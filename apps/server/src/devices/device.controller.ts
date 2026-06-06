import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { DeviceService } from './device.service'
import type { CreateUserDeviceInput, UpdateUserDeviceInput } from './device.types'

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

  @Get('ping-all')
  pingAll() {
    return this.devices.pingAll()
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

  @Get(':id/capabilities/history')
  getCapabilityHistory(@Param('id') id: string) {
    return this.devices.getCapabilityHistory(id)
  }
}
