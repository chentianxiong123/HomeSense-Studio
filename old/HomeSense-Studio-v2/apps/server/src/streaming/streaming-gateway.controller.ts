import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common'
import { StreamingGatewayService } from './streaming-gateway.service'
import type { RegisterStreamingHostInput, ScanStreamingHostsInput, UpdateMoonlightWebRuntimeInput } from './streaming-gateway.types'

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

  @Post('hosts/:id/pair')
  async pairHost(@Param('id') id: string) {
    return { status: 'success', data: await this.streaming.pairHost(decodeURIComponent(id)) }
  }

  @Get('pair-tasks/:taskId')
  pairTask(@Param('taskId') taskId: string) {
    return { status: 'success', data: this.streaming.pairTask(decodeURIComponent(taskId)) }
  }

  @Post('scan')
  async scanHosts(@Body() body: ScanStreamingHostsInput) {
    return { status: 'success', data: await this.streaming.scanHosts(body) }
  }

  @Post('hosts/:id/wake')
  async wakeHost(@Param('id') id: string) {
    return { status: 'success', data: await this.streaming.wakeHost(decodeURIComponent(id)) }
  }

  @Get('hosts/:id/session-entry')
  async sessionEntry(@Param('id') id: string, @Req() req: any) {
    const protocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0]
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    const origin = host ? `${protocol}://${host}` : ''
    return { status: 'success', data: await this.streaming.sessionEntry(decodeURIComponent(id), origin) }
  }

  @Get('hosts/:id/apps')
  async hostApps(@Param('id') id: string, @Req() req: any) {
    const protocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0]
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    const origin = host ? `${protocol}://${host}` : ''
    return { status: 'success', data: await this.streaming.listHostApps(decodeURIComponent(id), origin) }
  }

  @Get('runtime')
  async runtimeStatus() {
    return { status: 'success', data: await this.streaming.runtimeStatus() }
  }

  @Put('runtime')
  async updateRuntime(@Body() body: UpdateMoonlightWebRuntimeInput) {
    return { status: 'success', data: await this.streaming.updateRuntime(body) }
  }
}
