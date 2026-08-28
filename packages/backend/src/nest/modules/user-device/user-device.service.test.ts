import { describe, expect, it, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { UserDeviceService } from './user-device.service.js'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE user_devices (
      id INTEGER NOT NULL, name TEXT NOT NULL,
      device_type TEXT NOT NULL DEFAULT 'other',
      room_id INTEGER NULL REFERENCES rooms(id) ON DELETE SET NULL,
      mi_did TEXT NULL,
      adb_ip TEXT NOT NULL DEFAULT '', ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id AUTOINCREMENT)
    );
  `)
  return db
}

describe('UserDeviceService', () => {
  let svc: UserDeviceService

  beforeEach(() => {
    svc = new UserDeviceService().withDb(makeDb())
  })

  it('starts empty', () => {
    expect(svc.list()).toEqual([])
  })

  it('creates a device with default device_type=other', () => {
    const d = svc.create({ name: 'Toshiba TV' })
    expect(d.name).toBe('Toshiba TV')
    expect(d.device_type).toBe('other')
    expect(d.id).toBeGreaterThan(0)
  })

  it('creates a device with explicit fields', () => {
    const d = svc.create({ name: 'XiaoAi', device_type: 'speaker', ip_address: '192.168.1.10', mi_did: 'abc123' })
    expect(d.device_type).toBe('speaker')
    expect(d.ip_address).toBe('192.168.1.10')
    expect(d.mi_did).toBe('abc123')
  })

  it('rejects invalid device_type', () => {
    expect(() => svc.create({ name: 'X', device_type: 'spaceship' as 'other' })).toThrow(/Invalid device_type/)
  })

  it('rejects missing name', () => {
    expect(() => svc.create({ name: '' as string })).toThrow(/name is required/)
  })

  it('gets a device by id', () => {
    const created = svc.create({ name: 'A' })
    const got = svc.get(created.id)
    expect(got.id).toBe(created.id)
    expect(got.name).toBe('A')
  })

  it('throws on missing id', () => {
    expect(() => svc.get(99999)).toThrow(/not found/i)
  })

  it('updates a device', () => {
    const created = svc.create({ name: 'A' })
    const updated = svc.update(created.id, { name: 'A2', device_type: 'television' })
    expect(updated.name).toBe('A2')
    expect(updated.device_type).toBe('television')
  })

  it('deletes a device', () => {
    const created = svc.create({ name: 'A' })
    const result = svc.remove(created.id)
    expect(result.status).toBe('deleted')
    expect(svc.list()).toEqual([])
  })

  it('joins room name when listing', () => {
    const db = makeDb()
    db.prepare('INSERT INTO rooms (name) VALUES (?)').run('Living Room')
    db.prepare('INSERT INTO rooms (name) VALUES (?)').run('Kitchen')
    db.prepare('INSERT INTO user_devices (name, room_id) VALUES (?, ?)').run('TV', 1)
    db.prepare('INSERT INTO user_devices (name, room_id) VALUES (?, ?)').run('Speaker', 2)
    const localSvc = new UserDeviceService().withDb(db)
    const list = localSvc.list()
    const tv = list.find((d) => d.name === 'TV')
    expect(tv?.room_name).toBe('Living Room')
  })
})
