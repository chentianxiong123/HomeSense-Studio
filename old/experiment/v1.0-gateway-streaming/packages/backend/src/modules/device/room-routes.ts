import type { FastifyInstance } from 'fastify'
import { getDb } from '../../db/index.js'

export async function roomRoutes(app: FastifyInstance) {
  app.get('/api/rooms', async () => {
    const db = getDb()
    const rooms = db.prepare('SELECT * FROM rooms ORDER BY name ASC').all()
    return { rooms }
  })

  app.get('/api/rooms/:id', async (request) => {
    const { id } = request.params as { id: string }
    const db = getDb()
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(id))
    if (!room) return { status: 'error', error: 'NOT_FOUND' }
    return { room }
  })

  app.post('/api/rooms', async (request) => {
    const body = request.body as { name: string }
    if (!body.name || !body.name.trim()) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'Name is required' }
    }
    const db = getDb()
    const result = db.prepare('INSERT INTO rooms (name) VALUES (?)').run(body.name.trim())
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(result.lastInsertRowid)
    return { status: 'success', data: { room } }
  })

  app.put('/api/rooms/:id', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as { name?: string }
    if (!body.name || !body.name.trim()) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'Name is required' }
    }
    const db = getDb()
    db.prepare("UPDATE rooms SET name = ?, updated_at = datetime('now') WHERE id = ?").run(body.name.trim(), Number(id))
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(id))
    return { status: 'success', data: { room } }
  })

  app.delete('/api/rooms/:id', async (request) => {
    const { id } = request.params as { id: string }
    const db = getDb()
    db.prepare('DELETE FROM rooms WHERE id = ?').run(Number(id))
    return { status: 'success' }
  })
}