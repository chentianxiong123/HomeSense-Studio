import Fastify from 'fastify'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { remoteWorkspaceService } from './index.js'
import { remoteWorkspaceRoutes } from './routes.js'

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    const emitter = new EventEmitter()
    return {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn((handler: (data: string) => void) => {
        emitter.on('data', handler)
      }),
      onExit: vi.fn((handler: (event: { exitCode: number; signal?: number }) => void) => {
        emitter.on('exit', handler)
      }),
    }
  }),
}))

describe('remote workspace routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the remote workspace status envelope', async () => {
    vi.spyOn(remoteWorkspaceService, 'getStatus').mockResolvedValue({
      checked_at: '2026-06-01T03:00:00.000Z',
      integration_state: 'registered',
      integration: null,
      readiness: 'registered',
      endpoint: {
        url: 'http://127.0.0.1:8080/healthz',
        reachable: false,
        status_code: null,
      },
      cli: {
        command: 'code-server',
        args: [],
        available: false,
        candidates: ['code-server'],
        install_hint: 'install code-server',
      },
      kernel: {
        name: 'homesense-source-workspace-kernel',
        mode: 'source_embedded',
        available: true,
        source_path: 'D:/files/HomeSense-Stdio/packages/backend/src/modules/remote-workspace/index.ts',
        status: 'scaffolded',
        notes: ['Container runtime wrappers have been removed from the workspace path.'],
      },
      ssh: {
        command: 'ssh',
        args: [],
        available: true,
        version: 'OpenSSH_for_Windows_9.5p1',
        candidates: ['ssh'],
        install_hint: 'install ssh',
      },
      launch: {
        command: 'code-server --bind-addr 127.0.0.1:8080 "D:/files/HomeSense-Stdio"',
        cwd: 'D:/files/HomeSense-Stdio',
        notes: ['Use code-server as the browser workspace core.'],
      },
      reference: {
        name: 'coder/code-server',
        url: 'https://github.com/coder/code-server',
        docs_url: 'https://coder.com/docs/code-server/latest',
        healthcheck_url: 'https://github.com/coder/code-server/blob/main/docs/FAQ.md#what-is-the-healthz-endpoint',
      },
      auth: {
        mode: 'service_password_or_reverse_proxy',
        independent: true,
        owner: 'code-server',
        notes: 'Code-server keeps its own login.',
      },
    })

    const app = Fastify()
    await app.register(remoteWorkspaceRoutes)

    const response = await app.inject({
      method: 'GET',
      url: '/api/remote-workspace/status',
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      status: 'success',
      data: {
        reference: { name: 'coder/code-server' },
        auth: { independent: true },
      },
    })

    await app.close()
  })

  it('lists and registers remote workspace targets', async () => {
    vi.spyOn(remoteWorkspaceService, 'listTargets').mockResolvedValue([
      {
        id: 'sidecar:code-server',
        label: 'HomeSense code-server',
        kind: 'code_server',
        endpoint: 'http://127.0.0.1:8080',
        source: 'sidecar',
        enabled: true,
        status: 'ready',
        capabilities: ['workspace.code_server.open'],
        auth: {
          mode: 'service_password_or_reverse_proxy',
          owner: 'code-server',
          notes: 'Code-server keeps its own login.',
        },
      },
    ])
    vi.spyOn(remoteWorkspaceService, 'registerTarget').mockResolvedValue({
      id: 'integration:9',
      label: 'Studio NAS',
      kind: 'ssh_host',
      endpoint: 'ssh://studio-nas.local:22',
      workspace_root: '/srv/workspace',
      source: 'external_integration',
      enabled: true,
      status: 'registered',
      integration_id: 9,
      capabilities: ['terminal.ssh.connect'],
      auth: {
        mode: 'ssh_key_or_agent',
        owner: 'target_host',
        notes: 'Target auth remains external to HomeSense.',
      },
    })
    vi.spyOn(remoteWorkspaceService, 'removeTarget').mockReturnValue(true)

    const app = Fastify()
    await app.register(remoteWorkspaceRoutes)

    const list = await app.inject({
      method: 'GET',
      url: '/api/remote-workspace/targets',
    })
    expect(list.statusCode).toBe(200)
    expect(JSON.parse(list.body)).toMatchObject({
      status: 'success',
      data: [{ id: 'sidecar:code-server' }],
    })

    const create = await app.inject({
      method: 'POST',
      url: '/api/remote-workspace/targets',
      payload: {
        label: 'Studio NAS',
        endpoint: 'ssh://studio-nas.local:22',
        workspace_root: '/srv/workspace',
      },
    })
    expect(create.statusCode).toBe(200)
    expect(JSON.parse(create.body)).toMatchObject({
      status: 'success',
      data: { id: 'integration:9', kind: 'ssh_host' },
    })

    const remove = await app.inject({
      method: 'DELETE',
      url: '/api/remote-workspace/targets/integration:9',
    })
    expect(remove.statusCode).toBe(200)
    expect(JSON.parse(remove.body)).toMatchObject({
      status: 'success',
    })

    await app.close()
  })

  it('probes a remote workspace target', async () => {
    vi.spyOn(remoteWorkspaceService, 'probeTarget').mockResolvedValue({
      id: 'integration:8',
      label: 'NAS',
      kind: 'ssh_host',
      checked_at: '2026-06-01T03:00:00.000Z',
      reachable: true,
      endpoint: 'ssh://studio-nas.local:22',
      command: 'ssh -p 22 studio-nas.local echo homesense_ssh_probe',
      output: 'homesense_ssh_probe',
    })

    const app = Fastify()
    await app.register(remoteWorkspaceRoutes)

    const response = await app.inject({
      method: 'POST',
      url: '/api/remote-workspace/targets/integration:8/probe',
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({
      status: 'success',
      data: {
        id: 'integration:8',
        reachable: true,
      },
    })

    await app.close()
  })

  it('lists and previews local workspace files', async () => {
    vi.spyOn(remoteWorkspaceService, 'listFiles').mockResolvedValue({
      target_id: 'local:source',
      label: 'Local Source',
      kind: 'local_source',
      root: 'D:/files/HomeSense-Stdio',
      path: '',
      absolute_path: 'D:/files/HomeSense-Stdio',
      entries: [
        {
          name: 'README.md',
          path: 'README.md',
          type: 'file',
          size: 12,
          modified_at: '2026-06-01T03:00:00.000Z',
        },
      ],
      truncated: false,
    })
    vi.spyOn(remoteWorkspaceService, 'readFile').mockResolvedValue({
      target_id: 'local:source',
      label: 'Local Source',
      kind: 'local_source',
      root: 'D:/files/HomeSense-Stdio',
      path: 'README.md',
      absolute_path: 'D:/files/HomeSense-Stdio/README.md',
      name: 'README.md',
      size: 12,
      modified_at: '2026-06-01T03:00:00.000Z',
      encoding: 'utf8',
      content: '# HomeSense',
      truncated: false,
    })

    const app = Fastify()
    await app.register(remoteWorkspaceRoutes)

    const tree = await app.inject({
      method: 'GET',
      url: '/api/remote-workspace/filesystem/tree?path=',
    })
    expect(tree.statusCode).toBe(200)
    expect(JSON.parse(tree.body)).toMatchObject({
      status: 'success',
      data: { target_id: 'local:source' },
    })

    const file = await app.inject({
      method: 'GET',
      url: '/api/remote-workspace/filesystem/file?path=README.md',
    })
    expect(file.statusCode).toBe(200)
    expect(JSON.parse(file.body)).toMatchObject({
      status: 'success',
      data: { name: 'README.md', encoding: 'utf8' },
    })

    await app.close()
  })

  it('starts and stops the remote workspace sidecar through explicit routes', async () => {
    vi.spyOn(remoteWorkspaceService, 'start').mockResolvedValue({
      status: 'started',
      command: 'code-server --bind-addr 127.0.0.1:8080 "D:/files/HomeSense-Stdio"',
      cwd: 'D:/files/HomeSense-Stdio',
      pid: 4321,
    })
    vi.spyOn(remoteWorkspaceService, 'stop').mockResolvedValue({
      status: 'stopped',
      message: 'Stopped code-server process 4321.',
    })

    const app = Fastify()
    await app.register(remoteWorkspaceRoutes)

    const start = await app.inject({
      method: 'POST',
      url: '/api/remote-workspace/start',
    })
    expect(start.statusCode).toBe(200)
    expect(JSON.parse(start.body)).toMatchObject({
      status: 'success',
      data: { status: 'started', pid: 4321 },
    })

    const stop = await app.inject({
      method: 'POST',
      url: '/api/remote-workspace/stop',
    })
    expect(stop.statusCode).toBe(200)
    expect(JSON.parse(stop.body)).toMatchObject({
      status: 'success',
      data: { status: 'stopped' },
    })

    await app.close()
  })
})
