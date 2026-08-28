import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ExternalIntegrationRecord } from '../integration/index.js'
import { externalIntegrationsService } from '../integration/index.js'

const execFileAsync = promisify(execFile)
const DEFAULT_CODE_SERVER_ENDPOINT = 'http://127.0.0.1:8080'
const DEFAULT_CODE_SERVER_BIND_ADDR = '127.0.0.1:8080'
const DEFAULT_CODE_SERVER_AUTH = 'password'
const DEFAULT_DIRECTORY_ENTRY_LIMIT = 200
const MAX_DIRECTORY_ENTRY_LIMIT = 500
const MAX_FILE_PREVIEW_BYTES = 192 * 1024

let launchedCodeServer: ChildProcess | null = null
let launchedCommand = 'code-server'
let launchedBaseArgs: string[] = []

export interface RemoteWorkspaceEndpointProbe {
  url: string
  reachable: boolean
  status_code: number | null
  state?: string
  last_heartbeat?: number | null
  error?: string
}

export interface RemoteWorkspaceCliProbe {
  command: string
  args: string[]
  available: boolean
  version?: string
  error?: string
  candidates: string[]
  install_hint: string
}

export interface RemoteWorkspaceSourceKernelProbe {
  name: string
  mode: 'source_embedded'
  available: boolean
  source_path: string
  status: 'scaffolded' | 'ready'
  notes: string[]
  error?: string
}

export interface RemoteWorkspaceSshProbe {
  command: string
  args: string[]
  available: boolean
  version?: string
  error?: string
  candidates: string[]
  install_hint: string
}

export interface RemoteWorkspaceLaunchRecipe {
  command: string
  cwd: string
  notes: string[]
}

export interface RemoteWorkspaceLaunchResult {
  status: 'started' | 'starting' | 'already_running' | 'missing_cli' | 'failed'
  command: string
  cwd: string
  pid?: number
  message?: string
  endpoint?: RemoteWorkspaceEndpointProbe
}

export interface RemoteWorkspaceStopResult {
  status: 'stopped' | 'not_running' | 'failed'
  message?: string
}

export type RemoteWorkspaceTargetKind = 'code_server' | 'ssh_host' | 'http_workspace' | 'local_service'

export interface RemoteWorkspaceTarget {
  id: string
  label: string
  kind: RemoteWorkspaceTargetKind
  endpoint: string
  workspace_root?: string
  source: 'sidecar' | 'external_integration'
  enabled: boolean
  status: 'ready' | 'registered' | 'offline'
  integration_id?: number
  capabilities: string[]
  auth: {
    mode: string
    owner: string
    notes: string
  }
}

export interface RemoteWorkspaceTargetProbe {
  id: string
  label: string
  kind: RemoteWorkspaceTargetKind
  checked_at: string
  reachable: boolean
  endpoint: string
  command?: string
  status_code?: number | null
  output?: string
  error?: string
}

export interface RegisterRemoteWorkspaceTargetInput {
  label?: string
  endpoint?: string
  workspace_root?: string
  auth_mode?: string
  description?: string
}

export interface RemoteWorkspaceTerminalLaunchInput {
  target_id?: string
}

export interface RemoteWorkspaceTerminalLaunch {
  target_id: string
  label: string
  kind: 'local_shell' | 'ssh_host'
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}

export interface RemoteWorkspaceFileListInput {
  target_id?: string
  path?: string
  limit?: number
}

export interface RemoteWorkspaceFileReadInput {
  target_id?: string
  path?: string
}

export interface RemoteWorkspaceFileEntry {
  name: string
  path: string
  type: 'directory' | 'file' | 'symlink' | 'other'
  size: number | null
  modified_at: string | null
}

export interface RemoteWorkspaceFileList {
  target_id: string
  label: string
  kind: 'local_source'
  root: string
  path: string
  absolute_path: string
  entries: RemoteWorkspaceFileEntry[]
  truncated: boolean
}

export interface RemoteWorkspaceFilePreview {
  target_id: string
  label: string
  kind: 'local_source'
  root: string
  path: string
  absolute_path: string
  name: string
  size: number
  modified_at: string | null
  encoding: 'utf8' | 'binary'
  content: string
  truncated: boolean
}

export interface RemoteWorkspaceStatus {
  checked_at: string
  integration_state: 'missing' | 'registered' | 'enabled'
  integration: ExternalIntegrationRecord | null
  readiness: 'missing' | 'registered' | 'partial' | 'ready'
  endpoint: RemoteWorkspaceEndpointProbe
  cli: RemoteWorkspaceCliProbe
  kernel: RemoteWorkspaceSourceKernelProbe
  ssh: RemoteWorkspaceSshProbe
  launch: RemoteWorkspaceLaunchRecipe
  reference: {
    name: string
    url: string
    docs_url: string
    healthcheck_url: string
  }
  auth: {
    mode: string
    independent: boolean
    owner: string
    notes: string
  }
}

export interface RemoteWorkspaceServiceOptions {
  getIntegration?: () => ExternalIntegrationRecord | null
  probeEndpoint?: (endpoint: string) => Promise<RemoteWorkspaceEndpointProbe>
  probeCli?: () => Promise<RemoteWorkspaceCliProbe>
  probeKernel?: () => Promise<RemoteWorkspaceSourceKernelProbe>
  probeSsh?: () => Promise<RemoteWorkspaceSshProbe>
  probeSshTarget?: (target: RemoteWorkspaceTarget, ssh: RemoteWorkspaceSshProbe) => Promise<RemoteWorkspaceTargetProbe>
  probeHttpTarget?: (target: RemoteWorkspaceTarget) => Promise<RemoteWorkspaceTargetProbe>
  probeNpx?: () => Promise<RemoteWorkspaceCliProbe>
  listIntegrations?: () => ExternalIntegrationRecord[]
  registerIntegration?: typeof externalIntegrationsService.register
  removeIntegration?: typeof externalIntegrationsService.remove
  spawnProcess?: typeof spawn
  workspaceRoot?: string
  now?: () => Date
  startReadyTimeoutMs?: number
  startReadyPollMs?: number
}

