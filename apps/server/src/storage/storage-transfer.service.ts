import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import fs from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import { pipeline } from 'node:stream/promises'
import { PassThrough, Readable } from 'node:stream'
import path from 'node:path'
import { AlistAuthorizationService } from '../alist/alist-authorization.service'
import type { AlistCopyInput, AlistDriverEntry, AlistDriverListResult, AlistDriverMutationResult } from '../alist/alist.types'
import { cliBridge } from '../cli/cli-bridge'
import { KeyStore } from '../terminal/keystore'
import { StorageMountService } from './storage-mount.service'
import type { StorageMountRecord } from './storage.types'

const DEFAULT_TIMEOUT_MS = 30_000
type TransferProgressReporter = (patch: { progress?: number; message?: string }) => void

@Injectable()
export class StorageTransferService {
  constructor(
    private readonly mounts: StorageMountService,
    private readonly authorizations: AlistAuthorizationService,
  ) {}

  async download(rawPath: string, output: NodeJS.WritableStream): Promise<{ name: string }> {
    const mount = this.findMount(rawPath)
    if (!mount) throw new BadRequestException(`No storage mount matched path: ${rawPath}`)
    const driver = normalizeDriver(mount.driver)
    if (driver === 'adb') return this.downloadAdb(mount, rawPath, output)
    if (driver === 'sftp') return this.downloadSftp(mount, rawPath, output)
    if (driver === 'webdav') return this.downloadWebdav(mount, rawPath, output)
    if (driver === 'local' || driver === 'smb' || driver === 'nfs') return this.downloadLocal(mount, rawPath, output)
    throw new BadRequestException(`Download is not implemented for driver: ${driver}`)
  }

  async upload(rawPath: string, input: NodeJS.ReadableStream): Promise<{ uploaded: number }> {
    const mount = this.findMount(rawPath)
    if (!mount) throw new BadRequestException(`No storage mount matched path: ${rawPath}`)
    if (mount.readonly) throw new ForbiddenException('mount is readonly')
    const driver = normalizeDriver(mount.driver)
    if (driver === 'adb') return this.uploadAdb(mount, rawPath, input)
    if (driver === 'sftp') return this.uploadSftp(mount, rawPath, input)
    if (driver === 'webdav') return this.uploadWebdav(mount, rawPath, input)
    if (driver === 'local' || driver === 'smb' || driver === 'nfs') return this.uploadLocal(mount, rawPath, input)
    throw new BadRequestException(`Upload is not implemented for driver: ${driver}`)
  }

  async mkdir(rawPath: string): Promise<{ created: number }> {
    const mount = this.findMount(rawPath)
    if (!mount) throw new BadRequestException(`No storage mount matched path: ${rawPath}`)
    if (mount.readonly) throw new ForbiddenException('mount is readonly')
    const driver = normalizeDriver(mount.driver)
    if (driver === 'adb') return this.mkdirAdb(mount, rawPath)
    if (driver === 'sftp') return this.mkdirSftpPath(mount, rawPath)
    if (driver === 'webdav') return this.mkdirWebdav(mount, rawPath)
    if (driver === 'local' || driver === 'smb' || driver === 'nfs') return this.mkdirLocal(mount, rawPath)
    throw new BadRequestException(`Mkdir is not implemented for driver: ${driver}`)
  }

  async copy(input: AlistCopyInput, report?: TransferProgressReporter): Promise<AlistDriverMutationResult> {
    const srcDir = requiredVirtualPath(input.src_dir, 'src_dir')
    const dstDir = requiredVirtualPath(input.dst_dir, 'dst_dir')
    const names = requiredNames(input.names)
    const dstMount = this.findMount(dstDir)
    if (!dstMount) throw new BadRequestException(`No storage mount matched destination: ${dstDir}`)
    if (dstMount.readonly) throw new ForbiddenException('destination mount is readonly')

    let copied = 0
    for (const name of names) {
      report?.({
        progress: progressFor(copied, names.length),
        message: `copying ${name}`,
      })
      const srcPath = cleanVirtualPath(path.posix.join(srcDir, name))
      const dstPath = cleanVirtualPath(path.posix.join(dstDir, name))
      await this.copyOne(srcPath, dstPath)
      copied += 1
      report?.({
        progress: progressFor(copied, names.length),
        message: `copied ${copied}/${names.length}`,
      })
    }
    return { copied }
  }

