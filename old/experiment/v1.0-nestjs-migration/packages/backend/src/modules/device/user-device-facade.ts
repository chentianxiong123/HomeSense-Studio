import { userDeviceCrudService } from './user-device-crud.service.js'
import {
  userDeviceCapabilityService,
  getAdbCapabilities,
  getAdbCapabilitiesForCache,
  type LegacyCapabilityExecuteBody,
} from './user-device-capability.service.js'
import { userDeviceAppService } from './user-device-app.service.js'

export { getAdbCapabilities, getAdbCapabilitiesForCache }
export type { LegacyCapabilityExecuteBody }

export class UserDeviceFacade {
  listDevices() {
    return userDeviceCrudService.listDevices()
  }

  async listCards(checkOnline: boolean) {
    return userDeviceCrudService.listCards(checkOnline)
  }

  async getRuntimeManifest(input: { online?: boolean; capabilities?: string; limit?: number }) {
    return userDeviceCrudService.getRuntimeManifest(input)
  }

  async pingAll() {
    return userDeviceCrudService.pingAll()
  }

  getDevice(id: number) {
    return userDeviceCrudService.getDevice(id)
  }

  createDevice(body: {
    name: string
    device_type?: string
    room_id?: number | null
    mi_did?: string | null
    adb_ip?: string
    ip_address?: string
  }) {
    return userDeviceCrudService.createDevice(body)
  }

  updateDevice(id: number, body: {
    name?: string
    device_type?: string
    room_id?: number | null
    mi_did?: string | null
    adb_ip?: string
    ip_address?: string
  }) {
    return userDeviceCrudService.updateDevice(id, body)
  }

  deleteDevice(id: number) {
    return userDeviceCrudService.deleteDevice(id)
  }

  async getCapabilities(id: number) {
    return userDeviceCapabilityService.getCapabilities(id)
  }

  async executeCapability(id: number, body: LegacyCapabilityExecuteBody) {
    return userDeviceCapabilityService.executeCapability(id, body)
  }

  async getIrKeys(id: number, forceRefresh: boolean) {
    return userDeviceCapabilityService.getIrKeys(id, forceRefresh)
  }

  async pressIrKey(id: number, keyId: string) {
    return userDeviceCapabilityService.pressIrKey(id, keyId)
  }

  getCapabilityHistory(id: string) {
    return userDeviceCapabilityService.getCapabilityHistory(id)
  }

  async getApps(id: number, forceRefresh: boolean) {
    return userDeviceAppService.getApps(id, forceRefresh)
  }

  async launchApp(id: number, pkg?: string) {
    return userDeviceAppService.launchApp(id, pkg)
  }

  async listMiCandidates() {
    return userDeviceAppService.listMiCandidates()
  }
}

export const userDeviceFacade = new UserDeviceFacade()
