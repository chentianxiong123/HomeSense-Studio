export type DeviceType =
  | 'television'
  | 'stb'
  | 'speaker'
  | 'router'
  | 'outlet'
  | 'phone'
  | 'tv_box'
  | 'tablet'
  | 'computer'
  | 'other'

export interface RoomRecord {
  id: number
  name: string
  created_at: string
  updated_at: string
}

export interface UserDevice {
  id: number
  name: string
  device_type: DeviceType
  room_id: number | null
  room_name: string | null
  mi_did: string | null
  adb_ip: string
  ip_address: string
  created_at: string
  updated_at: string
}

export interface CreateUserDeviceInput {
  name: string
  device_type?: DeviceType
  room_id?: number | null
  mi_did?: string | null
  adb_ip?: string
  ip_address?: string
}

export interface UpdateUserDeviceInput {
  name?: string
  device_type?: DeviceType
  room_id?: number | null
  mi_did?: string | null
  adb_ip?: string
  ip_address?: string
}

export interface DeviceCardProjection {
  id: number
  name: string
  device_type: DeviceType
  room: {
    id: number | null
    name: string
  }
  sources: string[]
  bindings: {
    mi_did: string | null
    adb_ip: string | null
    ip_address: string | null
  }
  network: {
    ping_target: string | null
    online: boolean | null
    checked: boolean
    method: 'ping' | 'none'
  }
  display: {
    icon: string
    title: string
    subtitle: string
    status: 'online' | 'offline' | 'unknown'
  }
}

export interface DeviceRuntimeManifestItem extends DeviceCardProjection {
  capability_count: number
  capabilities?: Array<Record<string, unknown>>
}

export interface DeviceRuntimeManifest {
  version: number
  generated_at: string
  include_capabilities: 'none' | 'summary' | 'full'
  devices: DeviceRuntimeManifestItem[]
}

export interface LegacyCapabilityExecuteBody {
  capability?: string
  capability_id?: string
  params?: string
  arguments?: Record<string, unknown>
}

