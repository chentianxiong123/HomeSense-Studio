import type { FastifyInstance } from 'fastify'
import { mcpRegistryService } from './index.js'

export async function mcpRegistryRoutes(app: FastifyInstance) {
  app.get('/api/mcp/servers', async () => {
    return { servers: mcpRegistryService.list() }
  })

  app.get('/api/mcp/servers/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const server = mcpRegistryService.get(Number(id))
    if (!server) {
      reply.code(404)
      return { status: 'error', error: 'NOT_FOUND', message: `MCP server not found: ${id}` }
    }
    return { server }
  })

  app.post('/api/mcp/servers', async (request, reply) => {
    try {
      const server = mcpRegistryService.register((request.body as Record<string, unknown>) ?? {})
      return { status: 'success', server }
    } catch (error) {
      reply.code(400)
      return { status: 'error', error: 'REGISTER_FAILED', message: (error as Error).message }
    }
  })

  app.delete('/api/mcp/servers/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const removed = mcpRegistryService.remove(Number(id))
    if (!removed) {
      reply.code(404)
      return { status: 'error', error: 'NOT_FOUND', message: `MCP server not found: ${id}` }
    }
    return { status: 'success' }
  })
}
