import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLIBridge } from './cli-bridge.js'
import { ManifestRegistryService } from '../registry/index.js'
import { ExecutorGatewayService } from '../executor-gateway/index.js'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const skillsDir = path.resolve(moduleDir, '../../../../../skills')
const offlineBaseUrl = 'http://127.0.0.1:9'

function loadBridge(): CLIBridge {
  const bridge = new CLIBridge()
  bridge.loadDiskExecutors(skillsDir)
  return bridge
}

describe('casting CLI integration', () => {
  it('loads DLNA and speaker casting as separate disk CLI executors', () => {
    const bridge = loadBridge()
    const dlna = bridge.listExecutors().find((item) => item.name === 'dlna-cast-cli')
    const speaker = bridge.listExecutors().find((item) => item.name === 'speaker-cast-cli')

    expect(dlna).toEqual(expect.objectContaining({
      name: 'dlna-cast-cli',
      source: 'third_party',
      protocol: 'in_process_module',
    }))
    expect(dlna?.actions).toEqual(expect.arrayContaining([
      'health',
      'discover_devices',
      'start_cast',
      'control_cast',
      'cast_status',
    ]))

    expect(speaker).toEqual(expect.objectContaining({
      name: 'speaker-cast-cli',
      source: 'third_party',
      protocol: 'in_process_module',
    }))
    expect(speaker?.actions).toEqual(expect.arrayContaining([
      'health',
      'list_speakers',
      'play_bilibili',
      'control_playback',
      'set_volume',
    ]))
  })

  it('reports bridge health without pretending the external bilibili-music service is online', async () => {
    const bridge = loadBridge()

    const result = await bridge.run('dlna-cast-cli', 'health', { base_url: offlineBaseUrl })

    expect(result.status).toBe('success')
    expect(result.data).toEqual(expect.objectContaining({
      ready: true,
      adapter: 'bilibili_music',
      base_url: offlineBaseUrl,
      service_reachable: false,
    }))
  })

  it('returns an explicit unavailable error for real casting actions when the source service is offline', async () => {
    const bridge = loadBridge()

    const result = await bridge.run('dlna-cast-cli', 'discover_devices', { base_url: offlineBaseUrl })

    expect(result.status).toBe('error')
    if (result.status !== 'error') throw new Error('expected casting offline error')
    expect(result.error).toBe('CAST_SERVICE_UNAVAILABLE')
    expect(result.message).toContain(offlineBaseUrl)
  })

  it('appears in the unified manifest registry as two CLI capability surfaces', () => {
    const bridge = loadBridge()
    const registry = new ManifestRegistryService(
      bridge,
      emptyAgentRegistry,
      emptyServiceRegistry,
      emptyChannelRegistry,
    )

    const dlna = registry.get('cli.dlna-cast-cli')
    const speaker = registry.get('cli.speaker-cast-cli')

    expect(dlna).toEqual(expect.objectContaining({
      id: 'cli.dlna-cast-cli',
      kind: 'cli',
      display_name: 'dlna-cast-cli',
      transport: 'local_cli',
      configured: true,
    }))
    expect(dlna?.actions.map((action) => action.name)).toEqual(expect.arrayContaining([
      'discover_devices',
      'start_cast',
    ]))

    expect(speaker).toEqual(expect.objectContaining({
      id: 'cli.speaker-cast-cli',
      kind: 'cli',
      display_name: 'speaker-cast-cli',
      transport: 'local_cli',
      configured: true,
    }))
    expect(speaker?.actions.map((action) => action.name)).toEqual(expect.arrayContaining([
      'list_speakers',
      'play_bilibili',
    ]))
  })

  it('can be invoked through the shared executor gateway cli.invoke path', async () => {
    const bridge = loadBridge()
    const gateway = new ExecutorGatewayService(
      bridge,
      emptyAgentGatewayRegistry,
      emptyServiceRegistry,
      emptyPlanLibrary,
      emptyMemoryKernel,
    )
    await gateway.initialize()

    const result = await gateway.invoke('cli.invoke', {
      cli_name: 'speaker-cast-cli',
      action: 'health',
      params: { base_url: offlineBaseUrl },
    })

    expect(result.status).toBe('success')
    expect(result.data).toEqual(expect.objectContaining({
      status: 'success',
      data: expect.objectContaining({
        ready: true,
        service_reachable: false,
      }),
    }))
  })
})

const emptyAgentRegistry = {
  list: () => [],
}

const emptyAgentGatewayRegistry = {
  listEnabledTargets: () => [],
  buildDispatchTemplate: () => ({}),
  get: () => undefined,
}

const emptyServiceRegistry = {
  list: () => [],
  call: async () => ({}),
}

const emptyChannelRegistry = {
  list: () => [],
}

const emptyPlanLibrary = {
  listPlans: () => [],
  getPlan: () => undefined,
}

const emptyMemoryKernel = {
  observeOutcome: () => undefined,
}
