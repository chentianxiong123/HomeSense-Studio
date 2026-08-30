import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { UserDeviceService } from './user-device.service.js'
import type {
  CreateUserDeviceInput,
  LegacyCapabilityExecuteBody,
  UpdateUserDeviceInput,
} from './user-device.service.js'

@Controller('api/user-devices')
export class UserDeviceController {
  constructor(private readonly svc: UserDeviceService) {}

  @Get()
  list() {
    return { devices: this.svc.list() }
  }

  @Get('cards')
  async listCards(@Query('online') online?: string) {
    return this.svc.listCards(online === 'true' || online === '1')
  }

  @Get('runtime-manifest')
  async getRuntimeManifest(
    @Query('online') online?: string,
    @Query('capabilities') capabilities?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getRuntimeManifest({
      online: online === 'true' || online === '1',
      capabilities,
      limit: limit ? Number(limit) : undefined,
    })
  }

  @Get('ping-all')
  async pingAll() {
    return this.svc.pingAll()
  }

  @Get('mi-candidates')
  async listMiCandidates() {
    return this.svc.listMiCandidates()
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return { device: this.svc.get(id) }
  }

  @Get(':id/capabilities')
  async getCapabilities(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getCapabilities(id)
  }

  @Post(':id/capabilities/execute')
  async executeCapability(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: LegacyCapabilityExecuteBody,
  ) {
    return this.svc.executeCapability(id, body)
  }

  @Get(':id/ir-keys')
  async getIrKeys(@Param('id', ParseIntPipe) id: number, @Query('refresh') refresh?: string) {
    return this.svc.getIrKeys(id, refresh === 'true' || refresh === '1')
  }

  @Post(':id/ir-press')
  async pressIrKey(@Param('id', ParseIntPipe) id: number, @Body() body: { key_id?: string }) {
    return this.svc.pressIrKey(id, body.key_id ?? '')
  }

  @Get(':id/capabilities/history')
  getCapabilityHistory(@Param('id') id: string) {
    return this.svc.getCapabilityHistory(id)
  }

  @Get(':id/apps')
  async getApps(@Param('id', ParseIntPipe) id: number, @Query('refresh') refresh?: string) {
    return this.svc.getApps(id, refresh === 'true' || refresh === '1')
  }

  @Post(':id/apps/launch')
  async launchApp(@Param('id', ParseIntPipe) id: number, @Body() body: { package?: string }) {
    return this.svc.launchApp(id, body.package)
  }

  @Post()
  create(@Body() body: CreateUserDeviceInput) {
    return { status: 'success', data: { device: this.svc.create(body) } }
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateUserDeviceInput) {
    return { status: 'success', data: { device: this.svc.update(id, body) } }
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    this.svc.remove(id)
    return { status: 'success' }
  }
}
