import { manifestRegistry as defaultManifestRegistry, type UnifiedExecutorManifest } from '../manifest-registry/index.js'
import { buildDeviceRuntimeManifest as defaultBuildDeviceRuntimeManifest, type DeviceRuntimeManifest } from '../device/device-runtime-manifest.js'
import { workflowNodeDefinitionRegistry as defaultWorkflowNodeDefinitionRegistry } from '../workflow/node-definitions.js'
import { llmService as defaultLlmService, type LLMModelConfig, type LLMProviderCategory, type LLMProviderConfig } from '../llm-provider/service.js'
import { skillsService as defaultSkillsService, type SkillDefinition } from '../skills-system/index.js'

export type RuntimeCapabilityDomain =
  | 'device'
  | 'executor'
  | 'provider'
  | 'workflow_node'
  | 'skill'

export interface RuntimeCapabilityAction {
  name: string
  description?: string
  params_schema?: Record<string, unknown>
  sample?: Record<string, unknown>
}

export interface RuntimeCapabilitySurface {
  id: string
  domain: RuntimeCapabilityDomain
  title: string
  description: string
  status: 'ready' | 'planned' | 'disabled' | 'dry_run' | 'offline' | 'unknown'
  configured: boolean
  action_count: number
  actions: RuntimeCapabilityAction[]
  tags: string[]
  usage_hint: string
  sample_invocation?: Record<string, unknown>
  metadata: Record<string, unknown>
}

export interface RuntimeCapabilityDomainSummary {
  domain: RuntimeCapabilityDomain
  title: string
  count: number
  action_count: number
  configured: number
}

export interface RuntimeCapabilityMap {
  version: number
  generated_at: string
  summary: {
    total_surfaces: number
    total_actions: number
    configured: number
    by_domain: Record<RuntimeCapabilityDomain, number>
  }
  domains: RuntimeCapabilityDomainSummary[]
  surfaces: RuntimeCapabilitySurface[]
}

export interface RuntimeCapabilityMapOptions {
  deviceLimit?: number
}

interface ManifestRegistryLike {
  list(): UnifiedExecutorManifest[]
}

interface WorkflowNodeDefinitionRegistryLike {
  list(): Array<{
    type: string
    label: string
    category: string
    description: string
    default_config: Record<string, unknown>
    config_schema: Array<{ key: string }>
    output_schema: unknown[]
  }>
}

interface LLMServiceLike {
  listProviders(category?: string): LLMProviderConfig[]
  listModels(providerId?: number, category?: string): LLMModelConfig[]
  getDefaultModel(category: string): LLMModelConfig
}

interface SkillsServiceLike {
  listSkills(): SkillDefinition[]
}

type DeviceManifestBuilder = (options?: {
  includeCapabilities?: 'none' | 'summary' | 'full'
  online?: boolean
  limit?: number
}) => Promise<DeviceRuntimeManifest>

const DOMAIN_TITLES: Record<RuntimeCapabilityDomain, string> = {
  device: 'Device Capabilities',
  executor: 'Executors',
  provider: 'Model Providers',
  workflow_node: 'Workflow Nodes',
  skill: 'Skills',
}

const PROVIDER_CATEGORIES: LLMProviderCategory[] = ['chat', 'embedding', 'rerank', 'vision']

export class RuntimeCapabilityMapService {
  constructor(
    private readonly manifestRegistry: ManifestRegistryLike = defaultManifestRegistry,
    private readonly buildDeviceRuntimeManifest: DeviceManifestBuilder = defaultBuildDeviceRuntimeManifest,
    private readonly workflowNodeDefinitions: WorkflowNodeDefinitionRegistryLike = defaultWorkflowNodeDefinitionRegistry,
    private readonly llmService: LLMServiceLike = defaultLlmService,
    private readonly skillsService: SkillsServiceLike = defaultSkillsService,
  ) {}

  async build(options: RuntimeCapabilityMapOptions = {}): Promise<RuntimeCapabilityMap> {
    const deviceLimit = clampNumber(options.deviceLimit ?? 30, 1, 200)
    const deviceManifest = await this.buildDeviceRuntimeManifest({
      includeCapabilities: 'summary',
      online: false,
      limit: deviceLimit,
    })

    const surfaces = [
      ...this.buildExecutorSurfaces(),
      ...this.buildDeviceSurfaces(deviceManifest),
      ...this.buildProviderSurfaces(),
      ...this.buildWorkflowNodeSurfaces(),
      ...this.buildSkillSurfaces(),
    ].sort((left, right) => left.domain.localeCompare(right.domain) || left.title.localeCompare(right.title))

    return {
      version: 1,
      generated_at: new Date().toISOString(),
      summary: this.buildSummary(surfaces),
      domains: this.buildDomainSummaries(surfaces),
      surfaces,
    }
  }

