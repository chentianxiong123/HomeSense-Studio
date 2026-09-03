type EventListener = (data: unknown) => void | Promise<void>

export const HeartEvent = {
  // compensation
  COMPENSATION_TASK_CREATED: 'compensation_task_created',
  COMPENSATION_TASK_FAILED: 'compensation_task_failed',
  COMPENSATION_TASK_SUCCEEDED: 'compensation_task_succeeded',
  COMPENSATION_RETRY: 'compensation_retry',
  STATE_CHANGED: 'state_changed',
  // devtest
  DEVTEST_SMOKE_STARTED: 'devtest_smoke_started',
  DEVTEST_SMOKE_COMPLETED: 'devtest_smoke_completed',
  // cron
  CRON_SCHEDULE_ADDED: 'cron_schedule_added',
  CRON_FIRED: 'cron_fired',
  CRON_FAILED: 'cron_failed',
  CRON_WORKFLOW_TRIGGERED: 'cron_workflow_triggered',
  // experience
  EXPERIENCE_WRITTEN: 'experience_written',
  EXPERIENCE_INDEXED: 'experience_indexed',
  EXPERIENCE_CONVERTED_TO_SKILL: 'experience_converted_to_skill',
  // memory-kernel
  MEMORY_REMEMBERED: 'memory_remembered',
  MEMORY_OBSERVATION: 'memory_observation',
  COMPILED_KNOWLEDGE_UPDATED: 'compiled_knowledge_updated',
  // rule-engine
  RULE_ADDED: 'rule_added',
  RULE_REMOVED: 'rule_removed',
  RULE_MATCHED: 'rule_matched',
  // service-registry
  SERVICE_REGISTERED: 'service_registered',
  SERVICE_CALLED: 'service_called',
  // skills-system
  SKILL_REGISTERED: 'skill_registered',
  // system-tools
  TIMER_FIRED: 'timer_fired',
  OUTCOME_REPORTED: 'outcome_reported',
  // workflow
  WORKFLOW_NODE_STARTED: 'workflow_node_started',
  WORKFLOW_NODE_FAILED: 'workflow_node_failed',
  WORKFLOW_NODE_COMPLETED: 'workflow_node_completed',
  WORKFLOW_COMPLETED: 'workflow_completed',
  WORKFLOW_FAILED: 'workflow_failed',
} as const

export type HeartEventType = (typeof HeartEvent)[keyof typeof HeartEvent]

export class EventBus {
  private listeners = new Map<string, Set<EventListener>>()

  async fire(eventType: HeartEventType, data?: unknown): Promise<void> {
    const listeners = this.listeners.get(eventType)
    if (!listeners) return

    for (const listener of listeners) {
      try {
        await listener(data)
      } catch (err) {
        console.error(`EventBus listener error for "${eventType}":`, err)
      }
    }
  }

  on(eventType: string, listener: EventListener): () => void {
    return this.listen(eventType, listener)
  }

  private listen(eventType: string, listener: EventListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(listener)

    return () => {
      this.listeners.get(eventType)?.delete(listener)
    }
  }
}

export const eventBus = new EventBus()
