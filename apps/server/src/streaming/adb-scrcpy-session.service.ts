import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import type { WebSocket } from 'ws'
import { cliBridge } from '../cli/cli-bridge'
import type {
  AdbScrcpyCommandSpec,
  AdbScrcpyRawBridge,
  AdbScrcpySession,
  AdbScrcpySessionInput,
  AdbScrcpySessionState,
} from './adb-scrcpy-session.types'

type ManagedAdbScrcpySession = AdbScrcpySession & {
  proc?: ChildProcess
  bridgeClients?: Set<net.Socket>
}

const MAX_TAIL_LINES = 80
const SESSION_ID_PREFIX = 'adb-scrcpy'
const SERVER_VERSION = '3.3.1'
const DEVICE_SERVER_PATH = '/data/local/tmp/homesense-scrcpy-server.jar'

@Injectable()
export class AdbScrcpySessionService implements OnModuleDestroy {
  private readonly sessions = new Map<string, ManagedAdbScrcpySession>()

  list(): AdbScrcpySession[] {
    return Array.from(this.sessions.values()).map(toPublicSession)
  }

  get(id: string): AdbScrcpySession {
    return toPublicSession(this.getManaged(id))
  }

  async create(input: AdbScrcpySessionInput): Promise<AdbScrcpySession> {
    const commandResult = await cliBridge.run('adb-cli', 'scrcpy_command', input as Record<string, unknown>)
    if (commandResult.status !== 'success' || !isCommandSpec(commandResult.data)) {
      throw new BadRequestException({
        error: commandResult.status === 'error' ? commandResult.error : 'INVALID_SCRCPY_COMMAND',
        message: commandResult.status === 'error' ? commandResult.message : 'adb-cli returned an invalid scrcpy command',
        data: commandResult.status === 'error' ? commandResult.data : commandResult.data,
      })
    }

    const command = commandResult.data
    const notes = [...command.notes]
    const dryRun = input.dry_run === true
    const bridgeable = needsRawBridge(command)
    const runnable = dryRun || bridgeable || canRunDirectCliSession(command)
    const now = new Date().toISOString()
    const session: ManagedAdbScrcpySession = {
      id: makeSessionId(),
      label: normalizeLabel(input.label, command),
      device: command.device,
      state: runnable && !dryRun ? 'starting' : 'prepared',
      created_at: now,
      updated_at: now,
      command,
      dry_run: dryRun,
      stdout_tail: [],
      stderr_tail: [],
      notes,
    }
    if (bridgeable) {
      session.stream = await this.createRawBridgePlan(session, input)
      session.notes = [...notes, ...session.stream.notes]
    }

    if (!runnable) {
      session.error = 'BACKEND_BRIDGE_REQUIRED'
      session.notes = [
        ...notes,
        'This scrcpy CLI spec is not directly runnable for browser video. Start a raw stream/protocol bridge session instead.',
      ]
      this.sessions.set(session.id, session)
      return toPublicSession(session)
    }

    this.sessions.set(session.id, session)
    if (!dryRun) {
      if (bridgeable) this.spawnRawBridgeSession(session, input)
      else this.spawnSession(session)
    }
    return toPublicSession(session)
  }

  stop(id: string): AdbScrcpySession {
    const session = this.getManaged(id)
    if (!session.proc || session.proc.killed || isTerminalState(session.state)) {
      session.state = session.state === 'prepared' ? 'stopped' : session.state
      session.updated_at = new Date().toISOString()
      return toPublicSession(session)
    }

    session.state = 'stopped'
    session.updated_at = new Date().toISOString()
    this.killSessionProcess(session)
    return toPublicSession(session)
  }

  remove(id: string): void {
    const session = this.getManaged(id)
    this.killSessionProcess(session)
    this.sessions.delete(session.id)
  }

  onModuleDestroy() {
    for (const session of this.sessions.values()) {
      this.killSessionProcess(session)
    }
  }