  private buildExecutorSurfaces(): RuntimeCapabilitySurface[] {
    return this.manifestRegistry.list().map((manifest) => {
      const actions = manifest.actions.map((action) => ({
        name: action.name,
        description: action.description,
        params_schema: action.params_schema,
      }))
      return {
        id: manifest.id,
        domain: 'executor' as const,
        title: manifest.display_name,
        description: manifest.description,
        status: manifest.status,
        configured: manifest.configured,
        action_count: actions.length,
        actions,
        tags: inferExecutorTags(manifest),
        usage_hint: manifest.kind === 'cli'
          ? `Invoke through cli.invoke with ${manifest.id.replace(/^cli\./, '')}.`
          : `Invoke through ${manifest.kind}.${manifest.display_name}.`,
        sample_invocation: manifest.sample_invocation,
        metadata: {
          kind: manifest.kind,
          protocol: manifest.protocol,
          transport: manifest.transport,
          endpoint_env: manifest.endpoint_env,
          timeout_ms: manifest.timeout_ms,
        },
      }
    })
  }

  private buildDeviceSurfaces(deviceManifest: DeviceRuntimeManifest): RuntimeCapabilitySurface[] {
    return deviceManifest.devices.map((device) => {
      const capabilities = Array.isArray(device.capabilities) ? device.capabilities : []
      const actions = capabilities.map((capability) => {
        const row = capability as {
          capability_id?: string
          name?: string
          input_schema?: Record<string, unknown>
          sample_arguments?: Record<string, unknown>
        }
        return {
          name: String(row.capability_id ?? row.name ?? ''),
          description: String(row.name ?? row.capability_id ?? ''),
          params_schema: row.input_schema,
          sample: row.sample_arguments,
        }
      }).filter((action) => action.name)
      const deviceStatus = device.display.status === 'online'
        ? 'ready'
        : device.display.status === 'offline'
          ? 'offline'
          : 'unknown'
      return {
        id: `device.${device.id}`,
        domain: 'device' as const,
        title: device.display.title || device.name,
        description: device.display.subtitle || `${device.device_type} device`,
        status: deviceStatus,
        configured: actions.length > 0,
        action_count: actions.length,
        actions,
        tags: compact([device.device_type, device.room.name, ...device.sources]),
        usage_hint: 'Use device_capability workflow nodes or device-agent tools after selecting this device.',
        metadata: {
          device_id: device.id,
          device_type: device.device_type,
          room: device.room,
          bindings: device.bindings,
          network: device.network,
          capability_count: device.capability_count,
        },
      }
    })
  }

