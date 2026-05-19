import fs from 'fs'
import path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import { z } from 'zod'

// ─── Subprocess Runner 接口（可注入 mock）──────────────────────────────
export interface SubprocessRunner {
  run(opts: {
    exePath: string
    args: string[]
    cwd?: string
    stdinPayload?: string
    timeoutMs: number
  }): Promise<string>
}

export class RealSubprocessRunner implements SubprocessRunner {
  async run(opts: {
    exePath: string
    args: string[]
    cwd?: string
    stdinPayload?: string
    timeoutMs: number
  }): Promise<string> {
    const { exePath, args, cwd, stdinPayload, timeoutMs } = opts
    return new Promise((resolve, reject) => {
      const proc: ChildProcess = spawn(exePath, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      })

      let stdout = ''
      let stderr = ''
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        proc.kill()
        reject(new Error(`Process timeout after ${timeoutMs}ms`))
      }, timeoutMs)

      proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
      proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })

      proc.on('close', (code) => {
        clearTimeout(timeout)
        if (settled) return
        settled = true
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim())
        } else {
          reject(new Error(`Process exited with code ${code}: ${stderr.trim() || stdout.trim()}`))
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        if (settled) return
        settled = true
        reject(err)
      })

      if (stdinPayload) {
        proc.stdin?.write(stdinPayload)
        proc.stdin?.end()
      } else {
        proc.stdin?.end()
      }
    })
  }
}

const CLIResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), data: z.unknown() }),
  z.object({ status: z.literal('error'), error: z.string(), message: z.string().optional(), data: z.unknown().optional() }),
])

export type CLIResult = z.infer<typeof CLIResponseSchema> & { duration_ms: number }

type ParamTypeName =
  | 'string'
  | 'number'
  | 'boolean'
  | 'unknown'
  | 'array'
  | 'object'
  | 'string[]'
  | 'number[]'
  | 'boolean[]'

interface ExecutorActionManifest {
  description?: string
  params_schema?: Record<string, string>
}

interface ExecutorManifest {
  name: string
  executable: string
  protocol?: 'process_json_arg' | 'process_stdin_json' | 'in_process_module'
  cwd?: string
  args?: string[]
  timeout_ms?: number
  actions: Record<string, ExecutorActionManifest>
}

interface RegisteredExecutor {
  name: string
  executable: string
  cwd?: string
  protocol: 'process_json_arg' | 'process_stdin_json' | 'in_process_module'
  args: string[]
  timeout_ms: number
  actions: Record<string, z.ZodSchema>
  action_manifests: Record<string, ExecutorActionManifest>
}

const ExecutorActionManifestSchema = z.object({
  description: z.string().optional(),
  params_schema: z.record(z.string()).optional(),
})

const ExecutorManifestSchema = z.object({
  name: z.string().min(1),
  executable: z.string().min(1),
  protocol: z.enum(['process_json_arg', 'process_stdin_json', 'in_process_module']).default('process_json_arg'),
  cwd: z.string().optional(),
  args: z.array(z.string()).default([]),
  timeout_ms: z.number().int().positive().max(300000).default(30000),
  actions: z.record(ExecutorActionManifestSchema),
})

