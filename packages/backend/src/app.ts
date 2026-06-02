import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import { initDb } from './db/index.js'
import { authRoutes } from './modules/integration/auth.routes.js'
import { deviceRoutes } from './modules/device/routes.js'
import { userDeviceRoutes } from './modules/device/user-device-routes.js'
import { roomRoutes } from './modules/device/room-routes.js'
import { userContextRoutes } from './modules/device/context-routes.js'
import { chatRoutes } from './modules/chat/routes.js'
import { workflowRoutes } from './modules/workflow/routes.js'
import { workflowSeedService } from './modules/workflow/seed.js'
import { llmProviderRoutes } from './modules/llm-provider/routes.js'
import { memoryRoutes } from './modules/memory/routes.js'
import { experienceRoutes } from './modules/experience/routes.js'
import { settingRoutes } from './modules/setting/routes.js'
import { skillRoutes } from './modules/skill/routes.js'
import { ruleRoutes } from './modules/rule/routes.js'
import { commandRoutes } from './modules/integration/command.routes.js'
import { compensationRoutes } from './modules/compensation/routes.js'
import { compensationService } from './modules/compensation/index.js'
import { cronRoutes } from './modules/cron/routes.js'
import { executorGatewayRoutes } from './modules/executor-gateway/routes.js'
import { manifestRegistryRoutes } from './modules/registry/routes.js'
import { approvalRoutes } from './modules/approval/routes.js'
import { agentInstanceRoutes } from './modules/agent-instance/routes.js'
// import { devtestRoutes } from './modules/devtest/routes.js'
import { intentRouterRoutes } from './modules/intent/routes.js'
import { deviceTypeSkillRoutes } from './modules/device-type-skill/routes.js'
import { memoryAssetsRoutes } from './modules/memory-assets/routes.js'
import { runtimeCapabilityMapRoutes } from './modules/runtime/routes.js'
import { mcpRegistryRoutes } from './modules/mcp-registry/routes.js'
import { externalIntegrationsService } from './modules/integration/index.js'
import { externalIntegrationRoutes } from './modules/integration/external-integrations.routes.js'
import { remoteWorkspaceRoutes } from './modules/remote-workspace/routes.js'
import { remoteWorkspaceService } from './modules/remote-workspace/index.js'
import { streamingGatewayRoutes } from './modules/streaming-gateway/routes.js'
import { eventBus } from './modules/event-bus/index.js'
// import { deviceStatePoller } from './modules/device-state-poller/index.js'
import { ruleEngine } from './modules/rule/index.js'
import { skillsService } from './modules/skills-system/index.js'
import { mcpRegistryService } from './modules/mcp-registry/index.js'
import { experienceService } from './modules/experience/index.js'
import { cronService } from './modules/cron/index.js'
import { agentInstanceService } from './modules/agent-instance/index.js'
import { agentAdapterRegistry } from './modules/agent-adapter/index.js'
import { llmService, seedDefaultProviders } from './modules/llm-provider/service.js'
import { cliBridge } from './modules/integration/index.js'
import { memoryKernel } from './modules/memory-kernel/index.js'
import { knowledgeCompiler } from './modules/knowledge-compiler/index.js'
import { executorGateway } from './modules/executor-gateway/index.js'
import { planLibrary } from './modules/plan-library/index.js'
import { assertWorkflowNodeRegistryIntegrity } from './modules/workflow/node-factory.js'
import './modules/registry/index.js'
import { channelRegistry } from './modules/channels/index.js'
import { stateMachine } from './modules/state-machine/index.js'

const wsClients = new Set<import('ws').WebSocket>()

