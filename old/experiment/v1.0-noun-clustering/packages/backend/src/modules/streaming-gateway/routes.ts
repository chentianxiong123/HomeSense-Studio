import type { FastifyInstance } from 'fastify'
import { streamingGatewayService } from './index.js'

export async function streamingGatewayRoutes(app: FastifyInstance) {
  app.get('/api/streaming-gateway/hosts', async () => {
    return { status: 'success', data: streamingGatewayService.listHosts() }
  })

  app.post('/api/streaming-gateway/hosts', async (request, reply) => {
    try {
      const host = streamingGatewayService.registerHost((request.body as Record<string, unknown>) ?? {})
      return { status: 'success', data: host }
    } catch (error) {
      reply.code(400)
      return { status: 'error', error: 'REGISTER_STREAMING_HOST_FAILED', message: (error as Error).message }
    }
  })

  app.delete('/api/streaming-gateway/hosts/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const removed = streamingGatewayService.removeHost(id)
    if (!removed) {
      reply.code(404)
      return { status: 'error', error: 'NOT_FOUND', message: `Streaming host not found: ${id}` }
    }
    return { status: 'success' }
  })

  app.post('/api/streaming-gateway/hosts/:id/probe', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = await streamingGatewayService.probeHost(id)
    if (!result) {
      reply.code(404)
      return { status: 'error', error: 'NOT_FOUND', message: `Streaming host not found: ${id}` }
    }
    return { status: 'success', data: result }
  })

  app.post('/api/streaming-gateway/hosts/:id/wake', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const result = await streamingGatewayService.wakeHost(id)
      if (!result) {
        reply.code(404)
        return { status: 'error', error: 'NOT_FOUND', message: `Streaming host not found: ${id}` }
      }
      return { status: 'success', data: result }
    } catch (error) {
      reply.code(400)
      return { status: 'error', error: 'WAKE_STREAMING_HOST_FAILED', message: (error as Error).message }
    }
  })

  app.get('/api/streaming-gateway/runtime', async () => {
    return { status: 'success', data: await streamingGatewayService.getRuntimeStatus() }
  })
}
