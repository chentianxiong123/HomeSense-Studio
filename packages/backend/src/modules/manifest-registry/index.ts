import { agentAdapterRegistry } from '../agent-adapter/index.js'
import { cliBridge, type CLIBridge } from '../cli-bridge/index.js'
import { serviceRegistry } from '../service-registry/index.js'
import { channelRegistry } from '../channels/index.js'

export type ExecutorKind = 'cli' | 'agent' | 'a2a' | 'service' | 'channel'

export interface ExecutorActionSpec {
  name: string
  description?: string
  params_schema?: Record<string, { type: string; required: boolean; default?: unknown; description?: string }>
}

export interface UnifiedExecutorManifest {
  id: string
  kind: ExecutorKind
  display_name: string
  description: string
  capabilities: string[]
  protocol: 'process_json_arg' | 'process_stdin_json' | 'in_process_module' | 'jsonrpc_http' | 'in_process_service'
  transport: 'local_cli' | 'local_agent' | 'remote_bridge' | 'a2a_http' | 'in_process'
  status: 'ready' | 'planned' | 'disabled' | 'dry_run'
  configured: boolean
  timeout_ms?: number
  endpoint_env?: string
  actions: ExecutorActionSpec[]
  sample_invocation?: Record<string, unknown>
}

interface ServiceRegistryInstance {
  list(): Array<{ name: string; description: string; schema?: { fields?: Record<string, unknown> } }>
}

interface AgentAdapterRegistryInstance {
  list(): Array<{
    id: string; display_name: string; description: string; capabilities: string[]
    execution_modes: string[]; payload_schema?: Record<string, { type: string; required: boolean; description?: string; default?: unknown }>
    adapter_binding?: { kind: string; endpoint_env?: string }
    runtime_status?: { mode: string; configured: boolean; endpoint_env?: string }
    sample_dispatch: { task: string; payload: Record<string, unknown>; execution_mode: string }
    transport: 'local_cli' | 'local_agent' | 'remote_bridge' | 'a2a_http'
    status: 'ready' | 'planned' | 'disabled'
  }>
}

interface ChannelRegistryInstance {
  list(): Array<{ name: string; display_name: string; description: string }>
}

function normalizeParamsSchema(
  raw: Record<string, string> | undefined,
): Record<string, { type: string; required: boolean }> | undefined {
  if (!raw) return undefined
  const out: Record<string, { type: string; required: boolean }> = {}
  for (const [key, rawType] of Object.entries(raw)) {
    const optional = rawType.endsWith('?')
    out[key] = {
      type: optional ? rawType.slice(0, -1) : rawType,
      required: !optional,
    }
  }
  return out
}

export class ManifestRegistryService {
  constructor(
    private readonly cliBridge: CLIBridge = cliBridge,
    private readonly agentAdapterRegistry: AgentAdapterRegistryInstance = agentAdapterRegistry,
    private readonly serviceRegistry: ServiceRegistryInstance = serviceRegistry,
    private readonly channelRegistry: ChannelRegistryInstance = channelRegistry,
  ) {}

  list(): UnifiedExecutorManifest[] {
    return [
      ...this.buildCliManifests(),
      ...this.buildAgentManifests(),
      ...this.buildServiceManifests(),
    ].sort((a, b) => a.id.localeCompare(b.id))
  }

  listByKind(kind: ExecutorKind): UnifiedExecutorManifest[] {
    return this.list().filter((m) => m.kind === kind)
  }

  get(id: string): UnifiedExecutorManifest | undefined {
    return this.list().find((m) => m.id === id)
  }

  summary(): {
    total: number
    by_kind: Record<ExecutorKind, number>
    configured: number
  } {
    const all = this.list()
    const by_kind: Record<ExecutorKind, number> = {
      cli: 0,
      agent: 0,
      a2a: 0,
      service: 0,
      channel: 0,
    }
    let configured = 0
    for (const m of all) {
      by_kind[m.kind] += 1
      if (m.configured) configured += 1
    }
    return { total: all.length, by_kind, configured }
  }

