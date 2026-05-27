import type { Workflow } from '@/api/workflow'

export type AssetKind = 'workflow' | 'skill' | 'manifest' | 'plan' | 'agent'
export type AssetFilter = 'all' | AssetKind

export interface SkillAssetSource {
  name: string
  description: string
  prompt_template: string
  allowed_tools_json: string
  action_schema_json: string
  context_mode: 'inline' | 'fork'
  source: 'builtin' | 'disk' | 'converted'
  skill_root: string
  enabled: boolean
}

export interface ManifestAssetSource {
  id: string
  kind: 'cli' | 'agent' | 'a2a' | 'service' | 'channel'
  display_name: string
  description: string
  capabilities: string[]
  protocol: string
  transport: string
  status: 'ready' | 'planned' | 'disabled' | 'dry_run'
  configured: boolean
  timeout_ms?: number
  endpoint_env?: string
  actions: Array<{
    name: string
    description?: string
    params_schema?: Record<string, unknown>
  }>
  sample_invocation?: Record<string, unknown>
}

export interface PlanAssetSource {
  id: string
  name: string
  description: string
  intent: string
  input: string
  source: string
}

export interface AgentAssetSource {
  id: number
  slug: string
  name: string
  profile: 'entertainment' | 'productivity' | 'maintainer' | 'remote_bot'
  surface: 'chat' | 'studio' | 'scheduler' | 'remote'
  memory_scope: string
  tool_scope_json: string
  default_channel: string
  status: string
}

export interface WorkflowGraphSnapshot {
  nodes: Array<{
    id?: number | string
    type: string
    label: string
    position?: { x: number; y: number }
  }>
  edges: Array<{
    source_node_id: number | string
    target_node_id: number | string
    source_port?: string
    target_port?: string
  }>
}

export interface AssetRecord {
  id: string
  kind: AssetKind
  title: string
  badge: string
  subtitle: string
  description: string
  status: string
  updatedAt: string
  route: string
  searchText: string
  accent: string
  workflowGraph?: WorkflowGraphSnapshot
  meta?: Record<string, unknown>
}

export interface AssetSummary {
  total: number
  workflows: number
  skills: number
  manifests: number
  plans: number
  agents: number
  published: number
  ready: number
}

export interface StudioAssetPayload {
  workflows: Workflow[]
  skills: SkillAssetSource[]
  manifests: ManifestAssetSource[]
  plans: PlanAssetSource[]
  agents: AgentAssetSource[]
}

const ASSET_ACCENTS: Record<AssetKind, string> = {
  workflow: '#1f7a4f',
  skill: '#7c3aed',
  manifest: '#2563eb',
  plan: '#d97706',
  agent: '#0891b2',
}

