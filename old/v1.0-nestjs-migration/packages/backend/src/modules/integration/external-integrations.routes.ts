import type { FastifyInstance } from 'fastify'
import { externalIntegrationsService } from './external-integrations.js'

export async function externalIntegrationRoutes(app: FastifyInstance) {
  app.get('/api/external-integrations', async () => {
    return { integrations: externalIntegrationsService.list() }
  })

  app.post('/api/external-integrations', async (request, reply) => {
    try {
      const integration = externalIntegrationsService.register((request.body as Record<string, unknown>) ?? {})
      return { status: 'success', integration }
    } catch (error) {
      reply.code(400)
      return { status: 'error', error: 'REGISTER_FAILED', message: (error as Error).message }
    }
  })

  app.delete('/api/external-integrations/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const removed = externalIntegrationsService.remove(Number(id))
    if (!removed) {
      reply.code(404)
      return { status: 'error', error: 'NOT_FOUND', message: `External integration not found: ${id}` }
    }
    return { status: 'success' }
  })
}