  private buildCliManifests(): UnifiedExecutorManifest[] {
    return this.cliBridge.listExecutors().map((executor) => {
      const actions: ExecutorActionSpec[] = executor.action_details.map((detail) => ({
        name: detail.name,
        description: detail.description,
        params_schema: normalizeParamsSchema(detail.params_schema),
      }))
      return {
        id: `cli.${executor.name}`,
        kind: 'cli' as const,
        display_name: executor.name,
        description: `CLI executor ${executor.name} (${executor.source}).`,
        capabilities: [],
        protocol: executor.protocol,
        transport: 'local_cli',
        status: 'ready',
        configured: true,
        timeout_ms: executor.timeout_ms,
        actions,
        sample_invocation: actions[0]
          ? { cli_name: executor.name, action: actions[0].name, params: {} }
          : undefined,
      }
    })
  }

  private buildAgentManifests(): UnifiedExecutorManifest[] {
    return this.agentAdapterRegistry.list().map((adapter) => {
      const binding = adapter.adapter_binding
      const isA2A = binding?.kind === 'a2a'
      const baseParamsSchema: Record<string, { type: string; required: boolean; description?: string; default?: unknown }> = {
        task: { type: 'string', required: true, description: '任务描述（自然语言）' },
        payload: { type: 'object', required: false, description: '结构化负载' },
        execution_mode: {
          type: 'string',
          required: false,
          default: adapter.execution_modes[0],
          description: adapter.execution_modes.join(' / '),
        },
      }
      return {
        id: `agent.${adapter.id}`,
        kind: isA2A ? 'a2a' : 'agent',
        display_name: adapter.display_name,
        description: adapter.description,
        capabilities: adapter.capabilities,
        protocol: isA2A ? 'jsonrpc_http' : 'in_process_module',
        transport: adapter.transport,
        status:
          adapter.runtime_status?.mode === 'a2a_dry_run'
            ? 'dry_run'
            : adapter.status,
        configured: adapter.runtime_status?.configured ?? false,
        endpoint_env: adapter.runtime_status?.endpoint_env,
        actions: adapter.execution_modes.map((mode) => ({
          name: `dispatch.${mode}`,
          description: `Dispatch task to ${adapter.display_name} in ${mode} mode.`,
          params_schema: {
            ...baseParamsSchema,
            execution_mode: { type: 'string', required: false, default: mode, description: 'fixed by action' },
            ...(adapter.payload_schema
              ? Object.fromEntries(
                  Object.entries(adapter.payload_schema).map(([key, def]) => [
                    `payload.${key}`,
                    def,
                  ]),
                )
              : {}),
          },
        })),
        sample_invocation: {
          target: adapter.id,
          task: adapter.sample_dispatch.task,
          payload: adapter.sample_dispatch.payload,
          execution_mode: adapter.sample_dispatch.execution_mode,
        },
      }
    })
  }

  private buildServiceManifests(): UnifiedExecutorManifest[] {
    const channelsByName = new Map(this.channelRegistry.list().map((channel) => [channel.name, channel]))
    return this.serviceRegistry.list().map((service) => {
      const channel = channelsByName.get(service.name)
      const isChannel = Boolean(channel)
      const fields = service.schema?.fields ?? {}
      const params_schema: Record<string, { type: string; required: boolean; description?: string; default?: unknown }> = {}
      for (const [key, def] of Object.entries(fields)) {
        params_schema[key] = {
          type: typeof (def as { default?: unknown }).default === 'string' ? 'string' : 'unknown',
          required: (def as { required: boolean }).required,
          description: (def as { description?: string }).description,
          default: (def as { default?: unknown }).default,
        }
      }
      return {
        id: `${isChannel ? 'channel' : 'service'}.${service.name}`,
        kind: isChannel ? 'channel' : 'service',
        display_name: channel?.display_name ?? service.name,
        description: channel?.description || service.description || service.name,
        capabilities: [],
        protocol: 'in_process_service',
        transport: 'in_process',
        status: 'ready',
        configured: true,
        actions: [
          {
            name: 'invoke',
            description: service.description || undefined,
            params_schema: Object.keys(params_schema).length > 0 ? params_schema : undefined,
          },
        ],
        sample_invocation: { service_name: service.name, params: {} },
      }
    })
  }
}

export const manifestRegistry = new ManifestRegistryService()