  private buildProviderSurfaces(): RuntimeCapabilitySurface[] {
    return PROVIDER_CATEGORIES.map((category) => {
      const providers = this.llmService.listProviders(category)
      const models = this.llmService.listModels(undefined, category)
      const defaultModel = safeGetDefaultModel(this.llmService, category)
      const enabledModels = models.filter((model) => model.enabled)
      return {
        id: `provider.${category}`,
        domain: 'provider' as const,
        title: providerCategoryTitle(category),
        description: providerCategoryDescription(category),
        status: enabledModels.length > 0 ? 'ready' : 'planned',
        configured: enabledModels.length > 0,
        action_count: enabledModels.length,
        actions: enabledModels.map((model) => ({
          name: model.model_name,
          description: model.is_default ? 'default model' : undefined,
          sample: { model_id: model.id, category },
        })),
        tags: [category, 'llm', category === 'vision' ? 'multimodal' : 'model'],
        usage_hint: providerUsageHint(category),
        metadata: {
          category,
          provider_count: providers.length,
          model_count: models.length,
          enabled_model_count: enabledModels.length,
          default_model: defaultModel ? {
            id: defaultModel.id,
            provider_id: defaultModel.provider_id,
            model_name: defaultModel.model_name,
          } : null,
          providers: providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            enabled: provider.enabled,
            category: provider.category,
            has_api_base: Boolean(provider.api_base),
            has_api_key: Boolean(provider.api_key),
          })),
        },
      }
    })
  }

  private buildWorkflowNodeSurfaces(): RuntimeCapabilitySurface[] {
    return this.workflowNodeDefinitions.list().map((node) => ({
      id: `workflow_node.${node.type}`,
      domain: 'workflow_node' as const,
      title: node.label,
      description: node.description,
      status: 'ready' as const,
      configured: true,
      action_count: 1,
      actions: [{
        name: node.type,
        description: node.description,
        params_schema: Object.fromEntries(node.config_schema.map((field) => [String(field.key ?? ''), field])),
        sample: node.default_config,
      }],
      tags: [node.category, node.type],
      usage_hint: 'Use this as a Studio workflow node.',
      metadata: {
        node_type: node.type,
        category: node.category,
        output_schema: node.output_schema,
      },
    }))
  }

  private buildSkillSurfaces(): RuntimeCapabilitySurface[] {
    return this.skillsService.listSkills().map((skill) => {
      const allowedTools = parseJsonArray(skill.allowed_tools_json)
      const actionSchema = parseJsonObject(skill.action_schema_json)
      return {
        id: `skill.${skill.name}`,
        domain: 'skill' as const,
        title: skill.name,
        description: skill.description,
        status: skill.enabled ? 'ready' : 'disabled',
        configured: skill.enabled,
        action_count: allowedTools.length,
        actions: allowedTools.map((tool) => ({ name: tool })),
        tags: compact([skill.source, skill.context_mode, ...allowedTools]),
        usage_hint: 'Load progressively when the task needs this instruction set.',
        metadata: {
          source: skill.source,
          context_mode: skill.context_mode,
          skill_root: skill.skill_root,
          action_schema: actionSchema,
        },
      }
    })
  }

  private buildSummary(surfaces: RuntimeCapabilitySurface[]): RuntimeCapabilityMap['summary'] {
    const byDomain = emptyDomainCounts()
    let configured = 0
    let totalActions = 0
    for (const surface of surfaces) {
      byDomain[surface.domain] += 1
      totalActions += surface.action_count
      if (surface.configured) configured += 1
    }
    return {
      total_surfaces: surfaces.length,
      total_actions: totalActions,
      configured,
      by_domain: byDomain,
    }
  }

  private buildDomainSummaries(surfaces: RuntimeCapabilitySurface[]): RuntimeCapabilityDomainSummary[] {
    return (Object.keys(DOMAIN_TITLES) as RuntimeCapabilityDomain[]).map((domain) => {
      const items = surfaces.filter((surface) => surface.domain === domain)
      return {
        domain,
        title: DOMAIN_TITLES[domain],
        count: items.length,
        action_count: items.reduce((sum, item) => sum + item.action_count, 0),
        configured: items.filter((item) => item.configured).length,
      }
    })
  }
}

export const runtimeCapabilityMapService = new RuntimeCapabilityMapService()

function inferExecutorTags(manifest: UnifiedExecutorManifest): string[] {
  const text = `${manifest.id} ${manifest.display_name} ${manifest.description} ${manifest.actions.map((action) => action.name).join(' ')}`.toLowerCase()
  const tags: string[] = [manifest.kind, manifest.transport]
  if (text.includes('cast') || text.includes('dlna')) tags.push('dlna', 'cast')
  if (text.includes('speaker')) tags.push('speaker')
  if (text.includes('music') || text.includes('bilibili')) tags.push('music', 'bilibili')
  if (text.includes('adb')) tags.push('adb')
  if (text.includes('mi')) tags.push('mi')
  return unique(tags)
}

function safeGetDefaultModel(service: LLMServiceLike, category: LLMProviderCategory): LLMModelConfig | null {
  try {
    return service.getDefaultModel(category)
  } catch {
    return null
  }
}

function providerCategoryTitle(category: LLMProviderCategory): string {
  if (category === 'chat') return 'Chat LLM'
  if (category === 'embedding') return 'Embedding Model'
  if (category === 'rerank') return 'Rerank Model'
  return 'Vision Model'
}

function providerCategoryDescription(category: LLMProviderCategory): string {
  if (category === 'chat') return 'Main conversational and agent reasoning model providers.'
  if (category === 'embedding') return 'Vector embedding providers for retrieval and memory indexing.'
  if (category === 'rerank') return 'Rerank providers for candidate ordering.'
  return 'Multimodal image understanding providers for screen and app-map analysis.'
}

function providerUsageHint(category: LLMProviderCategory): string {
  if (category === 'vision') return 'Use for screenshot understanding after UI tree or text lookup is insufficient.'
  if (category === 'embedding') return 'Use for vector recall and future multimodal gallery indexing.'
  if (category === 'rerank') return 'Use after lexical/vector recall to reorder candidate hits.'
  return 'Use as the primary Chat and agent reasoning model.'
}

function emptyDomainCounts(): Record<RuntimeCapabilityDomain, number> {
  return {
    device: 0,
    executor: 0,
    provider: 0,
    workflow_node: 0,
    skill: 0,
  }
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function compact(values: Array<string | null | undefined>): string[] {
  return unique(values.map((value) => String(value ?? '').trim()).filter(Boolean))
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}
