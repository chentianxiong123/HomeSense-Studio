import { describe, expect, it } from 'vitest'
import type { AssetRecord } from './assets'
import {
  buildAssetActionLinks,
  buildAssetPreviewFacts,
  buildFilterCounts,
  formatAssetBadge,
  formatAssetKind,
  formatAssetStatus,
} from './assetWorkbench'

const label = (zh: string, en: string) => `${zh}|${en}`

const workflowAsset: AssetRecord = {
  id: 'workflow:9',
  kind: 'workflow',
  title: 'Watch Bilibili On Toshiba TV Demo',
  badge: 'Workflow',
  subtitle: 'chat · Published',
  description: 'Intent -> TV flow',
  status: 'published',
  updatedAt: '2026-05-02T10:00:00.000Z',
  route: '/studio/workflows/9/overview',
  searchText: 'watch bilibili',
  accent: '#1f7a4f',
  workflowGraph: {
    nodes: [{ id: 1, type: 'start', label: 'Start' }],
    edges: [],
  },
  meta: {
    triggerType: 'chat',
    published: true,
  },
}

describe('buildFilterCounts', () => {
  it('returns stable counts for all and each asset kind', () => {
    const counts = buildFilterCounts([
      workflowAsset,
      { ...workflowAsset, id: 'skill:adb.launch', kind: 'skill' },
      { ...workflowAsset, id: 'plan:x', kind: 'plan' },
    ])

    expect(counts).toEqual({
      all: 3,
      workflow: 1,
      skill: 1,
      manifest: 0,
      plan: 1,
      agent: 0,
    })
  })
})

describe('formatAssetStatus', () => {
  it('maps known statuses and leaves unknown ones unchanged', () => {
    expect(formatAssetStatus('published', label)).toBe('已发布|Published')
    expect(formatAssetStatus('active', label)).toBe('运行中|Active')
    expect(formatAssetStatus('custom_state', label)).toBe('custom_state')
  })
})

describe('formatAssetKind / formatAssetBadge', () => {
  it('localizes first-class asset kinds and keeps protocol-like manifest badges stable', () => {
    expect(formatAssetKind('workflow', label)).toBe('工作流|Workflow')
    expect(formatAssetKind('agent', label)).toBe('智能体|Agent')
    expect(formatAssetBadge(workflowAsset, label)).toBe('工作流|Workflow')
    expect(formatAssetBadge({ ...workflowAsset, kind: 'manifest', badge: 'CLI' }, label)).toBe('CLI')
  })
})

describe('buildAssetPreviewFacts', () => {
  it('builds workflow-specific preview facts with shared overview fields', () => {
    const facts = buildAssetPreviewFacts(workflowAsset, label)

    expect(facts).toEqual([
      { label: '类型|Type', value: '工作流|Workflow' },
      { label: '状态|Status', value: '已发布|Published' },
      { label: '触发方式|Trigger', value: 'chat' },
      { label: '节点 / 边|Nodes / Edges', value: '1 / 0' },
      { label: '最近时间|Updated', value: '2026-05-02T10:00:00.000Z' },
    ])
  })
})

describe('buildAssetActionLinks', () => {
  it('gives workflows overview/editor/runs entrypoints and shallow assets a single detail route', () => {
    expect(buildAssetActionLinks(workflowAsset, label)).toEqual([
      { label: '概览|Overview', route: '/studio/workflows/9/overview' },
      { label: '编排器|Editor', route: '/studio/workflows/9/editor' },
      { label: '运行记录|Runs', route: '/studio/workflows/9/runs' },
    ])

    const skill = {
      ...workflowAsset,
      id: 'skill:adb.launch',
      kind: 'skill',
      route: '/assets/skills/adb.launch/overview',
    } as AssetRecord

    expect(buildAssetActionLinks(skill, label)).toEqual([
      { label: '进入详情|Open Detail', route: '/assets/skills/adb.launch/overview' },
    ])
  })
})
