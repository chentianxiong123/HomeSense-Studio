import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { DeviceGroupService } from './device-group.service'
import type { CreateDeviceGroupInput, UpdateDeviceGroupInput } from './device.types'

@Controller('device-groups')
export class DeviceGroupController {
  constructor(private readonly groups: DeviceGroupService) {}

  @Get()
  list() {
    return { groups: this.groups.list() }
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return { group: this.groups.get(id) }
  }

  @Post()
  create(@Body() body: CreateDeviceGroupInput) {
    return { status: 'success', data: { group: this.groups.create(body) } }
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateDeviceGroupInput) {
    return { status: 'success', data: { group: this.groups.update(id, body) } }
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    this.groups.remove(id)
    return { status: 'success' }
  }
}
