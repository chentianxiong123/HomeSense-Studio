import { getDb } from '../db/database'

export type TerminalTargetKind = 'local' | 'ssh' | 'adb'

export type TerminalTarget = {
  id: number
  name: string
  kind: TerminalTargetKind
  target: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type CreateTerminalTargetInput = {
  name: string
  kind: TerminalTargetKind
  target: Record<string, unknown>
}

export type UpdateTerminalTargetInput = {
  name?: string
  target?: Record<string, unknown>
}

function rowToTarget(row: any): TerminalTarget {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    target: JSON.parse(row.target_json || '{}'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export const TerminalTargetService = {
  list(): TerminalTarget[] {
    const rows = getDb()
      .prepare('SELECT id, name, kind, target_json, created_at, updated_at FROM terminal_targets ORDER BY created_at DESC, id DESC')
      .all() as any[]
    return rows.map(rowToTarget)
  },

  get(id: number): TerminalTarget | undefined {
    const row = getDb()
      .prepare('SELECT id, name, kind, target_json, created_at, updated_at FROM terminal_targets WHERE id = ?')
      .get(id) as any
    return row ? rowToTarget(row) : undefined
  },

  create(input: CreateTerminalTargetInput): TerminalTarget {
    const result = getDb()
      .prepare('INSERT INTO terminal_targets (name, kind, target_json) VALUES (?, ?, ?)')
      .run(input.name, input.kind, JSON.stringify(input.target))
    return TerminalTargetService.get(Number(result.lastInsertRowid))!
  },

  update(id: number, input: UpdateTerminalTargetInput): TerminalTarget {
    const existing = TerminalTargetService.get(id)
    if (!existing) throw new Error(`terminal target not found: ${id}`)
    const sets: string[] = []
    const params: unknown[] = []
    if (input.name !== undefined) { sets.push('name = ?'); params.push(input.name) }
    if (input.target !== undefined) { sets.push('target_json = ?'); params.push(JSON.stringify(input.target)) }
    if (sets.length === 0) return existing
    sets.push("updated_at = datetime('now')")
    params.push(id)
    getDb().prepare(`UPDATE terminal_targets SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return TerminalTargetService.get(id)!
  },

  remove(id: number): boolean {
    const result = getDb().prepare('DELETE FROM terminal_targets WHERE id = ?').run(id)
    return result.changes > 0
  },
}
