import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { RoomService } from './room.service'

@Controller('rooms')
export class RoomController {
  constructor(private readonly rooms: RoomService) {}

  @Get()
  list() {
    return { rooms: this.rooms.list() }
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return { room: this.rooms.get(id) }
  }

  @Post()
  create(@Body() body: { name: string; props?: Record<string, unknown> }) {
    return this.rooms.create(body)
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string; props?: Record<string, unknown> }) {
    return this.rooms.update(id, body)
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.rooms.remove(id)
  }
}