  pipeRawStreamToWebSocket(id: string, ws: WebSocket): void {
    const session = this.getManaged(id)
    if (!session.stream) {
      ws.close(1011, 'session has no raw stream')
      return
    }
    if (isTerminalState(session.state)) {
      ws.close(1011, `session is ${session.state}`)
      return
    }

    const socket = new net.Socket()
    session.bridgeClients ??= new Set()
    session.bridgeClients.add(socket)

    socket.on('data', (chunk) => {
      if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true })
    })
    socket.once('connect', () => {
      session.stream = session.stream ? { ...session.stream, ready: true } : session.stream
      session.updated_at = new Date().toISOString()
    })
    socket.once('error', (error) => {
      appendTail(session.stderr_tail, Buffer.from(`raw stream tcp error: ${error.message}`))
      safeCloseWs(ws, 1011, 'raw stream unavailable')
    })
    socket.once('close', () => {
      session.bridgeClients?.delete(socket)
      safeCloseWs(ws, 1000, 'stream closed')
    })
    ws.once('close', () => socket.destroy())
    ws.once('error', () => socket.destroy())
    socket.connect({ host: session.stream.local_host, port: session.stream.local_port })
  }

  private getManaged(id: string): ManagedAdbScrcpySession {
    const session = this.sessions.get(id)
    if (!session) throw new NotFoundException(`scrcpy session not found: ${id}`)
    return session
  }

  private spawnSession(session: ManagedAdbScrcpySession): void {
    const [executable, ...args] = session.command.argv
    if (!executable) {
      session.state = 'failed'
      session.error = 'missing scrcpy executable'
      session.updated_at = new Date().toISOString()
      return
    }

    try {
      const proc = spawn(executable, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      })
      session.proc = proc
      session.pid = proc.pid
      session.started_at = new Date().toISOString()
      session.updated_at = session.started_at

      proc.stdout?.on('data', (chunk: Buffer) => appendTail(session.stdout_tail, chunk))
      proc.stderr?.on('data', (chunk: Buffer) => appendTail(session.stderr_tail, chunk))
      proc.once('spawn', () => {
        if (session.state === 'starting') {
          session.state = 'running'
          session.updated_at = new Date().toISOString()
        }
      })
      proc.once('error', (error) => {
        session.state = 'failed'
        session.error = error.message
        session.updated_at = new Date().toISOString()
        appendTail(session.stderr_tail, Buffer.from(error.message))
      })
      proc.once('close', (code, signal) => {
        if (session.state !== 'stopped') {
          session.state = code === 0 ? 'exited' : 'failed'
        }
        session.exit_code = code
        session.signal = signal
        session.exited_at = new Date().toISOString()
        session.updated_at = session.exited_at
        session.proc = undefined
      })
    } catch (error) {
      session.state = 'failed'
      session.error = error instanceof Error ? error.message : String(error)
      session.updated_at = new Date().toISOString()
    }
  }

  private async createRawBridgePlan(session: ManagedAdbScrcpySession, input: AdbScrcpySessionInput): Promise<AdbScrcpyRawBridge> {
    const localPort = await allocateLocalPort()
    const scid = randomScid()
    return {
      kind: 'raw_h264',
      ws_path: `/api/streaming-gateway/adb-scrcpy/sessions/${encodeURIComponent(session.id)}/stream.ws`,
      local_host: '127.0.0.1',
      local_port: localPort,
      socket_name: `scrcpy_${scid}`,
      scid,
      device_server_path: DEVICE_SERVER_PATH,
      server_version: SERVER_VERSION,
      ready: false,
      mime: 'video/h264',
      notes: [
        'Raw bridge uses adb forward + scrcpy-server raw_stream=true.',
        `max_size=${input.max_size || 'default'}, bit_rate=${input.bit_rate || 'default'}, max_fps=${input.max_fps || 'default'}`,
      ],
    }
  }

  private spawnRawBridgeSession(session: ManagedAdbScrcpySession, input: AdbScrcpySessionInput): void {
    const bridge = session.stream
    if (!bridge) {
      session.state = 'failed'
      session.error = 'missing raw bridge plan'
      session.updated_at = new Date().toISOString()
      return
    }

    const adbPath = resolveAdbPath(session.command.executable)
    const serverPath = resolveScrcpyServerPath(session.command.executable)
    if (!serverPath) {
      session.state = 'failed'
      session.error = 'scrcpy-server not found; set SCRCPY_SERVER_PATH or install scrcpy with server binary'
      session.updated_at = new Date().toISOString()
      return
    }

    const deviceFlag = session.device ? ['-s', session.device] : []
    const push = runSync(adbPath, [...deviceFlag, 'push', serverPath, bridge.device_server_path])
    appendTail(session.stdout_tail, Buffer.from(push.stdout))
    appendTail(session.stderr_tail, Buffer.from(push.stderr))
    if (push.code !== 0) {
      session.state = 'failed'
      session.error = push.stderr || push.stdout || 'adb push scrcpy-server failed'
      session.updated_at = new Date().toISOString()
      return
    }

    const forward = runSync(adbPath, [...deviceFlag, 'forward', `tcp:${bridge.local_port}`, `localabstract:${bridge.socket_name}`])
    appendTail(session.stdout_tail, Buffer.from(forward.stdout))
    appendTail(session.stderr_tail, Buffer.from(forward.stderr))
    if (forward.code !== 0) {
      session.state = 'failed'
      session.error = forward.stderr || forward.stdout || 'adb forward failed'
      session.updated_at = new Date().toISOString()
      return
    }

    const serverCommand = buildRawServerCommand(bridge, input)
    try {
      const proc = spawn(adbPath, [...deviceFlag, 'shell', serverCommand], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      })
      session.proc = proc
      session.pid = proc.pid
      session.started_at = new Date().toISOString()
      session.updated_at = session.started_at
      session.state = 'starting'

      proc.stdout?.on('data', (chunk: Buffer) => appendTail(session.stdout_tail, chunk))
      proc.stderr?.on('data', (chunk: Buffer) => appendTail(session.stderr_tail, chunk))
      proc.once('spawn', () => {
        if (session.state === 'starting') {
          session.state = 'running'
          session.updated_at = new Date().toISOString()
        }
      })
      proc.once('error', (error) => {
        session.state = 'failed'
        session.error = error.message
        session.updated_at = new Date().toISOString()
        appendTail(session.stderr_tail, Buffer.from(error.message))
        removeForward(adbPath, deviceFlag, bridge.local_port)
      })
      proc.once('close', (code, signal) => {
        if (session.state !== 'stopped') {
          session.state = code === 0 ? 'exited' : 'failed'
        }
        session.exit_code = code
        session.signal = signal
        session.exited_at = new Date().toISOString()
        session.updated_at = session.exited_at
        session.proc = undefined
        removeForward(adbPath, deviceFlag, bridge.local_port)
      })
    } catch (error) {
      session.state = 'failed'
      session.error = error instanceof Error ? error.message : String(error)
      session.updated_at = new Date().toISOString()
      removeForward(adbPath, deviceFlag, bridge.local_port)
    }
  }

  private killSessionProcess(session: ManagedAdbScrcpySession): void {
    for (const client of session.bridgeClients ?? []) client.destroy()
    session.bridgeClients?.clear()
    if (session.proc && !session.proc.killed && !isTerminalState(session.state)) {
      session.proc.kill()
    }
  }
}

