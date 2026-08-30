import type { FastifyInstance } from 'fastify'
import { runtimeCapabilityMapService } from './index.js'

export async function runtimeCapabilityMapRoutes(app: FastifyInstance) {
  app.get('/api/runtime-capabilities', async (request) => {
    const query = request.query as { device_limit?: string }
    const deviceLimit = query.device_limit == null ? undefined : Number(query.device_limit)
    const map = await runtimeCapabilityMapService.build({ deviceLimit })
    return { map }
  })
}
