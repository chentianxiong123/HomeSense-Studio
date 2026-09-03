import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common'
import { DeviceDiscoveryService } from './device-discovery.service.js'
import { AdbService } from './services/adb.service.js'

interface DiscoverBody {
  renew?: boolean
  use_cli?: boolean
}

@Controller('api/devices')
export class DeviceDiscoveryController {
  constructor(
    private readonly discovery: DeviceDiscoveryService,
    private readonly adb: AdbService,
  ) {}

  @Get()
  async list() {
    const result = await this.discovery.discover()
    return { devices: result.adb, mi: result.mi, duration_ms: result.duration_ms, source: result.source }
  }

  @Post('discover')
  async discover(@Body() body: DiscoverBody) {
    const result = await this.discovery.discover({ renew: body?.renew, useCli: body?.use_cli })
    return {
      devices: result.adb,
      mi: result.mi,
      duration_ms: result.duration_ms,
      source: result.source,
    }
  }

  @Get('adb/list')
  async adbList() {
    return { devices: await this.adb.listDevices() }
  }

  @Post('adb/connect')
  async adbConnect(@Body() body: { ip: string; port?: number }) {
    const port = body?.port ?? 5555
    const serial = await this.adb.connectTcp(body.ip, port)
    return { status: 'connected', serial }
  }

  @Post('adb/disconnect')
  async adbDisconnect(@Body() body: { serial: string }) {
    if (!body?.serial) throw new NotFoundException('serial required')
    await this.adb.disconnect(body.serial)
    return { status: 'disconnected', serial: body.serial }
  }

  @Get('adb/packages/:serial')
  async adbPackages(@Param('serial') serial: string) {
    return { packages: await this.adb.listPackages(serial) }
  }

  @Post('adb/tap')
  async adbTap(@Body() body: { serial: string; x: number; y: number }) {
    if (!body?.serial) throw new NotFoundException('serial required')
    await this.adb.tap(body.serial, body.x, body.y)
    return { status: 'tapped', x: body.x, y: body.y }
  }

  @Post('adb/key')
  async adbKey(@Body() body: { serial: string; keyCode: number | string }) {
    if (!body?.serial) throw new NotFoundException('serial required')
    await this.adb.keyEvent(body.serial, body.keyCode)
    return { status: 'pressed', key: body.keyCode }
  }

  @Post('adb/shell')
  async adbShell(@Body() body: { serial: string; command: string }) {
    if (!body?.serial || !body?.command) throw new NotFoundException('serial and command required')
    const out = await this.adb.shell(body.serial, body.command)
    return { output: out }
  }

  @Get('adb/ping/:serial')
  async adbPing(@Param('serial') serial: string) {
    return this.discovery.pingAdb(serial)
  }
}