export class RemoteWorkspaceService {
  constructor(private readonly options: RemoteWorkspaceServiceOptions = {}) {}

  async getStatus(): Promise<RemoteWorkspaceStatus> {
    const integration = (this.options.getIntegration ?? defaultGetIntegration)()
    const endpoint = integration?.endpoint || DEFAULT_CODE_SERVER_ENDPOINT
    const [endpointProbe, cliProbe] = await Promise.all([
      (this.options.probeEndpoint ?? probeCodeServerEndpoint)(endpoint),
      (this.options.probeCli ?? probeCodeServerCli)(),
    ])
    const [kernelProbe, sshProbe] = await Promise.all([
      (this.options.probeKernel ?? probeSourceKernel)(),
      (this.options.probeSsh ?? probeSshCli)(),
    ])
    const workspaceRoot = path.resolve(this.options.workspaceRoot ?? process.env.HOMESENSE_REMOTE_WORKSPACE_ROOT ?? defaultWorkspaceRoot())
    const readiness = buildReadiness(integration, endpointProbe, cliProbe)
    const launchPlan = selectLaunchPlan(cliProbe)
    return {
      checked_at: (this.options.now ?? (() => new Date()))().toISOString(),
      integration_state: integration ? (integration.enabled ? 'enabled' : 'registered') : 'missing',
      integration,
      readiness,
      endpoint: endpointProbe,
      cli: cliProbe,
      kernel: kernelProbe,
      ssh: sshProbe,
      launch: {
        command: buildLaunchCommand(launchPlan.command, launchPlan.args, endpoint, workspaceRoot),
        cwd: workspaceRoot,
        notes: [
          'SSH targets are the main product lane for remote computers and NAS hosts.',
          'The workspace kernel is absorbed into the project and should grow from source instead of a container runtime wrapper.',
          'Keep code-server auth or reverse proxy auth separate from HomeSense Chat while the source kernel is being wired.',
          kernelProbe.available ? `Embedded source kernel: ${kernelProbe.name}.` : `Embedded source kernel path: ${kernelProbe.source_path}.`,
          ...kernelProbe.notes,
        ].filter((note): note is string => Boolean(note)),
      },
      reference: {
        name: 'coder/code-server',
        url: 'https://github.com/coder/code-server',
        docs_url: 'https://coder.com/docs/code-server/latest',
        healthcheck_url: 'https://github.com/coder/code-server/blob/main/docs/FAQ.md#what-is-the-healthz-endpoint',
      },
      auth: buildAuthSummary(integration),
    }
  }

  async start(): Promise<RemoteWorkspaceLaunchResult> {
    const integration = (this.options.getIntegration ?? defaultGetIntegration)()
    const workspaceRoot = path.resolve(this.options.workspaceRoot ?? process.env.HOMESENSE_REMOTE_WORKSPACE_ROOT ?? defaultWorkspaceRoot())
    const endpoint = integration?.endpoint || DEFAULT_CODE_SERVER_ENDPOINT

    if (launchedCodeServer && launchedCodeServer.exitCode == null) {
      return {
        status: 'already_running',
        command: buildLaunchCommand(launchedCommand, launchedBaseArgs, endpoint, workspaceRoot),
        cwd: workspaceRoot,
        pid: launchedCodeServer.pid ?? undefined,
      }
    }

    const cli = await (this.options.probeCli ?? probeCodeServerCli)()
    if (cli.available) {
      return this.startCodeServerProcess(cli, endpoint, workspaceRoot)
    }

    const npx = await (this.options.probeNpx ?? probeNpxLauncher)()
    if (!npx.available) {
      return {
        status: 'missing_cli',
        command: buildLaunchCommand(npx.command, npx.args, endpoint, workspaceRoot),
        cwd: workspaceRoot,
        message: npx.error ?? cli.error ?? 'code-server command not found.',
      }
    }

    return this.startCodeServerProcess(npx, endpoint, workspaceRoot)
  }

