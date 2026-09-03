import { Injectable, OnApplicationShutdown } from '@nestjs/common'
import { spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

const PATH_PREFIX = '/moonlight'
const PUBLIC_PATH = `${PATH_PREFIX}/`
const DEFAULT_PORT = 18080
const PROBE_TIMEOUT_MS = 1200
const INTERNAL_AUTH_FILE = 'homesense-auth.json'
const INTERNAL_AUTH_USER = 'homesense'
const LEGACY_INTERNAL_AUTH_PASSWORD = 'homesense'

type RuntimeState = {
  endpoint: string
  publicPath: string
  managed: boolean
  binary: string
  running: boolean
  reachable: boolean
  pid?: number
  statusCode: number | null
  error?: string
  checkedAt: string
}

type InternalAuthCredentials = {
  name: string
  password: string
}

type LoginResult = {
  ok: boolean
  statusCode: number | null
  cookies: string[]
  error?: string
}

type RuntimeRequestResult = {
  ok: boolean
  statusCode: number | null
  body: string
  error?: string
}

type RuntimeStreamResult = {
  ok: boolean
  statusCode: number | null
  response?: http.IncomingMessage
  error?: string
}

@Injectable()
export class MoonlightWebRuntimeService implements OnApplicationShutdown {
  private child: ChildProcess | null = null
  private childError = ''
  private port = Number(process.env.MOONLIGHT_WEB_RUNTIME_PORT || process.env.STREAMING_RUNTIME_PORT || DEFAULT_PORT)
  private internalAuth: InternalAuthCredentials | null = null

  publicPath() {
    return PUBLIC_PATH
  }

  internalEndpoint() {
    return `http://127.0.0.1:${this.port}${PATH_PREFIX}`
  }

  async status(): Promise<RuntimeState> {
    await this.ensureStarted()
    const status = await probeUrl(this.internalEndpoint())
    return {
      endpoint: this.internalEndpoint(),
      publicPath: this.publicPath(),
      managed: true,
      binary: resolveRuntimeBinary() || '',
      running: Boolean(this.child && !this.child.killed),
      reachable: status.reachable,
      pid: this.child?.pid,
      statusCode: status.statusCode,
      error: status.reachable ? undefined : status.error || this.childError || undefined,
      checkedAt: new Date().toISOString(),
    }
  }

  async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed && this.child.exitCode == null) return
    const binary = resolveRuntimeBinary()
    if (!binary) {
      this.childError = 'MOONLIGHT_WEB_RUNTIME_BIN is not configured and no bundled web-server binary was found.'
      return
    }

    this.port = await choosePort(this.port)
    const configDir = resolveRuntimeStateDir()
    fs.mkdirSync(configDir, { recursive: true })
    fs.mkdirSync(path.join(path.dirname(binary), 'server'), { recursive: true })
    const configPath = path.join(configDir, 'config.json')
    ensureRuntimeDefaultUserConfig(configPath)
    const logPath = path.resolve(process.cwd(), '../../data/logs/moonlight-web-runtime.log')
    fs.mkdirSync(path.dirname(logPath), { recursive: true })

    this.childError = ''
    const child = spawn(binary, ['--config-path', configPath, 'run'], {
      cwd: path.dirname(binary),
      env: {
        ...process.env,
        BIND_ADDRESS: `127.0.0.1:${this.port}`,
        PATH_PREFIX,
        LOG_FILE: logPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    child.stdout?.on('data', () => {})
    child.stderr?.on('data', (chunk) => {
      this.childError = chunk.toString().trim().slice(-1000)
    })
    child.once('exit', (code, signal) => {
      if (code !== 0 && code != null) this.childError = `Moonlight Web runtime exited with code ${code}`
      else if (signal) this.childError = `Moonlight Web runtime exited with signal ${signal}`
      this.child = null
    })

    await waitForReachable(this.internalEndpoint(), 7000)
  }

  async proxyHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await this.ensureStarted()
    const cookies = await this.ensureBrowserSession(req)
    proxyHttpRequest(req, res, this.port, PATH_PREFIX, cookies)
  }

  async proxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
    if (!req.url?.startsWith(PATH_PREFIX)) return false
    await this.ensureStarted()
    proxyUpgradeRequest(req, socket, head, this.port)
    return true
  }

  async requestJson<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
    await this.ensureStarted()
    const credentials = this.resolveInternalAuth()
    const login = await this.loginForInternalRequest(credentials)
    const result = await runtimeRequest(this.port, method, apiPath, login.cookieHeader, body)
    if (!result.ok) {
      throw new Error(result.body || result.error || `Moonlight Web API failed with status ${result.statusCode ?? 'unknown'}`)
    }
    return (result.body ? JSON.parse(result.body) : {}) as T
  }

  async requestJsonStream(apiPath: string, body?: unknown): Promise<http.IncomingMessage> {
    await this.ensureStarted()
    const credentials = this.resolveInternalAuth()
    const login = await this.loginForInternalRequest(credentials)
    const result = await runtimeStreamRequest(this.port, apiPath, login.cookieHeader, body)
    if (!result.ok || !result.response) {
      throw new Error(result.error || `Moonlight Web API stream failed with status ${result.statusCode ?? 'unknown'}`)
    }
    return result.response
  }

  onApplicationShutdown(): void {
    if (!this.child || this.child.killed) return
    this.child.kill()
  }

  private async ensureBrowserSession(req: IncomingMessage): Promise<string[]> {
    const rawPath = req.url || '/'
    if (rawPath.startsWith(`${PATH_PREFIX}/api/`) || rawPath.startsWith('/api/')) return []

    const credentials = this.resolveInternalAuth()
    let result = await loginRuntime(this.port, credentials)
    if (result.ok) return result.cookies

    const shouldTryLegacy = credentials.name === INTERNAL_AUTH_USER && credentials.password !== LEGACY_INTERNAL_AUTH_PASSWORD
    if (shouldTryLegacy && (result.statusCode === 401 || result.statusCode === 404)) {
      const legacy = { name: INTERNAL_AUTH_USER, password: LEGACY_INTERNAL_AUTH_PASSWORD }
      result = await loginRuntime(this.port, legacy)
      if (result.ok) {
        this.persistInternalAuth(legacy)
        this.internalAuth = legacy
        return result.cookies
      }
    }

    this.childError = result.error || `Moonlight Web internal login failed with status ${result.statusCode ?? 'unknown'}`
    return []
  }

  private async loginForInternalRequest(credentials: InternalAuthCredentials): Promise<{ cookieHeader: string }> {
    let result = await loginRuntime(this.port, credentials)
    if (!result.ok) {
      const shouldTryLegacy = credentials.name === INTERNAL_AUTH_USER && credentials.password !== LEGACY_INTERNAL_AUTH_PASSWORD
      if (shouldTryLegacy && (result.statusCode === 401 || result.statusCode === 404)) {
        const legacy = { name: INTERNAL_AUTH_USER, password: LEGACY_INTERNAL_AUTH_PASSWORD }
        result = await loginRuntime(this.port, legacy)
        if (result.ok) {
          this.persistInternalAuth(legacy)
          this.internalAuth = legacy
        }
      }
    }
    if (!result.ok) throw new Error(result.error || `Moonlight Web internal login failed with status ${result.statusCode ?? 'unknown'}`)
    return { cookieHeader: cookiesToHeader(result.cookies) }
  }

  private resolveInternalAuth(): InternalAuthCredentials {
    if (this.internalAuth) return this.internalAuth

    const envPassword = String(process.env.MOONLIGHT_WEB_INTERNAL_PASSWORD || '').trim()
    const envUser = String(process.env.MOONLIGHT_WEB_INTERNAL_USER || '').trim() || INTERNAL_AUTH_USER
    if (envPassword) {
      this.internalAuth = { name: envUser, password: envPassword }
      return this.internalAuth
    }

    const authPath = internalAuthPath()
    try {
      const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8')) as Partial<InternalAuthCredentials>
      const name = String(parsed.name || '').trim()
      const password = String(parsed.password || '').trim()
      if (name && password) {
        this.internalAuth = { name, password }
        return this.internalAuth
      }
    } catch {
      // Create a HomeSense-owned Moonlight Web account on first runtime use.
    }

    const credentials = {
      name: INTERNAL_AUTH_USER,
      password: crypto.randomBytes(24).toString('base64url'),
    }
    this.persistInternalAuth(credentials)
    this.internalAuth = credentials
    return credentials
  }

  private persistInternalAuth(credentials: InternalAuthCredentials): void {
    const authPath = internalAuthPath()
    fs.mkdirSync(path.dirname(authPath), { recursive: true })
    fs.writeFileSync(authPath, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  }
}

