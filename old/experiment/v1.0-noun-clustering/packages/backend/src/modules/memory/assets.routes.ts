import type { FastifyInstance } from 'fastify'
import { memoryAssetsService, type RecordExperiencePathInput } from './assets.js'

export async function memoryAssetsRoutes(app: FastifyInstance) {
  app.get('/api/assets/memory', async () => {
    return {
      assets: memoryAssetsService.list(),
      summary: memoryAssetsService.summary(),
    }
  })

  app.get('/api/assets/memory/:id', async (request, reply) => {
    const id = String((request.params as { id?: string }).id ?? '')
    const asset = memoryAssetsService.get(id)
    if (!asset) {
      reply.code(404)
      return {
        status: 'error',
        error: 'MEMORY_ASSET_NOT_FOUND',
        message: `Memory asset not found: ${id}`,
      }
    }
    return { asset }
  })

  app.post('/api/assets/memory/experience-paths', async (request, reply) => {
    try {
      const asset = memoryAssetsService.recordExperiencePath(request.body as RecordExperiencePathInput)
      return { status: 'success', asset }
    } catch (error) {
      reply.code(400)
      return {
        status: 'error',
        error: 'INVALID_EXPERIENCE_PATH',
        message: (error as Error).message,
      }
    }
  })
}
