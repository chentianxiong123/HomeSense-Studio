import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type Database from 'better-sqlite3'
import {
  userDeviceCapabilityService,
  type LegacyCapabilityExecuteBody,
} from '../../../modules/device/user-device-capability.service.js'
import { userDeviceAppService } from '../../../modules/device/user-device-app.service.js'
import { UserDeviceCrudService } from '../../../modules/device/user-device-crud.service.js'

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

export interface UserDevice {
  id: number
  name: string
  device_type: DeviceType
  room_id: number | null
  room_name?: string | null
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

export type { LegacyCapabilityExecuteBody }

const ALLOWED_DEVICE_TYPES: ReadonlySet<DeviceType> = new Set([
  'television',
  'stb',
  'speaker',
  'router',
  'outlet',
  'phone',
  'tv_box',
  'tablet',
  'computer',
  'other',
])

@Injectable()
export class UserDeviceService {
  private crud = new UserDeviceCrudService()

  withDb(database: Database.Database): this {
    this.crud = new UserDeviceCrudService(database)
    return this
  }

  list(): UserDevice[] {
    return this.crud.listDevices().devices as UserDevice[]
  }

  async listCards(checkOnline: boolean) {
    return this.crud.listCards(checkOnline)
  }

  async getRuntimeManifest(input: { online?: boolean; capabilities?: string; limit?: number }) {
    return this.crud.getRuntimeManifest(input)
  }

  async pingAll() {
    return this.crud.pingAll()
  }

  async listMiCandidates() {
    return userDeviceAppService.listMiCandidates()
  }

  get(id: number): UserDevice {
    const result = this.crud.getDevice(id) as { device?: UserDevice; error?: string }
    if (!result.device) {
      throw new NotFoundException(`User device not found: ${id}`)
    }
    return result.device
  }

  create(input: CreateUserDeviceInput): UserDevice {
    if (!input?.name?.trim()) {
      throw new BadRequestException('name is required')
    }
    if (input.device_type && !ALLOWED_DEVICE_TYPES.has(input.device_type)) {
      throw new BadRequestException(`Invalid device_type: ${input.device_type}`)
    }

    const result = this.crud.createDevice(input) as { data?: { device?: UserDevice }; error?: string; message?: string }
    if (!result.data?.device) {
      throw new BadRequestException(result.message ?? result.error ?? 'Failed to create device')
    }
    return result.data.device
  }

  update(id: number, input: UpdateUserDeviceInput): UserDevice {
    if (input.name !== undefined && !input.name.trim()) {
      throw new BadRequestException('name is required')
    }
    if (input.device_type && !ALLOWED_DEVICE_TYPES.has(input.device_type)) {
      throw new BadRequestException(`Invalid device_type: ${input.device_type}`)
    }

    const result = this.crud.updateDevice(id, input) as { data?: { device?: UserDevice }; error?: string; message?: string }
    if (!result.data?.device) {
      if (result.error === 'NOT_FOUND') {
        throw new NotFoundException(`User device not found: ${id}`)
      }
      throw new BadRequestException(result.message ?? result.error ?? 'Failed to update device')
    }
    return result.data.device
  }

  remove(id: number): { status: 'deleted'; id: number } {
    this.crud.deleteDevice(id)
    return { status: 'deleted', id }
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
}