function resolveRuntimeStateDir(): string {
  return path.resolve(process.cwd(), '../../data/runtime/moonlight-web/server')
}

function internalAuthPath(): string {
  return path.join(resolveRuntimeStateDir(), INTERNAL_AUTH_FILE)
}

function ensureRuntimeDefaultUserConfig(configPath: string): void {
  const defaultUser = resolveRuntimeDefaultUser()
  if (!defaultUser) return
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, any>
    const webServer = isRecord(parsed.web_server) ? parsed.web_server : {}
    if (webServer.default_user_id === defaultUser.userId && webServer.default_role_id === defaultUser.roleId) return
    parsed.web_server = {
      ...webServer,
      default_user_id: defaultUser.userId,
      default_role_id: defaultUser.roleId,
    }
    fs.writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  } catch {
    // The bundled runtime owns config creation; if it is missing or invalid, keep startup non-blocking.
  }
}

function resolveRuntimeDefaultUser(): { userId: number; roleId: number } | null {
  try {
    const dataPath = path.resolve(process.cwd(), '../../data/runtime/moonlight-web/package/server/data.json')
    const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as Record<string, any>
    const users = isRecord(parsed.users) ? parsed.users : {}
    const entries = Object.entries(users)
      .map(([id, value]) => ({ id: Number(id), user: value }))
      .filter((entry): entry is { id: number; user: Record<string, any> } => Number.isInteger(entry.id) && isRecord(entry.user))
    const selected = entries.find((entry) => entry.user.name === INTERNAL_AUTH_USER) ?? entries[0]
    const roleId = Number(selected?.user.role_id)
    if (!selected || !Number.isInteger(roleId)) return null
    return { userId: selected.id, roleId }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function resolveRuntimeBinary(): string {
  const configured = String(process.env.MOONLIGHT_WEB_RUNTIME_BIN || '').trim()
  const candidates = [
    configured,
    path.resolve(process.cwd(), '../../data/runtime/moonlight-web/package/web-server.exe'),
    path.resolve(process.cwd(), '../../data/runtime/moonlight-web/package/web-server'),
    path.resolve(process.cwd(), '../../data/runtime/moonlight-web/web-server.exe'),
    path.resolve(process.cwd(), '../../data/runtime/moonlight-web/web-server'),
    path.resolve(process.cwd(), '../../runtime/moonlight-web/web-server.exe'),
    path.resolve(process.cwd(), '../../runtime/moonlight-web/web-server'),
  ].filter(Boolean)
  return candidates.find((candidate) => fs.existsSync(candidate)) || ''
}

function choosePort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const tryPort = (port: number) => {
      const server = net.createServer()
      server.once('error', () => tryPort(port + 1))
      server.once('listening', () => {
        server.close(() => resolve(port))
      })
      server.listen(port, '127.0.0.1')
    }
    tryPort(Number.isInteger(preferred) && preferred > 0 ? preferred : DEFAULT_PORT)
  })
}

