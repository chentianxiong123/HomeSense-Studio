import type { FastifyInstance } from 'fastify'
import { manifestRegistry } from './index.js'
import { executorGateway } from '../executor-gateway/index.js'

export async function manifestRegistryRoutes(app: FastifyInstance) {
  app.get('/api/manifests', async (request) => {
    const query = request.query as { kind?: string }
    if (query.kind) {
      return { manifests: manifestRegistry.listByKind(query.kind as never) }
    }
    return { manifests: manifestRegistry.list(), summary: manifestRegistry.summary() }
  })

  app.get('/api/manifests/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const manifest = manifestRegistry.get(id)
    if (!manifest) {
      reply.code(404)
      return { status: 'error', error: 'NOT_FOUND', message: `Manifest not found: ${id}` }
    }
    return { manifest }
  })

  app.post('/api/manifests/:id/invoke', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = (request.body as Record<string, unknown>) ?? {}
    const manifest = manifestRegistry.get(id)
    if (!manifest) {
      reply.code(404)
      return { status: 'error', error: 'NOT_FOUND', message: `Manifest not found: ${id}` }
    }

    const started = Date.now()
    try {
      const result = await dispatchManifest(manifest, body)
      return {
        status: 'success',
        manifest_id: id,
        kind: manifest.kind,
        duration_ms: Date.now() - started,
        data: result,
      }
    } catch (err) {
      reply.code(400)
      return {
        status: 'error',
        manifest_id: id,
        kind: manifest.kind,
        duration_ms: Date.now() - started,
        error: 'INVOKE_FAILED',
        message: (err as Error).message,
      }
    }
  })
}

async function dispatchManifest(
  manifest: ReturnType<typeof manifestRegistry.get> & {},
  body: Record<string, unknown>,
) {
  const targetId = manifest.id.includes('.') ? manifest.id.split('.').slice(1).join('.') : manifest.id

  if (manifest.kind === 'cli') {
    const action = String(body.action ?? '')
    const params = (body.params as Record<string, unknown>) ?? {}
    if (!action) throw new Error('action is required for CLI manifest')
    return executorGateway.invoke('cli.invoke', {
      cli_name: targetId,
      action,
      params,
    })
  }

  if (manifest.kind === 'service' || manifest.kind === 'channel') {
    const params = (body.params as Record<string, unknown>) ?? {}
    return executorGateway.invoke('service.invoke', {
      service_name: targetId,
      params,
    })
  }

  if (manifest.kind === 'agent' || manifest.kind === 'a2a') {
    const task = String(body.task ?? '')
    const payload = (body.payload as Record<string, unknown>) ?? {}
    const execution_mode = String(body.execution_mode ?? 'deferred') as 'deferred' | 'immediate'
    if (!task) throw new Error('task is required for agent manifest')
    return executorGateway.invoke('agent.dispatch', {
      target: targetId,
      task,
      payload,
      execution_mode,
    })
  }

  throw new Error(`Unsupported manifest kind: ${manifest.kind}`)
}
