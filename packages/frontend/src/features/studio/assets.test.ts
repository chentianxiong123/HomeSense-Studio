import { describe, expect, it } from 'vitest'
import { buildAssetRecords, buildAssetSummary, filterAssetsByKind, type AssetRecord } from './assets'

describe('buildAssetRecords', () => {
  it('normalizes mixed backend payloads into a single asset table ordered by updated activity', () => {
    const assets = buildAssetRecords({
      workflows: [
        {
          id: 9,
          name: 'Watch Bilibili On Toshiba TV Demo',
          description: 'Intent -> TV flow',
          trigger_type: 'chat',
          cron_expression: null,
          published: 1,
          graph_json: '{"nodes":[{"id":1,"type":"start","label":"Start","position":{"x":0,"y":0}}],"edges":[]}',
          created_at: '2026-05-01T09:00:00.000Z',
          updated_at: '2026-05-02T10:00:00.000Z',
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
      kind: 'workflow',
      id: 'workflow:9',
      title: 'Watch Bilibili On Toshiba TV Demo',
      status: 'published',
      route: '/studio/workflows/9/overview',
    })
    expect(assets[0].workflowGraph?.nodes).toHaveLength(1)

    expect(assets.find((asset) => asset.kind === 'skill')).toMatchObject({
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
      id: 'workflow:1',
      kind: 'workflow',
      title: 'A',
      badge: 'Workflow',
      subtitle: '',
      description: '',
      status: 'draft',
      updatedAt: '2026-05-02T00:00:00.000Z',
      route: '/studio/workflows/1/overview',
      searchText: 'a',
      accent: '#1f7a4f',
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
      { kind: 'workflow', status: 'published' },
      { kind: 'workflow', status: 'draft' },
      { kind: 'manifest', status: 'ready' },
      { kind: 'agent', status: 'active' },
    ] as Array<Pick<AssetRecord, 'kind' | 'status'>>)

    expect(summary.total).toBe(4)
    expect(summary.workflows).toBe(2)
    expect(summary.published).toBe(1)
    expect(summary.ready).toBe(2)
  })
})