async function waitForReachable(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await probeUrl(url)
    if (status.reachable) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

function probeUrl(url: string): Promise<{ reachable: boolean; statusCode: number | null; error?: string }> {
  return new Promise((resolve) => {
    const request = http.request(url, { method: 'GET', timeout: PROBE_TIMEOUT_MS }, (response) => {
      response.resume()
      resolve({ reachable: response.statusCode != null && response.statusCode < 500, statusCode: response.statusCode ?? null })
    })
    request.once('timeout', () => {
      request.destroy()
      resolve({ reachable: false, statusCode: null, error: 'timeout' })
    })
    request.once('error', (error) => {
      resolve({ reachable: false, statusCode: null, error: error.message })
    })
    request.end()
  })
}

function loginRuntime(port: number, credentials: InternalAuthCredentials): Promise<LoginResult> {
  return new Promise((resolve) => {
    const body = JSON.stringify(credentials)
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `${PATH_PREFIX}/api/login`,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          host: `127.0.0.1:${port}`,
        },
        timeout: PROBE_TIMEOUT_MS,
      },
      (response) => {
        response.resume()
        const setCookie = response.headers['set-cookie']
        resolve({
          ok: response.statusCode != null && response.statusCode >= 200 && response.statusCode < 300,
          statusCode: response.statusCode ?? null,
          cookies: Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [],
        })
      },
    )
    request.once('timeout', () => {
      request.destroy()
      resolve({ ok: false, statusCode: null, cookies: [], error: 'timeout' })
    })
    request.once('error', (error) => {
      resolve({ ok: false, statusCode: null, cookies: [], error: error.message })
    })
    request.end(body)
  })
}