  private async startCodeServerProcess(
    launchCli: RemoteWorkspaceCliProbe,
    endpoint: string,
    workspaceRoot: string,
  ): Promise<RemoteWorkspaceLaunchResult> {
    const bindAddr = resolveBindAddr(endpoint)
    const authMode = normalizeAuthMode(process.env.HOMESENSE_CODE_SERVER_AUTH ?? DEFAULT_CODE_SERVER_AUTH)
    const dataDir = resolveUserDataDir()
    const args = [
      '--bind-addr',
      bindAddr,
      '--auth',
      authMode,
      '--user-data-dir',
      dataDir,
      '--disable-telemetry',
      workspaceRoot,
    ]

    try {
      const proc = (this.options.spawnProcess ?? spawn)(launchCli.command, [...launchCli.args, ...args], {
        cwd: workspaceRoot,
        detached: true,
        stdio: 'ignore',
        shell: process.platform === 'win32',
        windowsHide: true,
      })
      launchedCodeServer = proc
      launchedCommand = launchCli.command
      launchedBaseArgs = launchCli.args
      proc.unref()
      proc.once('exit', () => {
        if (launchedCodeServer === proc) {
          launchedCodeServer = null
          launchedCommand = 'code-server'
          launchedBaseArgs = []
        }
      })
      proc.once('error', () => {
        if (launchedCodeServer === proc) {
          launchedCodeServer = null
          launchedCommand = 'code-server'
          launchedBaseArgs = []
        }
      })
      const endpointProbe = await waitForEndpointReady(
        endpoint,
        this.options.probeEndpoint ?? probeCodeServerEndpoint,
        this.options.startReadyTimeoutMs ?? 12000,
        this.options.startReadyPollMs ?? 750,
      )
      const command = [launchCli.command, ...[...launchCli.args, ...args].map((arg) => quoteArg(arg))].join(' ')
      if (endpointProbe.reachable) {
        markRemoteWorkspaceEnabled(true)
        return {
          status: 'started',
          command,
          cwd: workspaceRoot,
          pid: proc.pid ?? undefined,
          endpoint: endpointProbe,
        }
      }
      if (proc.exitCode != null) {
        if (launchedCodeServer === proc) {
          launchedCodeServer = null
          launchedCommand = 'code-server'
          launchedBaseArgs = []
        }
        return {
          status: 'failed',
          command,
          cwd: workspaceRoot,
          pid: proc.pid ?? undefined,
          endpoint: endpointProbe,
          message: `code-server exited before /healthz became reachable: ${describeEndpointProbe(endpointProbe)}`,
        }
      }
      return {
        status: 'starting',
        command,
        cwd: workspaceRoot,
        pid: proc.pid ?? undefined,
        endpoint: endpointProbe,
        message: `code-server launched, but /healthz is not reachable yet: ${describeEndpointProbe(endpointProbe)}`,
      }
    } catch (error) {
      return {
        status: 'failed',
        command: buildLaunchCommand(launchCli.command, launchCli.args, endpoint, workspaceRoot),
        cwd: workspaceRoot,
        message: error instanceof Error ? error.message : 'Failed to launch code-server.',
      }
    }
  }

