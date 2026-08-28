import { eventBus as defaultEventBus, HeartEvent } from '../event-bus/index.js'
import { stateMachine as defaultStateMachine } from '../state-machine/index.js'

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

class ServiceRegistry {
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