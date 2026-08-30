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

const skillAsset: AssetRecord = {
  id: 'skill:adb.launch',
  kind: 'skill',
  title: 'ADB Launch',
  badge: 'Skill',
  subtitle: 'inline · disk',
  description: 'Launch Android packages',
  status: 'enabled',
  updatedAt: '2026-05-02T10:00:00.000Z',
  route: '/assets/skills/adb.launch/overview',
  searchText: 'adb launch',
  accent: '#7c3aed',
  meta: {
    contextMode: 'inline',
    tools: ['adb-cli'],
  },
}

describe('buildFilterCounts', () => {
  it('returns stable counts for all and each asset kind', () => {
    const counts = buildFilterCounts([
      skillAsset,
      { ...skillAsset, id: 'skill:device.tv_box' },
      { ...skillAsset, id: 'plan:x', kind: 'plan' },
    ])

    expect(counts).toEqual({
      all: 3,
      device_skill: 0,
      skill: 2,
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
    expect(formatAssetKind('agent', label)).toBe('遗留配置|Legacy Config')
    expect(formatAssetKind('device_skill', label)).toBe('设备技能|Device Skill')
    expect(formatAssetBadge(skillAsset, label)).toBe('技能|Skill')
    expect(formatAssetBadge({ ...skillAsset, kind: 'manifest', badge: 'CLI' }, label)).toBe('CLI')
  })
})

describe('buildAssetPreviewFacts', () => {
  it('builds skill-specific preview facts with shared overview fields', () => {
    const facts = buildAssetPreviewFacts(skillAsset, label)

    expect(facts).toEqual([
      { label: '类型|Type', value: '技能|Skill' },
      { label: '状态|Status', value: '启用|Enabled' },
      { label: '上下文模式|Context Mode', value: 'inline' },
      { label: '工具数量|Tools', value: '1' },
      { label: '最近时间|Updated', value: '2026-05-02T10:00:00.000Z' },
    ])
  })
})

describe('buildAssetActionLinks', () => {
  it('gives asset registry entries a single detail route', () => {
    expect(buildAssetActionLinks(skillAsset, label)).toEqual([
      { label: '进入详情|Open Detail', route: '/assets/skills/adb.launch/overview' },
    ])
  })
})
