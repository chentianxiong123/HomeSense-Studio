import { describe, expect, it } from 'vitest'
import { RuntimeCapabilityMapService } from './index.js'

describe('RuntimeCapabilityMapService', () => {
  it('aggregates real registry-shaped capability surfaces into one map', async () => {
    const service = new RuntimeCapabilityMapService(
      {
        list: () => [
          {
            id: 'cli.dlna-cast-cli',
            kind: 'cli',
            display_name: 'dlna-cast-cli',
            description: 'DLNA casting executor.',
            capabilities: [],
            protocol: 'in_process_module',
            transport: 'local_cli',
            status: 'ready',
            configured: true,
            actions: [
              { name: 'health' },
              { name: 'discover_devices' },
              { name: 'start_cast' },
            ],
            sample_invocation: { cli_name: 'dlna-cast-cli', action: 'health', params: {} },
          },
          {
            id: 'cli.speaker-cast-cli',
            kind: 'cli',
            display_name: 'speaker-cast-cli',
            description: 'Speaker casting executor.',
            capabilities: [],
            protocol: 'in_process_module',
            transport: 'local_cli',
            status: 'ready',
            configured: true,
            actions: [
              { name: 'health' },
              { name: 'list_speakers' },
              { name: 'play_bilibili' },
            ],
            sample_invocation: { cli_name: 'speaker-cast-cli', action: 'health', params: {} },
          },
        ],
      },
      async () => ({
        version: 1,
        generated_at: '2026-05-31T00:00:00.000Z',
        include_capabilities: 'summary',
        devices: [
          {
            id: 7,
            name: '客厅机顶盒',
            device_type: 'tv_box',
            room: { id: 1, name: '客厅' },
            sources: ['adb'],
            bindings: { mi_did: null, adb_ip: '192.168.31.253:5555', ip_address: '192.168.31.253' },
            network: { ping_target: '192.168.31.253', online: null, checked: false, method: 'none' },
            display: { icon: 'tv', title: '客厅机顶盒', subtitle: '客厅 · tv_box', status: 'unknown' },
            capability_count: 1,
            capabilities: [
              {
                capability_id: 'adb.ui_tree',
                name: '界面元素',
                kind: 'property',
                source: 'adb',
                risk: 'normal',
                required_fields: [],
                input_schema: { type: 'object' },
                output_schema: { type: 'object' },
                sample_arguments: {},
              },
            ],
          },
        ],
      }),
      {
        list: () => [
          {
            type: 'executor_call',
            label: 'Executor Call',
            category: 'control',
            description: 'Invoke a shared executor.',
            default_config: { executor_name: 'cli.invoke', params: {} },
            config_schema: [{ key: 'executor_name', control: 'text' }],
            output_schema: [{ key: 'result', type: 'object' }],
          },
        ],
      },
      {
        listProviders: (category?: string) => category === 'vision'
          ? [{ id: 1, name: 'vision-provider', api_base: 'https://example.test', api_key: 'secret', category: 'vision', enabled: true, extra_config: {} }]
          : [],
        listModels: (_providerId?: number, category?: string) => category === 'vision'
          ? [{ id: 2, provider_id: 1, model_name: 'vision-model', category: 'vision', is_default: true, enabled: true }]
          : [],
        getDefaultModel: (category: string) => {
          if (category !== 'vision') throw new Error('missing')
          return { id: 2, provider_id: 1, model_name: 'vision-model', category: 'vision', is_default: true, enabled: true }
        },
      },
      {
        listSkills: () => [
          {
            name: 'dlna-cast-cli',
            description: 'DLNA cast instructions.',
            prompt_template: '',
            allowed_tools_json: '["cli.invoke"]',
            action_schema_json: '{}',
            context_mode: 'inline',
            source: 'disk',
            skill_root: 'skills/dlna-cast-cli',
            enabled: true,
          },
          {
            name: 'speaker-cast-cli',
            description: 'Speaker cast instructions.',
            prompt_template: '',
            allowed_tools_json: '["cli.invoke"]',
            action_schema_json: '{}',
            context_mode: 'inline',
            source: 'disk',
            skill_root: 'skills/speaker-cast-cli',
            enabled: true,
          },
        ],
      },
    )

    const map = await service.build()

    expect(map.summary.by_domain).toMatchObject({
      executor: 2,
      device: 1,
      provider: 4,
      workflow_node: 1,
      skill: 2,
    })
    expect(map.surfaces.find((surface) => surface.id === 'cli.dlna-cast-cli')).toMatchObject({
      domain: 'executor',
      action_count: 3,
      tags: expect.arrayContaining(['dlna', 'cast']),
      sample_invocation: { cli_name: 'dlna-cast-cli', action: 'health', params: {} },
    })
    expect(map.surfaces.find((surface) => surface.id === 'cli.speaker-cast-cli')).toMatchObject({
      domain: 'executor',
      action_count: 3,
      tags: expect.arrayContaining(['speaker', 'cast', 'bilibili']),
    })
    expect(map.surfaces.find((surface) => surface.id === 'device.7')).toMatchObject({
      domain: 'device',
      action_count: 1,
      actions: [expect.objectContaining({ name: 'adb.ui_tree' })],
    })
    expect(map.surfaces.find((surface) => surface.id === 'provider.vision')).toMatchObject({
      domain: 'provider',
      configured: true,
      actions: [expect.objectContaining({ name: 'vision-model' })],
    })
    expect(map.surfaces.find((surface) => surface.id === 'skill.dlna-cast-cli')).toMatchObject({
      domain: 'skill',
      actions: [{ name: 'cli.invoke' }],
    })
  })
})
