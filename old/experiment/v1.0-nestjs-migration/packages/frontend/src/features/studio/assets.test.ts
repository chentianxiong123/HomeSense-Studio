import { describe, expect, it } from 'vitest'
import { buildAssetRecords, buildAssetSummary, filterAssetsByKind, type AssetRecord } from './assets'

describe('buildAssetRecords', () => {
  it('normalizes mixed backend payloads into a single asset table ordered by updated activity', () => {
    const assets = buildAssetRecords({
      deviceSkills: [
        {
          id: 'device_skill.tv_box',
          asset_type: 'device_skill',
          device_type: 'tv_box',
          title: '电视盒 / 机顶盒',
          summary: 'Operate Android TV boxes.',
          status: 'active',
          load_policy: 'on_device_type_match',
          when_to_load: ['看电视'],
          preferred_tools: ['device.rehearse'],
          common_paths: [],
          argument_rules: {},
          failure_recovery: [],
        },
      ],
      skills: [
        {
          name: 'adb.launch',
          description: 'Launch Android TV packages.',
          prompt_template: '',
          allowed_tools_json: '["adb-cli"]',
          action_schema_json: '[]',
          context_mode: 'inline',
          source: 'disk',
          skill_root: 'D:/skills/adb.launch',
          enabled: true,
        },
      ],
      manifests: [
        {
          id: 'cli.mi_adb',
          kind: 'cli',
          display_name: 'MI ADB CLI',
          description: 'ADB bridge',
          capabilities: ['packages', 'launch_app'],
          protocol: 'process_json_arg',
          transport: 'local_cli',
          status: 'ready',
          configured: true,
          actions: [{ name: 'launch_app' }],
        },
      ],
      plans: [
        {
          id: 'watch_bili',
          name: 'Watch Bili',
          description: 'Compiled TV route',
          intent: '看电视的B站',
          input: '看电视的B站',
          source: 'seed',
        },
      ],
      agents: [
        {
          id: 2,
          slug: 'studio-productivity',
          name: 'Studio Productivity Agent',
          profile: 'productivity',
          surface: 'studio',
          memory_scope: 'studio.productivity',
          tool_scope_json: '["workflow"]',
          default_channel: 'web',
          status: 'active',
        },
      ],
    })

    expect(assets).toHaveLength(5)
    expect(assets[0]).toMatchObject({
      kind: 'device_skill',
      id: 'device_skill.tv_box',
      title: '电视盒 / 机顶盒',
      status: 'active',
      route: '/assets/device-skills/device_skill.tv_box/overview',
    })

    expect(assets.find((asset) => asset.kind === 'skill')).toMatchObject({
      kind: 'skill',
      id: 'skill:adb.launch',
      badge: 'Skill',
      route: '/assets/skills/adb.launch/overview',
    })
    expect(assets.find((asset) => asset.kind === 'manifest')).toMatchObject({
      id: 'manifest:cli.mi_adb',
      badge: 'CLI',
      route: '/assets/manifests/cli.mi_adb/overview',
    })
  })
})

describe('filterAssetsByKind', () => {
  const fixtures: AssetRecord[] = [
    {
      id: 'skill:1',
      kind: 'skill',
      title: 'A',
      badge: 'Skill',
      subtitle: '',
      description: '',
      status: 'enabled',
      updatedAt: '2026-05-02T00:00:00.000Z',
      route: '/assets/skills/1/overview',
      searchText: 'a',
      accent: '#7c3aed',
    },
    {
      id: 'plan:x',
      kind: 'plan',
      title: 'B',
      badge: 'Plan',
      subtitle: '',
      description: '',
      status: 'ready',
      updatedAt: '2026-05-01T00:00:00.000Z',
      route: '/assets/plans/x/overview',
      searchText: 'b',
      accent: '#2563eb',
    },
  ]

  it('returns all assets for the all filter and narrows by specific kinds', () => {
    expect(filterAssetsByKind(fixtures, 'all')).toHaveLength(2)
    expect(filterAssetsByKind(fixtures, 'plan')).toEqual([fixtures[1]])
  })
})

describe('buildAssetSummary', () => {
  it('computes totals for the summary strip', () => {
    const summary = buildAssetSummary([
      { kind: 'skill', status: 'enabled' },
      { kind: 'device_skill', status: 'active' },
      { kind: 'plan', status: 'ready' },
      { kind: 'manifest', status: 'ready' },
      { kind: 'agent', status: 'active' },
    ] as Array<Pick<AssetRecord, 'kind' | 'status'>>)

    expect(summary.total).toBe(5)
    expect(summary.deviceSkills).toBe(1)
    expect(summary.skills).toBe(1)
    expect(summary.published).toBe(0)
    expect(summary.ready).toBe(4)
  })
})
