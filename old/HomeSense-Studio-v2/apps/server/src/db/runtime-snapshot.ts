import { getDb } from './database'

export function readRuntimeSnapshot<T>(key: string): T | null {
  const row = getDb()
    .prepare('SELECT value_json FROM runtime_snapshots WHERE key = ?')
    .get(key) as { value_json: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return null
  }
}

export function writeRuntimeSnapshot(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO runtime_snapshots (key, value_json, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = datetime('now')`,
    )
    .run(key, JSON.stringify(value ?? {}))
}

export function deleteRuntimeSnapshot(key: string): void {
  getDb().prepare('DELETE FROM runtime_snapshots WHERE key = ?').run(key)
}