const MI_CLI_SCHEMAS: Record<string, Record<string, z.ZodSchema>> = {
  'mi-cli': {
    login_password: z.object({ username: z.string(), password: z.string() }),
    verify_ticket: z.object({ ticket: z.string(), username: z.string().optional(), password: z.string().optional() }),
    login_qr: z.void(),
    login_qr_reset: z.void(),
    login_qr_status: z.void(),
    prepare_login: z.void(),
    login_status: z.void(),
    login_logout: z.void(),
    discover: z.object({ renew: z.boolean().optional() }).optional(),
    discover_ir: z.object({ parent_did: z.string() }),
    get_prop: z.union([
      z.object({ did: z.string(), siid: z.number(), piid: z.number() }),
      z.object({
        props: z.array(
          z.object({ did: z.string(), siid: z.number(), piid: z.number() }),
        ).min(1),
      }),
    ]),
    set_prop: z.union([
      z.object({ did: z.string(), siid: z.number(), piid: z.number(), value: z.unknown() }),
      z.object({
        props: z.array(
          z.object({ did: z.string(), siid: z.number(), piid: z.number(), value: z.unknown() }),
        ).min(1),
      }),
    ]),
    run_action: z.object({ did: z.string(), siid: z.number(), aiid: z.number(), params: z.array(z.unknown()).optional() }),
    spec_parse: z.object({ model: z.string() }),
    scene_list: z.object({ home_id: z.union([z.string(), z.number()]).optional() }).optional(),
    scene_execute: z.union([
      z.object({ scene_id: z.string(), home_id: z.union([z.string(), z.number()]).optional() }),
      z.object({ scene_name: z.string(), home_id: z.union([z.string(), z.number()]).optional() }),
    ]),
    speaker_list: z.void(),
    speaker_execute: z.object({ text: z.string(), silent: z.boolean().optional(), did: z.string().optional() }),
    speaker_play: z.object({ text: z.string(), did: z.string().optional() }),
    speaker_status: z.object({ did: z.string().optional() }).optional(),
    ir_discover: z.object({ parent_did: z.string() }),
    ir_get_keys: z.union([z.object({ controller_id: z.string() }), z.object({ did: z.string() })]),
    ir_pir_press_key: z.union([
      z.object({ controller_id: z.string(), key_id: z.string() }),
      z.object({ did: z.string(), key_id: z.string() }),
    ]),
    device_action: z.object({ did: z.string(), capability: z.string(), params: z.array(z.unknown()).optional() }),
    device_prop: z.object({ did: z.string(), capability: z.string(), value: z.unknown().optional() }),
    config_get: z.object({ key: z.string().optional() }).optional(),
    config_set: z.object({ key: z.string(), value: z.unknown() }),
  },
}

type CompensationAction =
  | { type: 'retry'; maxRetries: number; backoffMs: number }
  | { type: 'fallback'; fallbackAction: string; fallbackParams: Record<string, unknown> }
  | { type: 'notify'; message: string }
  | { type: 'abort'; reason: string }

const ERROR_STRATEGIES: Record<string, CompensationAction> = {
  DEVICE_OFFLINE: { type: 'retry', maxRetries: 3, backoffMs: 5000 },
  NETWORK_TIMEOUT: { type: 'retry', maxRetries: 2, backoffMs: 10000 },
  NETWORK_ERROR: { type: 'retry', maxRetries: 2, backoffMs: 10000 },
  AUTH_FAILED: { type: 'fallback', fallbackAction: 'login_qr', fallbackParams: {} },
  TOKEN_EXPIRED: { type: 'fallback', fallbackAction: 'login_qr', fallbackParams: {} },
  SPEC_NOT_FOUND: { type: 'abort', reason: 'Spec not found' },
  INVALID_PARAMS: { type: 'abort', reason: 'Invalid parameters' },
  ACTION_NOT_FOUND: { type: 'abort', reason: 'Action not found' },
  DEVICE_NOT_FOUND: { type: 'abort', reason: 'Device not found' },
  CAPABILITY_NOT_FOUND: { type: 'abort', reason: 'Capability not found on device' },
}

const ARCHIVED_EXECUTOR_NAMES = new Set(['hami-cli'])

function handleError(error: { cliName: string; action: string; code: string; message: string; timeout: boolean }): CompensationAction {
  if (error.timeout) {
    return { type: 'retry', maxRetries: 2, backoffMs: 10000 }
  }
  return ERROR_STRATEGIES[error.code] ?? { type: 'notify', message: error.message || 'Unknown error' }
}

function parseOutput(output: string): CLIResult {
  const parsed = CLIResponseSchema.safeParse(JSON.parse(output))
  if (!parsed.success) {
    return { status: 'error', error: 'PARSE_ERROR', message: parsed.error.message, duration_ms: 0 }
  }
  return { ...parsed.data, duration_ms: 0 }
}

