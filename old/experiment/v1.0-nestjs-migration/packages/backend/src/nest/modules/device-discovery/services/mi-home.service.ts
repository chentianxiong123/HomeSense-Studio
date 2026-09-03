import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import miio from 'miio'

export interface DiscoveredMiDevice {
  id: string
  address: string
  model: string
  token: string
}

interface MiioDeviceLike {
  id?: string
  address?: string
  token?: string
  model?: string
}

interface MiioBrowserLike {
  on(event: 'available', listener: (device: MiioDeviceLike) => void): unknown
  on(event: 'unavailable', listener: (device: MiioDeviceLike) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  stop(): unknown
}

/**
 * Native Mi Home service. Uses the miio library to discover and
 * control Xiaomi / Aqara devices directly on the LAN, without going
 * through any external CLI wrapper.
 *
 * `browse()` returns a Browser that auto-starts discovery on construction
 * and emits `available` / `unavailable` events as devices are found.
 */
@Injectable()
export class MiHomeService implements OnModuleDestroy {
  private readonly logger = new Logger(MiHomeService.name)
  private browser: MiioBrowserLike | null = null
  private cache = new Map<string, DiscoveredMiDevice>()

  startDiscovery(_timeoutMs = 8000): void {
    if (this.browser) {
      this.logger.warn('miio discovery already running')
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.browser = miio.browse() as any
    const b = this.browser!
    b.on('available', (device: MiioDeviceLike) => this.recordDevice(device))
    b.on('unavailable', (device: MiioDeviceLike) => this.forgetDevice(device))
    b.on('error', (err: Error) => this.logger.error('miio discovery error', err))
  }

  stopDiscovery(): void {
    if (this.browser) {
      this.browser.stop()
      this.browser = null
    }
  }

  listDiscovered(): DiscoveredMiDevice[] {
    return Array.from(this.cache.values())
  }

  async call(address: string, token: string): Promise<unknown> {
    return miio.device({ address, token })
  }

  onModuleDestroy(): void {
    this.stopDiscovery()
  }

  private recordDevice(device: MiioDeviceLike): void {
    if (!device.address || !device.model) return
    const id = device.id ?? `${device.address}:${device.model}`
    this.cache.set(id, {
      id,
      address: device.address,
      model: device.model,
      token: device.token ?? '',
    })
  }

  private forgetDevice(device: MiioDeviceLike): void {
    const id = device.id ?? `${device.address}:${device.model}`
    this.cache.delete(id)
  }
}
