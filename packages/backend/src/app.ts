import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { fileURLToPath } from 'url'
import path from 'path'
import { initDb } from './db/index.js'
import { authRoutes } from './modules/auth/routes.js'
import { deviceRoutes } from './modules/device/routes.js'
import { chatRoutes } from './modules/chat/routes.js'
import { chatStreamRoutes } from './modules/chat/stream.js'
import { workflowRoutes } from './modules/workflow/routes.js'
import { workflowSeedService } from './modules/workflow/seed.js'
import { llmProviderRoutes } from './modules/llm-provider/routes.js'
import { memoryRoutes } from './modules/memory/routes.js'
import { experienceRoutes } from './modules/experience/routes.js'
import { settingRoutes } from './modules/setting/routes.js'
import { skillRoutes } from './modules/skill/routes.js'
import { ruleRoutes } from './modules/rule/routes.js'
import { compensationRoutes } from './modules/compensation/routes.js'
import { cronRoutes } from './modules/cron/routes.js'
import { executorGatewayRoutes } from './modules/executor-gateway/routes.js'
import { manifestRegistryRoutes } from './modules/manifest-registry/routes.js'
import { approvalRoutes } from './modules/approval/routes.js'
import { agentInstanceRoutes } from './modules/agent-instance/routes.js'
import { devtestRoutes } from './modules/devtest/routes.js'
import { intentRouterRoutes } from './modules/intent-router/routes.js'
import { eventBus } from './modules/event-bus/index.js'
import { deviceStatePoller } from './modules/device-state-poller/index.js'
import { ruleEngine } from './modules/rule-engine/index.js'
import { skillsService } from './modules/skills-system/index.js'
import { experienceService } from './modules/experience/index.js'
import { cronService } from './modules/cron/index.js'
import { processPendingTasks } from './modules/compensation/index.js'
import { agentInstanceService } from './modules/agent-instance/index.js'
import { agentAdapterRegistry } from './modules/agent-adapter/index.js'
import { llmService } from './modules/llm-provider/service.js'
import { cliBridge } from './modules/cli-bridge/index.js'
import { memoryKernel } from './modules/memory-kernel/index.js'
import { knowledgeCompiler } from './modules/knowledge-compiler/index.js'
import { executorGateway } from './modules/executor-gateway/index.js'
import { planLibrary } from './modules/plan-library/index.js'
import { assertWorkflowNodeRegistryIntegrity } from './modules/workflow/node-factory.js'
import './modules/service-registry/index.js'
import { channelRegistry } from './modules/channels/index.js'

const wsClients = new Set<import('ws').WebSocket>()

export async function buildApp() {
  const app = Fastify({ logger: true })
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))

  await app.register(cors, { origin: true })
  await app.register(websocket)

  initDb()

  agentInstanceService.ensureDefaults()
  agentAdapterRegistry.initialize()
  llmService.seedSlotsFromEnv()
  memoryKernel.initialize()
  planLibrary.loadLegacyPlans()
  executorGateway.initialize()
  channelRegistry.register()
  assertWorkflowNodeRegistryIntegrity()
  workflowSeedService.ensureDefaults()
  ruleEngine.loadFromDb()

  const skillsDir = process.env.SKILLS_DIR || path.resolve(moduleDir, '..', '..', '..', 'skills')
  try {
    await skillsService.loadDiskSkills(skillsDir)
  } catch {}
  try {
    cliBridge.loadDiskExecutors(skillsDir)
  } catch {}

  experienceService.indexAllExperiences()
  knowledgeCompiler.refreshKnowledge()

  cronService.start(60000)

  const compensationTimer = setInterval(() => {
    processPendingTasks()
  }, 30000)

  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  app.get('/api/services', async () => {
    const { serviceRegistry } = await import('./modules/service-registry/index.js')
    return { services: serviceRegistry.list() }
  })

  app.post('/api/services/:name/call', async (request) => {
    const { name } = request.params as { name: string }
    const params = (request.body as Record<string, unknown>) ?? {}
    const { serviceRegistry } = await import('./modules/service-registry/index.js')
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
  app.register(chatRoutes)
  app.register(chatStreamRoutes)
  app.register(workflowRoutes)
  app.register(llmProviderRoutes)
  app.register(memoryRoutes)
  app.register(experienceRoutes)
  app.register(settingRoutes)
  app.register(skillRoutes)
  app.register(ruleRoutes)
  app.register(compensationRoutes)
  app.register(cronRoutes)
  app.register(executorGatewayRoutes)
  app.register(manifestRegistryRoutes)
  app.register(approvalRoutes)
  app.register(agentInstanceRoutes)
  app.register(devtestRoutes)
  app.register(intentRouterRoutes)

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

  eventBus.listen('state_changed', (data) => {
    const msg = JSON.stringify({ type: 'state_changed', data })
    for (const client of wsClients) {
      if (client.readyState === 1) {
        client.send(msg)
      }
    }
  })

  eventBus.listen('workflow_node_started', (data) => {
    const msg = JSON.stringify({ type: 'workflow_step', data: { ...(data as any), status: 'running' } })
    for (const client of wsClients) {
      if (client.readyState === 1) {
        client.send(msg)
      }
    }
  })

  eventBus.listen('workflow_node_completed', (data) => {
    const msg = JSON.stringify({ type: 'workflow_step', data: { ...(data as any), status: 'succeeded' } })
    for (const client of wsClients) {
      if (client.readyState === 1) {
        client.send(msg)
      }
    }
  })

  eventBus.listen('workflow_node_failed', (data) => {
    const msg = JSON.stringify({ type: 'workflow_step', data: { ...(data as any), status: 'failed' } })
    for (const client of wsClients) {
      if (client.readyState === 1) {
        client.send(msg)
      }
    }
  })

  eventBus.listen('workflow_completed', (data) => {
    const msg = JSON.stringify({ type: 'workflow_completed', data: data as any })
    for (const client of wsClients) {
      if (client.readyState === 1) {
        client.send(msg)
      }
    }
  })

  for (const channel of ['cron_fired', 'service_called', 'memory_observation', 'memory_remembered', 'compiled_knowledge_updated', 'service_registered', 'compensation_task_created', 'rule_executed'] as const) {
    eventBus.listen(channel, (data) => {
      const msg = JSON.stringify({ type: channel, data: data as any, ts: Date.now() })
      for (const client of wsClients) {
        if (client.readyState === 1) client.send(msg)
      }
    })
  }

  deviceStatePoller.start(30000)

  app.addHook('onClose', async () => {
    clearInterval(compensationTimer)
    cronService.stop()
    deviceStatePoller.stop()
    wsClients.clear()
  })

  return app
}
