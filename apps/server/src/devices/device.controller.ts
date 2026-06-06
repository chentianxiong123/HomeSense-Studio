import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { DeviceService } from './device.service'
import type { CreateUserDeviceInput, LegacyCapabilityExecuteBody, UpdateUserDeviceInput } from './device.types'

@Controller('user-devices')
export class DeviceController {
  constructor(private readonly devices: DeviceService) {}

  @Get()
  list() {
    return { devices: this.devices.list() }
  }

  @Get('cards')
  listCards(@Query('online') online?: string) {
    return this.devices.listCards(online === 'true' || online === '1')
  }

  @Get('runtime-manifest')
  getRuntimeManifest(
    @Query('online') online?: string,
    @Query('capabilities') capabilities?: string,
    @Query('limit') limit?: string,
  ) {
    return this.devices.getRuntimeManifest({
      online: online === 'true' || online === '1',
      capabilities,
      limit: limit ? Number(limit) : undefined,
    })
  }

  @Get('ping-all')
  pingAll() {
    return this.devices.pingAll()
  }

  @Get('mi-candidates')
  listMiCandidates(@Query('refresh') refresh?: string) {
    return this.devices.listMiCandidates({ refresh: refresh === 'true' || refresh === '1' })
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return { device: this.devices.get(id) }
  }

  @Post()
  create(@Body() body: CreateUserDeviceInput) {
    return { status: 'success', data: { device: this.devices.create(body) } }
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateUserDeviceInput) {
    return { status: 'success', data: { device: this.devices.update(id, body) } }
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    this.devices.remove(id)
    return { status: 'success' }
  }

  @Get(':id/capabilities')
  getCapabilities(@Param('id', ParseIntPipe) id: number) {
    return this.devices.getCapabilities(id)
  }

  @Post(':id/capabilities/execute')
  executeCapability(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: LegacyCapabilityExecuteBody,
  ) {
    return this.devices.executeCapability(id, body)
  }

  @Get(':id/capabilities/history')
  getCapabilityHistory(@Param('id') id: string) {
    return this.devices.getCapabilityHistory(id)
  }

  @Get(':id/ir-keys')
  getIrKeys(@Param('id', ParseIntPipe) id: number, @Query('refresh') refresh?: string) {
    return this.devices.getIrKeys(id, refresh === 'true' || refresh === '1')
  }

  @Post(':id/ir-press')
  pressIrKey(@Param('id', ParseIntPipe) id: number, @Body() body: { key_id?: string }) {
    return this.devices.pressIrKey(id, body.key_id ?? '')
  }

  @Get(':id/apps')
  getApps(@Param('id', ParseIntPipe) id: number, @Query('refresh') refresh?: string) {
    return this.devices.getApps(id, refresh === 'true' || refresh === '1')
  }

  @Post(':id/apps/launch')
  launchApp(@Param('id', ParseIntPipe) id: number, @Body() body: { package?: string }) {
    return this.devices.launchApp(id, body.package)
  }
}
