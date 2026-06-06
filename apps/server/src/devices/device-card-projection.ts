import { checkDeviceOnline } from './device-network'
import type { DeviceCardProjection, DeviceType, UserDevice } from './device.types'

export function buildDeviceCardProjection(
  device: UserDevice,
  online: boolean | null = null,
): DeviceCardProjection {
  const sources = [
    device.mi_did ? 'mi' : null,
    device.adb_ip?.trim() ? 'adb' : null,
  ].filter((item): item is string => Boolean(item))

  const pingTarget = (device.ip_address || device.adb_ip || '').split(':')[0].trim() || null
  const status = online == null ? 'unknown' : online ? 'online' : 'offline'

  return {
    id: device.id,
    name: device.name,
    device_type: device.device_type,
    room: {
      id: device.room_id,
      name: device.room_name ?? '',
    },
    sources,
    bindings: {
      mi_did: device.mi_did ?? null,
      adb_ip: device.adb_ip || null,
      ip_address: device.ip_address || null,
    },
    network: {
      ping_target: pingTarget,
      online,
      checked: online != null,
      method: pingTarget ? 'ping' : 'none',
    },
    display: {
      icon: deviceIcon(device.device_type),
      title: device.name,
      subtitle: [device.room_name, device.device_type].filter(Boolean).join(' · '),
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

function deviceIcon(deviceType: DeviceType): string {
  if (deviceType === 'television' || deviceType === 'tv_box') return 'tv'
  if (deviceType === 'stb') return 'stb'
  if (deviceType === 'speaker') return 'speaker'
  if (deviceType === 'router') return 'router'
  if (deviceType === 'outlet') return 'outlet'
  if (deviceType === 'phone' || deviceType === 'tablet') return 'phone'
  if (deviceType === 'computer') return 'computer'
  return 'device'
}
