import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../db/database'
import { pingAllDevices } from './device-network'
import { buildDeviceCardProjection, buildDeviceRuntimeCard } from './device-card-projection'
import type {
  CreateUserDeviceInput,
  DeviceRuntimeManifest,
  UpdateUserDeviceInput,
  UserDevice,
} from './device.types'

const HISTORY_LOG = path.resolve(__dirname, '../../../../data/capability-usage.log')

@Injectable()
export class DeviceService {
  list(): UserDevice[] {
    return this.listRows()
  }

  async listCards(checkOnline: boolean) {
    const devices = this.listRows()
    const cards = checkOnline
      ? await Promise.all(devices.map((device) => buildDeviceRuntimeCard(device)))
      : devices.map((device) => buildDeviceCardProjection(device))
    return { cards }
  }

  async pingAll() {
    return { online: await pingAllDevices() }
  }

  async runtimeManifest(options: {
    online: boolean
    capabilities: 'none' | 'summary' | 'full'
    limit?: number
  }): Promise<{ manifest: DeviceRuntimeManifest }> {
    const devices = this.listRows(options.limit)
    const cards = options.online
      ? await Promise.all(devices.map((device) => buildDeviceRuntimeCard(device)))
      : devices.map((device) => buildDeviceCardProjection(device))
    return {
      manifest: {
        version: 1,
        generated_at: new Date().toISOString(),
        include_capabilities: options.capabilities,
        devices: cards.map((card) => {
          const caps = Array.isArray(card.props?.capabilities) ? card.props.capabilities as Array<Record<string, unknown>> : []
          return {
            ...card,
            capability_count: caps.length,
            ...(options.capabilities === 'none' ? {} : { capabilities: caps }),
          }
        }),
      },
    }
  }

  get(id: number): UserDevice {
    const device = this.getOptional(id)
    if (!device) throw new NotFoundException(`User device not found: ${id}`)
    return device
  }

  create(input: CreateUserDeviceInput): UserDevice {
    const body = this.normalizeWriteInput(input, true)
    const db = getDb()
    const result = db
      .prepare(`INSERT INTO devices (name, props) VALUES (?, ?)`)
      .run(body.name, JSON.stringify(body.props))
    return this.get(Number(result.lastInsertRowid))
  }

  update(id: number, input: UpdateUserDeviceInput): UserDevice {
    this.get(id)
    const body = this.normalizeWriteInput(input, false)
    if (Object.keys(body).length === 0) {
      throw new BadRequestException('No fields to update')
    }
    const sets: string[] = []
    const vals: unknown[] = []
    if (body.name !== undefined) {
      sets.push('name = ?')
      vals.push(body.name)
    }
    if (body.props !== undefined) {
      sets.push('props = ?')
      vals.push(JSON.stringify(body.props))
    }
    sets.push("updated_at = datetime('now')")
    vals.push(id)
    getDb().prepare(`UPDATE devices SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    return this.get(id)
  }

  remove(id: number): { status: 'deleted'; id: number } {
    this.get(id)
    getDb().prepare('DELETE FROM devices WHERE id = ?').run(id)
    return { status: 'deleted', id }
  }

  recordCapabilityUsage(input: {
    deviceId: number
    capability: string
    params?: string
    status: string
    result?: unknown
  }): void {
    fs.mkdirSync(path.dirname(HISTORY_LOG), { recursive: true })
    const result = input.result === undefined ? '' : JSON.stringify(input.result).replace(/\r?\n/g, ' ')
    const line = [
      new Date().toISOString(),
      input.deviceId,
      safeHistoryField(input.capability),
      safeHistoryField(input.params ?? ''),
      safeHistoryField(input.status),
      safeHistoryField(result),
    ].join('|')
    fs.writeFileSync(HISTORY_LOG, `${line}\n`, { flag: 'a' })
  }

  getCapabilityHistory(id: string) {
    if (!fs.existsSync(HISTORY_LOG)) return { history: [] }
    const lines = fs.readFileSync(HISTORY_LOG, 'utf-8').trim().split('\n').filter(Boolean)
    const history = lines
      .map((line) => {
        const [time, deviceId, capability, params, status, ...resultParts] = line.split('|')
        return {
          time,
          deviceId,
          capability,
          params,
          status,
          result: resultParts.join('|') || '',
        }
      })
      .filter((entry) => entry.deviceId === id)
      .slice(-100)
    return { history }
  }

  private listRows(limit?: number): UserDevice[] {
    const sql = `
      SELECT d.id, d.name, d.props, d.created_at, d.updated_at
      FROM devices d
      ORDER BY d.created_at DESC, d.id DESC
      ${limit ? 'LIMIT ?' : ''}
    `
    const statement = getDb().prepare(sql)
    const rows = (limit ? statement.all(limit) : statement.all()) as Array<{
      id: number
      name: string
      props: string
      created_at: string
      updated_at: string
    }>
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      props: safeParseProps(row.props),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
  }

  private getOptional(id: number): UserDevice | undefined {
    const row = getDb()
      .prepare(`SELECT id, name, props, created_at, updated_at FROM devices WHERE id = ?`)
      .get(id) as
      | {
          id: number
          name: string
          props: string
          created_at: string
          updated_at: string
        }
      | undefined
    if (!row) return undefined
    return {
      id: row.id,
      name: row.name,
      props: safeParseProps(row.props),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
  }

  private normalizeWriteInput(
    input: CreateUserDeviceInput | UpdateUserDeviceInput,
    creating: boolean,
  ): { name?: string; props?: Record<string, unknown> } {
    const body: { name?: string; props?: Record<string, unknown> } = {}
    const props: Record<string, unknown> = { ...(input.props ?? {}) }

    if (creating && (!input.name || !input.name.trim())) {
      throw new BadRequestException('name is required')
    }
    if (input.name !== undefined) {
      const name = input.name.trim()
      if (!name) throw new BadRequestException('name is required')
      body.name = name
    }

    const adbIp = typeof props.adb_ip === 'string' ? props.adb_ip : ''
    if (adbIp) props.adb_ip = normalizeAdbIp(adbIp)
    const ipAddress = typeof props.ip_address === 'string' ? props.ip_address : ''
    if (ipAddress) props.ip_address = ipAddress.trim()
    const miDid = typeof props.mi_did === 'string' ? props.mi_did : ''
    if (miDid === '') delete props.mi_did

    body.props = props
    return body
  }
}

function normalizeAdbIp(value: string): string {
  const adbIp = value.trim()
  return adbIp && !adbIp.includes(':') ? `${adbIp}:5555` : adbIp
}

function safeHistoryField(value: unknown): string {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '/')
}

function safeParseProps(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) ?? {}
  } catch {
    return {}
  }
}
