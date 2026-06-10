import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { AlistAuthorizationService } from '../alist/alist-authorization.service'
import type {
  AlistCopyInput,
  AlistDriverEntry,
  AlistDriverGetResult,
  AlistDriverListResult,
  AlistDriverMutationResult,
  AlistGetInput,
  AlistListInput,
  AlistRemoveInput,
} from '../alist/alist.types'
import { KeyStore } from '../terminal/keystore'
import type { StorageMountRecord } from './storage.types'

const DEFAULT_TIMEOUT_MS = 30_000

@Injectable()
export class SftpStorageService {
  constructor(private readonly authorizations: AlistAuthorizationService) {}

  async list(mount: StorageMountRecord, input: AlistListInput): Promise<AlistDriverListResult> {
    const targetPath = cleanVirtualPath(input.path ?? mount.virtual_path)
    return this.withSftp(mount, async (sftp, context) => {
      const remote = remotePath(context.rootPath, relativePath(mount, targetPath))
      const entries = await readdir(sftp, remote)
      const mapped = entries
        .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
        .map((entry) => toEntry(mount, targetPath, entry.filename, entry.attrs))
        .sort((left, right) => Number(left.is_dir !== right.is_dir) || left.name.localeCompare(right.name))
      return {
        path: targetPath,
        provider: 'sftp',
        mount_path: mount.virtual_path,
        entries: mapped,
        total: mapped.length,
      }
    })
  }

  async get(mount: StorageMountRecord, input: AlistGetInput): Promise<AlistDriverGetResult> {
    const targetPath = requiredPath(input.path, 'path')
    return this.withSftp(mount, async (sftp, context) => {
      const remote = remotePath(context.rootPath, relativePath(mount, targetPath))
      const attrs = await stat(sftp, remote)
      const name = path.posix.basename(targetPath) || mount.name
      return {
        name,
        path: targetPath,
        size: Number(attrs.size ?? 0),
        is_dir: isDirectory(attrs),
        modified: modifiedTime(attrs),
        driver: 'sftp',
        mount_path: mount.virtual_path,
      }
    })
  }

  async remove(mount: StorageMountRecord, input: AlistRemoveInput): Promise<AlistDriverMutationResult> {
    if (mount.readonly) throw new ForbiddenException('mount is readonly')
    const dir = requiredPath(input.dir, 'dir')
    const names = requiredNames(input.names)
    return this.withSftp(mount, async (sftp, context) => {
      for (const name of names) {
        const target = remotePath(context.rootPath, path.posix.join(relativePath(mount, dir), name))
        const attrs = await stat(sftp, target)
        if (isDirectory(attrs)) await rmdir(sftp, target)
        else await unlink(sftp, target)
      }
      return { removed: names.length }
    })
  }

  async copy(mount: StorageMountRecord, input: AlistCopyInput): Promise<AlistDriverMutationResult> {
    if (mount.readonly) throw new ForbiddenException('mount is readonly')
    const srcDir = requiredPath(input.src_dir, 'src_dir')
    const dstDir = requiredPath(input.dst_dir, 'dst_dir')
    const names = requiredNames(input.names)
    return this.withSftp(mount, async (sftp, context) => {
      for (const name of names) {
        const src = remotePath(context.rootPath, path.posix.join(relativePath(mount, srcDir), name))
        const dst = remotePath(context.rootPath, path.posix.join(relativePath(mount, dstDir), name))
        const attrs = await stat(sftp, src)
        if (isDirectory(attrs)) {
          throw new BadRequestException('SFTP directory copy is not implemented yet')
        }
        await pipeline(sftp.createReadStream(src), sftp.createWriteStream(dst))
      }
      return { copied: names.length }
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

    const secret = auth.secret
    const password = typeof secret.password === 'string' ? secret.password : undefined
    const keyName = readString(mount.props.key_name) || readString(auth.props.key_name) || readString(secret.key_name)
    const passphrase = readString(secret.passphrase) || readString(auth.props.passphrase)
    const rootPath = normalizeRemoteRoot(readString(mount.props.root_path) || readString(auth.props.root_path) || '/')

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
      return await fn(sftp, { rootPath })
    } finally {
      client.end()
    }
  }
}

function connectSftp(client: Client, options: ConnectConfig): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new ServiceUnavailableException('SFTP connection timeout'))
    }, DEFAULT_TIMEOUT_MS)
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    client.once('ready', () => {
      client.sftp((err, sftp) => {
        if (err) finish(() => reject(err))
        else finish(() => resolve(sftp))
      })
    })
    client.once('error', (err) => finish(() => reject(err)))
    client.connect(options)
  })
}

function readdir(sftp: SFTPWrapper, target: string): Promise<Array<{ filename: string; attrs: any }>> {
  return new Promise((resolve, reject) => {
    sftp.readdir(target, (err, list) => {
      if (err) reject(err)
      else resolve(list as Array<{ filename: string; attrs: any }>)
    })
  })
}

function stat(sftp: SFTPWrapper, target: string): Promise<any> {
  return new Promise((resolve, reject) => {
    sftp.stat(target, (err, attrs) => {
      if (err) reject(err)
      else resolve(attrs)
    })
  })
}

function unlink(sftp: SFTPWrapper, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(target, (err) => err ? reject(err) : resolve())
  })
}

function rmdir(sftp: SFTPWrapper, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(target, (err) => err ? reject(err) : resolve())
  })
}

function toEntry(mount: StorageMountRecord, dir: string, name: string, attrs: any): AlistDriverEntry {
  return {
    name,
    path: cleanVirtualPath(path.posix.join(dir, name)),
    size: Number(attrs.size ?? 0),
    is_dir: isDirectory(attrs),
    modified: modifiedTime(attrs),
    driver: 'sftp',
    mount_path: mount.virtual_path,
  }
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

function remotePath(rootPath: string, rel: string): string {
  const cleanRel = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  return cleanVirtualPath(path.posix.join(rootPath, cleanRel))
}

function relativePath(mount: StorageMountRecord, rawPath: string): string {
  const cleanPath = cleanVirtualPath(rawPath)
  const mountPath = cleanVirtualPath(mount.virtual_path)
  if (cleanPath !== mountPath && !cleanPath.startsWith(`${mountPath}/`)) {
    throw new BadRequestException(`path is outside mount: ${rawPath}`)
  }
  return cleanPath.slice(mountPath.length).replace(/^\/+/, '')
}

function cleanVirtualPath(value: string): string {
  const normalized = String(value || '/').trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return path.posix.normalize(withSlash)
}

function normalizeRemoteRoot(value: string): string {
  return cleanVirtualPath(value || '/')
}

function requiredPath(value: unknown, field: string): string {
  const pathValue = typeof value === 'string' ? cleanVirtualPath(value) : ''
  if (!pathValue) throw new BadRequestException(`${field} is required`)
  return pathValue
}

function requiredNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new BadRequestException('names is required')
  return value.map((item) => {
    const name = String(item || '').trim()
    if (!name || name.includes('/') || name.includes('\\')) throw new BadRequestException(`invalid name: ${name}`)
    return name
  })
}

function isDirectory(attrs: any): boolean {
  return typeof attrs?.isDirectory === 'function' ? attrs.isDirectory() : false
}

function modifiedTime(attrs: any): string {
  const raw = Number(attrs?.mtime ?? 0)
  return raw > 0 ? new Date(raw * 1000).toISOString() : ''
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
