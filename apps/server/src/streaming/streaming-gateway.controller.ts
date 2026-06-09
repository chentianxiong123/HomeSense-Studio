import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common'
import { StreamingGatewayService } from './streaming-gateway.service'
import type { RegisterStreamingHostInput } from './streaming-gateway.types'

@Controller('streaming-gateway')
export class StreamingGatewayController {
  constructor(private readonly streaming: StreamingGatewayService) {}

  @Get('hosts')
  hosts() {
    return { status: 'success', data: this.streaming.listHosts() }
  }

  @Post('hosts')
  registerHost(@Body() body: RegisterStreamingHostInput) {
    return { status: 'success', data: this.streaming.registerHost(body) }
  }

  @Delete('hosts/:id')
  removeHost(@Param('id') id: string) {
    this.streaming.removeHost(decodeURIComponent(id))
    return { status: 'success' }
  }

  @Post('hosts/:id/probe')
  async probeHost(@Param('id') id: string) {
    return { status: 'success', data: await this.streaming.probeHost(decodeURIComponent(id)) }
  }

  @Post('hosts/:id/wake')
  async wakeHost(@Param('id') id: string) {
    return { status: 'success', data: await this.streaming.wakeHost(decodeURIComponent(id)) }
  }

  @Get('runtime')
  async runtimeStatus() {
    return { status: 'success', data: await this.streaming.runtimeStatus() }
  }
}
