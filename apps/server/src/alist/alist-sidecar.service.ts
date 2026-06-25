import { BadGatewayException, BadRequestException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { AlistDriverEntry, AlistDriverGetResult, AlistDriverListResult } from './alist.types'
import { AlistAuthorizationService } from './alist-authorization.service'
import type { StorageMountRecord } from '../storage/storage.types'

const DEFAULT_PORT = 15244
const DEFAULT_PASSWORD = 'homesense-alist-sidecar'
const SIDECAR_ROOT = path.resolve(__dirname, '../../../../data/alist-sidecar')
const REFERENCE_ALIST_DIR = path.resolve(__dirname, '../../../../../References/alist')

interface AListResponse<T> {
  code: number
  message?: string
  data: T
}

interface AListStorage {
  id: number
  mount_path: string
  driver: string
  addition: string
  remark?: string
  status?: string
}

interface AListFsEntry {
  name: string
  size?: number
  is_dir?: boolean
  modified?: string
  created?: string
  raw_url?: string
}

@Injectable()
export class AlistSidecarService implements OnModuleDestroy {
  private readonly log = new Logger(AlistSidecarService.name)
  private process: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private token: string | null = null
  private readonly baseUrl = `http://127.0.0.1:${Number(process.env.ALIST_SIDECAR_PORT || DEFAULT_PORT)}`

  constructor(private readonly authorizations: AlistAuthorizationService) {}

  async onModuleDestroy(): Promise<void> {
    if (!this.process) return
    this.process.kill()
    this.process = null
  }

  async health(): Promise<{ status: string; version: string; drivers: string[]; mounts: string[]; started_at: string }> {
    await this.ensureStarted()
    const storages = await this.listStorages()
    return {
      status: 'ok',
      version: 'alist-sidecar',
      drivers: ['baidu_netdisk'],
      mounts: storages.map((storage) => storage.mount_path),
      started_at: new Date().toISOString(),
    }
  }

  async list(mount: StorageMountRecord, rawPath: string): Promise<AlistDriverListResult> {
    await this.syncMount(mount)
    const virtualPath = cleanVirtualPath(rawPath || mount.virtual_path)
    const sidecarPath = toSidecarPath(mount, virtualPath)
    const data = await this.request<{
      content?: AListFsEntry[]
      total?: number
      provider?: string
    }>('/api/fs/list', {
      method: 'POST',
      body: JSON.stringify({
        path: sidecarPath,
        password: '',
        page: 1,
        per_page: 500,
        refresh: false,
      }),
    })
    const entries = (data.content ?? []).map((entry) => mapEntry(entry, virtualPath, mount))
    return {
      path: virtualPath,
      provider: 'baidu_netdisk',
      mount_path: mount.virtual_path,
      entries,
      total: data.total ?? entries.length,
    }
  }

  async get(mount: StorageMountRecord, rawPath: string): Promise<AlistDriverGetResult> {
    await this.syncMount(mount)
    const virtualPath = cleanVirtualPath(rawPath || mount.virtual_path)
    const data = await this.request<AListFsEntry>('/api/fs/get', {
      method: 'POST',
      body: JSON.stringify({ path: toSidecarPath(mount, virtualPath), password: '' }),
    })
    return {
      ...mapEntry(data, path.posix.dirname(virtualPath), mount),
      path: virtualPath,
      raw_url: data.raw_url,
    }
  }

  private async syncMount(mount: StorageMountRecord): Promise<void> {
    if (normalizeDriver(mount.driver) !== 'baidu_netdisk') return
    const authorization = this.authorizations.getPrivate(mount.authorization_id)
    const refreshToken = readString(authorization.secret.refresh_token) || readString(authorization.secret.password)
    if (!refreshToken) throw new BadRequestException('百度网盘需要 refresh_token')

    await this.ensureStarted()
    const sidecarMountPath = sidecarMountPathFor(mount)
    const addition = JSON.stringify({
      refresh_token: refreshToken,
      root_folder_path: readString(mount.props.root_path) || readString(authorization.props.root_path) || '/',
      order_by: 'name',
      order_direction: 'asc',
      download_api: readString(authorization.props.download_api) || 'official',
      client_id: readString(authorization.props.client_id) || 'hq9yQ9w9kR4YHj1kyYafLygVocobh7Sf',
      client_secret: readString(authorization.props.client_secret) || 'YH2VpZcFJHYNnV6vLfHQXDBhcE7ZChyE',
      custom_crack_ua: readString(authorization.props.custom_crack_ua) || 'netdisk',
      upload_thread: '3',
      upload_api: 'https://d.pcs.baidu.com',
      use_dynamic_upload_api: true,
      custom_upload_part_size: 0,
      low_bandwith_upload_mode: false,
      only_list_video_file: false,
    })

    const existing = (await this.listStorages()).find((storage) => storage.mount_path === sidecarMountPath)
    const body = {
      ...(existing ? { id: existing.id } : {}),
      mount_path: sidecarMountPath,
      order: mount.id,
      remark: `homesense:${mount.id}`,
      cache_expiration: 30,
      web_proxy: true,
      webdav_policy: 'native_proxy',
      down_proxy_url: '',
      down_proxy_sign: true,
      extract_folder: 'front',
      enable_sign: false,
      driver: 'BaiduNetdisk',
      order_by: 'name',
      order_direction: 'asc',
      addition,
    }
    await this.request(existing ? '/api/admin/storage/update' : '/api/admin/storage/create', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  private async listStorages(): Promise<AListStorage[]> {
    await this.ensureStarted()
    const data = await this.request<{ content?: AListStorage[] }>('/api/admin/storage/list?page=1&per_page=500')
    return data.content ?? []
  }

  private async ensureStarted(): Promise<void> {
    if (this.token) return
    if (this.starting) return this.starting
    this.starting = this.start()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  private async start(): Promise<void> {
    fs.mkdirSync(SIDECAR_ROOT, { recursive: true })
    await this.ensureConfig()
    if (!await this.tryLogin()) {
      await this.resetInternalAdminPassword()
      if (await this.tryLogin()) return
      this.spawnSidecar()
      await this.waitUntilReady()
      if (!await this.tryLogin()) {
        throw new BadGatewayException('AList sidecar started but login failed')
      }
    }
  }

  private spawnSidecar(): void {
    if (this.process) return
    const command = resolveAlistServerCommand()
    const env = {
      ...process.env,
      ALIST_ADMIN_PASSWORD: DEFAULT_PASSWORD,
      ALIST_FORCE: 'true',
      ALIST_SCHEME_ADDR: '127.0.0.1',
      ALIST_SCHEME_HTTP_PORT: String(Number(process.env.ALIST_SIDECAR_PORT || DEFAULT_PORT)),
      ALIST_SCHEME_HTTPS_PORT: '-1',
      ALIST_LOG_ENABLE: 'false',
      ALIST_S3_ENABLE: 'false',
      ALIST_FTP_ENABLE: 'false',
      ALIST_SFTP_ENABLE: 'false',
    }
    this.process = spawn(command.file, command.args, {
      cwd: command.cwd,
      env,
      windowsHide: true,
    })
    this.process.stdout.on('data', (chunk) => this.log.debug(String(chunk).trim()))
    this.process.stderr.on('data', (chunk) => this.log.warn(String(chunk).trim()))
    this.process.once('exit', (code) => {
      this.log.warn(`AList sidecar exited with code ${code}`)
      this.process = null
      this.token = null
    })
  }

  private async ensureConfig(): Promise<void> {
    const configPath = path.join(SIDECAR_ROOT, 'config.json')
    const current = readJsonFile(configPath)
    const config: Record<string, unknown> = {
      ...current,
      force: true,
      scheme: {
        ...(isRecord(current.scheme) ? current.scheme : {}),
        address: '127.0.0.1',
        http_port: Number(process.env.ALIST_SIDECAR_PORT || DEFAULT_PORT),
        https_port: -1,
      },
      log: { ...(isRecord(current.log) ? current.log : {}), enable: false },
      s3: { ...(isRecord(current.s3) ? current.s3 : {}), enable: false },
      ftp: { ...(isRecord(current.ftp) ? current.ftp : {}), enable: false },
      sftp: { ...(isRecord(current.sftp) ? current.sftp : {}), enable: false },
    }
    const distDir = path.join(SIDECAR_ROOT, 'public', 'dist')
    config.dist_dir = distDir
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    // alist server requires frontend dist/index.html to start, even if only API is used
    fs.mkdirSync(distDir, { recursive: true })
    const indexHtml = path.join(distDir, 'index.html')
    if (!fs.existsSync(indexHtml)) {
      fs.writeFileSync(indexHtml, '<!doctype html><html><head><title>alist</title></head><body></body></html>')
    }
  }

  private async resetInternalAdminPassword(): Promise<void> {
    const command = resolveAlistAdminSetCommand()
    await new Promise<void>((resolve) => {
      const child = spawn(command.file, command.args, {
        cwd: command.cwd,
        env: { ...process.env, ALIST_ADMIN_PASSWORD: DEFAULT_PASSWORD },
        windowsHide: true,
      })
      child.once('error', () => resolve())
      child.once('exit', () => resolve())
    })
  }

  private async waitUntilReady(): Promise<void> {
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      if (await this.tryLogin()) return
      await delay(800)
    }
    throw new BadGatewayException('AList sidecar did not become ready')
  }

  private async tryLogin(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Client-Id': 'homesense-sidecar' },
        body: JSON.stringify({ username: 'admin', password: DEFAULT_PASSWORD }),
      })
      if (!response.ok) return false
      const body = await response.json() as AListResponse<{ token?: string }>
      if (body.code !== 200 || !body.data?.token) return false
      this.token = body.data.token
      return true
    } catch {
      return false
    }
  }

  private async request<T>(urlPath: string, init?: RequestInit): Promise<T> {
    await this.ensureStarted()
    const response = await fetch(`${this.baseUrl}${urlPath}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: this.token ?? '',
        ...(init?.headers ?? {}),
      },
    })
    let body: AListResponse<T> | null = null
    try {
      body = await response.json() as AListResponse<T>
    } catch {}
    if (!response.ok || !body || body.code !== 200) {
      throw new BadGatewayException(body?.message || `AList sidecar request failed: ${response.status}`)
    }
    return body.data
  }
}

function resolveAlistServerCommand(): { file: string; args: string[]; cwd: string } {
  const bin = readString(process.env.ALIST_BIN)
  if (bin) return { file: bin, args: ['server', '--data', SIDECAR_ROOT], cwd: path.dirname(bin) }
  const bundled = path.join(SIDECAR_ROOT, 'alist.exe')
  if (fs.existsSync(bundled)) return { file: bundled, args: ['server', '--data', SIDECAR_ROOT], cwd: SIDECAR_ROOT }
  return { file: 'go', args: ['run', '.', 'server', '--data', SIDECAR_ROOT], cwd: REFERENCE_ALIST_DIR }
}

function resolveAlistAdminSetCommand(): { file: string; args: string[]; cwd: string } {
  const bin = readString(process.env.ALIST_BIN)
  if (bin) return { file: bin, args: ['admin', 'set', DEFAULT_PASSWORD, '--data', SIDECAR_ROOT], cwd: path.dirname(bin) }
  const bundled = path.join(SIDECAR_ROOT, 'alist.exe')
  if (fs.existsSync(bundled)) return { file: bundled, args: ['admin', 'set', DEFAULT_PASSWORD, '--data', SIDECAR_ROOT], cwd: SIDECAR_ROOT }
  return { file: 'go', args: ['run', '.', 'admin', 'set', DEFAULT_PASSWORD, '--data', SIDECAR_ROOT], cwd: REFERENCE_ALIST_DIR }
}

function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function sidecarMountPathFor(mount: StorageMountRecord): string {
  return `/homesense-${mount.id}`
}

function toSidecarPath(mount: StorageMountRecord, virtualPath: string): string {
  const mountPath = cleanVirtualPath(mount.virtual_path)
  const rel = virtualPath === mountPath ? '' : virtualPath.slice(mountPath.length)
  return cleanVirtualPath(`${sidecarMountPathFor(mount)}${rel}`)
}

function mapEntry(entry: AListFsEntry, parentPath: string, mount: StorageMountRecord): AlistDriverEntry {
  const name = readString(entry.name)
  return {
    name,
    path: cleanVirtualPath(path.posix.join(parentPath, name)),
    size: Number(entry.size ?? 0),
    is_dir: Boolean(entry.is_dir),
    modified: entry.modified || entry.created,
    driver: 'baidu_netdisk',
    mount_path: mount.virtual_path,
  }
}

function cleanVirtualPath(value: string): string {
  const normalized = String(value || '/').trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return withSlash.replace(/\/+$/, '') || '/'
}

function normalizeDriver(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