  async stop(): Promise<RemoteWorkspaceStopResult> {
    if (!launchedCodeServer || launchedCodeServer.exitCode != null) {
      launchedCodeServer = null
      launchedCommand = 'code-server'
      launchedBaseArgs = []
      return {
        status: 'not_running',
      }
    }
    try {
      launchedCodeServer.kill()
      const pid = launchedCodeServer.pid
      launchedCodeServer = null
      launchedCommand = 'code-server'
      launchedBaseArgs = []
      markRemoteWorkspaceEnabled(false)
      return {
        status: 'stopped',
        message: pid ? `Stopped code-server process ${pid}.` : 'Stopped code-server process.',
      }
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Failed to stop code-server.',
      }
    }
  }

  async listTargets(): Promise<RemoteWorkspaceTarget[]> {
    const status = await this.getStatus()
    const workspaceRoot = path.resolve(this.options.workspaceRoot ?? process.env.HOMESENSE_REMOTE_WORKSPACE_ROOT ?? defaultWorkspaceRoot())
    const integrations = (this.options.listIntegrations ?? (() => externalIntegrationsService.list()))()
    const sidecarTarget: RemoteWorkspaceTarget = {
      id: 'sidecar:code-server',
      label: 'HomeSense code-server',
      kind: 'code_server',
      endpoint: workspaceOpenEndpoint(status),
      workspace_root: workspaceRoot,
      source: 'sidecar',
      enabled: status.endpoint.reachable,
      status: status.endpoint.reachable ? 'ready' : (status.integration ? 'registered' : 'offline'),
      integration_id: status.integration?.id,
      capabilities: [
        'workspace.code_server.open',
        'workspace.code_server.open_folder',
        'workspace.code_server.open_terminal',
        'filesystem.preview',
        'terminal.session.open',
      ],
      auth: status.auth,
    }
    const externalTargets = integrations
      .filter((item) => item.metadata?.role === 'remote_workspace_target')
      .map((item) => integrationToWorkspaceTarget(item))
    return [sidecarTarget, ...externalTargets]
  }

  async registerTarget(input: RegisterRemoteWorkspaceTargetInput): Promise<RemoteWorkspaceTarget> {
    const label = String(input.label ?? '').trim()
    const endpoint = String(input.endpoint ?? '').trim()
    if (!label) throw new Error('label is required')
    if (!endpoint) throw new Error('endpoint is required')
    const kind = inferTargetKind(endpoint)
    const workspaceRoot = String(input.workspace_root ?? '').trim()
    const authMode = String(input.auth_mode ?? defaultTargetAuthMode(kind)).trim()
    const registerIntegration = this.options.registerIntegration ?? externalIntegrationsService.register.bind(externalIntegrationsService)
    const record = registerIntegration({
      name: buildTargetIntegrationName(label, endpoint),
      kind: 'local_service',
      endpoint,
      enabled: true,
      description: String(input.description ?? `Remote workspace target: ${label}`).trim(),
      capability_ids: capabilitiesForTargetKind(kind),
      actions: actionsForTargetKind(kind),
      metadata: {
        source: 'user',
        role: 'remote_workspace_target',
        workspace_target: {
          label,
          kind,
          workspace_root: workspaceRoot || undefined,
        },
        auth: {
          mode: authMode,
          credentials_owned_by: 'target_host',
          notes: 'HomeSense stores the target declaration only; credentials remain with the target host or sidecar service.',
        },
      },
    })
    return integrationToWorkspaceTarget(record)
  }

  removeTarget(id: string): boolean {
    const match = /^integration:(\d+)$/.exec(id)
    if (!match) return false
    const removeIntegration = this.options.removeIntegration ?? externalIntegrationsService.remove.bind(externalIntegrationsService)
    return removeIntegration(Number(match[1]))
  }

  async probeTarget(id: string): Promise<RemoteWorkspaceTargetProbe | null> {
    const target = await this.findTargetById(id)
    if (!target) return null
    const checkedAt = (this.options.now ?? (() => new Date()))().toISOString()
    if (target.kind === 'ssh_host') {
      const ssh = await (this.options.probeSsh ?? probeSshCli)()
      return (this.options.probeSshTarget ?? probeSshWorkspaceTarget)(target, ssh)
    }
    if (target.kind === 'http_workspace' || target.kind === 'code_server') {
      return (this.options.probeHttpTarget ?? probeHttpWorkspaceTarget)(target)
    }
    return {
      id: target.id,
      label: target.label,
      kind: target.kind,
      checked_at: checkedAt,
      reachable: false,
      endpoint: target.endpoint,
      error: 'Target probe is not implemented for this target kind yet.',
    }
  }

  async createTerminalLaunch(input: RemoteWorkspaceTerminalLaunchInput = {}): Promise<RemoteWorkspaceTerminalLaunch> {
    const workspaceRoot = path.resolve(this.options.workspaceRoot ?? process.env.HOMESENSE_REMOTE_WORKSPACE_ROOT ?? defaultWorkspaceRoot())
    const targetId = String(input.target_id ?? '').trim()
    if (!targetId || targetId === 'local' || targetId === 'local:shell') {
      const shell = resolveLocalShell()
      return {
        target_id: 'local:shell',
        label: 'Local Shell',
        kind: 'local_shell',
        command: shell.command,
        args: shell.args,
        cwd: workspaceRoot,
      }
    }

    const target = await this.findTargetById(targetId)
    if (!target) throw new Error(`Remote workspace target not found: ${targetId}`)
    if (target.kind !== 'ssh_host') {
      throw new Error(`Terminal launch is only implemented for ssh_host targets: ${target.kind}`)
    }

    const ssh = await (this.options.probeSsh ?? probeSshCli)()
    if (!ssh.available) throw new Error(ssh.error ?? 'SSH CLI is not available.')
    const parsed = parseSshEndpoint(target.endpoint)
    if (!parsed) throw new Error('Endpoint must use ssh://user@host:port.')

    const args = [
      ...ssh.args,
      '-tt',
      '-p',
      String(parsed.port),
      parsed.login,
    ]
    return {
      target_id: target.id,
      label: target.label,
      kind: 'ssh_host',
      command: ssh.command,
      args,
      cwd: workspaceRoot,
    }
  }

  async listFiles(input: RemoteWorkspaceFileListInput = {}): Promise<RemoteWorkspaceFileList> {
    const workspaceRoot = path.resolve(this.options.workspaceRoot ?? process.env.HOMESENSE_REMOTE_WORKSPACE_ROOT ?? defaultWorkspaceRoot())
    const target = await this.resolveFilesystemTarget(input.target_id)
    const resolved = resolveWorkspacePath(workspaceRoot, input.path)
    const stats = await fs.promises.stat(resolved.absolutePath)
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolved.workspacePath || '.'}`)
    }

    const limit = clampDirectoryLimit(input.limit)
    const dirents = await fs.promises.readdir(resolved.absolutePath, { withFileTypes: true })
    const sorted = dirents.sort((a, b) => {
      const aDir = a.isDirectory() ? 0 : 1
      const bDir = b.isDirectory() ? 0 : 1
      if (aDir !== bDir) return aDir - bDir
      return a.name.localeCompare(b.name)
    })
    const entries = await Promise.all(sorted.slice(0, limit).map(async (entry) => {
      const absolutePath = path.join(resolved.absolutePath, entry.name)
      return buildFileEntry(workspaceRoot, absolutePath, entry)
    }))

    return {
      target_id: target.target_id,
      label: target.label,
      kind: 'local_source',
      root: workspaceRoot,
      path: resolved.workspacePath,
      absolute_path: resolved.absolutePath,
      entries,
      truncated: sorted.length > limit,
    }
  }

  async readFile(input: RemoteWorkspaceFileReadInput = {}): Promise<RemoteWorkspaceFilePreview> {
    const workspaceRoot = path.resolve(this.options.workspaceRoot ?? process.env.HOMESENSE_REMOTE_WORKSPACE_ROOT ?? defaultWorkspaceRoot())
    const target = await this.resolveFilesystemTarget(input.target_id)
    const resolved = resolveWorkspacePath(workspaceRoot, input.path)
    const stats = await fs.promises.stat(resolved.absolutePath)
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${resolved.workspacePath || '.'}`)
    }

    const buffer = await readFilePreviewBytes(resolved.absolutePath)
    const previewBuffer = buffer.bytes.subarray(0, MAX_FILE_PREVIEW_BYTES)
    const binary = isLikelyBinary(previewBuffer)
    return {
      target_id: target.target_id,
      label: target.label,
      kind: 'local_source',
      root: workspaceRoot,
      path: resolved.workspacePath,
      absolute_path: resolved.absolutePath,
      name: path.basename(resolved.absolutePath),
      size: stats.size,
      modified_at: stats.mtime ? stats.mtime.toISOString() : null,
      encoding: binary ? 'binary' : 'utf8',
      content: binary ? '' : previewBuffer.toString('utf8'),
      truncated: buffer.truncated || stats.size > MAX_FILE_PREVIEW_BYTES,
    }
  }

  shutdown(): void {
    if (launchedCodeServer && launchedCodeServer.exitCode == null) {
      launchedCodeServer.kill()
    }
    launchedCodeServer = null
    launchedCommand = 'code-server'
    launchedBaseArgs = []
  }

  private async findTargetById(id: string): Promise<RemoteWorkspaceTarget | null> {
    const targets = await this.listTargets()
    return targets.find((target) => target.id === id) ?? null
  }

  private async resolveFilesystemTarget(targetIdInput: unknown): Promise<{ target_id: string; label: string }> {
    const targetId = String(targetIdInput ?? '').trim()
    if (!targetId || targetId === 'local' || targetId === 'local:source' || targetId === 'sidecar:code-server') {
      return {
        target_id: targetId || 'local:source',
        label: 'Local Source',
      }
    }

    const target = await this.findTargetById(targetId)
    if (!target) throw new Error(`Remote workspace target not found: ${targetId}`)
    throw new Error(`Filesystem browsing is only implemented for the local source workspace. Target ${target.label} is ${target.kind}.`)
  }
}

