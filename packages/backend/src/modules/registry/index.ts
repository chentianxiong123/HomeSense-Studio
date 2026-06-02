/**
 * Module: registry
 *
 * In-memory registries that the system looks things up in. This module
 * was the consolidation of three legacy modules:
 *   - service-registry  (named services with schema, fires events)
 *   - entity-registry   (entity definitions keyed by device)
 *   - manifest-registry (unified CLI/agent/service/channel manifest view)
 *
 * Noun: registry
 * Public surface: the three classes + their singleton instances + their types.
 * Internal helpers are `_`-prefixed.
 */

import { eventBus as defaultEventBus, HeartEvent } from '../event-bus/index.js'
import { stateMachine as defaultStateMachine } from '../state-machine/index.js'
import { cliBridge as defaultCliBridge, type CLIBridge } from '../integration/index.js'

// ============================================================================
// Service registry
// ============================================================================

export interface ServiceSchema {
  description: string
  fields: Record<string, {
    description: string
    required: boolean
    default?: unknown
  }>
}

export type ServiceHandler = (params: Record<string, unknown>) => Promise<unknown>

export interface ServiceInfo {
  name: string
  description: string
  schema?: ServiceSchema
}

interface EventBusInstance {
  fire(event: string, data?: unknown): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

interface StateMachineInstance {
  set(entityId: string, state: string, attributes?: Record<string, unknown>): void
  get(entityId: string): { state: string; attributes?: Record<string, unknown> } | undefined
}

export class ServiceRegistry {
  private services = new Map<string, { handler: ServiceHandler; schema?: ServiceSchema }>()

  constructor(
    private readonly eventBus: EventBusInstance = defaultEventBus,
    private readonly stateMachine: StateMachineInstance = defaultStateMachine,
  ) {}

  register(name: string, handler: ServiceHandler, schema?: ServiceSchema): void {
    this.services.set(name, { handler, schema })
    this.eventBus.fire(HeartEvent.SERVICE_REGISTERED, { name, schema })
  }

  async call(name: string, params: Record<string, unknown>): Promise<unknown> {
    const service = this.services.get(name)
    if (!service) {
      throw new Error(`Service not found: ${name}`)
    }

    if (service.schema) {
      for (const [fieldName, fieldDef] of Object.entries(service.schema.fields)) {
        if (fieldDef.required && params[fieldName] === undefined) {
          if (fieldDef.default !== undefined) {
            params[fieldName] = fieldDef.default
          } else {
            throw new Error(`Missing required field: ${fieldName}`)
          }
        }
      }
    }

    const result = await service.handler(params)
    this.eventBus.fire(HeartEvent.SERVICE_CALLED, { name, params })
    return result
  }

  list(): ServiceInfo[] {
    return Array.from(this.services.entries()).map(([name, { schema }]) => ({
      name,
      description: schema?.description ?? '',
      schema,
    }))
  }

  has(name: string): boolean {
    return this.services.has(name)
  }

  initialize(): void {
    // Device control handlers will be re-added later.
  }
}

export const serviceRegistry = new ServiceRegistry()
serviceRegistry.initialize()

// ============================================================================
// Entity registry
// ============================================================================

export interface EntityDef {
  entity_id: string
  device_did: string
  domain: string
  capability: string
  name: string
  icon: string
  enabled: boolean
}

export class EntityRegistry {
  private entities = new Map<string, EntityDef>()

  register(entity: EntityDef): void {
    this.entities.set(entity.entity_id, entity)
  }

  get(entityId: string): EntityDef | undefined {
    return this.entities.get(entityId)
  }

  getByDevice(deviceDid: string): EntityDef[] {
    return Array.from(this.entities.values()).filter((e) => e.device_did === deviceDid)
  }

  getAll(): EntityDef[] {
    return Array.from(this.entities.values())
  }

  remove(entityId: string): boolean {
    return this.entities.delete(entityId)
  }
}

export const entityRegistry = new EntityRegistry()

// ============================================================================
// Manifest registry (CLI / agent / service / channel unified view)
// ============================================================================

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

interface ServiceRegistryPort {
  list(): Array<{ name: string; description: string; schema?: { fields?: Record<string, unknown> } }>
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
    private readonly cliBridge: CLIBridge = defaultCliBridge,
    private readonly serviceRegistryPort: ServiceRegistryPort = serviceRegistry,
  ) {}

  list(): UnifiedExecutorManifest[] {
    return [
      ...this.buildCliManifests(),
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

  private buildServiceManifests(): UnifiedExecutorManifest[] {
    return this.serviceRegistryPort.list().map((service) => {
      const isChannel = false
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
        id: `service.${service.name}`,
        kind: 'service',
        display_name: service.name,
        description: service.description || service.name,
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
