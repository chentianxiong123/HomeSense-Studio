import type { FastifyInstance } from 'fastify'
import { agentInstanceService } from './index.js'

export async function agentInstanceRoutes(app: FastifyInstance) {
  app.get('/api/agents/instances', async () => {
    return { instances: agentInstanceService.listActive() }
  })

  app.get('/api/agents/instances/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const instance = agentInstanceService.getById(Number(id))
    if (!instance) {
      reply.code(404)
      return { status: 'error', error: 'NOT_FOUND' }
    }
    return { instance }
  })
}
