import { getDb } from '../../db/index.js'
import { eventBus } from '../event-bus/index.js'

type GetDbFn = () => ReturnType<typeof getDb>

interface EventBusInstance {
  fire(event: string, data?: unknown): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

interface ScheduleEntry {
  id: string
  cron: string
  callback: () => Promise<void>
}

class CronService {
  private schedules = new Map<string, ScheduleEntry>()
  private timer: ReturnType<typeof setInterval> | null = null
  private counter = 0

  constructor(
    private readonly getDb: GetDbFn = getDb,
    private readonly eventBus: EventBusInstance = eventBus,
  ) {}

  addSchedule(cron: string, callback: () => Promise<void>): string {
    if (!this.isValidCron(cron)) {
      throw new Error(`Invalid cron expression: ${cron}`)
    }

    const id = `cron_${++this.counter}_${Date.now()}`
    this.schedules.set(id, { id, cron, callback })

    this.eventBus.fire('cron_schedule_added', { schedule_id: id, cron })
    return id
  }

  removeSchedule(scheduleId: string): void {
    this.schedules.delete(scheduleId)
  }

  tick(): void {
    const now = new Date()
    for (const [id, schedule] of this.schedules) {
      if (this.matchesCron(schedule.cron, now)) {
        this.eventBus.fire('cron_fired', { schedule_id: id, cron: schedule.cron, fired_at: now.toISOString() })
        schedule.callback().catch((err) => {
          this.eventBus.fire('cron_failed', { schedule_id: id, error: (err as Error).message })
        })
      }
    }
  }

  start(intervalMs: number = 60000): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), intervalMs)
    this.loadFromDb()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  listSchedules(): Array<{ id: string; cron: string }> {
    return Array.from(this.schedules.values()).map((s) => ({ id: s.id, cron: s.cron }))
  }

  private loadFromDb(): void {
    try {
      const db = this.getDb()
      const workflows = db.prepare(
        "SELECT * FROM workflows WHERE trigger_type = 'cron' AND published = 1 AND cron_expression IS NOT NULL",
      ).all() as Array<Record<string, unknown>>

      for (const wf of workflows) {
        const cronExpr = wf.cron_expression as string
        const wfId = wf.id as number
        if (cronExpr && this.isValidCron(cronExpr)) {
          this.addSchedule(cronExpr, async () => {
            this.eventBus.fire('cron_workflow_triggered', { workflow_id: wfId })
          })
        }
      }
    } catch {}
  }

  private isValidCron(cron: string): boolean {
    const parts = cron.trim().split(/\s+/)
    return parts.length >= 5 && parts.length <= 6
  }

  private matchesCron(cron: string, date: Date): boolean {
    const parts = cron.trim().split(/\s+/)
    if (parts.length < 5) return false

    const minute = date.getMinutes()
    const hour = date.getHours()
    const dayOfMonth = date.getDate()
    const month = date.getMonth() + 1
    const dayOfWeek = date.getDay()

    return (
      this.matchField(parts[0], minute) &&
      this.matchField(parts[1], hour) &&
      this.matchField(parts[2], dayOfMonth) &&
      this.matchField(parts[3], month) &&
      this.matchField(parts[4], dayOfWeek)
    )
  }

  private matchField(field: string, value: number): boolean {
    if (field === '*') return true

    if (field.includes(',')) {
      return field.split(',').some((part) => this.matchField(part, value))
    }

    if (field.includes('/')) {
      const [range, step] = field.split('/')
      const stepNum = parseInt(step, 10)
      if (range === '*') {
        return value % stepNum === 0
      }
      const start = parseInt(range, 10)
      return value >= start && (value - start) % stepNum === 0
    }

    if (field.includes('-')) {
      const [start, end] = field.split('-').map(Number)
      return value >= start && value <= end
    }

    return parseInt(field, 10) === value
  }
}

export const cronService = new CronService()
