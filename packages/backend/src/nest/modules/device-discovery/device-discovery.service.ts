import { Injectable, Logger } from '@nestjs/common'
import { AdbService, AdbDeviceInfo } from './services/adb.service.js'
import { MiHomeService, DiscoveredMiDevice } from './services/mi-home.service.js'
import { CliCompatService } from './external/cli-compat.service.js'

export interface DiscoveryResult {
  adb: AdbDeviceInfo[]
  mi: DiscoveredMiDevice[]
  duration_ms: number
  source: 'native' | 'cli' | 'mixed'
}

/**
 * DeviceDiscoveryService orchestrates the native adb and mi-home
 * services. By default it uses native libraries; pass { useCli: true }
 * to fall back to the external CLI compat layer (or both are tried,
 * with native taking priority).
 */
@Injectable()
export class DeviceDiscoveryService {
  private readonly logger = new Logger(DeviceDiscoveryService.name)

  constructor(
    private readonly adb: AdbService,
    private readonly miHome: MiHomeService,
    private readonly cli: CliCompatService,
  ) {}

  async discover(opts: { useCli?: boolean; renew?: boolean } = {}): Promise<DiscoveryResult> {
    const start = Date.now()
    const useCli = opts.useCli ?? false
    const source: 'native' | 'cli' | 'mixed' = useCli ? 'cli' : 'native'

    let adbDevices: AdbDeviceInfo[] = []
    let miDevices: DiscoveredMiDevice[] = []

    if (!useCli) {
      adbDevices = await this.adb.listDevices()
      this.miHome.startDiscovery(8000)
      // give the miio browser a moment to emit
      await new Promise((resolve) => setTimeout(resolve, 1500))
      miDevices = this.miHome.listDiscovered()
    }

    if (useCli || (adbDevices.length === 0 && miDevices.length === 0)) {
      const cliResult = await this.cli.run<{ devices?: AdbDeviceInfo[]; homes?: DiscoveredMiDevice[] }>(
        'mi-cli',
        'discover',
        { renew: opts.renew ?? false },
      )
      if (cliResult.status === 'success' && cliResult.data) {
        if (Array.isArray(cliResult.data.devices)) {
          adbDevices = cliResult.data.devices as AdbDeviceInfo[]
        }
        if (Array.isArray(cliResult.data.homes)) {
          miDevices = cliResult.data.homes as DiscoveredMiDevice[]
        }
      }
    }

    return {
      adb: adbDevices,
      mi: miDevices,
      duration_ms: Date.now() - start,
      source: useCli ? 'cli' : (adbDevices.length > 0 || miDevices.length > 0 ? source : 'cli'),
    }
  }

  async pingAdb(serial: string): Promise<{ alive: boolean; latency_ms: number }> {
    const start = Date.now()
    try {
      const out = await this.adb.shell(serial, 'echo ok')
      return {
        alive: out.trim() === 'ok',
        latency_ms: Date.now() - start,
      }
    } catch {
      return { alive: false, latency_ms: Date.now() - start }
    }
  }
}
