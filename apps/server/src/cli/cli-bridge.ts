import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'

export type CLIResult =
  | { status: 'success'; data?: unknown; duration_ms: number }
  | { status: 'error'; error: string; message?: string; data?: unknown; duration_ms: number }

interface PythonCommand {
  exePath: string
  argsPrefix: string[]
  env: NodeJS.ProcessEnv
}

const BUILT_IN_CLIS = new Set(['mi-cli', 'adb-cli'])
const commandCache = new Map<string, PythonCommand>()

function repoRoot(): string {
  return path.resolve(__dirname, '../../../../')
}

function getBuiltInCLIPath(cliName: string): string {
  return path.join(repoRoot(), 'packages', cliName)
}

function getModuleName(cliName: string): string {
  return cliName.replace(/-/g, '_')
}

function cleanPythonEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra }
  delete env.PYTHONHOME
  return env
}

function getEnvPythonOverride(cliName: string): string | undefined {
  if (cliName === 'mi-cli') return process.env.MI_CLI_PYTHON || process.env.CLI_BRIDGE_PYTHON
  if (cliName === 'adb-cli') return process.env.ADB_CLI_PYTHON || process.env.CLI_BRIDGE_PYTHON
  return process.env.CLI_BRIDGE_PYTHON
}

function getVenvPythonPath(cliName: string): string {
  const cliPath = getBuiltInCLIPath(cliName)
  return process.platform === 'win32'
    ? path.join(cliPath, '.venv', 'Scripts', 'python.exe')
    : path.join(cliPath, '.venv', 'bin', 'python')
}

function canRunCommand(exePath: string, args: string[]): boolean {
  const result = spawnSync(exePath, args, {
    shell: false,
    stdio: 'ignore',
    env: cleanPythonEnv(),
  })
  return result.status === 0
}

function pythonPathEnv(cliPath: string): NodeJS.ProcessEnv {
  const srcPath = path.join(cliPath, 'src')
  const current = process.env.PYTHONPATH
  return cleanPythonEnv({
    PYTHONPATH: current ? `${srcPath}${path.delimiter}${current}` : srcPath,
  })
}

function getBuiltInPythonCommand(cliName: string): PythonCommand {
  const cached = commandCache.get(cliName)
  if (cached) return cached

  const cliPath = getBuiltInCLIPath(cliName)
  const override = getEnvPythonOverride(cliName)
  if (override) {
    const command = { exePath: override, argsPrefix: [], env: pythonPathEnv(cliPath) }
    commandCache.set(cliName, command)
    return command
  }

  const venvPython = getVenvPythonPath(cliName)
  if (fs.existsSync(venvPython)) {
    const command = { exePath: venvPython, argsPrefix: [], env: pythonPathEnv(cliPath) }
    commandCache.set(cliName, command)
    return command
  }

  const uvExe = process.env.UV_EXE || 'uv'
  if (canRunCommand(uvExe, ['--version'])) {
    const command = {
      exePath: uvExe,
      argsPrefix: ['run', '--isolated', '--with-editable', '.', 'python'],
      env: cleanPythonEnv(),
    }
    commandCache.set(cliName, command)
    return command
  }

  const command = { exePath: 'python', argsPrefix: [], env: pythonPathEnv(cliPath) }
  commandCache.set(cliName, command)
  return command
}

function parseOutput(output: string, durationMs: number): CLIResult {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const rawJson = lines.at(-1) ?? ''
  if (!rawJson) {
    return { status: 'error', error: 'EMPTY_OUTPUT', message: 'CLI returned no output', duration_ms: durationMs }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch (error) {
    return {
      status: 'error',
      error: 'PARSE_ERROR',
      message: error instanceof Error ? error.message : String(error),
      data: output,
      duration_ms: durationMs,
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'error', error: 'INVALID_OUTPUT', data: parsed, duration_ms: durationMs }
  }

  const result = parsed as { status?: string; data?: unknown; error?: string; message?: string }
  if (result.status === 'success') {
    return { status: 'success', data: result.data, duration_ms: durationMs }
  }
  return {
    status: 'error',
    error: result.error || 'CLI_ERROR',
    message: result.message,
    data: result.data ?? parsed,
    duration_ms: durationMs,
  }
}

export class CLIBridge {
  async run(cliName: string, action: string, params?: Record<string, unknown>): Promise<CLIResult> {
    if (!BUILT_IN_CLIS.has(cliName)) {
      return { status: 'error', error: 'CLI_NOT_REGISTERED', message: `Unknown CLI: ${cliName}`, duration_ms: 0 }
    }

    const cliPath = getBuiltInCLIPath(cliName)
    if (!fs.existsSync(cliPath)) {
      return { status: 'error', error: 'CLI_NOT_FOUND', message: `Missing CLI package: ${cliPath}`, duration_ms: 0 }
    }

    const command = getBuiltInPythonCommand(cliName)
    const payload = JSON.stringify({ action, ...(params ?? {}) })
    const args = [...command.argsPrefix, '-m', getModuleName(cliName), 'run', payload]
    const startedAt = Date.now()

    try {
      const output = await runProcess({
        exePath: command.exePath,
        args,
        cwd: cliPath,
        env: command.env,
        timeoutMs: 30000,
      })
      return parseOutput(output, Date.now() - startedAt)
    } catch (error) {
      return {
        status: 'error',
        error: 'PROCESS_ERROR',
        message: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startedAt,
      }
    }
  }
}

function runProcess(opts: {
  exePath: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc: ChildProcess = spawn(opts.exePath, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill()
      reject(new Error(`Process timeout after ${opts.timeoutMs}ms`))
    }, opts.timeoutMs)

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })
    proc.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      reject(new Error(`Process exited with code ${code}: ${stderr.trim() || stdout.trim()}`))
    })
  })
}

export const cliBridge = new CLIBridge()

