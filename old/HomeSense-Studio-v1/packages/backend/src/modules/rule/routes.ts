import type { FastifyInstance } from 'fastify'
import { getDb } from '../../db/index.js'
import { ruleEngine } from '../rule-engine/index.js'

export async function ruleRoutes(app: FastifyInstance) {
  app.get('/api/rules', async () => {
    const rules = ruleEngine.listRules()
    return { rules }
  })

  app.post('/api/rules', async (request) => {
    const body = request.body as {
      trigger_pattern: string
      priority?: number
      actions: Array<{ tool: string; action: string; params: Record<string, unknown>; order: number }>
    }
    if (!body.trigger_pattern || !body.actions?.length) {
      return { status: 'error', error: 'INVALID_PARAMS', message: '缺少 trigger_pattern/actions 参数' }
    }
    const rule = ruleEngine.addRule({
      id: 0,
      trigger_pattern: body.trigger_pattern,
      priority: body.priority ?? 5,
      enabled: true,
      actions: body.actions,
    })
    return { status: 'success', rule }
  })

  app.get('/api/rules/:id', async (request) => {
    const { id } = request.params as { id: string }
    const rules = ruleEngine.listRules()
    const rule = rules.find((r: any) => r.id === Number(id))
    if (!rule) {
      return { status: 'error', error: 'NOT_FOUND' }
    }
    return { rule }
  })

  app.put('/api/rules/:id', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as {
      trigger_pattern?: string
      priority?: number
      enabled?: boolean
      actions?: Array<{ tool: string; action: string; params: Record<string, unknown>; order: number }>
    }
    const db = getDb()
    const ruleId = Number(id)

    const existing = db.prepare('SELECT * FROM rules WHERE id = ?').get(ruleId)
    if (!existing) {
      return { status: 'error', error: 'NOT_FOUND' }
    }

    const updates: string[] = []
    const values: unknown[] = []
    if (body.trigger_pattern !== undefined) { updates.push('trigger_pattern = ?'); values.push(body.trigger_pattern) }
    if (body.priority !== undefined) { updates.push('priority = ?'); values.push(body.priority) }
    if (body.enabled !== undefined) { updates.push('enabled = ?'); values.push(body.enabled ? 1 : 0) }

    if (updates.length > 0) {
      values.push(ruleId)
      db.prepare(`UPDATE rules SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    }

    if (body.actions) {
      db.prepare('DELETE FROM rule_actions WHERE rule_id = ?').run(ruleId)
      const insertAction = db.prepare(
        `INSERT INTO rule_actions (rule_id, tool, action, params_json, "order") VALUES (?, ?, ?, ?, ?)`,
      )
      for (const action of body.actions) {
        insertAction.run(ruleId, action.tool, action.action, JSON.stringify(action.params), action.order)
      }
    }

    ruleEngine.loadFromDb()
    return { status: 'success' }
  })

  app.delete('/api/rules/:id', async (request) => {
    const { id } = request.params as { id: string }
    ruleEngine.removeRule(Number(id))
    return { status: 'success' }
  })

  app.patch('/api/rules/:id/toggle', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as { enabled: boolean }
    const db = getDb()
    db.prepare('UPDATE rules SET enabled = ? WHERE id = ?').run(body.enabled ? 1 : 0, Number(id))
    ruleEngine.loadFromDb()
    return { status: 'success' }
  })
}
