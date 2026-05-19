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
  workflow: ['工作流', 'Workflow'],
  skill: ['技能', 'Skill'],
  manifest: ['执行清单', 'Manifest'],
  plan: ['计划', 'Plan'],
  agent: ['智能体', 'Agent'],
}

export function buildFilterCounts(assets: AssetRecord[]): Record<AssetFilter, number> {
  return {
    all: assets.length,
    workflow: countKind(assets, 'workflow'),
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

  if (asset.kind === 'workflow') {
    facts.push({
      label: label('触发方式', 'Trigger'),
      value: String(asset.meta?.triggerType ?? '-'),
    })
    facts.push({
      label: label('节点 / 边', 'Nodes / Edges'),
      value: `${asset.workflowGraph?.nodes.length ?? 0} / ${asset.workflowGraph?.edges.length ?? 0}`,
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
  if (asset.kind === 'workflow') {
    const workflowId = asset.id.replace('workflow:', '')
    return [
      { label: label('概览', 'Overview'), route: `/studio/workflows/${workflowId}/overview` },
      { label: label('编排器', 'Editor'), route: `/studio/workflows/${workflowId}/editor` },
      { label: label('运行记录', 'Runs'), route: `/studio/workflows/${workflowId}/runs` },
    ]
  }

  return [{ label: label('进入详情', 'Open Detail'), route: asset.route }]
}

function countKind(assets: AssetRecord[], kind: AssetKind): number {
  return assets.filter((asset) => asset.kind === kind).length
}
