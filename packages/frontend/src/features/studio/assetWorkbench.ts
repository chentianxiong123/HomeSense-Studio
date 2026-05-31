import type { AssetFilter, AssetKind, AssetRecord } from './assets'

export type AssetActionLink = {
  label: string
  route: string
}

export type AssetPreviewFact = {
  label: string
  value: string
}

const STATUS_LABELS: Record<string, [string, string]> = {
  published: ['已发布', 'Published'],
  draft: ['草稿', 'Draft'],
  enabled: ['启用', 'Enabled'],
  disabled: ['停用', 'Disabled'],
  ready: ['就绪', 'Ready'],
  planned: ['规划中', 'Planned'],
  dry_run: ['演练', 'Dry Run'],
  active: ['运行中', 'Active'],
}

const KIND_LABELS: Record<AssetKind, [string, string]> = {
  device_skill: ['设备技能', 'Device Skill'],
  skill: ['技能', 'Skill'],
  manifest: ['记忆项', 'Memory Item'],
  plan: ['计划', 'Plan'],
  agent: ['遗留配置', 'Legacy Config'],
}

export function buildFilterCounts(assets: AssetRecord[]): Record<AssetFilter, number> {
  return {
    all: assets.length,
    device_skill: countKind(assets, 'device_skill'),
    skill: countKind(assets, 'skill'),
    manifest: countKind(assets, 'manifest'),
    plan: countKind(assets, 'plan'),
    agent: countKind(assets, 'agent'),
  }
}

export function formatAssetStatus(status: string, label: (zh: string, en: string) => string): string {
  const names = STATUS_LABELS[status]
  return names ? label(names[0], names[1]) : status
}

export function formatAssetKind(kind: AssetKind, label: (zh: string, en: string) => string): string {
  const names = KIND_LABELS[kind]
  return label(names[0], names[1])
}

export function formatAssetBadge(asset: AssetRecord, label: (zh: string, en: string) => string): string {
  if (asset.kind === 'manifest') return asset.badge
  return formatAssetKind(asset.kind, label)
}

export function buildAssetPreviewFacts(
  asset: AssetRecord,
  label: (zh: string, en: string) => string,
): AssetPreviewFact[] {
  const facts: AssetPreviewFact[] = [
    { label: label('类型', 'Type'), value: formatAssetBadge(asset, label) },
    { label: label('状态', 'Status'), value: formatAssetStatus(asset.status, label) },
  ]

  if (asset.kind === 'device_skill') {
    facts.push({
      label: label('设备类型', 'Device Type'),
      value: String(asset.meta?.deviceType ?? '-'),
    })
    facts.push({
      label: label('触发词', 'Triggers'),
      value: String(Array.isArray(asset.meta?.triggers) ? asset.meta.triggers.length : 0),
    })
  } else if (asset.kind === 'skill') {
    facts.push({
      label: label('上下文模式', 'Context Mode'),
      value: String(asset.meta?.contextMode ?? '-'),
    })
    facts.push({
      label: label('工具数量', 'Tools'),
      value: String(Array.isArray(asset.meta?.tools) ? asset.meta.tools.length : 0),
    })
  } else if (asset.kind === 'manifest') {
    facts.push({
      label: label('能力数', 'Capabilities'),
      value: String(Array.isArray(asset.meta?.capabilities) ? asset.meta.capabilities.length : 0),
    })
    facts.push({
      label: label('动作数', 'Actions'),
      value: String(Array.isArray(asset.meta?.actions) ? asset.meta.actions.length : 0),
    })
  } else if (asset.kind === 'plan') {
    facts.push({
      label: label('意图', 'Intent'),
      value: String(asset.meta?.intent ?? '-'),
    })
    facts.push({
      label: label('来源', 'Source'),
      value: String(asset.meta?.source ?? '-'),
    })
  } else if (asset.kind === 'agent') {
    facts.push({
      label: label('记忆域', 'Memory Scope'),
      value: String(asset.meta?.memoryScope ?? '-'),
    })
    facts.push({
      label: label('默认通道', 'Default Channel'),
      value: String(asset.meta?.defaultChannel ?? '-'),
    })
  }

  facts.push({
    label: label('最近时间', 'Updated'),
    value: asset.updatedAt || label('未提供', 'N/A'),
  })

  return facts
}

export function buildAssetActionLinks(
  asset: AssetRecord,
  label: (zh: string, en: string) => string,
): AssetActionLink[] {
  return [{ label: label('进入详情', 'Open Detail'), route: asset.route }]
}

function countKind(assets: AssetRecord[], kind: AssetKind): number {
  return assets.filter((asset) => asset.kind === kind).length
}
