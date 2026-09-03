import { INestApplicationContext, Logger } from '@nestjs/common'
import { Controller, Get, Post, Put, Delete, Param, ParseIntPipe, Body, NotFoundException, BadRequestException } from '@nestjs/common'
import { OnModuleInit } from '@nestjs/common'
import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import { SessionStore } from './session.store'
import { ProtocolTarget, ProtocolKind } from './protocols/protocol.interface'
import { resolveDeviceTarget } from './target-resolver'
import { DeviceService } from '../devices/device.service'
import { TerminalTargetService, CreateTerminalTargetInput, UpdateTerminalTargetInput, TerminalTarget } from './terminal-target.service'
import { SshProtocol } from './protocols/ssh.protocol'
import { Client } from 'ssh2'

const PATH = '/api/terminal/ws'
const log = new Logger('TerminalGateway')

type Incoming =
  | { type: 'start'; target: ProtocolTarget; label?: string; cols?: number; rows?: number }
  | { type: 'attach'; session_id: string; cols?: number; rows?: number }
  | { type: 'input'; session_id: string; data: string }
  | { type: 'resize'; session_id: string; cols: number; rows: number }
  | { type: 'detach'; session_id: string }
  | { type: 'kill'; session_id: string }

export class TerminalGateway implements OnModuleInit {
  private wss: WebSocketServer | null = null

  constructor(private readonly deviceService: DeviceService) {}

  onModuleInit(): void {
    // attached in main.ts after app.listen()
  }

  attach(server: Server) {
    this.wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (req, socket, head) => {
      const url = req.url ?? ''
      if (!url.startsWith(PATH)) return
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.handleConnection(ws as unknown as WebSocket)
      })
    })
    log.log(`WebSocket listening on ${PATH}`)
  }

  private handleConnection(ws: WebSocket) {
    log.log('client connected')
    let currentSessionId: string | null = null
    let sendFn: (payload: string) => void = (payload) => {
      if (ws.readyState === ws.OPEN) ws.send(payload)
    }

    const detachCurrent = () => {
      if (!currentSessionId) return
      const session = SessionStore.get(currentSessionId)
      if (session) session.detachSocket(sendFn)
      currentSessionId = null
    }

    ws.on('message', async (raw) => {
      let msg: Incoming
      try { msg = JSON.parse(raw.toString()) as Incoming } catch {
        sendFn(JSON.stringify({ type: 'error', data: { message: 'invalid json' } }))
        return
      }

      try {
        if (msg.type === 'start') {
          detachCurrent()
          const kind: ProtocolKind = msg.target.kind
          const label = msg.label ?? `${kind} session`
          const cols = clampSize(msg.cols, 120, 20, 300)
          const rows = clampSize(msg.rows, 32, 8, 120)
          const session = await SessionStore.create(msg.target, label, cols, rows)
          currentSessionId = session.id
          session.attachSocket(sendFn)
          session.resize(cols, rows)
          return
        }

        if (msg.type === 'attach') {
          detachCurrent()
          const session = SessionStore.get(msg.session_id)
          if (!session) {
            sendFn(JSON.stringify({ type: 'error', data: { message: 'session not found' } }))
            return
          }
          currentSessionId = session.id
          session.attachSocket(sendFn)
          const cols = clampSize(msg.cols, session.info.cols, 20, 300)
          const rows = clampSize(msg.rows, session.info.rows, 8, 120)
          session.resize(cols, rows)
          return
        }

        if (!currentSessionId) {
          sendFn(JSON.stringify({ type: 'error', data: { message: 'no active session' } }))
          return
        }
        const requestedSessionId = 'session_id' in msg ? msg.session_id : currentSessionId
        if (requestedSessionId !== currentSessionId) {
          sendFn(JSON.stringify({ type: 'error', data: { message: 'session mismatch' } }))
          return
        }
        const session = SessionStore.get(currentSessionId)
        if (!session) {
          sendFn(JSON.stringify({ type: 'error', data: { message: 'session not found' } }))
          currentSessionId = null
          return
        }

        if (msg.type === 'input') session.write(msg.data)
        else if (msg.type === 'resize') {
          session.resize(clampSize(msg.cols, session.info.cols, 20, 300), clampSize(msg.rows, session.info.rows, 8, 120))
        }
        else if (msg.type === 'detach') {
          sendFn(JSON.stringify({ type: 'session_detached', data: { session_id: currentSessionId } }))
          detachCurrent()
        }
        else if (msg.type === 'kill') {
          SessionStore.terminate(currentSessionId, 'client killed')
          currentSessionId = null
        }
      } catch (err) {
        sendFn(JSON.stringify({ type: 'error', data: { message: (err as Error).message } }))
      }
    })

    ws.on('close', () => {
      detachCurrent()
      log.log('client disconnected')
    })
  }
}