function getBuiltInCLIPath(cliName: 'mi-cli'): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const packagesDir = path.resolve(moduleDir, '..', '..', '..', '..')
  return path.join(packagesDir, cliName)
}

function getCLIExePath(cliName: string): string | null {
  if (cliName === 'mi-cli') {
    const miCliPath = getBuiltInCLIPath('mi-cli')
    return path.join(miCliPath, '.venv', 'Scripts', 'python.exe')
  }
  return null
}

function getCLIWorkingDir(cliName: string): string | null {
  if (cliName === 'mi-cli') {
    return getBuiltInCLIPath('mi-cli')
  }
  return null
}

function buildBuiltInSpawnArgs(cliName: string, action: string, params?: Record<string, unknown>): string[] {
  const payload = JSON.stringify({ action, ...(params ?? {}) })
  return ['-m', cliName.replace('-', '_'), 'run', payload]
}

function buildParamSchema(schema: Record<string, string>): z.ZodSchema {
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [key, rawType] of Object.entries(schema)) {
    const isOptional = rawType.endsWith('?')
    const normalizedType = rawType.replace(/\?$/, '') as ParamTypeName
    let valueSchema: z.ZodTypeAny

    switch (normalizedType) {
      case 'string':
        valueSchema = z.string()
        break
      case 'number':
        valueSchema = z.number()
        break
      case 'boolean':
        valueSchema = z.boolean()
        break
      case 'array':
      case 'string[]':
        valueSchema = z.array(z.string())
        break
      case 'number[]':
        valueSchema = z.array(z.number())
        break
      case 'boolean[]':
        valueSchema = z.array(z.boolean())
        break
      case 'object':
        valueSchema = z.record(z.unknown())
        break
      case 'unknown':
      default:
        valueSchema = z.unknown()
        break
    }

    shape[key] = isOptional ? valueSchema.optional() : valueSchema
  }

  return Object.keys(shape).length === 0 ? z.void() : z.object(shape)
}

function resolveManifestPath(baseDir: string, target: string): string {
  if (!target.includes('/') && !target.includes('\\')) {
    return target
  }
  if (path.isAbsolute(target)) return target
  return path.resolve(baseDir, target)
}

function resolveManifestArg(baseDir: string, value: string): string {
  if (value.startsWith('./') || value.startsWith('../') || value.startsWith('.\\') || value.startsWith('..\\')) {
    return path.resolve(baseDir, value)
  }
  return value
}

export class CLIBridge {
  private readonly runner: SubprocessRunner
  private thirdPartyExecutors = new Map<string, RegisteredExecutor>()

  constructor(runner: SubprocessRunner = new RealSubprocessRunner()) {
    this.runner = runner
  }

  async run(cliName: string, action: string, params?: Record<string, unknown>): Promise<CLIResult> {
    if (ARCHIVED_EXECUTOR_NAMES.has(cliName)) {
      return { status: 'error', error: 'EXECUTOR_ARCHIVED', message: `Executor archived: ${cliName}`, duration_ms: 0 }
    }

    const schemas = this.getSchemas(cliName)
    const schema = schemas?.[action]
    if (!schema) {
      return { status: 'error', error: 'ACTION_NOT_FOUND', message: `Unknown action: ${cliName}.${action}`, duration_ms: 0 }
    }

    if (!(schema instanceof z.ZodVoid)) {
      const parsed = schema.safeParse(params ?? {})
      if (!parsed.success) {
        return { status: 'error', error: 'INVALID_PARAMS', message: parsed.error.message, duration_ms: 0 }
      }
    }

    const start = Date.now()
    try {
      const thirdParty = this.thirdPartyExecutors.get(cliName)
      if (thirdParty?.protocol === 'in_process_module') {
        const result = await this.execInProcess(thirdParty, action, params)
        result.duration_ms = Date.now() - start
        return result
      }

      const spawnSpec = this.buildSpawnSpec(cliName, action, params)
      const stdout = await this.execProcess(spawnSpec)
      const result = parseOutput(stdout)
      result.duration_ms = Date.now() - start
      return result
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return { status: 'error', error: 'PROCESS_ERROR', message: errorMsg, duration_ms: Date.now() - start }
    }
  }

