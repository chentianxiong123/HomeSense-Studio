import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { cliBridge } from '../cli/cli-bridge'

type AuthFileData = Record<string, unknown>

const REQUIRED_AUTH_FIELDS = ['ssecurity', 'userId', 'cUserId', 'serviceToken'] as const

function authFilePath() {
  return path.join(process.env.MI_CLI_CONFIG_DIR || path.join(os.homedir(), '.cache', 'mi-cli'), 'auth.json')
}

function authField(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function readAuthFile(): AuthFileData {
  const file = authFilePath()
  if (!fs.existsSync(file)) return {}
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as AuthFileData
  } catch {
    return {}
  }
}

function authFieldsPresent(authData: AuthFileData) {
  return Object.fromEntries(REQUIRED_AUTH_FIELDS.map((field) => [field, Boolean(authData[field])]))
}

function localAuthStatus() {
  const startedAt = Date.now()
  const authData = readAuthFile()
  const hasSavedLogin = Object.keys(authData).length > 0
  const missing = REQUIRED_AUTH_FIELDS.filter((field) => !authData[field])
  const expireTime = Number(authData.expireTime || 0)
  const expired = expireTime > 0 && expireTime <= Date.now()
  const loggedIn = missing.length === 0 && !expired

  return {
    status: 'success' as const,
    data: {
      logged_in: loggedIn,
      token_valid: loggedIn,
      has_saved_login: hasSavedLogin,
      user_id: authField(authData.userId),
      auth_fields_present: authFieldsPresent(authData),
      message: loggedIn ? '已登录（本地缓存）' : hasSavedLogin ? '本地凭据不完整或已过期' : '未登录',
      source: 'local_auth_file',
      expire_time: expireTime || undefined,
    },
    duration_ms: Date.now() - startedAt,
  }
}

@Controller('auth')
export class AuthController {
  @Get('status')
  status(@Query('refresh') refresh?: string) {
    if (!refresh) return localAuthStatus()
    return cliBridge.run('mi-cli', 'login_status')
  }

  @Post('login')
  login(@Body() body?: { username?: string; password?: string }) {
    if (body?.username || body?.password) {
      return cliBridge.run('mi-cli', 'login_password', {
        username: body.username ?? '',
        password: body.password ?? '',
      })
    }
    return cliBridge.run('mi-cli', 'login_qr')
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
  logout() {
    return cliBridge.run('mi-cli', 'login_logout')
  }

  @Post('qr/start')
  startQr() {
    return cliBridge.run('mi-cli', 'login_qr')
  }

  @Get('qr/status')
  qrStatus() {
    return cliBridge.run('mi-cli', 'login_qr_status')
  }

  @Post('qr/reset')
  qrReset() {
    return cliBridge.run('mi-cli', 'login_qr_reset')
  }
}
