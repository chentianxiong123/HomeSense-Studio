import type { FastifyInstance } from 'fastify'
import { executorGateway } from './index.js'
import { cliBridge } from '../integration/index.js'

export async function executorGatewayRoutes(app: FastifyInstance) {
  app.get('/api/executor-gateway/executors', async () => {
    return {
      executors: executorGateway.listExecutors(),
      cli_executors: cliBridge.listExecutors(),
    }
  })

  app.post('/api/executor-gateway/executors/:name/invoke', async (request) => {
    const { name } = request.params as { name: string }
    const params = (request.body as Record<string, unknown>) ?? {}
    return executorGateway.invoke(name, params)
  })

  app.get('/api/executor-gateway/plans', async () => {
    return { plans: executorGateway.listPlans() }
  })

  app.get('/api/executor-gateway/plans/:id', async (request) => {
    const { id } = request.params as { id: string }
    const preview = executorGateway.previewPlan(id)
    if (!preview) {
      return { status: 'error', error: 'NOT_FOUND', message: `Plan not found: ${id}` }
    }
    return { status: 'success', data: preview }
  })

  app.post('/api/executor-gateway/plans/:id/run', async (request) => {
    const { id } = request.params as { id: string }
    try {
      return { status: 'success', data: await executorGateway.runPlan(id) }
    } catch (error) {
      return { status: 'error', error: 'PLAN_RUN_ERROR', message: (error as Error).message }
    }
  })
}
