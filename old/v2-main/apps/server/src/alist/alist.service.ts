import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DeviceService } from '../devices/device.service'
import { AlistAuthorizationService } from './alist-authorization.service'
import type {
  AlistCopyInput,
  AlistDriverConfig,
  AlistDriverGetResult,
  AlistDriverHealthResult,
  AlistDriverListResult,
  AlistDriverMutationResult,
  AlistDriverProps,
  AlistDriverRawResult,
  AlistGetInput,
  AlistListInput,
  AlistRemoveInput,
} from './alist.types'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_ATTEMPTS = 3

interface CommandSpec {
  exePath: string
  argsPrefix: string[]
  cwd: string
}

@Injectable()
export class AlistService {
  private readonly log = new Logger(AlistService.name)

  constructor(
    private readonly devices: DeviceService,
    private readonly authorizations: AlistAuthorizationService,
  ) {}

  health(deviceId: number): Promise<AlistDriverHealthResult> {
    return this.healthForProps(this.readAlistProps(deviceId))
  }

  list(deviceId: number, input: AlistListInput): Promise<AlistDriverListResult> {
    return this.listForProps(this.readAlistProps(deviceId), input)
  }

  get(deviceId: number, input: AlistGetInput): Promise<AlistDriverGetResult> {
    return this.getForProps(this.readAlistProps(deviceId), input)
  }

  remove(deviceId: number, input: AlistRemoveInput): Promise<AlistDriverMutationResult> {
    return this.removeForProps(this.readAlistProps(deviceId), input)
  }

  copy(deviceId: number, input: AlistCopyInput): Promise<AlistDriverMutationResult> {
    return this.copyForProps(this.readAlistProps(deviceId), input)
  }

  healthForProps(props: AlistDriverProps): Promise<AlistDriverHealthResult> {
    return this.runWithProps<AlistDriverHealthResult>(props, 'health', {})
  }

  listForProps(props: AlistDriverProps, input: AlistListInput): Promise<AlistDriverListResult> {
    const targetPath = requiredPath(input.path ?? '/', 'path')
    return this.runWithProps<AlistDriverListResult>(props, 'list', { path: targetPath })
  }

  getForProps(props: AlistDriverProps, input: AlistGetInput): Promise<AlistDriverGetResult> {
    const targetPath = requiredPath(input.path, 'path')
    return this.runWithProps<AlistDriverGetResult>(props, 'get', { path: targetPath })
  }

  removeForProps(props: AlistDriverProps, input: AlistRemoveInput): Promise<AlistDriverMutationResult> {
    const dir = requiredPath(input.dir, 'dir')
    const names = requiredNames(input.names)
    return this.runWithProps<AlistDriverMutationResult>(props, 'remove', { dir, names: JSON.stringify(names) })
  }

  copyForProps(props: AlistDriverProps, input: AlistCopyInput): Promise<AlistDriverMutationResult> {
    const srcDir = requiredPath(input.src_dir, 'src_dir')
    const dstDir = requiredPath(input.dst_dir, 'dst_dir')
    const names = requiredNames(input.names)
    return this.runWithProps<AlistDriverMutationResult>(props, 'copy', {
      'src-dir': srcDir,
      'dst-dir': dstDir,
      names: JSON.stringify(names),
    })
  }

