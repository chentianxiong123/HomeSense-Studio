import { eventBus } from '../event-bus/index.js'
import { cliBridge } from '../cli-bridge/index.js'
import { getDb } from '../../db/index.js'
import { stateMachine } from '../state-machine/index.js'

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

class ServiceRegistry {
  private services = new Map<string, { handler: ServiceHandler; schema?: ServiceSchema }>()

  register(name: string, handler: ServiceHandler, schema?: ServiceSchema): void {
    this.services.set(name, { handler, schema })
    eventBus.fire('service_registered', { name, schema })
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
    eventBus.fire('service_called', { name, params })
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
}

export const serviceRegistry = new ServiceRegistry()

function getDidFromEntityId(entityId: string): string {
  const parts = entityId.split('.')
  if (parts.length >= 2) {
    return parts[1].split('_')[0] || parts[1]
  }
  return entityId
}

function getEntityFromDb(entityId: string) {
  const db = getDb()
  return db
    .prepare('SELECT e.*, df.siid, df.piid, df.aiid FROM entities e LEFT JOIN device_features df ON e.feature_id = df.id WHERE e.entity_id = ?')
    .get(entityId) as Record<string, unknown> | undefined
}

serviceRegistry.register('device_control.turn_on', async (params) => {
  const { entity_id } = params
  const entity = getEntityFromDb(entity_id as string)
  if (!entity) throw new Error(`Entity not found: ${entity_id}`)

  const did = (entity.device_did as string) || getDidFromEntityId(entity_id as string)
  const siid = Number(entity.siid ?? 2)
  const piid = Number(entity.piid ?? 1)

  const result = await cliBridge.run('mi-cli', 'set_prop', { did, siid, piid, value: true })
  if (result.status === 'success') {
    stateMachine.set(entity_id as string, 'on', { ...(result.data as Record<string, unknown>) })
  }
  return result
}, {
  description: '打开设备',
  fields: { entity_id: { description: '实体 ID', required: true } },
})

serviceRegistry.register('device_control.turn_off', async (params) => {
  const { entity_id } = params
  const entity = getEntityFromDb(entity_id as string)
  if (!entity) throw new Error(`Entity not found: ${entity_id}`)

  const did = (entity.device_did as string) || getDidFromEntityId(entity_id as string)
  const siid = Number(entity.siid ?? 2)
  const piid = Number(entity.piid ?? 1)

  const result = await cliBridge.run('mi-cli', 'set_prop', { did, siid, piid, value: false })
  if (result.status === 'success') {
    stateMachine.set(entity_id as string, 'off', { ...(result.data as Record<string, unknown>) })
  }
  return result
}, {
  description: '关闭设备',
  fields: { entity_id: { description: '实体 ID', required: true } },
})

serviceRegistry.register('device_control.set_value', async (params) => {
  const { entity_id, value } = params
  const entity = getEntityFromDb(entity_id as string)
  if (!entity) throw new Error(`Entity not found: ${entity_id}`)

  const did = (entity.device_did as string) || getDidFromEntityId(entity_id as string)
  const siid = Number(entity.siid ?? 2)
  const piid = Number(entity.piid ?? 1)

  const result = await cliBridge.run('mi-cli', 'set_prop', { did, siid, piid, value })
  if (result.status === 'success') {
    stateMachine.set(entity_id as string, String(value), { ...(result.data as Record<string, unknown>) })
  }
  return result
}, {
  description: '设置设备属性值',
  fields: {
    entity_id: { description: '实体 ID', required: true },
    value: { description: '目标值', required: true },
  },
})

serviceRegistry.register('device_control.get_state', async (params) => {
  const { entity_id } = params
  return stateMachine.get(entity_id as string)
}, {
  description: '获取设备状态',
  fields: { entity_id: { description: '实体 ID', required: true } },
})

serviceRegistry.register('device_control.run_action', async (params) => {
  const { entity_id, siid, aiid, action_params } = params
  const entity = getEntityFromDb(entity_id as string)
  if (!entity) throw new Error(`Entity not found: ${entity_id}`)

  const did = (entity.device_did as string) || getDidFromEntityId(entity_id as string)
  return cliBridge.run('mi-cli', 'run_action', {
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