  async copyTree(
    input: AlistCopyInput,
    list: (path: string) => Promise<AlistDriverListResult>,
    report?: TransferProgressReporter,
  ): Promise<AlistDriverMutationResult> {
    const srcDir = requiredVirtualPath(input.src_dir, 'src_dir')
    const dstDir = requiredVirtualPath(input.dst_dir, 'dst_dir')
    const names = requiredNames(input.names)
    const plan: Array<{ srcPath: string; dstPath: string; isDir: boolean }> = []

    for (const name of names) {
      const srcPath = cleanVirtualPath(path.posix.join(srcDir, name))
      const dstPath = cleanVirtualPath(path.posix.join(dstDir, name))
      await this.collectCopyPlan(srcPath, dstPath, list, plan)
    }

    await this.mkdir(dstDir)
    let copied = 0
    const files = plan.filter((item) => !item.isDir)
    for (const item of plan) {
      if (item.isDir) {
        report?.({ progress: progressFor(copied, Math.max(files.length, 1)), message: `creating ${item.dstPath}` })
        await this.mkdir(item.dstPath)
        continue
      }
      report?.({ progress: progressFor(copied, Math.max(files.length, 1)), message: `copying ${path.posix.basename(item.srcPath)}` })
      await this.copyOne(item.srcPath, item.dstPath)
      copied += 1
      report?.({ progress: progressFor(copied, Math.max(files.length, 1)), message: `copied ${copied}/${files.length}` })
    }
    return { copied }
  }

  private async downloadLocal(mount: StorageMountRecord, rawPath: string, output: NodeJS.WritableStream): Promise<{ name: string }> {
    const fullPath = this.localPath(mount, rawPath)
    await pipeline(fs.createReadStream(fullPath), output)
    return { name: path.basename(fullPath) }
  }

  private async uploadLocal(mount: StorageMountRecord, rawPath: string, input: NodeJS.ReadableStream): Promise<{ uploaded: number }> {
    const fullPath = this.localPath(mount, rawPath)
    await mkdir(path.dirname(fullPath), { recursive: true })
    await pipeline(input, fs.createWriteStream(fullPath))
    return { uploaded: 1 }
  }

  private async mkdirLocal(mount: StorageMountRecord, rawPath: string): Promise<{ created: number }> {
    await mkdir(this.localPath(mount, rawPath), { recursive: true })
    return { created: 1 }
  }

  private async downloadWebdav(mount: StorageMountRecord, rawPath: string, output: NodeJS.WritableStream): Promise<{ name: string }> {
    const auth = this.authorizations.getPrivate(mount.authorization_id)
    const url = webdavUrl(mount, auth, rawPath)
    const response = await fetch(url, { headers: webdavHeaders(auth) })
    if (!response.ok || !response.body) throw new BadRequestException(`WebDAV download failed: ${response.status}`)
    await pipeline(Readable.fromWeb(response.body as any), output)
    return { name: path.posix.basename(cleanVirtualPath(rawPath)) }
  }

