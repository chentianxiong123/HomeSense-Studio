import { eventBus as defaultEventBus, HeartEvent } from '../event-bus/index.js'
import { cliBridge as defaultCliBridge } from '../cli-bridge/index.js'
import { getDb as defaultGetDb } from '../../db/index.js'
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

type GetDbFn = () => ReturnType<typeof defaultGetDb>

interface EventBusInstance {
  fire(event: string, data?: unknown): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

interface CliBridgeInstance {
  run(cliName: string, action: string, params: Record<string, unknown>): Promise<unknown>
}

interface StateMachineInstance {
  set(entityId: string, state: string, attributes?: Record<string, unknown>): void
  get(entityId: string): { state: string; attributes?: Record<string, unknown> } | undefined
}

class ServiceRegistry {
  private services = new Map<string, { handler: ServiceHandler; schema?: ServiceSchema }>()

  constructor(
    private readonly eventBus: EventBusInstance = defaultEventBus,
    private readonly getDb: GetDbFn = defaultGetDb,
    private readonly cliBridge: CliBridgeInstance = defaultCliBridge,
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

  private getDidFromEntityId(entityId: string): string {
    const parts = entityId.split('.')
    if (parts.length >= 2) {
      return parts[1].split('_')[0] || parts[1]
    }
    return entityId
  }

  private getEntityFromDb(entityId: string) {
    const db = this.getDb()
    return db
      .prepare('SELECT e.*, df.siid, df.piid, df.aiid FROM entities e LEFT JOIN device_features df ON e.feature_id = df.id WHERE e.entity_id = ?')
      .get(entityId) as Record<string, unknown> | undefined
  }

  private createDeviceHandlers(): void {
    this.register('device_control.turn_on', async (params) => {
      const { entity_id } = params
      const entity = this.getEntityFromDb(entity_id as string)
      if (!entity) throw new Error(`Entity not found: ${entity_id}`)

      const did = (entity.device_did as string) || this.getDidFromEntityId(entity_id as string)
      const siid = Number(entity.siid ?? 2)
      const piid = Number(entity.piid ?? 1)

      const result = await this.cliBridge.run('mi-cli', 'set_prop', { did, siid, piid, value: true }) as { status: string; data?: Record<string, unknown> }
      if (result.status === 'success') {
        this.stateMachine.set(entity_id as string, 'on', { ...(result.data ?? {}) })
      }
      return result
    }, {
      description: '打开设备',
      fields: { entity_id: { description: '实体 ID', required: true } },
    })

    this.register('device_control.turn_off', async (params) => {
      const { entity_id } = params
      const entity = this.getEntityFromDb(entity_id as string)
      if (!entity) throw new Error(`Entity not found: ${entity_id}`)

      const did = (entity.device_did as string) || this.getDidFromEntityId(entity_id as string)
      const siid = Number(entity.siid ?? 2)
      const piid = Number(entity.piid ?? 1)

      const result = await this.cliBridge.run('mi-cli', 'set_prop', { did, siid, piid, value: false }) as { status: string; data?: Record<string, unknown> }
      if (result.status === 'success') {
        this.stateMachine.set(entity_id as string, 'off', { ...(result.data ?? {}) })
      }
      return result
    }, {
      description: '关闭设备',
      fields: { entity_id: { description: '实体 ID', required: true } },
    })

    this.register('device_control.set_value', async (params) => {
      const { entity_id, value } = params
      const entity = this.getEntityFromDb(entity_id as string)
      if (!entity) throw new Error(`Entity not found: ${entity_id}`)

      const did = (entity.device_did as string) || this.getDidFromEntityId(entity_id as string)
      const siid = Number(entity.siid ?? 2)
      const piid = Number(entity.piid ?? 1)

      const result = await this.cliBridge.run('mi-cli', 'set_prop', { did, siid, piid, value }) as { status: string; data?: Record<string, unknown> }
      if (result.status === 'success') {
        this.stateMachine.set(entity_id as string, String(value), { ...(result.data ?? {}) })
      }
      return result
    }, {
      description: '设置设备属性值',
      fields: {
        entity_id: { description: '实体 ID', required: true },
        value: { description: '目标值', required: true },
      },
    })

    this.register('device_control.get_state', async (params) => {
      const { entity_id } = params
      return this.stateMachine.get(entity_id as string)
    }, {
      description: '获取设备状态',
      fields: { entity_id: { description: '实体 ID', required: true } },
    })

    this.register('device_control.run_action', async (params) => {
      const { entity_id, siid, aiid, action_params } = params
      const entity = this.getEntityFromDb(entity_id as string)
      if (!entity) throw new Error(`Entity not found: ${entity_id}`)

      const did = (entity.device_did as string) || this.getDidFromEntityId(entity_id as string)
      return this.cliBridge.run('mi-cli', 'run_action', {
        did,
        siid: Number(siid ?? entity.siid ?? 2),
        aiid: Number(aiid ?? entity.aiid ?? 1),
        params: action_params ?? [],
      })
    }, {
      description: '执行设备动作',
      fields: {
        entity_id: { description: '实体 ID', required: true },
        siid: { description: 'Service ID', required: false },
        aiid: { description: 'Action ID', required: false },
        action_params: { description: '动作参数', required: false },
      },
    })
  }

  initialize(): void {
    this.createDeviceHandlers()
  }
}

export const serviceRegistry = new ServiceRegistry()
serviceRegistry.initialize()