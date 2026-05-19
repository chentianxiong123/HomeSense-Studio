import { getDb } from '../../db/index.js'
import { eventBus } from '../event-bus/index.js'
import { serviceRegistry } from '../service-registry/index.js'
import { entityRegistry } from '../entity-registry/index.js'
import { stateMachine } from '../state-machine/index.js'

type GetDbFn = () => ReturnType<typeof getDb>

interface EventBusInstance {
  fire(event: string, data?: unknown): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

interface ServiceRegistryInstance {
  call(serviceName: string, params: Record<string, unknown>): Promise<unknown>
  list(): Array<{ name: string }>
}

interface EntityRegistryInstance {
  get(entityId: string): unknown
}

interface StateMachineInstance {
  get(entityId: string): { state: string } | undefined
}

export interface CompensationTask {
  id: number
  type: string
  params_json: string
  retry_count: number
  max_retries: number
  next_retry_at: string
  state: 'pending' | 'running' | 'succeeded' | 'failed'
  error_message: string
  created_at: string
}

export interface PreviewResult {
  can_execute: boolean
  checks: Array<{
    name: string
    passed: boolean
    message: string
  }>
  estimated_impact: string
  warnings: string[]
}

export class CompensationService {
  constructor(
    private readonly getDb: GetDbFn = getDb,
    private readonly eventBus: EventBusInstance = eventBus,
    private readonly serviceRegistry: ServiceRegistryInstance = serviceRegistry,
    private readonly entityRegistry: EntityRegistryInstance = entityRegistry,
    private readonly stateMachine: StateMachineInstance = stateMachine,
  ) {}

  createTask(
    type: string,
    params: Record<string, unknown>,
    maxRetries: number = 3,
  ): CompensationTask {
    const db = this.getDb()
    const now = new Date().toISOString()
    const paramsJson = JSON.stringify(params)

    const result = db.prepare(
      `INSERT INTO compensation_tasks (type, params_json, retry_count, max_retries, next_retry_at, state, error_message, created_at)
     VALUES (?, ?, 0, ?, ?, 'pending', '', ?)`,
    ).run(type, paramsJson, maxRetries, now, now)

    const task: CompensationTask = {
      id: Number(result.lastInsertRowid),
      type,
      params_json: paramsJson,
      retry_count: 0,
      max_retries: maxRetries,
      next_retry_at: now,
      state: 'pending',
      error_message: '',
      created_at: now,
    }

    this.eventBus.fire('compensation_task_created', { task_id: task.id, type })
    return task
  }

  private persistState(task: CompensationTask): void {
    const db = this.getDb()
    db.prepare(
      `UPDATE compensation_tasks SET state = ?, retry_count = ?, next_retry_at = ?, error_message = ? WHERE id = ?`,
    ).run(task.state, task.retry_count, task.next_retry_at, task.error_message, task.id)
  }

  preview(task: CompensationTask): PreviewResult {
    const checks: PreviewResult['checks'] = []
    const warnings: string[] = []
    let canExecute = true

    let params: Record<string, unknown> = {}
    try {
      params = JSON.parse(task.params_json)
    } catch {
      checks.push({ name: 'params_valid', passed: false, message: '参数 JSON 解析失败' })
      canExecute = false
    }

    if (!task.type) {
      checks.push({ name: 'type_valid', passed: false, message: '任务类型为空' })
      canExecute = false
    } else {
      checks.push({ name: 'type_valid', passed: true, message: `任务类型: ${task.type}` })
    }

    if (task.type === 'device_control') {
      const entityId = params.entity_id as string | undefined
      if (entityId) {
        const entity = this.entityRegistry.get(entityId)
        if (entity) {
          checks.push({ name: 'entity_exists', passed: true, message: `实体存在: ${entityId}` })
          const state = this.stateMachine.get(entityId)
          if (state?.state === 'unavailable') {
            checks.push({ name: 'entity_online', passed: false, message: '实体不可用' })
            canExecute = false
          } else {
            checks.push({ name: 'entity_online', passed: true, message: '实体在线' })
          }
        } else {
          checks.push({ name: 'entity_exists', passed: false, message: `实体不存在: ${entityId}` })
          canExecute = false
        }
      } else {
        checks.push({ name: 'entity_id', passed: false, message: '缺少 entity_id 参数' })
        canExecute = false
      }
    }

    if (task.max_retries > 5) {
      warnings.push(`最大重试次数 ${task.max_retries} 较大，可能导致长时间重试`)
    }

    const services = this.serviceRegistry.list()
    const hasService = services.some((s) => {
      const name = (s as { name: string }).name
      return name.startsWith(task.type)
    })
    if (!hasService && task.type !== 'device_control') {
      checks.push({ name: 'service_available', passed: false, message: `未找到 ${task.type} 相关服务` })
      canExecute = false
    } else {
      checks.push({ name: 'service_available', passed: true, message: '服务可用' })
    }

    return {
      can_execute: canExecute,
      checks,
      estimated_impact: task.type === 'device_control' ? '设备状态变更' : '未知影响',
      warnings,
    }
  }

  async retryWithBackoff(task: CompensationTask): Promise<boolean> {
    if (task.retry_count >= task.max_retries) {
      task.state = 'failed'
      task.error_message = `已达最大重试次数 ${task.max_retries}`
      this.persistState(task)
      this.eventBus.fire('compensation_task_failed', { task_id: task.id, error: task.error_message })
      return false
    }

    const baseMs = 1000
    const backoff = baseMs * Math.pow(2, task.retry_count)
    task.next_retry_at = new Date(Date.now() + backoff).toISOString()
    task.state = 'running'
    this.persistState(task)

    try {
      const params = JSON.parse(task.params_json)
      let success = false

      if (task.type === 'device_control') {
        try {
          const serviceName = `device_control.${params.action ?? 'turn_on'}`
          await this.serviceRegistry.call(serviceName, params)
          success = true
        } catch {}
      } else {
        try {
          await this.serviceRegistry.call(task.type, params)
          success = true
        } catch {}
      }

      if (success) {
        task.state = 'succeeded'
        task.error_message = ''
        this.persistState(task)
        this.eventBus.fire('compensation_task_succeeded', { task_id: task.id })
        return true
      } else {
        throw new Error('执行失败')
      }
    } catch (err) {
      task.retry_count++
      task.state = 'pending'
      task.error_message = (err as Error).message
      this.persistState(task)
      this.eventBus.fire('compensation_retry', { task_id: task.id, retry_count: task.retry_count })
      return false
    }
  }

  getTask(id: number): CompensationTask | undefined {
    const db = this.getDb()
    return db.prepare('SELECT * FROM compensation_tasks WHERE id = ?').get(id) as CompensationTask | undefined
  }

  getPendingTasks(): CompensationTask[] {
    const db = this.getDb()
    return db.prepare(
      "SELECT * FROM compensation_tasks WHERE state = 'pending' AND next_retry_at <= datetime('now')",
    ).all() as CompensationTask[]
  }

  processPendingTasks(): void {
    const tasks = this.getPendingTasks()
    for (const task of tasks) {
      this.retryWithBackoff(task).catch(() => {})
    }
  }
}

export const compensationService = new CompensationService()