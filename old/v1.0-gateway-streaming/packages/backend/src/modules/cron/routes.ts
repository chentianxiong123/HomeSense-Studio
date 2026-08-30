import type { FastifyInstance } from 'fastify'
import { cronService } from '../cron/index.js'

export async function cronRoutes(app: FastifyInstance) {
  app.get('/api/cron/schedules', async () => {
    const schedules = cronService.listSchedules()
    return { schedules }
  })

  app.post('/api/cron/schedules', async (request) => {
    const body = request.body as {
      cron: string
      workflow_id?: number
    }
    if (!body.cron) {
      return { status: 'error', error: 'INVALID_PARAMS', message: '缺少 cron 参数' }
    }
    try {
      const id = cronService.addSchedule(body.cron, async () => {
        if (body.workflow_id) {
          const { workflowRuntime } = await import('../workflow/run-workflow.js')
          await workflowRuntime.runWorkflow(body.workflow_id)
        }
      })
      return { status: 'success', schedule_id: id }
    } catch (err) {
      return { status: 'error', error: 'INVALID_CRON', message: (err as Error).message }
    }
  })

  app.delete('/api/cron/schedules/:id', async (request) => {
    const { id } = request.params as { id: string }
    cronService.removeSchedule(id)
    return { status: 'success' }
  })
}