export async function buildApp() {
  const app = Fastify({ logger: true })
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))

  await app.register(cors, { origin: true })
  await app.register(websocket)

  initDb()

  stateMachine.hydrate()

  agentInstanceService.ensureDefaults()
  agentAdapterRegistry.initialize()
  memoryKernel.initialize()
  await executorGateway.initialize()
  channelRegistry.register()
  assertWorkflowNodeRegistryIntegrity()
  workflowSeedService.ensureDefaults()
  ruleEngine.loadFromDb()

  // Serve the standalone Mi Home login test page
  app.get('/test.html', async (request, reply) => {
    const testHtmlPath = path.resolve(moduleDir, '..', '..', 'mi-cli', 'test.html')
    const content = fs.readFileSync(testHtmlPath, 'utf-8')
    reply.type('text/html').send(content)
  })

  // Reload persisted skills (especially source='converted' from prior promotions)
  // before overlaying disk skills, so the in-memory map survives restarts.
  skillsService.loadAll()

  const skillsDir = process.env.SKILLS_DIR || path.resolve(moduleDir, '..', '..', '..', 'skills')
  try {
    await skillsService.loadDiskSkills(skillsDir)
  } catch {}
  try {
    cliBridge.loadDiskExecutors(skillsDir)
  } catch {}

  experienceService.indexAllExperiences()
  knowledgeCompiler.refreshKnowledge()
  externalIntegrationsService.ensureDefaults()
  mcpRegistryService.ensureDefaults()
  seedDefaultProviders()

  setTimeout(() => {
    memoryKernel.rebuildCompiledKnowledgeEmbeddings()
      .then((result) => {
        app.log.info(
          `[startup] Knowledge embeddings rebuilt: ${result.stored}/${result.processed} ` +
          `(profile=${result.profile_name})`,
        )
      })
      .catch((err: Error) => {
        app.log.warn(`[startup] Knowledge embedding rebuild skipped: ${err.message}`)
      })
  }, 0)

  cronService.start(60000)

  const embeddingRefreshTimer = setInterval(() => {
    knowledgeCompiler.refreshKnowledge()
    memoryKernel.rebuildCompiledKnowledgeEmbeddings()
      .catch(() => {})
  }, 10 * 60 * 1000)

  const compensationTimer = setInterval(() => {
    compensationService.processPendingTasks()
  }, 30000)

  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  app.get('/api/services', async () => {
    const { serviceRegistry } = await import('./modules/registry/index.js')
    return { services: serviceRegistry.list() }
  })

  app.post('/api/services/:name/call', async (request) => {
    const { name } = request.params as { name: string }
    const params = (request.body as Record<string, unknown>) ?? {}
    const { serviceRegistry } = await import('./modules/registry/index.js')
    try {
      const result = await serviceRegistry.call(name, params)
      return { status: 'success', data: result }
    } catch (err) {
      return { status: 'error', error: 'SERVICE_ERROR', message: (err as Error).message }
    }
  })

  app.get('/api/executors', async () => {
    return { executors: cliBridge.listExecutors() }
  })

  app.register(authRoutes)
  app.register(deviceRoutes)
  app.register(userDeviceRoutes)
  app.register(roomRoutes)
  app.register(userContextRoutes)
  app.register(chatRoutes)
  app.register(workflowRoutes)
  app.register(llmProviderRoutes)
  app.register(memoryRoutes)
  app.register(experienceRoutes)
  app.register(settingRoutes)
  app.register(skillRoutes)
  app.register(ruleRoutes)
  app.register(commandRoutes)
  app.register(compensationRoutes)
  app.register(cronRoutes)
  app.register(executorGatewayRoutes)
  app.register(manifestRegistryRoutes)
  app.register(approvalRoutes)
  app.register(agentInstanceRoutes)
  // app.register(devtestRoutes)
  app.register(intentRouterRoutes)
  app.register(deviceTypeSkillRoutes)
  app.register(memoryAssetsRoutes)
  app.register(runtimeCapabilityMapRoutes)
  app.register(mcpRegistryRoutes)
  app.register(externalIntegrationRoutes)
  app.register(remoteWorkspaceRoutes)
  app.register(streamingGatewayRoutes)

  app.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (socket) => {
      wsClients.add(socket)

      socket.on('message', (msg: Buffer) => {
        const data = msg.toString()
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === 'subscribe' && parsed.event === 'state_changed') {
            socket.send(JSON.stringify({ type: 'subscribed', event: 'state_changed' }))
          }
          if (parsed.type === 'subscribe_devices') {
            socket.send(JSON.stringify({ type: 'subscribed', event: 'state_changed', dids: parsed.dids }))
          }
        } catch {}
      })

      socket.on('close', () => {
        wsClients.delete(socket)
      })
    })
  })

  eventBus.on('state_changed', (data) => {
    const msg = JSON.stringify({ type: 'state_changed', data })
    for (const client of wsClients) {
      if (client.readyState === 1) {
        client.send(msg)
      }
    }
  })

  eventBus.on('workflow_node_started', (data) => {
    const msg = JSON.stringify({ type: 'workflow_step', data: { ...(data as any), status: 'running' } })
    for (const client of wsClients) {
      if (client.readyState === 1) {
        client.send(msg)
      }
    }
  })

  eventBus.on('workflow_node_completed', (data) => {
    const msg = JSON.stringify({ type: 'workflow_step', data: { ...(data as any), status: 'succeeded' } })
    for (const client of wsClients) {
      if (client.readyState === 1) {
        client.send(msg)
      }
    }
  })

  eventBus.on('workflow_node_failed', (data) => {
    const msg = JSON.stringify({ type: 'workflow_step', data: { ...(data as any), status: 'failed' } })
    for (const client of wsClients) {
      if (client.readyState === 1) {
        client.send(msg)
      }
    }
  })

  eventBus.on('workflow_completed', (data) => {
    const msg = JSON.stringify({ type: 'workflow_completed', data: data as any })
    for (const client of wsClients) {
      if (client.readyState === 1) {
        client.send(msg)
      }
    }
  })

  eventBus.on('workflow_failed', (data) => {
    const msg = JSON.stringify({ type: 'workflow_failed', data: { ...(data as any), status: 'failed' } })
    for (const client of wsClients) {
      if (client.readyState === 1) {
        client.send(msg)
      }
    }
  })

  for (const channel of ['cron_fired', 'service_called', 'memory_observation', 'memory_remembered', 'compiled_knowledge_updated', 'service_registered', 'compensation_task_created', 'compensation_task_failed', 'compensation_task_succeeded', 'compensation_retry', 'rule_executed'] as const) {
    eventBus.on(channel, (data) => {
      const msg = JSON.stringify({ type: channel, data: data as any, ts: Date.now() })
      for (const client of wsClients) {
        if (client.readyState === 1) client.send(msg)
      }
    })
  }

  // deviceStatePoller.start(30000)

  app.addHook('onClose', async () => {
    clearInterval(compensationTimer)
    clearInterval(embeddingRefreshTimer)
    cronService.stop()
    remoteWorkspaceService.shutdown()
    // deviceStatePoller.stop()
    wsClients.clear()
  })

  return app
}