export const remoteWorkspaceService = new RemoteWorkspaceService()

export async function probeSourceKernel(): Promise<RemoteWorkspaceSourceKernelProbe> {
  const sourceRoot = path.resolve(
    defaultWorkspaceRoot(),
    'packages',
    'backend',
    'src',
    'modules',
    'remote-workspace',
  )
  const sourcePath = path.join(sourceRoot, 'index.ts')
  const available = fs.existsSync(sourcePath)
  return {
    name: 'homesense-source-workspace-kernel',
    mode: 'source_embedded',
    available,
    source_path: sourcePath,
    status: available ? 'scaffolded' : 'scaffolded',
    notes: [
      'Container runtime wrappers have been removed from the workspace path.',
      'This kernel is now represented as source inside the HomeSense project.',
    ],
  }
}

export async function probeCodeServerEndpoint(endpoint: string): Promise<RemoteWorkspaceEndpointProbe> {
  const base = normalizeHttpUrl(endpoint)
  if (!base) {
    return {
      url: buildHealthUrl(endpoint),
      reachable: false,
      status_code: null,
      error: 'Endpoint is not HTTP or HTTPS.',
    }
  }

  const url = buildHealthUrl(base)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
      },
    })
    const body = await response.text()
    const parsed = parseProbeBody(body)
    return {
      url,
      reachable: response.ok && (parsed.state === 'alive' || parsed.state === 'expired'),
      status_code: response.status,
      state: parsed.state,
      last_heartbeat: parsed.lastHeartbeat,
    }
  } catch (error) {
    return {
      url,
      reachable: false,
      status_code: null,
      error: error instanceof Error ? error.message : 'Failed to probe code-server health endpoint.',
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function probeCodeServerCli(options: { allowNpxFallback?: boolean } = {}): Promise<RemoteWorkspaceCliProbe> {
  const commands = buildCodeServerCommandCandidates(options.allowNpxFallback === true)
  let lastError: string | undefined

  for (const candidate of commands) {
    try {
      const output = await probeCommandVersion(candidate, 5000)
      return {
        command: candidate.command,
        args: candidate.args,
        available: true,
        version: output.split(/\r?\n/)[0] || undefined,
        candidates: commands.map(formatCommandCandidate),
        install_hint: buildInstallHint(),
      }
    } catch (error) {
      lastError = formatExecError(error, 'Failed to probe code-server CLI.')
    }
  }

  return {
    command: commands[0]?.command ?? 'code-server',
    args: commands[0]?.args ?? [],
    available: false,
    error: lastError ?? 'code-server command not found.',
    candidates: commands.map(formatCommandCandidate),
    install_hint: buildInstallHint(),
  }
}

export async function probeNpxLauncher(): Promise<RemoteWorkspaceCliProbe> {
  const command = 'npx'
  const args = ['--yes', 'code-server']
  try {
    const output = await probeCommandVersion({ command, args }, 120000)
    return {
      command,
      args,
      available: true,
      version: output.split(/\r?\n/)[0] || undefined,
      candidates: [formatCommandCandidate({ command, args })],
      install_hint: buildInstallHint(),
    }
  } catch (error) {
    return {
      command,
      args,
      available: false,
      error: formatExecError(error, 'npx --yes code-server failed.'),
      candidates: [formatCommandCandidate({ command, args })],
      install_hint: buildInstallHint(),
    }
  }
}

export async function probeSshCli(): Promise<RemoteWorkspaceSshProbe> {
  const commands = buildSshCommandCandidates()
  let lastError: string | undefined

  for (const candidate of commands) {
    try {
      const output = await execFileVersion(candidate.command, [...candidate.args, '-V'], 5000)
      return {
        command: candidate.command,
        args: candidate.args,
        available: true,
        version: output.split(/\r?\n/)[0] || undefined,
        candidates: commands.map(formatCommandCandidate),
        install_hint: buildSshInstallHint(),
      }
    } catch (error) {
      lastError = formatExecError(error, 'Failed to probe SSH CLI.')
    }
  }

  return {
    command: commands[0]?.command ?? 'ssh',
    args: commands[0]?.args ?? [],
    available: false,
    error: lastError ?? 'ssh command not found.',
    candidates: commands.map(formatCommandCandidate),
    install_hint: buildSshInstallHint(),
  }
}

export async function probeSshWorkspaceTarget(
  target: RemoteWorkspaceTarget,
  ssh: RemoteWorkspaceSshProbe,
): Promise<RemoteWorkspaceTargetProbe> {
  const checkedAt = new Date().toISOString()
  if (!ssh.available) {
    return {
      id: target.id,
      label: target.label,
      kind: target.kind,
      checked_at: checkedAt,
      reachable: false,
      endpoint: target.endpoint,
      command: [ssh.command, ...ssh.args].join(' '),
      error: ssh.error ?? 'SSH CLI is not available.',
    }
  }

  const parsed = parseSshEndpoint(target.endpoint)
  if (!parsed) {
    return {
      id: target.id,
      label: target.label,
      kind: target.kind,
      checked_at: checkedAt,
      reachable: false,
      endpoint: target.endpoint,
      error: 'Endpoint must use ssh://user@host:port.',
    }
  }

  const args = [
    ...ssh.args,
    '-o', 'BatchMode=yes',
    '-o', 'NumberOfPasswordPrompts=0',
    '-o', 'ConnectTimeout=4',
    '-o', 'LogLevel=ERROR',
    '-p', String(parsed.port),
    parsed.login,
    'echo homesense_ssh_probe',
  ]
  const command = [ssh.command, ...args.map((arg) => quoteArg(arg))].join(' ')

  try {
    const output = await execFileVersion(ssh.command, args, 8000)
    return {
      id: target.id,
      label: target.label,
      kind: target.kind,
      checked_at: checkedAt,
      reachable: output.includes('homesense_ssh_probe'),
      endpoint: target.endpoint,
      command,
      output: output.split(/\r?\n/).slice(0, 3).join('\n'),
    }
  } catch (error) {
    return {
      id: target.id,
      label: target.label,
      kind: target.kind,
      checked_at: checkedAt,
      reachable: false,
      endpoint: target.endpoint,
      command,
      error: formatExecError(error, 'SSH target probe failed.'),
    }
  }
}

export async function probeHttpWorkspaceTarget(target: RemoteWorkspaceTarget): Promise<RemoteWorkspaceTargetProbe> {
  const probe = await probeCodeServerEndpoint(target.endpoint)
  return {
    id: target.id,
    label: target.label,
    kind: target.kind,
    checked_at: new Date().toISOString(),
    reachable: probe.reachable,
    endpoint: target.endpoint,
    status_code: probe.status_code,
    error: probe.error,
    output: probe.state,
  }
}

async function probeCommandVersion(candidate: CommandCandidate, timeout: number): Promise<string> {
  const args = [...candidate.args, '--version']
  return execFileVersion(candidate.command, args, timeout)
}

async function execFileVersion(command: string, args: string[], timeout: number): Promise<string> {
  const result = await execFileAsync(command, args, {
    timeout,
    windowsHide: true,
    shell: process.platform === 'win32',
  })
  return String(result.stdout || result.stderr || '').trim()
}

async function waitForEndpointReady(
  endpoint: string,
  probeEndpoint: (endpoint: string) => Promise<RemoteWorkspaceEndpointProbe>,
  timeoutMs: number,
  pollMs: number,
): Promise<RemoteWorkspaceEndpointProbe> {
  const startedAt = Date.now()
  const deadline = startedAt + Math.max(0, timeoutMs)
  let lastProbe = await probeEndpoint(endpoint)
  while (!lastProbe.reachable && Date.now() < deadline) {
    await delay(Math.max(50, Math.min(pollMs, deadline - Date.now())))
    lastProbe = await probeEndpoint(endpoint)
  }
  return lastProbe
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describeEndpointProbe(probe: RemoteWorkspaceEndpointProbe): string {
  if (probe.reachable) return probe.state ? `state=${probe.state}` : 'reachable'
  if (probe.error) return probe.error
  if (probe.status_code != null) return `HTTP ${probe.status_code}`
  return 'health endpoint unreachable'
}

function workspaceOpenEndpoint(status: RemoteWorkspaceStatus): string {
  const endpoint = status.integration?.endpoint || DEFAULT_CODE_SERVER_ENDPOINT
  try {
    const url = new URL(endpoint)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.pathname = '/'
      url.search = ''
      url.hash = ''
      return url.toString().replace(/\/$/, '')
    }
  } catch {}
  return endpoint
}

function formatExecError(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback
  const record = error as { message?: unknown; stdout?: unknown; stderr?: unknown }
  const message = typeof record.message === 'string' ? record.message : fallback
  const output = String(record.stderr ?? record.stdout ?? '').trim()
  if (!output) return message
  const firstLine = output.split(/\r?\n/).find((line) => line.trim())?.trim()
  return firstLine ? `${message}: ${firstLine}` : message
}

function markRemoteWorkspaceEnabled(enabled: boolean): void {
  try {
    externalIntegrationsService.setEnabled('code-server-workspace', enabled)
  } catch {
    // Status write-back must not decide whether the sidecar launch itself succeeded.
  }
}

function defaultGetIntegration(): ExternalIntegrationRecord | null {
  return externalIntegrationsService.getByName('code-server-workspace')
}

function integrationToWorkspaceTarget(record: ExternalIntegrationRecord): RemoteWorkspaceTarget {
  const target = normalizeObject(record.metadata?.workspace_target)
  const auth = normalizeObject(record.metadata?.auth)
  const endpoint = String(record.endpoint ?? '').trim()
  return {
    id: `integration:${record.id}`,
    label: String(target.label ?? record.name ?? endpoint).trim(),
    kind: inferTargetKind(endpoint),
    endpoint,
    workspace_root: optionalText(target.workspace_root),
    source: 'external_integration',
    enabled: record.enabled,
    status: record.enabled ? 'registered' : 'offline',
    integration_id: record.id,
    capabilities: record.capability_ids,
    auth: {
      mode: String(auth.mode ?? 'target_host_key_or_token'),
      owner: String(auth.credentials_owned_by ?? 'target_host'),
      notes: String(auth.notes ?? 'Target auth remains external to HomeSense.'),
    },
  }
}

function inferTargetKind(endpoint: string): RemoteWorkspaceTargetKind {
  if (endpoint.startsWith('ssh://')) return 'ssh_host'
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) return 'http_workspace'
  if (endpoint.startsWith('internal://')) return 'local_service'
  return 'local_service'
}

function defaultTargetAuthMode(kind: RemoteWorkspaceTargetKind): string {
  if (kind === 'ssh_host') return 'ssh_key_or_agent'
  if (kind === 'http_workspace') return 'service_session_or_reverse_proxy'
  return 'service_password_or_reverse_proxy'
}

function capabilitiesForTargetKind(kind: RemoteWorkspaceTargetKind): string[] {
  if (kind === 'ssh_host') {
    return ['terminal.session.open', 'terminal.session.input', 'terminal.session.resize', 'terminal.session.close', 'terminal.ssh.connect', 'filesystem.tree']
  }
  if (kind === 'http_workspace') {
    return ['workspace.code_server.open', 'workspace.code_server.open_folder', 'workspace.code_server.open_terminal', 'filesystem.preview', 'filesystem.tree']
  }
  return ['workspace.code_server.open', 'terminal.session.open', 'filesystem.tree']
}

function actionsForTargetKind(kind: RemoteWorkspaceTargetKind) {
  if (kind === 'ssh_host') {
    return [
      { name: 'open_session', capability_id: 'terminal.session.open', description: 'Open a local or SSH terminal session.' },
      { name: 'send_input', capability_id: 'terminal.session.input', description: 'Send terminal input.' },
      { name: 'resize', capability_id: 'terminal.session.resize', description: 'Resize a terminal session.' },
      { name: 'close_session', capability_id: 'terminal.session.close', description: 'Close a terminal session.' },
    ]
  }
  if (kind === 'http_workspace') {
    return [
      { name: 'open_workspace', capability_id: 'workspace.code_server.open', description: 'Open the browser workspace entry.' },
      { name: 'open_folder', capability_id: 'workspace.code_server.open_folder', description: 'Open a workspace folder.' },
      { name: 'open_terminal', capability_id: 'workspace.code_server.open_terminal', description: 'Open an integrated terminal.' },
    ]
  }
  return [
    { name: 'open_workspace', capability_id: 'workspace.code_server.open', description: 'Open the workspace entry.' },
    { name: 'open_terminal', capability_id: 'terminal.session.open', description: 'Open a terminal surface.' },
  ]
}

function buildTargetIntegrationName(label: string, endpoint: string): string {
  const slug = `${label}-${endpoint}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `workspace-target-${slug || 'target'}`
}

function optionalText(value: unknown): string {
  return String(value ?? '').trim()
}

function clampDirectoryLimit(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DIRECTORY_ENTRY_LIMIT
  return Math.max(1, Math.min(MAX_DIRECTORY_ENTRY_LIMIT, Math.floor(parsed)))
}

function resolveWorkspacePath(root: string, inputPath: unknown): { workspacePath: string; absolutePath: string } {
  const raw = String(inputPath ?? '').trim()
  const cleaned = raw
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  const absolutePath = path.resolve(root, cleaned || '.')
  if (!isPathInside(root, absolutePath)) {
    throw new Error('Path must stay inside the workspace root.')
  }
  return {
    workspacePath: toWorkspacePath(path.relative(root, absolutePath)),
    absolutePath,
  }
}

function isPathInside(root: string, target: string): boolean {
  const normalizedRoot = normalizeForPathCompare(path.resolve(root))
  const normalizedTarget = normalizeForPathCompare(path.resolve(target))
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
}

function normalizeForPathCompare(value: string): string {
  const normalized = path.normalize(value)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function buildFileEntry(root: string, absolutePath: string, dirent: Dirent): Promise<RemoteWorkspaceFileEntry> {
  let stats: Stats | null = null
  try {
    stats = await fs.promises.lstat(absolutePath)
  } catch {}
  return {
    name: dirent.name,
    path: toWorkspacePath(path.relative(root, absolutePath)),
    type: direntToFileType(dirent),
    size: stats && stats.isFile() ? stats.size : null,
    modified_at: stats?.mtime ? stats.mtime.toISOString() : null,
  }
}

function direntToFileType(dirent: Dirent): RemoteWorkspaceFileEntry['type'] {
  if (dirent.isDirectory()) return 'directory'
  if (dirent.isFile()) return 'file'
  if (dirent.isSymbolicLink()) return 'symlink'
  return 'other'
}

function toWorkspacePath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  return normalized === '.' ? '' : normalized
}

async function readFilePreviewBytes(filePath: string): Promise<{ bytes: Buffer; truncated: boolean }> {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(MAX_FILE_PREVIEW_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return {
      bytes: buffer.subarray(0, bytesRead),
      truncated: bytesRead > MAX_FILE_PREVIEW_BYTES,
    }
  } finally {
    await handle.close()
  }
}

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false
  const sampleSize = Math.min(buffer.length, 4096)
  for (let index = 0; index < sampleSize; index += 1) {
    if (buffer[index] === 0) return true
  }
  return false
}

function defaultWorkspaceRoot(): string {
  const cwd = process.cwd()
  if (path.basename(cwd) === 'backend' && path.basename(path.dirname(cwd)) === 'packages') {
    return path.resolve(cwd, '..', '..')
  }
  return cwd
}

function resolveBindAddr(endpoint: string): string {
  const direct = String(process.env.HOMESENSE_CODE_SERVER_BIND_ADDR ?? process.env.CODE_SERVER_BIND_ADDR ?? '').trim()
  if (direct) return direct
  try {
    const url = new URL(endpoint)
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    return `${url.hostname}:${port}`
  } catch {
    return DEFAULT_CODE_SERVER_BIND_ADDR
  }
}

function resolveUserDataDir(): string {
  return String(
    process.env.HOMESENSE_CODE_SERVER_USER_DATA_DIR
    ?? process.env.CODE_SERVER_USER_DATA_DIR
    ?? path.join(os.homedir(), '.homesense', 'code-server'),
  )
}

function normalizeAuthMode(value: string): 'password' | 'none' {
  return value === 'none' ? 'none' : 'password'
}

interface CommandCandidate {
  command: string
  args: string[]
}

function buildCodeServerCommandCandidates(includeNpxFallback = false): CommandCandidate[] {
  const configured = String(
    process.env.HOMESENSE_CODE_SERVER_COMMAND
    ?? process.env.CODE_SERVER_COMMAND
    ?? '',
  ).trim()
  const candidates: CommandCandidate[] = []
  if (configured) candidates.push(parseCommandCandidate(configured))

  if (process.platform === 'win32') {
    candidates.push({ command: 'code-server', args: [] })
  } else {
    candidates.push({ command: 'code-server', args: [] })
  }

  const localBin = process.platform === 'win32'
    ? path.resolve(defaultWorkspaceRoot(), 'node_modules', '.bin', 'code-server.cmd')
    : path.resolve(defaultWorkspaceRoot(), 'node_modules', '.bin', 'code-server')
  candidates.push({ command: localBin, args: [] })

  if (process.platform === 'win32') {
    if (includeNpxFallback || allowNpxFallback()) candidates.push({ command: 'npx.cmd', args: ['--yes', 'code-server'] })
  } else {
    if (includeNpxFallback || allowNpxFallback()) candidates.push({ command: 'npx', args: ['--yes', 'code-server'] })
  }

  return uniqueCandidates(candidates)
}

function buildSshCommandCandidates(): CommandCandidate[] {
  const configured = String(process.env.HOMESENSE_SSH_COMMAND ?? process.env.SSH_COMMAND ?? '').trim()
  const candidates: CommandCandidate[] = []
  if (configured) candidates.push(parseCommandCandidate(configured))

  if (process.platform === 'win32') {
    candidates.push({ command: path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe'), args: [] })
  }
  candidates.push({ command: 'ssh', args: [] })

  return uniqueCandidates(candidates)
}

function parseCommandCandidate(commandLine: string): CommandCandidate {
  const parts = commandLine.match(/"[^"]+"|'[^']+'|\S+/g) ?? [commandLine]
  const [command, ...args] = parts.map((part) => part.replace(/^['"]|['"]$/g, ''))
  return { command: command || 'code-server', args }
}

function uniqueCandidates(candidates: CommandCandidate[]): CommandCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = formatCommandCandidate(candidate)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatCommandCandidate(candidate: CommandCandidate): string {
  return [candidate.command, ...candidate.args].join(' ')
}

function buildInstallHint(): string {
  return 'Install code-server or set HOMESENSE_CODE_SERVER_COMMAND. Status probes do not run npx by default; explicit start verifies npx --yes code-server as a fallback.'
}

function buildSshInstallHint(): string {
  return 'Install OpenSSH client or set HOMESENSE_SSH_COMMAND. Target probes use BatchMode and do not request passwords interactively.'
}

function allowNpxFallback(): boolean {
  const value = String(process.env.HOMESENSE_CODE_SERVER_ALLOW_NPX ?? process.env.CODE_SERVER_ALLOW_NPX ?? '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

function buildLaunchCommand(command: string, baseArgs: string[], endpoint: string, workspaceRoot: string): string {
  const bindAddr = resolveBindAddr(endpoint)
  const auth = normalizeAuthMode(process.env.HOMESENSE_CODE_SERVER_AUTH ?? DEFAULT_CODE_SERVER_AUTH)
  const dataDir = resolveUserDataDir()
  return [
    command,
    ...baseArgs.map((arg) => quoteArg(arg)),
    '--bind-addr', bindAddr,
    '--auth', auth,
    '--user-data-dir', quoteArg(dataDir),
    '--disable-telemetry',
    quoteArg(workspaceRoot),
  ].join(' ')
}

function selectLaunchPlan(cli: RemoteWorkspaceCliProbe): { command: string; args: string[] } {
  return { command: cli.command, args: cli.args }
}

function resolveLocalShell(): { command: string; args: string[] } {
  const configured = String(process.env.HOMESENSE_LOCAL_SHELL ?? process.env.SHELL ?? '').trim()
  if (configured) {
    const candidate = parseCommandCandidate(configured)
    return {
      command: candidate.command,
      args: candidate.args,
    }
  }
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    return {
      command: path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoLogo'],
    }
  }
  return {
    command: '/bin/bash',
    args: ['-l'],
  }
}

function parseSshEndpoint(endpoint: string): { login: string; host: string; port: number } | null {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'ssh:' || !url.hostname) return null
    const username = decodeURIComponent(url.username || '').trim()
    const host = url.hostname
    const port = Number(url.port || 22)
    if (!Number.isFinite(port) || port <= 0) return null
    return {
      login: username ? `${username}@${host}` : host,
      host,
      port,
    }
  } catch {
    return null
  }
}

function quoteArg(value: string): string {
  if (!value) return '""'
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

function buildReadiness(
  integration: ExternalIntegrationRecord | null,
  endpoint: RemoteWorkspaceEndpointProbe,
  cli: RemoteWorkspaceCliProbe,
): RemoteWorkspaceStatus['readiness'] {
  if (!integration) return 'missing'
  if (integration.enabled && endpoint.reachable && cli.available) return 'ready'
  if (endpoint.reachable || cli.available) return 'partial'
  return 'registered'
}

function buildAuthSummary(integration: ExternalIntegrationRecord | null): RemoteWorkspaceStatus['auth'] {
  const auth = normalizeObject(integration?.metadata?.auth)
  return {
    mode: String(auth.mode ?? 'service_password_or_reverse_proxy'),
    independent: true,
    owner: String(auth.credentials_owned_by ?? 'code-server'),
    notes: String(auth.notes ?? 'Code-server keeps its own login or reverse proxy session.'),
  }
}

function normalizeHttpUrl(endpoint: string): string | null {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function buildHealthUrl(endpoint: string): string {
  try {
    return new URL('/healthz', endpoint).toString()
  } catch {
    return endpoint
  }
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function parseProbeBody(body: string): { state?: string; lastHeartbeat?: number | null } {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const state = typeof parsed.status === 'string' ? parsed.status : undefined
    const lastHeartbeat = typeof parsed.lastHeartbeat === 'number' ? parsed.lastHeartbeat : null
    return { state, lastHeartbeat }
  } catch {
    return {}
  }
}
