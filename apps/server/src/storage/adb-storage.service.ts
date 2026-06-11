import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import path from 'node:path'
import { cliBridge } from '../cli/cli-bridge'
import { AlistAuthorizationService } from '../alist/alist-authorization.service'
import type {
  AlistDriverEntry,
  AlistDriverGetResult,
  AlistDriverListResult,
  AlistDriverMutationResult,
  AlistGetInput,
  AlistListInput,
  AlistRemoveInput,
  AlistCopyInput,
} from '../alist/alist.types'
import type { StorageMountRecord } from './storage.types'

interface AdbListFile {
  name: string
  path: string
  directory: boolean
  symlink?: boolean
  size?: number
  mtime?: string
}

interface AdbListResult {
  path: string
  parent: string
  files: AdbListFile[]
  count: number
}

interface AdbReadResult {
  name: string
  path: string
  size: number
  modified_at: string | null
}

@Injectable()
export class AdbStorageService {
  constructor(private readonly authorizations: AlistAuthorizationService) {}

  async list(mount: StorageMountRecord, input: AlistListInput): Promise<AlistDriverListResult> {
    const targetPath = cleanVirtualPath(input.path ?? mount.virtual_path)
    const context = this.context(mount)
    const remote = remotePath(context.rootPath, relativePath(mount, targetPath))
    const result = await cliBridge.run('adb-cli', 'list_files', {
      device: context.device,
      path: remote,
    })
    if (result.status !== 'success' || !isRecord(result.data)) {
      throw new BadRequestException(result.status === 'error' ? result.message || result.error : 'ADB list_files returned invalid data')
    }
    const data = result.data as unknown as AdbListResult
    const entries = (data.files ?? []).map((file) => toEntry(mount, context.rootPath, file))
    return {
      path: targetPath,
      provider: 'adb',
      mount_path: mount.virtual_path,
      entries,
      total: entries.length,
    }
  }

  async get(mount: StorageMountRecord, input: AlistGetInput): Promise<AlistDriverGetResult> {
    const targetPath = requiredPath(input.path, 'path')
    const context = this.context(mount)
    const remote = remotePath(context.rootPath, relativePath(mount, targetPath))
    const result = await cliBridge.run('adb-cli', 'read_file', {
      device: context.device,
      path: remote,
      max_bytes: 1024,
    })
    if (result.status !== 'success' || !isRecord(result.data)) {
      throw new BadRequestException(result.status === 'error' ? result.message || result.error : 'ADB read_file returned invalid data')
    }
    const data = result.data as unknown as AdbReadResult
    return {
      name: data.name || path.posix.basename(targetPath),
      path: targetPath,
      size: Number(data.size ?? 0),
      is_dir: false,
      modified: data.modified_at ?? '',
      driver: 'adb',
      mount_path: mount.virtual_path,
    }
  }

  async remove(mount: StorageMountRecord, input: AlistRemoveInput): Promise<AlistDriverMutationResult> {
    if (mount.readonly) throw new ForbiddenException('mount is readonly')
    const dir = requiredPath(input.dir, 'dir')
    const names = requiredNames(input.names)
    const context = this.context(mount)
    const result = await cliBridge.run('adb-cli', 'remove_files', {
      device: context.device,
      dir: remotePath(context.rootPath, relativePath(mount, dir)),
      names,
    })
    if (result.status !== 'success' || !isRecord(result.data)) {
      throw new BadRequestException(result.status === 'error' ? result.message || result.error : 'ADB remove_files returned invalid data')
    }
    return { removed: Number((result.data as { removed?: number }).removed ?? names.length) }
  }

  async copy(mount: StorageMountRecord, input: AlistCopyInput): Promise<AlistDriverMutationResult> {
    if (mount.readonly) throw new ForbiddenException('mount is readonly')
    const srcDir = requiredPath(input.src_dir, 'src_dir')
    const dstDir = requiredPath(input.dst_dir, 'dst_dir')
    const names = requiredNames(input.names)
    const context = this.context(mount)
    const result = await cliBridge.run('adb-cli', 'copy_files', {
      device: context.device,
      src_dir: remotePath(context.rootPath, relativePath(mount, srcDir)),
      dst_dir: remotePath(context.rootPath, relativePath(mount, dstDir)),
      names,
    })
    if (result.status !== 'success' || !isRecord(result.data)) {
      throw new BadRequestException(result.status === 'error' ? result.message || result.error : 'ADB copy_files returned invalid data')
    }
    return { copied: Number((result.data as { copied?: number }).copied ?? names.length) }
  }

  private context(mount: StorageMountRecord): { device: string; rootPath: string } {
    const auth = this.authorizations.getPrivate(mount.authorization_id)
    const device = readString(mount.props.device) || readString(mount.props.address) || readString(auth.endpoint)
    if (!device) throw new BadRequestException('ADB storage mount requires device endpoint')
    const rootPath = cleanVirtualPath(readString(mount.props.root_path) || readString(auth.props.root_path) || '/sdcard/')
    return { device, rootPath }
  }
}

function toEntry(mount: StorageMountRecord, rootPath: string, file: AdbListFile): AlistDriverEntry {
  return {
    name: file.name,
    path: virtualPath(mount.virtual_path, rootPath, file.path),
    size: Number(file.size ?? 0),
    is_dir: Boolean(file.directory),
    modified: file.mtime ?? '',
    driver: 'adb',
    mount_path: mount.virtual_path,
  }
}

function remotePath(rootPath: string, rel: string): string {
  return cleanVirtualPath(path.posix.join(rootPath, rel.replace(/^\/+/, '')))
}

function relativePath(mount: StorageMountRecord, rawPath: string): string {
  const cleanPath = cleanVirtualPath(rawPath)
  const mountPath = cleanVirtualPath(mount.virtual_path)
  if (cleanPath !== mountPath && !cleanPath.startsWith(`${mountPath}/`)) {
    throw new BadRequestException(`path is outside mount: ${rawPath}`)
  }
  return cleanPath.slice(mountPath.length).replace(/^\/+/, '')
}

function virtualPath(mountPath: string, rootPath: string, remote: string): string {
  const cleanRoot = cleanVirtualPath(rootPath)
  const cleanRemote = cleanVirtualPath(remote)
  const rel = cleanRemote === cleanRoot ? '' : cleanRemote.replace(`${cleanRoot.replace(/\/+$/, '')}/`, '')
  return cleanVirtualPath(path.posix.join(mountPath, rel))
}

function cleanVirtualPath(value: string): string {
  const normalized = String(value || '/').trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return path.posix.normalize(withSlash)
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
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new BadRequestException(`invalid name: ${name}`)
    return name
  })
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
