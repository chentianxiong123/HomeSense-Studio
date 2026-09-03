export type AssetKind = 'device_skill' | 'skill' | 'manifest' | 'plan' | 'agent'
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

export interface DeviceSkillAssetSource {
  id: string
  asset_type: 'device_skill'
  device_type: string
  title: string
  summary: string
  status: 'active' | 'draft'
  load_policy: string
  when_to_load: string[]
  preferred_tools: string[]
  common_paths: Array<{ intent: string; steps: string[] }>
  argument_rules: Record<string, string>
  failure_recovery: string[]
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
  meta?: Record<string, unknown>
}

export interface AssetSummary {
  total: number
  deviceSkills: number
  skills: number
  manifests: number
  plans: number
  agents: number
  published: number
  ready: number
}

export interface StudioAssetPayload {
  deviceSkills: DeviceSkillAssetSource[]
  skills: SkillAssetSource[]
  manifests: ManifestAssetSource[]
  plans: PlanAssetSource[]
  agents: AgentAssetSource[]
}

const ASSET_ACCENTS: Record<AssetKind, string> = {
  device_skill: '#10b981',
  skill: '#7c3aed',
  manifest: '#2563eb',
  plan: '#d97706',
  agent: '#0891b2',
}

export function buildAssetRecords(payload: StudioAssetPayload): AssetRecord[] {
  const records: AssetRecord[] = [
    ...payload.deviceSkills.map((skill) => ({
      id: skill.id,
      kind: 'device_skill' as const,
      title: skill.title,
      badge: 'Device Skill',
      subtitle: [skill.device_type, skill.load_policy].join(' · '),
      description: skill.summary,
      status: skill.status,
      updatedAt: '',
      route: `/assets/device-skills/${encodeURIComponent(skill.id)}/overview`,
      searchText: `${skill.title} ${skill.device_type} ${skill.summary} ${skill.when_to_load.join(' ')}`.toLowerCase(),
      accent: ASSET_ACCENTS.device_skill,
      meta: {
        deviceType: skill.device_type,
        loadPolicy: skill.load_policy,
        triggers: skill.when_to_load,
        preferredTools: skill.preferred_tools,
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
    deviceSkills: countByKind(assets, 'device_skill'),
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
