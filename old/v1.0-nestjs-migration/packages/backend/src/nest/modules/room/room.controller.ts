import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { RoomService } from './room.service.js'

@Controller('api/rooms')
export class RoomController {
  constructor(private readonly svc: RoomService) {}

  @Get()
  list() {
    return { rooms: this.svc.list() }
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.svc.get(id)
  }

  @Post()
  create(@Body() body: { name: string }) {
    return this.svc.create(body)
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string }) {
    return this.svc.update(id, body)
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id)
  }
}
