import { describe, it, expect } from 'vitest'
import { createInMemoryDb } from '../db/index.js'

describe('test-support · createInMemoryDb', () => {
  it('creates a fresh database with full schema', () => {
    const db = createInMemoryDb()

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>

    const names = tables.map((t) => t.name)
    expect(names).not.toContain('devices')
    expect(names).not.toContain('device_features')
    expect(names).not.toContain('entities')
    expect(names).not.toContain('entity_states')
    expect(names).not.toContain('state_history')
    expect(names).toContain('memory_entities')
    expect(names).toContain('memory_triples')
    expect(names).toContain('memory_attributes')
    expect(names).toContain('experiences')
    expect(names).toContain('skills')
    expect(names).toContain('compiled_knowledge_items')
    expect(names).toContain('conversations')
  })

  it('starts each database empty (test isolation)', () => {
    const dbA = createInMemoryDb()
    const dbB = createInMemoryDb()

    dbA.prepare("INSERT INTO conversations DEFAULT VALUES").run()
    const countA = (dbA.prepare("SELECT COUNT(*) AS c FROM conversations").get() as { c: number }).c
    const countB = (dbB.prepare("SELECT COUNT(*) AS c FROM conversations").get() as { c: number }).c

    expect(countA).toBe(1)
    expect(countB).toBe(0)
  })

  it('supports memory_entities + memory_attributes inserts', () => {
    const db = createInMemoryDb()

    db.prepare(
      `INSERT INTO memory_entities (id, name, type, wing, room) VALUES (?, ?, ?, ?, ?)`,
    ).run('device.test_lamp', 'Test Lamp', 'device', 'home', 'living')

    db.prepare(
      `INSERT INTO memory_attributes (entity_id, key, value) VALUES (?, ?, ?)`,
    ).run('device.test_lamp', 'brightness', '50')

    const attr = db.prepare(
      `SELECT key, value FROM memory_attributes WHERE entity_id = ? AND valid_to IS NULL`,
    ).get('device.test_lamp') as { key: string; value: string }

    expect(attr.key).toBe('brightness')
    expect(attr.value).toBe('50')
  })

  it('supports FTS5 virtual tables', () => {
    const db = createInMemoryDb()

    db.prepare(
      `INSERT INTO experiences_fts (title, content, category) VALUES (?, ?, ?)`,
    ).run('test exp', 'turning on the living room lamp', 'device-control')

    const rows = db.prepare(
      `SELECT title FROM experiences_fts WHERE experiences_fts MATCH ?`,
    ).all('lamp') as Array<{ title: string }>

    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].title).toBe('test exp')
  })
})
