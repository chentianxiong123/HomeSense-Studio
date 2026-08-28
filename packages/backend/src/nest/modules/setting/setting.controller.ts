import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Put } from '@nestjs/common'
import { SettingService } from './setting.service.js'

interface PutBody {
  value: unknown
}

@Controller('api/settings')
export class SettingController {
  private readonly settings: SettingService

  constructor(settings: SettingService) {
    this.settings = settings
  }

  @Get('list')
  list() {
    return { settings: this.settings.list() }
  }

  @Get('get/:key')
  getOne(@Param('key') key: string) {
    const record = this.settings.get(key)
    if (!record) {
      throw new NotFoundException(`Setting not found: ${key}`)
    }
    return record
  }

  @Put('set/:key')
  setOne(@Param('key') key: string, @Body() body: PutBody) {
    return this.settings.set(key, body?.value)
  }

  @Post('delete/:key')
  deleteOne(@Param('key') key: string) {
    const removed = this.settings.delete(key)
    return { status: removed ? 'deleted' : 'not_found', key }
  }
}
