import type { FastifyInstance } from 'fastify'
import { experienceService } from './index.js'

export async function experienceRoutes(app: FastifyInstance) {
  app.post('/api/experiences', async (request) => {
    const body = request.body as {
      category: string
      title: string
      content: string
      importance: number
    }
    if (!body.category || !body.title || !body.content) {
      return { status: 'error', error: 'INVALID_PARAMS', message: '缺少 category/title/content 参数' }
    }
    try {
      const id = experienceService.writeExperience(
        body.category,
        body.title,
        body.content,
        body.importance ?? 0.5,
      )
      return { status: 'success', data: { id } }
    } catch (err) {
      return { status: 'error', error: 'EXPERIENCE_ERROR', message: (err as Error).message }
    }
  })

  app.get('/api/experiences', async (request) => {
    const query = request.query as { q?: string; category?: string; top_k?: string }
    if (query.q) {
      const results = experienceService.recallExperiences(
        query.q,
        parseInt(query.top_k ?? '5'),
        query.category,
      )
      return { status: 'success', data: results }
    }

    const db = (await import('../../db/index.js')).getDb()
    let sql = 'SELECT * FROM experiences'
    const params: unknown[] = []
    if (query.category) {
      sql += ' WHERE category = ?'
      params.push(query.category)
    }
    sql += ' ORDER BY importance DESC LIMIT 20'
    const experiences = db.prepare(sql).all(...params)
    return { status: 'success', data: experiences }
  })

  app.post('/api/experiences/index', async () => {
    const count = experienceService.indexAllExperiences()
    return { status: 'success', data: { indexed: count } }
  })
}
