import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExternalIntegrationRecord } from '../external-integrations/index.js'
import { RemoteWorkspaceService, probeSourceKernel } from './index.js'

function makeIntegration(overrides: Partial<ExternalIntegrationRecord> = {}): ExternalIntegrationRecord {
  return {
    id: 6,
    name: 'code-server-workspace',
    kind: 'local_service',
    endpoint: 'http://127.0.0.1:8080',
    description: 'code-server',
    capability_ids: [],
    actions: [],
    enabled: false,
    metadata: {
      auth: {
        mode: 'service_password_or_reverse_proxy',
        credentials_owned_by: 'code-server',
        notes: 'Code-server keeps its own login.',
      },
    },
    created_at: '2026-06-01 00:00:00',
    updated_at: '2026-06-01 00:00:00',
    ...overrides,
  }
}

function makeSshProbe(overrides: Partial<{ available: boolean; version: string; error: string }> = {}) {
  return {
    command: 'ssh',
    args: [],
    available: false,
    error: 'missing',
    candidates: ['ssh'],
    install_hint: 'install',
    ...overrides,
  }
}

describe('RemoteWorkspaceService', () => {
  afterEach(() => {
    new RemoteWorkspaceService().shutdown()
  })

  it('reports the source-level workspace kernel scaffold instead of a container fallback', async () => {
    const kernel = await probeSourceKernel()

    expect(kernel.mode).toBe('source_embedded')
    expect(kernel.name).toBe('homesense-source-workspace-kernel')
    expect(kernel.source_path).toContain('remote-workspace')
    expect(kernel.notes.join(' ')).toContain('Container runtime wrappers')
  })

  it('reports ready when the sidecar is enabled and both probes pass', async () => {
    const service = new RemoteWorkspaceService({
      getIntegration: () => makeIntegration({ enabled: true }),
      probeEndpoint: async (endpoint) => ({
        url: `${endpoint.replace(/\/$/, '')}/healthz`,
        reachable: true,
        status_code: 200,
      }),
      probeCli: async () => ({
        command: 'code-server',
        args: [],
        available: true,
        version: '4.95.3',
        candidates: ['code-server'],
        install_hint: 'install',
      }),
      probeSsh: async () => makeSshProbe({ available: true, version: 'OpenSSH_for_Windows_9.5p1' }),
      workspaceRoot: 'D:/files/HomeSense-Stdio',
      now: () => new Date('2026-06-01T03:00:00Z'),
    })

    const status = await service.getStatus()

    expect(status.integration_state).toBe('enabled')
    expect(status.readiness).toBe('ready')
    expect(status.endpoint.reachable).toBe(true)
    expect(status.cli.available).toBe(true)
    expect(status.launch.command).toContain('code-server --bind-addr 127.0.0.1:8080')
    expect(status.auth.mode).toBe('service_password_or_reverse_proxy')
  })

  it('reports missing when the integration is absent', async () => {
    const service = new RemoteWorkspaceService({
      getIntegration: () => null,
      probeEndpoint: async () => ({
        url: 'http://127.0.0.1:8080/healthz',
        reachable: false,
        status_code: null,
      }),
      probeCli: async () => ({
        command: 'code-server',
        args: [],
        available: false,
        error: 'missing',
        candidates: ['code-server'],
        install_hint: 'install',
      }),
      probeSsh: async () => makeSshProbe(),
    })

    const status = await service.getStatus()

    expect(status.integration_state).toBe('missing')
    expect(status.readiness).toBe('missing')
    expect(status.integration).toBeNull()
  })

  it('lists the local code-server sidecar and registered workspace targets', async () => {
    const service = new RemoteWorkspaceService({
      getIntegration: () => makeIntegration({ enabled: true }),
      probeEndpoint: async (endpoint) => ({
        url: `${endpoint.replace(/\/$/, '')}/healthz`,
        reachable: true,
        status_code: 200,
        state: 'alive',
      }),
      probeCli: async () => ({
        command: 'code-server',
        args: [],
        available: false,
        error: 'missing',
        candidates: ['code-server'],
        install_hint: 'install',
      }),
      probeSsh: async () => makeSshProbe(),
      listIntegrations: () => [
        makeIntegration({
          id: 8,
          name: 'workspace-target-nas',
          endpoint: 'ssh://nas.local:22',
          enabled: true,
          capability_ids: ['terminal.ssh.connect', 'filesystem.tree'],
          metadata: {
            role: 'remote_workspace_target',
            workspace_target: {
              label: 'NAS',
              workspace_root: '/srv/homesense',
            },
            auth: {
              mode: 'ssh_key_or_agent',
              credentials_owned_by: 'target_host',
            },
          },
        }),
      ],
      workspaceRoot: 'D:/files/HomeSense-Stdio',
    })

    const targets = await service.listTargets()

    expect(targets[0]).toMatchObject({
      id: 'sidecar:code-server',
      kind: 'code_server',
      status: 'ready',
    })
    expect(targets[1]).toMatchObject({
      id: 'integration:8',
      label: 'NAS',
      kind: 'ssh_host',
      endpoint: 'ssh://nas.local:22',
      workspace_root: '/srv/homesense',
    })
  })

  it('registers and removes remote workspace targets through external integrations', async () => {
    const registerIntegration = vi.fn((input: any) => makeIntegration({
      id: 9,
      name: input.name,
      endpoint: input.endpoint,
      enabled: input.enabled,
      capability_ids: input.capability_ids,
      actions: input.actions,
      metadata: input.metadata,
    }))
    const removeIntegration = vi.fn(() => true)
    const service = new RemoteWorkspaceService({
      registerIntegration,
      removeIntegration,
    })

    const target = await service.registerTarget({
      label: 'Studio NAS',
      endpoint: 'ssh://studio-nas.local:22',
      workspace_root: '/data/workspace',
    })

    expect(target).toMatchObject({
      id: 'integration:9',
      label: 'Studio NAS',
      kind: 'ssh_host',
      endpoint: 'ssh://studio-nas.local:22',
    })
    expect(registerIntegration).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.stringContaining('workspace-target-studio-nas'),
      kind: 'local_service',
      capability_ids: expect.arrayContaining(['terminal.ssh.connect', 'filesystem.tree']),
      metadata: expect.objectContaining({ role: 'remote_workspace_target' }),
    }))
    expect(service.removeTarget('integration:9')).toBe(true)
    expect(removeIntegration).toHaveBeenCalledWith(9)
  })

  it('probes a registered SSH workspace target on demand', async () => {
    const probeSshTarget = vi.fn(async (target: any, ssh: any) => ({
      id: target.id,
      label: target.label,
      kind: target.kind,
      checked_at: '2026-06-01T03:00:00.000Z',
      reachable: true,
      endpoint: target.endpoint,
      command: `${ssh.command} -p 22 nas.local echo homesense_ssh_probe`,
      output: 'homesense_ssh_probe',
    }))
    const service = new RemoteWorkspaceService({
      getIntegration: () => makeIntegration({ enabled: true }),
      probeEndpoint: async (endpoint) => ({
        url: `${endpoint.replace(/\/$/, '')}/healthz`,
        reachable: false,
        status_code: null,
      }),
      probeCli: async () => ({
        command: 'code-server',
        args: [],
        available: false,
        error: 'missing',
        candidates: ['code-server'],
        install_hint: 'install',
      }),
      probeSsh: async () => makeSshProbe({ available: true, version: 'OpenSSH_9.5' }),
      probeSshTarget,
      listIntegrations: () => [
        makeIntegration({
          id: 8,
          name: 'workspace-target-nas',
          endpoint: 'ssh://nas.local:22',
          enabled: true,
          capability_ids: ['terminal.ssh.connect'],
          metadata: {
            role: 'remote_workspace_target',
            workspace_target: { label: 'NAS' },
            auth: { mode: 'ssh_key_or_agent' },
          },
        }),
      ],
    })

    const probe = await service.probeTarget('integration:8')

    expect(probe).toMatchObject({
      id: 'integration:8',
      label: 'NAS',
      kind: 'ssh_host',
      reachable: true,
    })
    expect(probeSshTarget).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'ssh://nas.local:22' }),
      expect.objectContaining({ available: true }),
    )
  })

  it('creates a local shell terminal launch from source kernel', async () => {
    const previous = process.env.HOMESENSE_LOCAL_SHELL
    process.env.HOMESENSE_LOCAL_SHELL = 'test-shell --login'
    try {
      const service = new RemoteWorkspaceService({
        workspaceRoot: 'D:/files/HomeSense-Stdio',
      })

      const launch = await service.createTerminalLaunch()

      expect(launch).toMatchObject({
        target_id: 'local:shell',
        label: 'Local Shell',
        kind: 'local_shell',
        command: 'test-shell',
        args: ['--login'],
      })
      expect(launch.cwd).toContain('HomeSense-Stdio')
    } finally {
      if (previous === undefined) {
        delete process.env.HOMESENSE_LOCAL_SHELL
      } else {
        process.env.HOMESENSE_LOCAL_SHELL = previous
      }
    }
  })

  it('creates an SSH terminal launch for a registered target', async () => {
    const service = new RemoteWorkspaceService({
      getIntegration: () => makeIntegration({ enabled: true }),
      probeEndpoint: async (endpoint) => ({
        url: `${endpoint.replace(/\/$/, '')}/healthz`,
        reachable: false,
        status_code: null,
      }),
      probeCli: async () => ({
        command: 'code-server',
        args: [],
        available: false,
        error: 'missing',
        candidates: ['code-server'],
        install_hint: 'install',
      }),
      probeSsh: async () => ({
        command: 'ssh',
        args: ['-F', 'D:/ssh/config'],
        available: true,
        version: 'OpenSSH_9.5',
        candidates: ['ssh'],
        install_hint: 'install',
      }),
      listIntegrations: () => [
        makeIntegration({
          id: 8,
          name: 'workspace-target-nas',
          endpoint: 'ssh://root@nas.local:2222',
          enabled: true,
          capability_ids: ['terminal.ssh.connect'],
          metadata: {
            role: 'remote_workspace_target',
            workspace_target: { label: 'NAS' },
            auth: { mode: 'ssh_key_or_agent' },
          },
        }),
      ],
      workspaceRoot: 'D:/files/HomeSense-Stdio',
    })

    const launch = await service.createTerminalLaunch({ target_id: 'integration:8' })

    expect(launch).toMatchObject({
      target_id: 'integration:8',
      label: 'NAS',
      kind: 'ssh_host',
      command: 'ssh',
    })
    expect(launch.args).toEqual(expect.arrayContaining(['-F', 'D:/ssh/config', '-tt', '-p', '2222', 'root@nas.local']))
  })

  it('lists and previews files from the local source workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'homesense-rw-'))
    fs.mkdirSync(path.join(root, 'dir-a'))
    fs.writeFileSync(path.join(root, 'dir-a', 'note.txt'), 'hello workspace\n')
    fs.writeFileSync(path.join(root, 'README.md'), '# HomeSense\n')

    const service = new RemoteWorkspaceService({
      workspaceRoot: root,
    })

    const tree = await service.listFiles({ path: '' })
    expect(tree.target_id).toBe('local:source')
    expect(tree.root).toBe(path.resolve(root))
    expect(tree.entries.map((entry) => entry.name)).toEqual(expect.arrayContaining(['dir-a', 'README.md']))
    expect(tree.entries[0].type).toBe('directory')

    const preview = await service.readFile({ path: 'README.md' })
    expect(preview.encoding).toBe('utf8')
    expect(preview.content).toContain('HomeSense')
    expect(preview.path).toBe('README.md')

    fs.rmSync(root, { recursive: true, force: true })
  })

  it('rejects filesystem access outside the workspace root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'homesense-rw-'))
    const service = new RemoteWorkspaceService({ workspaceRoot: root })

    await expect(service.listFiles({ path: '../outside' })).rejects.toThrow('Path must stay inside the workspace root.')

    fs.rmSync(root, { recursive: true, force: true })
  })

  it('starts and stops a detected code-server sidecar', async () => {
    const processHandle = new EventEmitter() as any
    processHandle.pid = 4321
    processHandle.exitCode = null
    processHandle.kill = vi.fn(() => true)
    processHandle.unref = vi.fn()
    const spawnProcess = vi.fn(() => processHandle)

    const service = new RemoteWorkspaceService({
      getIntegration: () => makeIntegration({ enabled: true }),
      probeCli: async () => ({
        command: 'npx',
        args: ['--yes', 'code-server'],
        available: true,
        version: '4.95.3',
        candidates: ['npx --yes code-server'],
        install_hint: 'install',
      }),
      probeEndpoint: async (endpoint) => ({
        url: `${endpoint.replace(/\/$/, '')}/healthz`,
        reachable: true,
        status_code: 200,
        state: 'alive',
      }),
      spawnProcess,
      workspaceRoot: 'D:/files/HomeSense-Stdio',
    })

    const started = await service.start()
    expect(started.status).toBe('started')
    expect(started.pid).toBe(4321)
    expect(started.command).toContain('npx --yes code-server --bind-addr')
    expect(spawnProcess).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['--yes', 'code-server', '--bind-addr', '127.0.0.1:8080']),
      expect.objectContaining({
        cwd: expect.stringContaining('HomeSense-Stdio'),
        shell: process.platform === 'win32',
      }),
    )
    expect(processHandle.unref).toHaveBeenCalled()
    expect(started.endpoint?.reachable).toBe(true)

    const stopped = await service.stop()
    expect(stopped.status).toBe('stopped')
    expect(processHandle.kill).toHaveBeenCalled()
  })

  it('falls back to npx when code-server is missing', async () => {
    const processHandle = new EventEmitter() as any
    processHandle.pid = 9876
    processHandle.exitCode = null
    processHandle.kill = vi.fn(() => true)
    processHandle.unref = vi.fn()
    const spawnProcess = vi.fn(() => processHandle)

    const service = new RemoteWorkspaceService({
      getIntegration: () => makeIntegration({ enabled: true }),
      probeCli: async () => ({
        command: 'code-server',
        args: [],
        available: false,
        error: 'missing',
        candidates: ['code-server'],
        install_hint: 'install',
      }),
      probeNpx: async () => ({
        command: 'npx',
        args: ['--yes', 'code-server'],
        available: true,
        version: '10.9.7',
        candidates: ['npx --yes code-server'],
        install_hint: 'install',
      }),
      probeEndpoint: async (endpoint) => ({
        url: `${endpoint.replace(/\/$/, '')}/healthz`,
        reachable: true,
        status_code: 200,
        state: 'alive',
      }),
      spawnProcess,
      workspaceRoot: 'D:/files/HomeSense-Stdio',
    })

    const started = await service.start()
    expect(started.status).toBe('started')
    expect(started.command).toContain('npx --yes code-server --bind-addr')
    expect(spawnProcess).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['--yes', 'code-server', '--bind-addr', '127.0.0.1:8080']),
      expect.objectContaining({
        cwd: expect.stringContaining('HomeSense-Stdio'),
        shell: process.platform === 'win32',
      }),
    )

    const stopped = await service.stop()
    expect(stopped.status).toBe('stopped')
    expect(processHandle.kill).toHaveBeenCalled()
  })

  it('does not report started until the sidecar health endpoint is reachable', async () => {
    const processHandle = new EventEmitter() as any
    processHandle.pid = 2468
    processHandle.exitCode = null
    processHandle.kill = vi.fn(() => true)
    processHandle.unref = vi.fn()
    const spawnProcess = vi.fn(() => processHandle)

    const service = new RemoteWorkspaceService({
      getIntegration: () => makeIntegration({ enabled: true }),
      probeCli: async () => ({
        command: 'code-server',
        args: [],
        available: true,
        version: '4.95.3',
        candidates: ['code-server'],
        install_hint: 'install',
      }),
      probeSsh: async () => makeSshProbe(),
      probeEndpoint: async (endpoint) => ({
        url: `${endpoint.replace(/\/$/, '')}/healthz`,
        reachable: false,
        status_code: null,
        error: 'connection refused',
      }),
      spawnProcess,
      workspaceRoot: 'D:/files/HomeSense-Stdio',
      startReadyTimeoutMs: 0,
    })

    const result = await service.start()

    expect(result.status).toBe('starting')
    expect(result.endpoint?.reachable).toBe(false)
    expect(result.message).toContain('/healthz')

    const stopped = await service.stop()
    expect(stopped.status).toBe('stopped')
  })
})
