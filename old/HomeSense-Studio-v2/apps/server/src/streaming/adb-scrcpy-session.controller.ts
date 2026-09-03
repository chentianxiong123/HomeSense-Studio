import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common'
import { AdbScrcpySessionService } from './adb-scrcpy-session.service'
import type { AdbScrcpySessionInput } from './adb-scrcpy-session.types'

@Controller('streaming-gateway/adb-scrcpy')
export class AdbScrcpySessionController {
  constructor(private readonly sessions: AdbScrcpySessionService) {}

  @Get('sessions')
  listSessions() {
    return { status: 'success', data: this.sessions.list() }
  }

  @Get('sessions/:id')
  getSession(@Param('id') id: string) {
    return { status: 'success', data: this.sessions.get(decodeURIComponent(id)) }
  }

  @Post('sessions')
  async createSession(@Body() body: AdbScrcpySessionInput) {
    return { status: 'success', data: await this.sessions.create(body ?? {}) }
  }

  @Post('sessions/:id/stop')
  stopSession(@Param('id') id: string) {
    return { status: 'success', data: this.sessions.stop(decodeURIComponent(id)) }
  }

  @Delete('sessions/:id')
  removeSession(@Param('id') id: string) {
    this.sessions.remove(decodeURIComponent(id))
    return { status: 'success' }
  }
}