function runtimeRequest(port: number, method: string, apiPath: string, cookieHeader: string, payload?: unknown): Promise<RuntimeRequestResult> {
  return new Promise((resolve) => {
    const body = payload == null ? '' : JSON.stringify(payload)
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: `${PATH_PREFIX}/api${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`,
        headers: {
          ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          host: `127.0.0.1:${port}`,
        },
        timeout: 30000,
      },
      (response) => {
        let responseBody = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          responseBody += chunk
        })
        response.on('end', () => {
          resolve({
            ok: response.statusCode != null && response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode ?? null,
            body: responseBody,
          })
        })
      },
    )
    request.once('timeout', () => {
      request.destroy()
      resolve({ ok: false, statusCode: null, body: '', error: 'timeout' })
    })
    request.once('error', (error) => {
      resolve({ ok: false, statusCode: null, body: '', error: error.message })
    })
    request.end(body)
  })
}

function runtimeStreamRequest(port: number, apiPath: string, cookieHeader: string, payload?: unknown): Promise<RuntimeStreamResult> {
  return new Promise((resolve) => {
    const body = payload == null ? '' : JSON.stringify(payload)
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `${PATH_PREFIX}/api${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`,
        headers: {
          ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          host: `127.0.0.1:${port}`,
        },
        timeout: 65000,
      },
      (response) => {
        if (response.statusCode != null && response.statusCode >= 200 && response.statusCode < 300) {
          resolve({ ok: true, statusCode: response.statusCode, response })
          return
        }
        let responseBody = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          responseBody += chunk
        })
        response.on('end', () => {
          resolve({ ok: false, statusCode: response.statusCode ?? null, error: responseBody })
        })
      },
    )
    request.once('timeout', () => {
      request.destroy()
      resolve({ ok: false, statusCode: null, error: 'timeout' })
    })
    request.once('error', (error) => {
      resolve({ ok: false, statusCode: null, error: error.message })
    })
    request.end(body)
  })
}

function cookiesToHeader(cookies: string[]): string {
  return cookies
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ')
}

function proxyHttpRequest(req: IncomingMessage, res: ServerResponse, port: number, pathPrefix: string, setCookies: string[] = []): void {
  const rawPath = req.url || '/'
  const targetPath = rawPath.startsWith(pathPrefix) ? rawPath : `${pathPrefix}${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`
  const target = http.request(
    {
      host: '127.0.0.1',
      port,
      method: req.method,
      path: targetPath,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${port}`,
      },
    },
    (targetRes) => {
      const headers = { ...targetRes.headers }
      if (setCookies.length > 0) {
        const existing = headers['set-cookie']
        headers['set-cookie'] = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...setCookies]
      }
      res.writeHead(targetRes.statusCode ?? 502, headers)
      targetRes.pipe(res)
    },
  )
  target.once('error', (error) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(error.message)
  })
  req.pipe(target)
}

function proxyUpgradeRequest(req: IncomingMessage, socket: Duplex, head: Buffer, port: number): void {
  const target = net.connect(port, '127.0.0.1', () => {
    target.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`)
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue
      target.write(`${key}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`)
    }
    target.write(`host: 127.0.0.1:${port}\r\n`)
    target.write('\r\n')
    if (head.length > 0) target.write(head)
    socket.pipe(target).pipe(socket)
  })
  target.once('error', () => socket.destroy())
}
