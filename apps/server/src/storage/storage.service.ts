import { BadRequestException, Injectable } from '@nestjs/common'
import { AlistService } from '../alist/alist.service'
import type {
  AlistCopyInput,
  AlistDriverHealthResult,
  AlistDriverListResult,
  AlistDriverProps,
  AlistDriverGetResult,
  AlistDriverMutationResult,
  AlistGetInput,
  AlistListInput,
  AlistRemoveInput,
} from '../alist/alist.types'
import { AdbStorageService } from './adb-storage.service'
import { StorageMountService } from './storage-mount.service'
import { StorageTaskService } from './storage-task.service'
import { StorageTransferService } from './storage-transfer.service'
import { SftpStorageService } from './sftp-storage.service'
import type { StorageMountRecord, StorageTaskRecord } from './storage.types'

type StorageProgressReporter = (patch: { progress?: number; message?: string }) => void

@Injectable()
export class StorageService {
  constructor(
    private readonly mounts: StorageMountService,
    private readonly alist: AlistService,
    private readonly sftp: SftpStorageService,
    private readonly adb: AdbStorageService,
    private readonly tasks: StorageTaskService,
    private readonly transfers: StorageTransferService,
  ) {}

  async health(): Promise<AlistDriverHealthResult> {
    const health = await this.alist.healthForProps(this.buildDriverProps())
    const extraDrivers = new Set<string>()
    for (const mount of this.mounts.list().mounts) {
      const driver = normalizeDriver(mount.driver)
      if (driver === 'sftp' || driver === 'adb' || driver === 'smb' || driver === 'nfs') extraDrivers.add(driver)
    }
    return { ...health, drivers: Array.from(new Set([...health.drivers, ...extraDrivers])).sort() }
  }

  list(input: AlistListInput): Promise<AlistDriverListResult> {
    this.ensureMounts()
    const mount = this.findMount(input.path ?? '/')
    if (mount && normalizeDriver(mount.driver) === 'sftp') {
      return this.sftp.list(mount, input)
    }
    if (mount && normalizeDriver(mount.driver) === 'adb') {
      return this.adb.list(mount, input)
    }
    return this.alist.listForProps(this.buildDriverProps(), input)
  }

  get(input: AlistGetInput): Promise<AlistDriverGetResult> {
    this.ensureMounts()
    const mount = this.findMount(input.path ?? '')
    if (mount && normalizeDriver(mount.driver) === 'sftp') {
      return this.sftp.get(mount, input)
    }
    if (mount && normalizeDriver(mount.driver) === 'adb') {
      return this.adb.get(mount, input)
    }
    return this.alist.getForProps(this.buildDriverProps(), input)
  }

  remove(input: AlistRemoveInput): Promise<AlistDriverMutationResult> {
    this.ensureMounts()
    const mount = this.findMount(input.dir ?? '')
    if (mount && normalizeDriver(mount.driver) === 'sftp') {
      return this.sftp.remove(mount, input)
    }
    if (mount && normalizeDriver(mount.driver) === 'adb') {
      return this.adb.remove(mount, input)
    }
    return this.alist.removeForProps(this.buildDriverProps(), input)
  }

  copy(input: AlistCopyInput, report?: StorageProgressReporter): Promise<AlistDriverMutationResult> {
    this.ensureMounts()
    const srcMount = this.findMount(input.src_dir ?? '')
    const dstMount = this.findMount(input.dst_dir ?? '')
    const crossMount = Boolean(srcMount && dstMount && srcMount.id !== dstMount.id)
    if (crossMount) {
      return this.transfers.copy(input, report)
    }
    if (srcMount && normalizeDriver(srcMount.driver) === 'sftp') {
      if (!dstMount || dstMount.id !== srcMount.id) {
        throw new BadRequestException('SFTP cross-mount copy is not implemented yet')
      }
      report?.({ progress: 20, message: 'copying in SFTP mount' })
      return this.sftp.copy(srcMount, input)
    }
    if (srcMount && normalizeDriver(srcMount.driver) === 'adb') {
      if (!dstMount || dstMount.id !== srcMount.id) {
        throw new BadRequestException('ADB cross-mount copy is not implemented yet')
      }
      report?.({ progress: 20, message: 'copying in ADB mount' })
      return this.adb.copy(srcMount, input)
    }
    if (dstMount && normalizeDriver(dstMount.driver) === 'sftp') {
      throw new BadRequestException('SFTP cross-mount copy is not implemented yet')
    }
    if (dstMount && normalizeDriver(dstMount.driver) === 'adb') {
      throw new BadRequestException('ADB cross-mount copy is not implemented yet')
    }
    report?.({ progress: 20, message: 'copying in storage driver' })
    return this.alist.copyForProps(this.buildDriverProps(), input)
  }

  copyTask(input: AlistCopyInput): StorageTaskRecord {
    this.ensureMounts()
    return this.tasks.createCopyTask(input, (report) => this.transfers.copyTree(input, (targetPath) => this.list({ path: targetPath }), report))
  }

  mkdir(path: string): Promise<{ created: number }> {
    this.ensureMounts()
    return this.transfers.mkdir(path)
  }

  private buildDriverProps(): AlistDriverProps {
    const mounts = this.mounts.list().mounts
    return {
      mounts: mounts.map((mount) => ({
        path: mount.virtual_path,
        label: mount.name,
        driver: localBackedDriver(mount.driver) ? 'local' : mount.driver,
        authorization_id: mount.authorization_id,
        readonly: mount.readonly,
        ...mount.props,
      })),
    }
  }

  private ensureMounts(): void {
    if (this.mounts.list().mounts.length === 0) {
      throw new BadRequestException('No storage mounts configured')
    }
  }

  private findMount(rawPath: string): StorageMountRecord | null {
    const targetPath = cleanVirtualPath(rawPath)
    let selected: StorageMountRecord | null = null
    for (const mount of this.mounts.list().mounts) {
      const mountPath = cleanVirtualPath(mount.virtual_path)
      if (targetPath === mountPath || targetPath.startsWith(`${mountPath}/`)) {
        if (!selected || mountPath.length > cleanVirtualPath(selected.virtual_path).length) {
          selected = mount
        }
      }
    }
    return selected
  }
}

function normalizeDriver(value: unknown): string {
  const driver = String(value || '').trim().toLowerCase()
  if (driver === 'ssh') return 'sftp'
  return driver
}

function localBackedDriver(value: unknown): boolean {
  const driver = normalizeDriver(value)
  return driver === 'smb' || driver === 'nfs'
}

function cleanVirtualPath(value: string): string {
  const normalized = String(value || '/').trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return withSlash.replace(/\/+$/, '') || '/'
}