export function buildAssetRecords(payload: StudioAssetPayload): AssetRecord[] {
  const records: AssetRecord[] = [
    ...payload.workflows.map((workflow) => ({
      id: `workflow:${workflow.id}`,
      kind: 'workflow' as const,
      title: workflow.name,
      badge: 'Workflow',
      subtitle: [workflow.trigger_type, workflow.published ? 'Published' : 'Draft'].join(' · '),
      description: workflow.description || '',
      status: workflow.published ? 'published' : 'draft',
      updatedAt: workflow.updated_at || workflow.created_at || '',
      route: `/studio/workflows/${workflow.id}/overview`,
      searchText: `${workflow.name} ${workflow.description} ${workflow.trigger_type}`.toLowerCase(),
      accent: ASSET_ACCENTS.workflow,
      workflowGraph: parseWorkflowGraph(workflow.graph_json),
      meta: {
        triggerType: workflow.trigger_type,
        cronExpression: workflow.cron_expression,
        published: Boolean(workflow.published),
      },
    })),
    ...payload.skills.map((skill) => ({
      id: `skill:${skill.name}`,
      kind: 'skill' as const,
      title: skill.name,
      badge: 'Skill',
      subtitle: [skill.context_mode, skill.source].join(' · '),
      description: skill.description || '',
      status: skill.enabled ? 'enabled' : 'disabled',
      updatedAt: '',
      route: `/assets/skills/${encodeURIComponent(skill.name)}/overview`,
      searchText: `${skill.name} ${skill.description} ${skill.context_mode} ${skill.source}`.toLowerCase(),
      accent: ASSET_ACCENTS.skill,
      meta: {
        source: skill.source,
        contextMode: skill.context_mode,
        tools: safeParseJsonArray(skill.allowed_tools_json),
      },
    })),
    ...payload.manifests.map((manifest) => ({
      id: `manifest:${manifest.id}`,
      kind: 'manifest' as const,
      title: manifest.display_name,
      badge: manifest.kind.toUpperCase(),
      subtitle: [manifest.transport, manifest.protocol].filter(Boolean).join(' · '),
      description: manifest.description || '',
      status: manifest.status,
      updatedAt: '',
      route: `/assets/manifests/${encodeURIComponent(manifest.id)}/overview`,
      searchText: `${manifest.display_name} ${manifest.description} ${manifest.kind} ${manifest.capabilities.join(' ')}`.toLowerCase(),
      accent: ASSET_ACCENTS.manifest,
      meta: {
        configured: manifest.configured,
        capabilities: manifest.capabilities,
        actions: manifest.actions,
      },
    })),
    ...payload.plans.map((plan) => ({
      id: `plan:${plan.id}`,
      kind: 'plan' as const,
      title: plan.name,
      badge: 'Plan',
      subtitle: [plan.intent, plan.source].filter(Boolean).join(' · '),
      description: plan.description || '',
      status: 'ready',
      updatedAt: '',
      route: `/assets/plans/${encodeURIComponent(plan.id)}/overview`,
      searchText: `${plan.name} ${plan.description} ${plan.intent} ${plan.input} ${plan.source}`.toLowerCase(),
      accent: ASSET_ACCENTS.plan,
      meta: {
        intent: plan.intent,
        input: plan.input,
        source: plan.source,
      },
    })),
    ...payload.agents.map((agent) => ({
      id: `agent:${agent.slug}`,
      kind: 'agent' as const,
      title: agent.name,
      badge: 'Agent',
      subtitle: [agent.profile, agent.surface].join(' · '),
      description: `${agent.memory_scope} -> ${agent.default_channel}`,
      status: agent.status,
      updatedAt: '',
      route: `/assets/agents/${encodeURIComponent(agent.slug)}/overview`,
      searchText: `${agent.name} ${agent.slug} ${agent.profile} ${agent.surface} ${agent.memory_scope}`.toLowerCase(),
      accent: ASSET_ACCENTS.agent,
      meta: {
        slug: agent.slug,
        memoryScope: agent.memory_scope,
        defaultChannel: agent.default_channel,
        toolScope: safeParseJsonArray(agent.tool_scope_json),
      },
    })),
  ]

  return records.sort((left, right) => compareDate(right.updatedAt, left.updatedAt) || left.title.localeCompare(right.title))
}

export function filterAssetsByKind(assets: AssetRecord[], filter: AssetFilter): AssetRecord[] {
  if (filter === 'all') return assets
  return assets.filter((asset) => asset.kind === filter)
}

export function buildAssetSummary(assets: Array<Pick<AssetRecord, 'kind' | 'status'>>): AssetSummary {
  return {
    total: assets.length,
    workflows: countByKind(assets, 'workflow'),
    skills: countByKind(assets, 'skill'),
    manifests: countByKind(assets, 'manifest'),
    plans: countByKind(assets, 'plan'),
    agents: countByKind(assets, 'agent'),
    published: assets.filter((asset) => asset.status === 'published').length,
    ready: assets.filter((asset) => asset.status === 'ready' || asset.status === 'active').length,
  }
}

function countByKind(assets: Array<Pick<AssetRecord, 'kind'>>, kind: AssetKind): number {
  return assets.filter((asset) => asset.kind === kind).length
}

function parseWorkflowGraph(raw: string): WorkflowGraphSnapshot {
  try {
    const parsed = JSON.parse(raw) as Partial<WorkflowGraphSnapshot>
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    }
  } catch {
    return { nodes: [], edges: [] }
  }
}

function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function compareDate(left: string, right: string): number {
  const leftTime = left ? Date.parse(left) : 0
  const rightTime = right ? Date.parse(right) : 0
  return leftTime - rightTime
}