function makeSessionId(): string {
  return `${SESSION_ID_PREFIX}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeLabel(label: unknown, command: AdbScrcpyCommandSpec): string {
  const value = String(label || '').trim()
  if (value) return value
  return command.device ? `ADB screen ${command.device}` : 'ADB screen session'
}

function canRunDirectCliSession(command: AdbScrcpyCommandSpec): boolean {
  if (!command.requires_backend_bridge) return true
  return command.direct_cli_video
}

function needsRawBridge(command: AdbScrcpyCommandSpec): boolean {
  return command.requires_backend_bridge && !command.direct_cli_video
}

function isTerminalState(state: AdbScrcpySessionState): boolean {
  return state === 'exited' || state === 'failed' || state === 'stopped'
}

function allocateLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address?.port) resolve(address.port)
        else reject(new Error('failed to allocate local port'))
      })
    })
  })
}

function randomScid(): string {
  const value = Math.floor(Math.random() * 0x7fffffff)
  return value.toString(16).padStart(8, '0')
}

function resolveAdbPath(scrcpyExecutable: string): string {
  const configured = String(process.env.ADB_PATH || '').trim()
  if (configured) return configured
  const exeName = process.platform === 'win32' ? 'adb.exe' : 'adb'
  const sibling = path.join(path.dirname(scrcpyExecutable), exeName)
  return fs.existsSync(sibling) ? sibling : 'adb'
}

function resolveScrcpyServerPath(scrcpyExecutable: string): string {
  const configured = String(process.env.SCRCPY_SERVER_PATH || '').trim()
  if (configured && fs.existsSync(configured)) return configured
  const sibling = path.join(path.dirname(scrcpyExecutable), 'scrcpy-server')
  if (fs.existsSync(sibling)) return sibling
  const common = [
    '/usr/local/share/scrcpy/scrcpy-server',
    '/usr/share/scrcpy/scrcpy-server',
  ]
  return common.find((candidate) => fs.existsSync(candidate)) || ''
}

function runSync(executable: string, args: string[]): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(executable, args, {
    shell: false,
    encoding: 'utf8',
    env: process.env,
    timeout: 30_000,
  })
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
  }
}

function removeForward(adbPath: string, deviceFlag: string[], localPort: number): void {
  runSync(adbPath, [...deviceFlag, 'forward', '--remove', `tcp:${localPort}`])
}

function buildRawServerCommand(bridge: AdbScrcpyRawBridge, input: AdbScrcpySessionInput): string {
  const params = [
    `CLASSPATH=${bridge.device_server_path}`,
    'app_process',
    '/',
    'com.genymobile.scrcpy.Server',
    bridge.server_version,
    `scid=${bridge.scid}`,
    'log_level=info',
    'tunnel_forward=true',
    'audio=false',
    'control=false',
    'cleanup=false',
    'raw_stream=true',
  ]

  appendServerParam(params, 'max_size', input.max_size)
  appendServerParam(params, 'video_bit_rate', normalizeBitRate(input.bit_rate))
  appendServerParam(params, 'max_fps', input.max_fps)
  appendServerParam(params, 'video_codec', input.video_codec)
  appendServerParam(params, 'display_id', input.display_id)
  return params.join(' ')
}

function appendServerParam(params: string[], name: string, value: unknown): void {
  const raw = String(value ?? '').trim()
  if (!raw) return
  if (!/^[a-zA-Z0-9_.:-]+$/.test(raw)) return
  params.push(`${name}=${raw}`)
}

function normalizeBitRate(value: unknown): string {
  const raw = String(value ?? '').trim().toUpperCase()
  if (!raw) return ''
  const match = raw.match(/^(\d+)([KMG])?$/)
  if (!match) return raw
  const amount = Number(match[1])
  const unit = match[2]
  if (!Number.isFinite(amount)) return raw
  if (unit === 'G') return String(amount * 1_000_000_000)
  if (unit === 'M') return String(amount * 1_000_000)
  if (unit === 'K') return String(amount * 1_000)
  return String(amount)
}

function appendTail(target: string[], chunk: Buffer): void {
  const lines = chunk.toString('utf8').split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean)
  target.push(...lines)
  if (target.length > MAX_TAIL_LINES) {
    target.splice(0, target.length - MAX_TAIL_LINES)
  }
}

function safeCloseWs(ws: WebSocket, code: number, reason: string): void {
  try {
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
      ws.close(code, reason.slice(0, 80))
    }
  } catch {
    // Ignore per-client close failures; stream sessions must not bring down the server.
  }
}

function isCommandSpec(value: unknown): value is AdbScrcpyCommandSpec {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AdbScrcpyCommandSpec>
  return (
    typeof candidate.executable === 'string' &&
    Array.isArray(candidate.args) &&
    Array.isArray(candidate.argv) &&
    typeof candidate.command_line === 'string' &&
    typeof candidate.profile === 'string'
  )
}

function toPublicSession(session: ManagedAdbScrcpySession): AdbScrcpySession {
  const { proc: _proc, ...publicSession } = session
  return {
    ...publicSession,
    stdout_tail: [...session.stdout_tail],
    stderr_tail: [...session.stderr_tail],
    notes: [...session.notes],
  }
}
