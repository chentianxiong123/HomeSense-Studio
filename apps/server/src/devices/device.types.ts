export type RoomRecord = {
  id: number
  name: string
  props: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type UserDevice = {
  id: number
  name: string
  props: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type CreateUserDeviceInput = {
  name: string
  props?: Record<string, unknown>
}

export type UpdateUserDeviceInput = {
  name?: string
  props?: Record<string, unknown>
}

export type DeviceCardProjection = {
  id: number
  name: string
  props: Record<string, unknown>
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

export type DeviceRuntimeManifestItem = DeviceCardProjection & {
  capability_count: number
  capabilities?: Array<Record<string, unknown>>
}

export type DeviceRuntimeManifest = {
  version: number
  generated_at: string
  include_capabilities: 'none' | 'summary' | 'full'
  devices: DeviceRuntimeManifestItem[]
}

export type LegacyCapabilityExecuteBody = {
  capability?: string
  capability_id?: string
  params?: string
  arguments?: Record<string, unknown>
}

export type DeviceGroup = {
  id: number
  name: string
  member_ids: number[]
  created_at: string
  updated_at: string
}

export type CreateDeviceGroupInput = {
  name: string
  device_ids?: number[]
}

export type UpdateDeviceGroupInput = {
  name?: string
  device_ids?: number[]
}