  async runBatch(
    cliName: string,
    commands: Array<{ action: string; params?: Record<string, unknown> }>,
  ): Promise<CLIResult[]> {
    const results: CLIResult[] = []
    for (const cmd of commands) {
      const result = await this.run(cliName, cmd.action, cmd.params)
      results.push(result)
      if (result.status === 'error') break
    }
    return results
  }

  async runWithRetry(
    cliName: string,
    action: string,
    params?: Record<string, unknown>,
    maxAttempts: number = 3,
  ): Promise<CLIResult> {
    let lastResult: CLIResult | null = null
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const result = await this.run(cliName, action, params)
      if (result.status === 'success') return result
      lastResult = result

      if (result.status === 'error' && result.error) {
        const strategy = handleError({
          cliName,
          action,
          code: result.error,
          message: result.message ?? '',
          timeout: result.error === 'NETWORK_TIMEOUT',
        })

        if (strategy.type === 'abort' || strategy.type === 'notify') break
        if (strategy.type === 'retry' && attempt < strategy.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, strategy.backoffMs))
          continue
        }
        if (strategy.type === 'fallback') {
          const fallbackResult = await this.run(cliName, strategy.fallbackAction, strategy.fallbackParams)
          if (fallbackResult.status === 'error') break
          return this.run(cliName, action, params)
        }
      }
    }
    return lastResult ?? { status: 'error', error: 'UNKNOWN', message: 'Unknown CLI error', duration_ms: 0 }
  }

  registerThirdPartyManifest(manifest: ExecutorManifest, baseDir?: string): void {
    const parsed = ExecutorManifestSchema.parse(manifest)
    const manifestBaseDir = baseDir ?? process.cwd()
    const cwd = parsed.cwd ? resolveManifestPath(manifestBaseDir, parsed.cwd) : baseDir
    const resolvedArgs = parsed.args.map((arg) => resolveManifestArg(manifestBaseDir, arg))
    const executable = parsed.protocol === 'in_process_module'
      ? resolveManifestArg(manifestBaseDir, resolvedArgs[0] ?? parsed.executable)
      : resolveManifestPath(manifestBaseDir, parsed.executable)
    const args = parsed.protocol === 'in_process_module' ? resolvedArgs.slice(1) : resolvedArgs

    const actions = Object.fromEntries(
      Object.entries(parsed.actions).map(([actionName, actionManifest]) => [
        actionName,
        buildParamSchema(actionManifest.params_schema ?? {}),
      ]),
    )

    this.thirdPartyExecutors.set(parsed.name, {
      name: parsed.name,
      executable,
      cwd,
      protocol: parsed.protocol,
      args,
      timeout_ms: parsed.timeout_ms,
      actions,
      action_manifests: parsed.actions,
    })
  }

  loadDiskExecutors(skillsDir: string): void {
    if (!fs.existsSync(skillsDir)) return

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillDir = path.join(skillsDir, entry.name)
      const manifestPath = path.join(skillDir, 'EXECUTOR.json')
      if (!fs.existsSync(manifestPath)) continue

      try {
        const raw = fs.readFileSync(manifestPath, 'utf-8')
        const manifest = JSON.parse(raw) as ExecutorManifest
        if ((manifest as any).archived === true || (manifest as any).status === 'archived') continue
        this.registerThirdPartyManifest(manifest, skillDir)
      } catch {}
    }
  }

  listExecutors(): Array<{
    name: string
    source: 'builtin' | 'third_party'
    protocol: 'process_json_arg' | 'process_stdin_json' | 'in_process_module'
    timeout_ms: number
    actions: string[]
    action_details: Array<{
      name: string
      description?: string
      params_schema: Record<string, string>
    }>
  }> {
    const builtins = Object.entries(MI_CLI_SCHEMAS).map(([name, actions]) => ({
      name,
      source: 'builtin' as const,
      protocol: 'process_json_arg' as const,
      timeout_ms: 30000,
      actions: Object.keys(actions),
      action_details: Object.keys(actions).map((actionName) => ({
        name: actionName,
        params_schema: {},
      })),
    }))
    const thirdParty = Array.from(this.thirdPartyExecutors.values()).map((executor) => ({
      name: executor.name,
      source: 'third_party' as const,
      protocol: executor.protocol,
      timeout_ms: executor.timeout_ms,
      actions: Object.keys(executor.actions),
      action_details: Object.entries(executor.action_manifests).map(([actionName, actionManifest]) => ({
        name: actionName,
        description: actionManifest.description,
        params_schema: actionManifest.params_schema ?? {},
      })),
    })).filter((executor) => !ARCHIVED_EXECUTOR_NAMES.has(executor.name))
    return [...builtins, ...thirdParty]
  }

  hasExecutor(name: string): boolean {
    if (ARCHIVED_EXECUTOR_NAMES.has(name)) return false
    if (MI_CLI_SCHEMAS[name]) return true
    return this.thirdPartyExecutors.has(name)
  }

  private getSchemas(cliName: string): Record<string, z.ZodSchema> | undefined {
    if (ARCHIVED_EXECUTOR_NAMES.has(cliName)) return undefined
    if (MI_CLI_SCHEMAS[cliName]) return MI_CLI_SCHEMAS[cliName]
    return this.thirdPartyExecutors.get(cliName)?.actions
  }

  private buildSpawnSpec(
    cliName: string,
    action: string,
    params?: Record<string, unknown>,
  ): { exePath: string; args: string[]; cwd?: string; stdinPayload?: string; timeoutMs: number } {
    const thirdParty = this.thirdPartyExecutors.get(cliName)
    if (thirdParty) {
      const payload = JSON.stringify({ action, ...(params ?? {}) })
      if (thirdParty.protocol === 'process_stdin_json') {
        return {
          exePath: thirdParty.executable,
          args: [...thirdParty.args],
          cwd: thirdParty.cwd,
          stdinPayload: payload,
          timeoutMs: thirdParty.timeout_ms,
        }
      }

      return {
        exePath: thirdParty.executable,
        args: [...thirdParty.args, payload],
        cwd: thirdParty.cwd,
        timeoutMs: thirdParty.timeout_ms,
      }
    }

    const exePath = this.getExePath(cliName)
    return {
      exePath,
      args: buildBuiltInSpawnArgs(cliName, action, params),
      cwd: this.getCwd(cliName),
      timeoutMs: 30000,
    }
  }

  private getExePath(cliName: string): string {
    const builtIn = getCLIExePath(cliName)
    if (builtIn) return builtIn
    return cliName
  }

  private getCwd(cliName: string): string | undefined {
    return getCLIWorkingDir(cliName) ?? undefined
  }

  private async execProcess(spec: {
    exePath: string
    args: string[]
    cwd?: string
    stdinPayload?: string
    timeoutMs: number
  }): Promise<string> {
    return this.runner.run(spec)
  }

  private async execInProcess(
    executor: RegisteredExecutor,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<CLIResult> {
    const moduleUrl = pathToFileURL(executor.executable).href
    const imported = await import(moduleUrl)
    const run = imported.run as ((payload: { action: string } & Record<string, unknown>) => Promise<unknown> | unknown) | undefined

    if (typeof run !== 'function') {
      return {
        status: 'error',
        error: 'PROCESS_ERROR',
        message: `Executor module missing run() export: ${executor.executable}`,
        duration_ms: 0,
      }
    }

    const result = await run({ action, ...(params ?? {}) })
    const parsed = CLIResponseSchema.safeParse(result)
    if (!parsed.success) {
      return {
        status: 'error',
        error: 'PARSE_ERROR',
        message: parsed.error.message,
        duration_ms: 0,
      }
    }

    return { ...parsed.data, duration_ms: 0 }
  }
}

export const cliBridge = new CLIBridge()
export const defaultCliBridge = cliBridge
export { handleError, parseOutput, CLIResponseSchema }
