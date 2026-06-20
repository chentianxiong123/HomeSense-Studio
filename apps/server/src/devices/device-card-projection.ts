import { checkDeviceOnline } from './device-network'
import type { DeviceCardProjection, UserDevice } from './device.types'

function readProp(device: UserDevice, key: string): unknown {
  return device.props?.[key]
}

function readString(device: UserDevice, key: string): string {
  const value = readProp(device, key)
  return typeof value === 'string' ? value : ''
}

function readNumber(device: UserDevice, key: string): number | null {
  const value = readProp(device, key)
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function buildDeviceCardProjection(
  device: UserDevice,
  online: boolean | null = null,
): DeviceCardProjection {
  const miDid = readString(device, 'mi_did') || null
  const adbIp = readString(device, 'adb_ip').trim() || null
  const ipAddress = readString(device, 'ip_address') || null
  const streamingHostId = readString(device, 'streaming_host_id') || null
  const dlnaLocation = readString(device, 'dlna_location') || null
  const roomId = readNumber(device, 'room_id')
  const deviceType = readString(device, 'device_type') || 'other'

  const sources: string[] = []
  if (miDid) sources.push('mi')
  if (adbIp) sources.push('adb')
  if (streamingHostId) sources.push('streaming')
  if (dlnaLocation || device.props?.dlan === true) sources.push('dlan')

  const pingTarget =
    (ipAddress || adbIp || '').split(':')[0].trim() || null
  const status = online == null ? 'unknown' : online ? 'online' : 'offline'

  return {
    id: device.id,
    name: device.name,
    props: device.props,
    room: {
      id: roomId,
      name: (device.props?.room_name as string) ?? '',
    },
    sources,
    bindings: {
      mi_did: miDid,
      adb_ip: adbIp,
      ip_address: ipAddress,
      streaming_host_id: streamingHostId,
      dlna_location: dlnaLocation,
    },
    network: {
      ping_target: pingTarget,
      online,
      checked: online != null,
      method: pingTarget ? 'ping' : 'none',
    },
    display: {
      icon: deviceIcon(deviceType),
      title: device.name,
      subtitle: [(device.props?.room_name as string) ?? '', deviceType].filter(Boolean).join(' · '),
      status,
    },
  }
}

export async function buildDeviceRuntimeCard(device: UserDevice): Promise<DeviceCardProjection> {
  const onlineCheck = await checkDeviceOnline(device)
  const card = buildDeviceCardProjection(device, onlineCheck.online)
  card.network = {
    ping_target: onlineCheck.target,
    online: onlineCheck.online,
    checked: onlineCheck.checked,
    method: onlineCheck.method,
  }
  card.display.status = onlineCheck.online == null ? 'unknown' : onlineCheck.online ? 'online' : 'offline'
  return card
}

function deviceIcon(deviceType: string): string {
  if (deviceType === 'television' || deviceType === 'tv_box') return 'tv'
  if (deviceType === 'stb') return 'stb'
  if (deviceType === 'speaker') return 'speaker'
  if (deviceType === 'router') return 'router'
  if (deviceType === 'outlet') return 'outlet'
  if (deviceType === 'phone' || deviceType === 'tablet') return 'phone'
  if (deviceType === 'computer') return 'computer'
  return 'device'
}
