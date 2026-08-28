/**
 * Port: Device
 *
 * Every device interaction in the system goes through this port.
 * Implementations may wrap adb, mqtt, http, or a sandbox simulator.
 */

export type DeviceStatus = 'online' | 'offline' | 'unknown'

export interface DeviceRecord {
  id: string
  name: string
  type: string
  room?: string
  status: DeviceStatus
  capabilities: string[]
  last_seen_at?: string
  meta?: Record<string, unknown>
}

export interface DeviceInvokeRequest {
  device_id: string
  capability: string
  args?: Record<string, unknown>
  timeout_ms?: number
}

export interface DeviceInvokeResult {
  ok: boolean
  data?: unknown
  error?: string
  duration_ms?: number
}

export interface DevicePort {
  list(filter?: { room?: string; type?: string; status?: DeviceStatus }): Promise<DeviceRecord[]>
  get(id: string): Promise<DeviceRecord | undefined>
  invoke(req: DeviceInvokeRequest): Promise<DeviceInvokeResult>
  ping(id: string): Promise<DeviceStatus>
}
