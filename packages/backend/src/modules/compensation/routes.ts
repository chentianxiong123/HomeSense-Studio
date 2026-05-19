import type { FastifyInstance } from 'fastify'
import { compensationService, type CompensationTask } from '../compensation/index.js'

export async function compensationRoutes(app: FastifyInstance) {
  app.post('/api/compensation/tasks', async (request) => {
    const body = request.body as {
      type: string
      params: Record<string, unknown>
      max_retries?: number
    }
    if (!body.type) {
      return { status: 'error', error: 'INVALID_PARAMS', message: '缺少 type 参数' }
    }
    const task = compensationService.createTask(body.type, body.params ?? {}, body.max_retries ?? 3)
    return { status: 'success', task }
  })

  app.get('/api/compensation/tasks', async () => {
    const tasks = compensationService.getPendingTasks()
    return { tasks }
  })

  app.get('/api/compensation/tasks/:id', async (request) => {
    const { id } = request.params as { id: string }
    const task = compensationService.getTask(Number(id))
    if (!task) {
      return { status: 'error', error: 'NOT_FOUND' }
    }
    return { task }
  })

  app.post('/api/compensation/tasks/:id/retry', async (request) => {
    const { id } = request.params as { id: string }
    const task = compensationService.getTask(Number(id))
    if (!task) {
      return { status: 'error', error: 'NOT_FOUND' }
    }
    const success = await compensationService.retryWithBackoff(task)
    return { status: 'success', success }
  })

  app.post('/api/compensation/tasks/:id/preview', async (request) => {
    const { id } = request.params as { id: string }
    const task = compensationService.getTask(Number(id))
    if (!task) {
      return { status: 'error', error: 'NOT_FOUND' }
    }
    const result = compensationService.preview(task)
    return { status: 'success', result }
  })

  app.post('/api/compensation/process', async () => {
    compensationService.processPendingTasks()
    return { status: 'success' }
  })
}