function clampSize(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

@Controller('terminal')
export class TerminalController {
  constructor(
    private readonly deviceService: DeviceService,
  ) {}

  /**
   * List all terminal targets (configured access entries: local / SSH / ADB).
   * Used by AuthorizationsView SSH card.
   */
  @Get('targets')
  listTargets() {
    return { status: 'success', data: TerminalTargetService.list() }
  }

  @Get('targets/:id')
  getTarget(@Param('id', ParseIntPipe) id: number) {
    const t = TerminalTargetService.get(id)
    if (!t) throw new NotFoundException(`terminal target not found: ${id}`)
    return { status: 'success', data: t }
  }

  @Post('targets')
  createTarget(@Body() body: CreateTerminalTargetInput) {
    if (!body.name || !body.kind || !body.target) {
      throw new BadRequestException('name, kind, target are required')
    }
    return { status: 'success', data: TerminalTargetService.create(body) }
  }

  @Put('targets/:id')
  updateTarget(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateTerminalTargetInput) {
    return { status: 'success', data: TerminalTargetService.update(id, body) }
  }

  @Delete('targets/:id')
  removeTarget(@Param('id', ParseIntPipe) id: number) {
    if (!TerminalTargetService.remove(id)) {
      throw new NotFoundException(`terminal target not found: ${id}`)
    }
    return { status: 'success' }
  }

  /**
   * Test an SSH target without opening a session. Validates that the key file
   * exists and the server is reachable.
   */
  @Post('targets/:id/test')
  async testTarget(@Param('id', ParseIntPipe) id: number) {
    const t = TerminalTargetService.get(id)
    if (!t) throw new NotFoundException(`terminal target not found: ${id}`)
    if (t.kind !== 'ssh') {
      return { status: 'success', data: { ok: true, note: 'non-ssh target, skipped live test' } }
    }
    const target = t.target as any
    if (!target.host || !target.user) {
      throw new BadRequestException('ssh target missing host or user')
    }
    return new Promise((resolve) => {
      const client = new Client()
      let resolved = false
      const finish = (data: any) => {
        if (resolved) return
        resolved = true
        try { client.end() } catch {}
        resolve({ status: 'success', data })
      }
      client.on('ready', () => finish({ ok: true, message: 'authenticated' }))
      client.on('error', (err) => finish({ ok: false, message: err.message }))
      client.on('handshake', (info) => {
        // handshake ok; wait for auth
      })
      const opts: any = {
        host: target.host,
        port: target.port ?? 22,
        username: target.user,
        readyTimeout: 8000,
      }
      if (target.auth === 'password' && target.password) opts.password = target.password
      else if (target.auth === 'key' && target.keyName) {
        try {
          // dynamic import to avoid pulling keystore into the controller
          const { KeyStore } = require('./keystore')
          opts.privateKey = KeyStore.readSshKey(target.keyName)
        } catch (e) {
          return finish({ ok: false, message: `key load failed: ${(e as Error).message}` })
        }
      } else {
        return finish({ ok: false, message: 'no auth method configured' })
      }
      try { client.connect(opts) } catch (e) { finish({ ok: false, message: (e as Error).message }) }
    })
  }

  /**
   * Resolve a numeric id to a SessionTarget. Tries terminal_targets first,
   * then falls back to devices (legacy: linux_box/windows_pc/android_tv).
   */
  @Get('target/:id')
  resolveTarget(@Param('id', ParseIntPipe) id: number) {
    const fromTable = TerminalTargetService.get(id)
    if (fromTable) {
      const target = { ...(fromTable.target as Record<string, unknown>), kind: fromTable.kind } as ProtocolTarget
      return {
        status: 'success',
        data: {
          target,
          label: fromTable.name,
          target_id: fromTable.id,
          kind: fromTable.kind,
        },
      }
    }
    try {
      const { target, label } = resolveDeviceTarget(this.deviceService, id)
      return { status: 'success', data: { target, label, device_id: id } }
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      throw new BadRequestException((err as Error).message)
    }
  }

  @Get('device-target/:id')
  resolveDeviceTerminalTarget(@Param('id', ParseIntPipe) id: number) {
    try {
      const { target, label } = resolveDeviceTarget(this.deviceService, id)
      return { status: 'success', data: { target, label, device_id: id, kind: target.kind } }
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      throw new BadRequestException((err as Error).message)
    }
  }
}
