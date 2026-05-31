import { eventBus, HeartEvent } from '../event-bus/index.js'
import { memoryKernel } from '../memory-kernel/index.js'
import type { ExecutorInvokeResult } from '../executor-gateway/index.js'

export const SYSTEM_AGENT_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'set_timer',
      description: 'Set a one-shot timer that fires a device action or workflow after a delay. Use this when the user says "in 5 minutes turn off the TV" or similar delayed actions.',
      parameters: {
        type: 'object',
        properties: {
          delay_seconds: { type: 'integer', description: 'Delay in seconds before the action fires.' },
          label: { type: 'string', description: 'Short human-readable label for the timer.' },
          action: {
            type: 'object',
            description: 'The action to execute when the timer fires. Must have tool and action fields, optionally params.',
            properties: {
              tool: { type: 'string' },
              action: { type: 'string' },
              params: { type: 'object' },
            },
            required: ['tool', 'action'],
          },
        },
        required: ['delay_seconds', 'label', 'action'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'remember',
      description: 'Write a user preference, habit, or experience note to long-term memory. Use this when the user explicitly says "remember that..." or expresses a preference worth persisting.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The fact, preference, or experience to remember.' },
          type: { type: 'string', enum: ['person', 'device', 'room', 'concept', 'skill'], description: 'Category of the memory.' },
          wing: { type: 'string', description: 'Knowledge domain or grouping (e.g. user_preferences, device_habits).' },
          room: { type: 'string', description: 'Optional room or sub-context.' },
        },
        required: ['content', 'type', 'wing'],
      },
    },
  },
]

const SYSTEM_TOOL_NAMES = new Set(SYSTEM_AGENT_TOOL_DEFINITIONS.map((t) => t.function.name))

export function isSystemAgentTool(name: string): boolean {
  return SYSTEM_TOOL_NAMES.has(name)
}

export async function executeSystemAgentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ExecutorInvokeResult> {
  try {
    switch (name) {
      case 'set_timer':
        return executeSetTimer(args)
      case 'remember':
        return executeRemember(args)
      default:
        return { status: 'error', executor: name, error: `Unknown system tool: ${name}` }
    }
  } catch (err) {
    return { status: 'error', executor: name, error: (err as Error).message }
  }
}

function executeSetTimer(args: Record<string, unknown>): ExecutorInvokeResult {
  const delaySeconds = Number(args.delay_seconds)
  if (!Number.isFinite(delaySeconds) || delaySeconds < 1) {
    return { status: 'error', executor: 'set_timer', error: 'delay_seconds must be a positive integer' }
  }

  const label = String(args.label ?? 'timer')
  const action = args.action as Record<string, unknown> | undefined
  if (!action || typeof action.tool !== 'string' || typeof action.action !== 'string') {
    return { status: 'error', executor: 'set_timer', error: 'action must have tool and action fields' }
  }

  const fireAt = new Date(Date.now() + delaySeconds * 1000)
  const timerId = `timer_${Date.now()}`

  setTimeout(() => {
    eventBus.fire(HeartEvent.TIMER_FIRED, {
      timer_id: timerId,
      label,
      action,
      fired_at: new Date().toISOString(),
    })
  }, delaySeconds * 1000)

  return {
    status: 'success',
    executor: 'set_timer',
    data: {
      timer_id: timerId,
      label,
      delay_seconds: delaySeconds,
      fire_at: fireAt.toISOString(),
      action,
    },
  }
}

function executeRemember(args: Record<string, unknown>): ExecutorInvokeResult {
  const content = String(args.content ?? '').trim()
  if (!content) {
    return { status: 'error', executor: 'remember', error: 'content is required' }
  }

  const type = String(args.type ?? 'concept') as 'person' | 'device' | 'room' | 'concept' | 'skill'
  const wing = String(args.wing ?? 'user_preferences')
  const room = String(args.room ?? '')

  memoryKernel.remember(content, {
    type,
    wing,
    room,
    source: 'chat_tool',
    confidence: 0.9,
  })

  return {
    status: 'success',
    executor: 'remember',
    data: {
      content,
      type,
      wing,
      room,
      stored: true,
    },
  }
}
