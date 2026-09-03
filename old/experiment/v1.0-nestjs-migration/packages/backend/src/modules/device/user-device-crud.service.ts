import type Database from 'better-sqlite3'
import { getDb } from '../../db/index.js'
import { pingAllDevices } from './device-network.js'
import {
  buildDeviceCardProjection,
  buildDeviceRuntimeCard,
  type DeviceCardRow,
} from './device-card-projection.js'
import { buildDeviceRuntimeManifest } from './device-runtime-manifest.js'

export class UserDeviceCrudService {
  constructor(private readonly database?: Database.Database) {}

  withDb(database: Database.Database): UserDeviceCrudService {
    return new UserDeviceCrudService(database)
  }

  private get db() {
    return this.database ?? getDb()
  }

  listDevices() {
    const devices = this.db.prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      ORDER BY d.created_at DESC
    `).all()
    return { devices }
  }

  async listCards(checkOnline: boolean) {
    const devices = this.db.prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      ORDER BY d.created_at DESC
    `).all() as DeviceCardRow[]
    const cards = checkOnline
      ? await Promise.all(devices.map((device) => buildDeviceRuntimeCard(device)))
      : devices.map((device) => buildDeviceCardProjection(device))
    return { cards }
  }

  async getRuntimeManifest(input: { online?: boolean; capabilities?: string; limit?: number }) {
    const includeCapabilities = input.capabilities === 'full'
      ? 'full'
      : input.capabilities === 'none'
        ? 'none'
        : 'summary'
    const manifest = await buildDeviceRuntimeManifest({
      online: Boolean(input.online),
      includeCapabilities,
      limit: input.limit ?? 20,
    })
    return { manifest }
  }

  async pingAll() {
    const online = await pingAllDevices()
    return { online }
  }

  getDevice(id: number) {
    const device = this.db.prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.id = ?
    `).get(id)
    if (!device) return { status: 'error', error: 'NOT_FOUND' }
    return { device }
  }

  createDevice(body: {
    name: string
    device_type?: string
    room_id?: number | null
    mi_did?: string | null
    adb_ip?: string
    ip_address?: string
  }) {
    if (!body.name) return { status: 'error', error: 'INVALID_PARAMS', message: 'Name is required' }

    let adbIp = body.adb_ip?.trim() || ''
    if (adbIp && !adbIp.includes(':')) adbIp = `${adbIp}:5555`

    const result = this.db.prepare(`
      INSERT INTO user_devices (name, device_type, room_id, mi_did, adb_ip, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(body.name, body.device_type || 'other', body.room_id ?? null, body.mi_did || null, adbIp, body.ip_address || '')

    const device = this.db.prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.id = ?
    `).get(result.lastInsertRowid)

    return { status: 'success', data: { device } }
  }

  updateDevice(id: number, body: {
    name?: string
    device_type?: string
    room_id?: number | null
    mi_did?: string | null
    adb_ip?: string
    ip_address?: string
  }) {
    const sets: string[] = []
    const vals: unknown[] = []

    if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name) }
    if (body.device_type !== undefined) { sets.push('device_type = ?'); vals.push(body.device_type) }
    if (body.room_id !== undefined) { sets.push('room_id = ?'); vals.push(body.room_id ?? null) }
    if (body.mi_did !== undefined) { sets.push('mi_did = ?'); vals.push(body.mi_did || null) }
    if (body.adb_ip !== undefined) {
      const adbIp = body.adb_ip.trim()
      sets.push('adb_ip = ?')
      vals.push(adbIp && !adbIp.includes(':') ? `${adbIp}:5555` : adbIp)
    }
    if (body.ip_address !== undefined) { sets.push('ip_address = ?'); vals.push(body.ip_address) }

    if (sets.length === 0) return { status: 'error', error: 'INVALID_PARAMS', message: 'No fields to update' }

    sets.push("updated_at = datetime('now')")
    vals.push(id)
    this.db.prepare(`UPDATE user_devices SET ${sets.join(', ')} WHERE id = ?`).run(...vals)

    const device = this.db.prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.id = ?
    `).get(id)
    return { status: 'success', data: { device } }
  }

  deleteDevice(id: number) {
    this.db.prepare('DELETE FROM user_devices WHERE id = ?').run(id)
    return { status: 'success' }
  }
}

export const userDeviceCrudService = new UserDeviceCrudService()
