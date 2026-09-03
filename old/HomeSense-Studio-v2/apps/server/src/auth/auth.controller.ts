import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { cliBridge } from '../cli/cli-bridge'
import { deleteRuntimeSnapshot, readRuntimeSnapshot, writeRuntimeSnapshot } from '../db/runtime-snapshot'

const MI_AUTH_STATUS_SNAPSHOT = 'mi.auth.status'

@Controller('auth')
export class AuthController {
  @Get('status')
  async status(@Query('refresh') refresh?: string) {
    if (!isTruthyQuery(refresh)) {
      const snapshot = readRuntimeSnapshot<Record<string, unknown>>(MI_AUTH_STATUS_SNAPSHOT)
      if (snapshot) return snapshot
    }
    const result = await cliBridge.run('mi-cli', 'login_status', { refresh: isTruthyQuery(refresh) })
    if (isLoggedInResult(result)) writeRuntimeSnapshot(MI_AUTH_STATUS_SNAPSHOT, result)
    return result
  }

  @Post('login')
  async login(@Body() body?: { username?: string; password?: string }) {
    let result
    if (body?.username || body?.password) {
      result = await cliBridge.run('mi-cli', 'login_password', {
        username: body.username ?? '',
        password: body.password ?? '',
      })
    } else {
      result = await cliBridge.run('mi-cli', 'login_qr')
    }
    if (isLoggedInResult(result)) writeRuntimeSnapshot(MI_AUTH_STATUS_SNAPSHOT, result)
    return result
  }

  @Post('verify-ticket')
  verifyTicket(@Body() body: { ticket?: string; username?: string; password?: string }) {
    return cliBridge.run('mi-cli', 'verify_ticket', {
      ticket: body?.ticket ?? '',
      username: body?.username ?? '',
      password: body?.password ?? '',
    })
  }

  @Post('logout')
  async logout() {
    const result = await cliBridge.run('mi-cli', 'login_logout')
    deleteRuntimeSnapshot(MI_AUTH_STATUS_SNAPSHOT)
    deleteRuntimeSnapshot('mi.devices.candidates')
    return result
  }

  @Post('qr/start')
  startQr() {
    return cliBridge.run('mi-cli', 'login_qr')
  }

  @Get('qr/status')
  async qrStatus() {
    const result = await cliBridge.run('mi-cli', 'login_qr_status')
    if (isLoggedInResult(result)) writeRuntimeSnapshot(MI_AUTH_STATUS_SNAPSHOT, result)
    return result
  }

  @Post('qr/reset')
  qrReset() {
    return cliBridge.run('mi-cli', 'login_qr_reset')
  }
}

function isTruthyQuery(value: string | undefined): boolean {
  return value === 'true' || value === '1'
}

function isLoggedInResult(result: Awaited<ReturnType<typeof cliBridge.run>>): boolean {
  if (result.status !== 'success') return false
  const data = result.data
  return Boolean(data && typeof data === 'object' && !Array.isArray(data) && (data as { logged_in?: unknown }).logged_in)
}
