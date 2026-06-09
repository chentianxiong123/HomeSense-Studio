import { NotFoundException } from '@nestjs/common'
import { DeviceService } from '../devices/device.service'
import { ProtocolTarget } from './protocols/protocol.interface'

/**
 * Translate a device id into a ProtocolTarget.
 * Reads device_type and props from the device record; loads auth material
 * (SSH key) from KeyStore by name — never returns secrets to the caller.
 *
 * Conventions:
 *   - Any device with ssh_host + ssh_user becomes an SSH target.
 *   - Any device with adb_serial or adb_ip becomes an ADB target.
 *   - windows_pc without SSH falls back to a local terminal.
 *   - Anything else is not terminal-capable.
 */
export function resolveDeviceTarget(
  deviceService: DeviceService,
  deviceId: number,
): { target: ProtocolTarget; label: string } {
  const device = deviceService.get(deviceId)
  const props = (device.props ?? {}) as Record<string, unknown>
  const deviceType = typeof props.device_type === 'string' ? props.device_type : ''
  const sshHost = readString(props, 'ssh_host')
  const sshUser = readString(props, 'ssh_user')
  const adbSerial = readString(props, 'adb_serial') || readString(props, 'adb_ip')

  if (sshHost && sshUser) {
    const port = typeof props.ssh_port === 'number' ? props.ssh_port : 22
    const keyName = readString(props, 'ssh_key_name') || undefined
    const password = readString(props, 'ssh_password') || undefined

    if (keyName) {
      return { target: { kind: 'ssh', host: sshHost, port, user: sshUser, auth: 'key', keyName }, label: `SSH · ${sshUser}@${sshHost}` }
    }
    if (password) {
      return { target: { kind: 'ssh', host: sshHost, port, user: sshUser, auth: 'password', password }, label: `SSH · ${sshUser}@${sshHost}` }
    }
    throw new Error(`device ${deviceId} has ssh_host/ssh_user but no ssh_key_name or ssh_password`)
  }

  if (adbSerial) {
    return { target: { kind: 'adb', serial: adbSerial }, label: `ADB · ${adbSerial}` }
  }

  if (deviceType === 'windows_pc') {
    return { target: { kind: 'local' }, label: `Local · ${device.name}` }
  }

  throw new NotFoundException(`Device type "${deviceType}" is not terminal-capable`)
}

function readString(props: Record<string, unknown>, key: string): string {
  const v = props[key]
  return typeof v === 'string' ? v.trim() : ''
}
