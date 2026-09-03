import type { FastifyInstance } from 'fastify'
import { approvalRegistry, type ApprovalDecision } from './index.js'

export async function approvalRoutes(app: FastifyInstance) {
  app.get('/api/approvals', async () => {
    return { approvals: approvalRegistry.list() }
  })

  app.get('/api/approvals/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const record = approvalRegistry.get(id)
    if (!record) {
      reply.code(404)
      return { status: 'error', error: 'NOT_FOUND' }
    }
    return { approval: record }
  })

  app.post('/api/approvals/:id/resolve', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as { decision?: ApprovalDecision }
    const decision = body?.decision
    if (decision !== 'approved' && decision !== 'denied') {
      reply.code(400)
      return { status: 'error', error: 'INVALID_DECISION' }
    }
    const resolved = approvalRegistry.resolve(id, decision)
    if (!resolved) {
      reply.code(409)
      return { status: 'error', error: 'ALREADY_RESOLVED_OR_MISSING' }
    }
    return { status: 'success', approval: approvalRegistry.get(id) }
  })
}
