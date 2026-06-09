import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common'
import { AlistService } from './alist.service'
import type { AlistCopyInput, AlistGetInput, AlistListInput, AlistRemoveInput } from './alist.types'

@Controller('alist/devices/:deviceId')
export class AlistController {
  constructor(private readonly alist: AlistService) {}

  @Get('health')
  health(@Param('deviceId', ParseIntPipe) deviceId: number) {
    return this.alist.health(deviceId)
  }

  @Post('fs/list')
  list(@Param('deviceId', ParseIntPipe) deviceId: number, @Body() body: AlistListInput) {
    return this.alist.list(deviceId, body)
  }

  @Post('fs/get')
  get(@Param('deviceId', ParseIntPipe) deviceId: number, @Body() body: AlistGetInput) {
    return this.alist.get(deviceId, body)
  }

  @Post('fs/remove')
  remove(@Param('deviceId', ParseIntPipe) deviceId: number, @Body() body: AlistRemoveInput) {
    return this.alist.remove(deviceId, body)
  }

  @Post('fs/copy')
  copy(@Param('deviceId', ParseIntPipe) deviceId: number, @Body() body: AlistCopyInput) {
    return this.alist.copy(deviceId, body)
  }
}
