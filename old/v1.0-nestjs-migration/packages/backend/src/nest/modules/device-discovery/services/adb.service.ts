import { Injectable, Logger } from '@nestjs/common'
import adbkit from 'adbkit'

export interface AdbDeviceInfo {
  serial: string
  state: 'device' | 'offline' | 'unauthorized' | string
  product?: string
  model?: string
  device?: string
  transport?: string
}

export interface AdbAppInfo {
  packageName: string
  label?: string
}

export interface AdbScreenshotResult {
  format: 'png'
  base64: string
  width?: number
  height?: number
}

/**
 * Native ADB service. Uses the adbkit library to talk to adb directly
 * without going through any external CLI wrapper.
 *
 * To use, you must have the adb binary on the host (adbkit shells out
 * to it for actual adb commands). This is the only external dependency.
 */
@Injectable()
export class AdbService {
  private readonly logger = new Logger(AdbService.name)
  private readonly client: ReturnType<typeof adbkit.createClient>

  constructor() {
    this.client = adbkit.createClient()
  }

  async listDevices(): Promise<AdbDeviceInfo[]> {
    try {
      const devices = await this.client.listDevices()
      return devices.map((d: { id: string; type?: string; properties?: Record<string, string> }) => ({
        serial: d.id,
        state: d.type ?? 'unknown',
        product: d.properties?.['ro.product.name'],
        model: d.properties?.['ro.product.model'],
        device: d.properties?.['ro.product.device'],
        transport: d.id.includes(':') ? 'tcp' : 'usb',
      }))
    } catch (err) {
      this.logger.error('listDevices failed', err as Error)
      return []
    }
  }

  async connectTcp(ip: string, port = 5555): Promise<string> {
    return this.client.connect(ip, port)
  }

  async disconnect(serial: string): Promise<void> {
    await this.client.disconnect(serial)
  }

  async shell(serial: string, command: string): Promise<string> {
    return this.client.shell(serial, command).then(adbkit.util.readAll).then((buf: Buffer) => buf.toString('utf-8'))
  }

  async listPackages(serial: string, options: { thirdPartyOnly?: boolean } = {}): Promise<string[]> {
    const cmd = options.thirdPartyOnly ? 'pm list packages -3' : 'pm list packages'
    const out = await this.shell(serial, cmd)
    return out
      .split('\n')
      .map((line) => line.replace(/^package:/, '').trim())
      .filter(Boolean)
  }

  async takeScreenshot(serial: string): Promise<AdbScreenshotResult> {
    const stream = await this.client.shell(serial, 'screencap -p')
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer)
    }
    return {
      format: 'png',
      base64: Buffer.concat(chunks).toString('base64'),
    }
  }

  async tap(serial: string, x: number, y: number): Promise<void> {
    await this.client.shell(serial, `input tap ${x} ${y}`)
  }

  async inputText(serial: string, text: string): Promise<void> {
    const escaped = text.replace(/ /g, '%s').replace(/'/g, "\\'")
    await this.client.shell(serial, `input text '${escaped}'`)
  }

  async keyEvent(serial: string, keyCode: number | string): Promise<void> {
    await this.client.shell(serial, `input keyevent ${keyCode}`)
  }

  async launchApp(serial: string, packageName: string): Promise<void> {
    const focus = await this.shell(serial, `dumpsys window windows | grep -E 'mCurrentFocus'`)
    const started = await this.shell(serial, `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`)
    if (!started.toLowerCase().includes('events injected')) {
      throw new Error(`Failed to launch ${packageName}: ${focus}`)
    }
  }
}
