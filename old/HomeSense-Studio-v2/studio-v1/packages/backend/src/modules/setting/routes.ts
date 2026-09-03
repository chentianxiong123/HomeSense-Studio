import type { FastifyInstance } from 'fastify'

export async function settingRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => {
    return { settings: {} }
  })

  app.put('/api/settings', async () => {
    return { status: 'error', error: 'NOT_IMPLEMENTED' }
  })
}