  private async uploadWebdav(mount: StorageMountRecord, rawPath: string, input: NodeJS.ReadableStream): Promise<{ uploaded: number }> {
    const auth = this.authorizations.getPrivate(mount.authorization_id)
    const url = webdavUrl(mount, auth, rawPath)
    const response = await fetch(url, {
      method: 'PUT',
      headers: webdavHeaders(auth),
      body: input as any,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    if (!response.ok) throw new BadRequestException(`WebDAV upload failed: ${response.status}`)
    return { uploaded: 1 }
  }

  private async mkdirWebdav(mount: StorageMountRecord, rawPath: string): Promise<{ created: number }> {
    const auth = this.authorizations.getPrivate(mount.authorization_id)
    const rootPath = cleanVirtualPath(readString(mount.props.root_path) || readString(auth.props.root_path) || '/')
    const rel = relativePath(mount, rawPath)
    const parts = cleanVirtualPath(path.posix.join(rootPath, rel)).split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current = path.posix.join(current, part)
      const base = String(mount.props.address || auth.endpoint || '').replace(/\/+$/, '')
      const url = `${base}/${current.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
      const response = await fetch(url, { method: 'MKCOL', headers: webdavHeaders(auth) })
      if (response.ok || response.status === 405) continue
      throw new BadRequestException(`WebDAV mkdir failed: ${response.status}`)
    }
    return { created: 1 }
  }

  private async downloadAdb(mount: StorageMountRecord, rawPath: string, output: NodeJS.WritableStream): Promise<{ name: string }> {
    const context = this.adbContext(mount)
    const remote = remotePath(context.rootPath, relativePath(mount, rawPath))
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'homesense-adb-pull-'))
    const tempFile = path.join(tempDir, path.posix.basename(remote) || 'download')
    try {
      const result = await cliBridge.run('adb-cli', 'pull_file', {
        device: context.device,
        path: remote,
        local_path: tempFile,
      })
      if (result.status !== 'success') {
        throw new BadRequestException(result.message || result.error || 'ADB pull_file failed')
      }
      await pipeline(fs.createReadStream(tempFile), output)
      return { name: path.posix.basename(remote) || 'download' }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  private async uploadAdb(mount: StorageMountRecord, rawPath: string, input: NodeJS.ReadableStream): Promise<{ uploaded: number }> {
    const context = this.adbContext(mount)
    const remote = remotePath(context.rootPath, relativePath(mount, rawPath))
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'homesense-adb-push-'))
    const tempFile = path.join(tempDir, path.posix.basename(remote) || 'upload')
    try {
      await pipeline(input, fs.createWriteStream(tempFile))
      const result = await cliBridge.run('adb-cli', 'push_file', {
        device: context.device,
        path: remote,
        local_path: tempFile,
      })
      if (result.status !== 'success') {
        throw new BadRequestException(result.message || result.error || 'ADB push_file failed')
      }
      return { uploaded: 1 }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  private async mkdirAdb(mount: StorageMountRecord, rawPath: string): Promise<{ created: number }> {
    const context = this.adbContext(mount)
    const remote = remotePath(context.rootPath, relativePath(mount, rawPath))
    const result = await cliBridge.run('adb-cli', 'mkdir_path', {
      device: context.device,
      path: remote,
    })
    if (result.status !== 'success') {
      throw new BadRequestException(result.message || result.error || 'ADB mkdir_path failed')
    }
    return { created: 1 }
  }

  private async downloadSftp(mount: StorageMountRecord, rawPath: string, output: NodeJS.WritableStream): Promise<{ name: string }> {
    return this.withSftp(mount, async (sftp, context) => {
      const remote = remotePath(context.rootPath, relativePath(mount, rawPath))
      await pipeline(sftp.createReadStream(remote), output)
      return { name: path.posix.basename(remote) }
    })
  }

  private async uploadSftp(mount: StorageMountRecord, rawPath: string, input: NodeJS.ReadableStream): Promise<{ uploaded: number }> {
    return this.withSftp(mount, async (sftp, context) => {
      const remote = remotePath(context.rootPath, relativePath(mount, rawPath))
      await mkdirSftp(sftp, path.posix.dirname(remote))
      await pipeline(input, sftp.createWriteStream(remote))
      return { uploaded: 1 }
    })
  }

  private async mkdirSftpPath(mount: StorageMountRecord, rawPath: string): Promise<{ created: number }> {
    return this.withSftp(mount, async (sftp, context) => {
      const remote = remotePath(context.rootPath, relativePath(mount, rawPath))
      await mkdirSftp(sftp, remote)
      return { created: 1 }
    })
  }

  private async withSftp<T>(
    mount: StorageMountRecord,
    fn: (sftp: SFTPWrapper, context: { rootPath: string }) => Promise<T>,
  ): Promise<T> {
    const auth = this.authorizations.getPrivate(mount.authorization_id)
    const endpoint = String(mount.props.address || auth.endpoint || '').trim()
    const parsed = parseEndpoint(endpoint)
    const username = String(mount.props.username || auth.username || parsed.username || '').trim()
    if (!parsed.host) throw new BadRequestException('SFTP endpoint requires a host')
    if (!username) throw new BadRequestException('SFTP authorization requires username')
    const password = typeof auth.secret.password === 'string' ? auth.secret.password : undefined
    const keyName = readString(mount.props.key_name) || readString(auth.props.key_name) || readString(auth.secret.key_name)
    const passphrase = readString(auth.secret.passphrase) || readString(auth.props.passphrase)
    const connectOptions: ConnectConfig = {
      host: parsed.host,
      port: parsed.port,
      username,
      readyTimeout: DEFAULT_TIMEOUT_MS,
    }
    if (password) connectOptions.password = password
    else if (keyName) {
      connectOptions.privateKey = KeyStore.readSshKey(keyName)
      if (passphrase) connectOptions.passphrase = passphrase
    } else {
      throw new BadRequestException('SFTP authorization requires password or key_name')
    }

    const client = new Client()
    try {
      const sftp = await connectSftp(client, connectOptions)
      const rootPath = cleanVirtualPath(readString(mount.props.root_path) || readString(auth.props.root_path) || '/')
      return await fn(sftp, { rootPath })
    } finally {
      client.end()
    }
  }

  private localPath(mount: StorageMountRecord, rawPath: string): string {
    const auth = this.authorizations.getPrivate(mount.authorization_id)
    const rootPath = readString(mount.props.root_path) || readString(auth.props.root_path) || auth.endpoint
    if (!rootPath) throw new BadRequestException(`${mount.driver} mount requires root_path`)
    const root = path.resolve(rootPath)
    const rel = relativePath(mount, rawPath)
    const fullPath = path.resolve(root, path.normalize(rel))
    const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`
    if (fullPath !== root && !fullPath.toLowerCase().startsWith(rootWithSep.toLowerCase())) {
      throw new BadRequestException('path escapes mount root')
    }
    return fullPath
  }

  private async copyOne(srcPath: string, dstPath: string): Promise<void> {
    const stream = new PassThrough()
    const read = this.download(srcPath, stream).catch((error) => {
      stream.destroy(error instanceof Error ? error : new Error(String(error)))
      throw error
    })
    const write = this.upload(dstPath, stream)
    await Promise.all([read, write])
  }

  private async collectCopyPlan(
    srcPath: string,
    dstPath: string,
    list: (path: string) => Promise<AlistDriverListResult>,
    plan: Array<{ srcPath: string; dstPath: string; isDir: boolean }>,
  ): Promise<void> {
    const detail = await this.entryDetail(srcPath, list)
    if (!detail.is_dir) {
      plan.push({ srcPath, dstPath, isDir: false })
      return
    }
    plan.push({ srcPath, dstPath, isDir: true })
    const children = await list(srcPath)
    for (const child of children.entries) {
      await this.collectCopyPlan(child.path, cleanVirtualPath(path.posix.join(dstPath, child.name)), list, plan)
    }
  }

  private async entryDetail(srcPath: string, list: (path: string) => Promise<AlistDriverListResult>): Promise<Pick<AlistDriverEntry, 'is_dir'>> {
    const parent = cleanVirtualPath(path.posix.dirname(srcPath))
    const name = path.posix.basename(srcPath)
    const siblings = await list(parent)
    const entry = siblings.entries.find((item) => item.name === name || cleanVirtualPath(item.path) === srcPath)
    if (!entry) throw new BadRequestException(`source path not found: ${srcPath}`)
    return { is_dir: entry.is_dir }
  }

  private adbContext(mount: StorageMountRecord): { device: string; rootPath: string } {
    const auth = this.authorizations.getPrivate(mount.authorization_id)
    const device = readString(mount.props.device) || readString(mount.props.address) || readString(auth.endpoint)
    if (!device) throw new BadRequestException('ADB storage mount requires device endpoint')
    const rootPath = cleanVirtualPath(readString(mount.props.root_path) || readString(auth.props.root_path) || '/sdcard/')
    return { device, rootPath }
  }

  private findMount(rawPath: string): StorageMountRecord | null {
    const targetPath = cleanVirtualPath(rawPath)
    let selected: StorageMountRecord | null = null
    for (const mount of this.mounts.list().mounts) {
      const mountPath = cleanVirtualPath(mount.virtual_path)
      if (targetPath === mountPath || targetPath.startsWith(`${mountPath}/`)) {
        if (!selected || mountPath.length > cleanVirtualPath(selected.virtual_path).length) selected = mount
      }
    }
    return selected
  }
}

function requiredVirtualPath(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${field} is required`)
  return cleanVirtualPath(value)
}

function requiredNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new BadRequestException('names is required')
  return value.map((item) => {
    const name = String(item || '').trim()
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new BadRequestException(`invalid name: ${name}`)
    return name
  })
}

function connectSftp(client: Client, options: ConnectConfig): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new BadRequestException('SFTP connection timeout'))
    }, DEFAULT_TIMEOUT_MS)
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    client.once('ready', () => client.sftp((err, sftp) => err ? finish(() => reject(err)) : finish(() => resolve(sftp))))
    client.once('error', (err) => finish(() => reject(err)))
    client.connect(options)
  })
}

function mkdirSftp(sftp: SFTPWrapper, target: string): Promise<void> {
  const parts = cleanVirtualPath(target).split('/').filter(Boolean)
  let current = '/'
  return parts.reduce((promise, part) => promise.then(() => new Promise<void>((resolve, reject) => {
    current = path.posix.join(current, part)
    sftp.mkdir(current, (err) => {
      if (!err) {
        resolve()
        return
      }
      sftp.stat(current, (statErr, attrs) => {
        if (!statErr && typeof attrs?.isDirectory === 'function' && attrs.isDirectory()) resolve()
        else reject(err)
      })
    })
  })), Promise.resolve())
}

function webdavUrl(mount: StorageMountRecord, auth: { endpoint: string; username?: string; secret: Record<string, unknown>; props: Record<string, unknown> }, rawPath: string): string {
  const rootPath = cleanVirtualPath(readString(mount.props.root_path) || readString(auth.props.root_path) || '/')
  const rel = relativePath(mount, rawPath)
  const base = String(mount.props.address || auth.endpoint || '').replace(/\/+$/, '')
  const remote = cleanVirtualPath(path.posix.join(rootPath, rel))
  return `${base}/${remote.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
}

function parseEndpoint(endpoint: string): { host: string; port: number; username?: string } {
  const raw = endpoint.trim()
  if (!raw) return { host: '', port: 22 }
  if (/^[a-z]+:\/\//i.test(raw)) {
    const url = new URL(raw)
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : 22,
      username: decodeURIComponent(url.username || ''),
    }
  }
  const match = raw.match(/^\[?([^\]]+)\]?(?::(\d+))?$/)
  if (!match) return { host: raw, port: 22 }
  return { host: match[1], port: match[2] ? Number(match[2]) : 22 }
}

function webdavHeaders(auth: { username?: string; secret: Record<string, unknown> }): HeadersInit {
  const password = typeof auth.secret.password === 'string' ? auth.secret.password : ''
  if (!auth.username && !password) return {}
  return { Authorization: `Basic ${Buffer.from(`${auth.username || ''}:${password}`).toString('base64')}` }
}

function remotePath(rootPath: string, rel: string): string {
  return cleanVirtualPath(path.posix.join(rootPath, rel.replace(/^\/+/, '')))
}

function relativePath(mount: StorageMountRecord, rawPath: string): string {
  const cleanPath = cleanVirtualPath(rawPath)
  const mountPath = cleanVirtualPath(mount.virtual_path)
  if (cleanPath !== mountPath && !cleanPath.startsWith(`${mountPath}/`)) throw new BadRequestException(`path is outside mount: ${rawPath}`)
  return cleanPath.slice(mountPath.length).replace(/^\/+/, '')
}

function cleanVirtualPath(value: string): string {
  const normalized = String(value || '/').trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return path.posix.normalize(withSlash)
}

function normalizeDriver(value: unknown): string {
  const driver = String(value || '').trim().toLowerCase()
  if (driver === 'ssh') return 'sftp'
  return driver
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function progressFor(done: number, total: number): number {
  if (total <= 0) return 5
  return 5 + Math.floor((Math.max(0, Math.min(done, total)) / total) * 90)
}