  private async runWithProps<T>(
    alist: AlistDriverProps,
    action: string,
    args: Record<string, string>,
  ): Promise<T> {
    const command = resolveCommand()
    const config = this.buildRuntimeConfig(alist)
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const result = await this.runOnce(command, action, args, config, alist.config_file)
        if (result.code === 0) return (result.data ?? {}) as T
        const retryable = Boolean(result.retryable) && attempt < MAX_ATTEMPTS
        if (retryable) {
          this.log.warn(`alist-driver ${action} failed; retrying attempt ${attempt + 1}/${MAX_ATTEMPTS}: ${result.message || result.error}`)
          continue
        }
        throw mapDriverError(result)
      } catch (error) {
        lastError = error
        if (error instanceof HttpException) throw error
        if (attempt < MAX_ATTEMPTS && isRetryableProcessError(error)) {
          this.log.warn(`alist-driver ${action} process error; retrying attempt ${attempt + 1}/${MAX_ATTEMPTS}: ${errorText(error)}`)
          continue
        }
        throw error
      }
    }

    throw lastError instanceof Error ? lastError : new BadGatewayException(String(lastError))
  }

  private runOnce(
    command: CommandSpec,
    action: string,
    args: Record<string, string>,
    config: AlistDriverConfig | null,
    configFile?: string,
  ): Promise<AlistDriverRawResult> {
    return new Promise((resolve, reject) => {
      const finalArgs = [...command.argsPrefix, action]
      if (configFile && !config) {
        finalArgs.push(`--config-file=${configFile}`)
      }
      for (const [key, value] of Object.entries(args)) {
        finalArgs.push(`--${key}=${value}`)
      }

      const proc: ChildProcess = spawn(command.exePath, finalArgs, {
        cwd: command.cwd,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        proc.kill()
        reject(new GatewayTimeoutException(`alist-driver timeout after ${DEFAULT_TIMEOUT_MS}ms`))
      }, DEFAULT_TIMEOUT_MS)

      proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })
      proc.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(error)
      })
      proc.on('close', () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        const parsed = parseDriverOutput(stdout)
        if (!parsed) {
          reject(new BadGatewayException(`alist-driver returned invalid JSON${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
          return
        }
        if (stderr.trim() && parsed.code !== 0) {
          this.log.warn(`alist-driver stderr: ${stderr.trim()}`)
        }
        resolve(parsed)
      })

      if (config) {
        proc.stdin?.end(JSON.stringify(config))
      } else {
        proc.stdin?.end()
      }
    })
  }

  private readAlistProps(deviceId: number): AlistDriverProps {
    const device = this.devices.get(deviceId)
    const value = device.props?.alist_driver
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new NotFoundException(`Device ${deviceId} has no props.alist_driver`)
    }
    const props = value as AlistDriverProps
    if (!props.config_file && (!Array.isArray(props.mounts) || props.mounts.length === 0)) {
      throw new BadRequestException('props.alist_driver requires config_file or mounts')
    }
    return props
  }

  private buildRuntimeConfig(props: AlistDriverProps): AlistDriverConfig | null {
    if (!Array.isArray(props.mounts)) return null
    return {
      mounts: props.mounts.map((mount) => {
        const authorizationId = resolveAuthorizationId(mount.auth_ref ?? mount.authorization_id)
        if (!authorizationId) {
          return {
            ...mount,
            path: requiredPath(mount.path, 'mount.path'),
            driver: String(mount.driver || 'local').trim() || 'local',
          }
        }

        const auth = this.authorizations.getPrivate(authorizationId)
        const password = typeof auth.secret.password === 'string' ? auth.secret.password : undefined
        const rootPath = typeof auth.props.root_path === 'string' ? auth.props.root_path : undefined
        return {
          ...mount,
          path: requiredPath(mount.path, 'mount.path'),
          driver: String(mount.driver || auth.driver || 'webdav').trim() || 'webdav',
          address: mount.address || auth.endpoint,
          username: mount.username || auth.username,
          ...(password ? { password } : {}),
          root_path: mount.root_path || rootPath,
        }
      }),
    }
  }
}

function resolveCommand(): CommandSpec {
  const repoRoot = path.resolve(__dirname, '../../../../')
  const packageDir = path.join(repoRoot, 'packages', 'alist-driver')
  const envBin = process.env.ALIST_DRIVER_BIN
  if (envBin) return { exePath: envBin, argsPrefix: [], cwd: packageDir }

  const localExe = process.platform === 'win32'
    ? path.join(packageDir, 'alist-driver.exe')
    : path.join(packageDir, 'alist-driver')
  if (fs.existsSync(localExe)) return { exePath: localExe, argsPrefix: [], cwd: packageDir }

  return { exePath: 'go', argsPrefix: ['run', './cmd/alist-driver'], cwd: packageDir }
}

function resolveAuthorizationId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const match = trimmed.match(/(\d+)$/)
  if (!match) return null
  const id = Number(match[1])
  return Number.isInteger(id) && id > 0 ? id : null
}

function parseDriverOutput(stdout: string): AlistDriverRawResult | null {
  const line = stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).at(-1)
  if (!line) return null
  try {
    const parsed = JSON.parse(line) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const result = parsed as Partial<AlistDriverRawResult>
    return typeof result.code === 'number' ? parsed as AlistDriverRawResult : null
  } catch {
    return null
  }
}

function mapDriverError(result: Extract<AlistDriverRawResult, { code: number }>): HttpException {
  const message = result.message || result.error || 'alist-driver failed'
  if (result.code === 400) return new BadRequestException(message)
  if (result.code === 401) return new UnauthorizedException(message)
  if (result.code === 403) return new ForbiddenException(message)
  if (result.code === 404) return new NotFoundException(message)
  if (result.code === 501) return new ServiceUnavailableException(message)
  if (result.code === 504) return new GatewayTimeoutException(message)
  return new BadGatewayException(message)
}

function isRetryableProcessError(error: unknown): boolean {
  if (error instanceof GatewayTimeoutException) return true
  const message = errorText(error).toLowerCase()
  return message.includes('timeout') || message.includes('econnreset') || message.includes('epipe')
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requiredPath(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${field} is required`)
  }
  const normalized = value.trim().replace(/\\/g, '/')
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function requiredNames(value: unknown): string[] {
  if (!Array.isArray(value)) throw new BadRequestException('names must be an array')
  const names = value.map((item) => String(item || '').trim()).filter(Boolean)
  if (names.length === 0) throw new BadRequestException('names is required')
  for (const name of names) {
    if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      throw new BadRequestException(`invalid name: ${name}`)
    }
  }
  return names
}
