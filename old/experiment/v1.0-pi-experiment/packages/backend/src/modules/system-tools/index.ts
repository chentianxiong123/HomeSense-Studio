import { eventBus, HeartEvent } from '../event-bus/index.js'
import { memoryKernel } from '../memory-kernel/index.js'
import { memoryAssetsService } from '../memory-assets/index.js'
import { executeDeviceAgentTool } from '../device/device-agent-tools.js'
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
  {
    type: 'function' as const,
    function: {
      name: 'confirm_outcome',
      description: 'Ask the user whether the last device action succeeded. Use this after executing a device capability or workflow when the system cannot verify success automatically (e.g. TV screen changed, music started playing). The user response feeds back into the experience path success/failure count.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Short confirmation question to ask the user, e.g. "电视画面切换到B站了吗？"' },
          experience_path_id: { type: 'string', description: 'The memory item ID of the experience path to update with the outcome.' },
          context: {
            type: 'object',
            description: 'Execution context for the feedback record.',
            properties: {
              intent: { type: 'string' },
              device_id: { type: 'integer' },
              capability: { type: 'string' },
              steps_executed: { type: 'integer' },
            },
          },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'report_outcome',
      description: 'Record the outcome of a previously asked confirmation. Call this after the user responds to a confirm_outcome question. Updates the experience path success/failure counters and writes an observation to memory.',
      parameters: {
        type: 'object',
        properties: {
          success: { type: 'boolean', description: 'Whether the action succeeded according to the user.' },
          experience_path_id: { type: 'string', description: 'The memory item ID to update.' },
          note: { type: 'string', description: 'Optional note about what happened (e.g. user said "no, it opened the wrong app").' },
          context: {
            type: 'object',
            properties: {
              intent: { type: 'string' },
              device_id: { type: 'integer' },
              capability: { type: 'string' },
            },
          },
        },
        required: ['success'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'wait_until',
      description: 'Wait until a condition is met on a device, polling at intervals. Use this between steps in a multi-step path when the next step depends on a state change (e.g. app launched, screen loaded). Returns success when condition is met or error on timeout.',
      parameters: {
        type: 'object',
        properties: {
          device_id: { type: 'integer', description: 'Device to check condition on.' },
          condition: { type: 'string', enum: ['app_foreground', 'ui_element_visible', 'device_online'], description: 'Type of condition to check.' },
          expected: { type: 'string', description: 'Expected value: package name for app_foreground, element text for ui_element_visible, or "true" for device_online.' },
          timeout_ms: { type: 'integer', description: 'Maximum wait time in milliseconds. Defaults to 5000.' },
          poll_interval_ms: { type: 'integer', description: 'Polling interval in milliseconds. Defaults to 800.' },
        },
        required: ['device_id', 'condition', 'expected'],
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
      case 'confirm_outcome':
        return executeConfirmOutcome(args)
      case 'report_outcome':
        return executeReportOutcome(args)
      case 'wait_until':
        return await executeWaitUntil(args)
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

function executeConfirmOutcome(args: Record<string, unknown>): ExecutorInvokeResult {
  const question = String(args.question ?? '').trim()
  if (!question) {
    return { status: 'error', executor: 'confirm_outcome', error: 'question is required' }
  }

  const confirmationId = `confirm_${Date.now()}`

  return {
    status: 'success',
    executor: 'confirm_outcome',
    data: {
      confirmation_id: confirmationId,
      question,
      experience_path_id: args.experience_path_id ?? null,
      context: args.context ?? {},
      awaiting_user_response: true,
    },
  }
}

function executeReportOutcome(args: Record<string, unknown>): ExecutorInvokeResult {
  const success = Boolean(args.success)
  const pathId = String(args.experience_path_id ?? '').trim()
  const note = String(args.note ?? '').trim()
  const context = (args.context ?? {}) as Record<string, unknown>

  if (pathId) {
    memoryAssetsService.recordOutcome(pathId, success)
  }

  const intent = String(context.intent ?? '').trim()
  const deviceId = context.device_id ? String(context.device_id) : undefined
  const capability = String(context.capability ?? '').trim()

  if (intent || capability) {
    memoryKernel.observeOutcome({
      intent: intent || capability,
      target_device_id: deviceId,
      tool: 'device_agent',
      action: capability || 'unknown',
      success,
      error: success ? undefined : note || undefined,
    })
  }

  eventBus.fire(HeartEvent.OUTCOME_REPORTED, {
    success,
    experience_path_id: pathId || null,
    note,
    context,
    reported_at: new Date().toISOString(),
  })

  return {
    status: 'success',
    executor: 'report_outcome',
    data: {
      success,
      experience_path_id: pathId || null,
      observation_written: Boolean(intent || capability),
      path_updated: Boolean(pathId),
    },
  }
}

async function executeWaitUntil(args: Record<string, unknown>): Promise<ExecutorInvokeResult> {
  const deviceId = Number(args.device_id)
  if (!Number.isFinite(deviceId)) {
    return { status: 'error', executor: 'wait_until', error: 'device_id is required' }
  }

  const condition = String(args.condition ?? '').trim()
  const expected = String(args.expected ?? '').trim()
  if (!condition || !expected) {
    return { status: 'error', executor: 'wait_until', error: 'condition and expected are required' }
  }

  const timeoutMs = Number(args.timeout_ms) || 5000
  const pollIntervalMs = Number(args.poll_interval_ms) || 800
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const met = await checkCondition(deviceId, condition, expected)
    if (met) {
      return {
        status: 'success',
        executor: 'wait_until',
        data: {
          condition,
          expected,
          met: true,
          elapsed_ms: Date.now() - startTime,
        },
      }
    }
    await sleep(pollIntervalMs)
  }

  return {
    status: 'error',
    executor: 'wait_until',
    error: `Timeout: condition "${condition}" not met within ${timeoutMs}ms`,
    message: `等待超时：${condition} = "${expected}" 未在 ${timeoutMs}ms 内满足`,
  }
}

async function checkCondition(deviceId: number, condition: string, expected: string): Promise<boolean> {
  try {
    if (condition === 'app_foreground') {
      const result = await executeDeviceAgentTool('get_current_app', { device_id: deviceId })
      if (result.status !== 'success') return false
      const data = result.data as Record<string, unknown> | undefined
      const currentApp = String(data?.package ?? data?.current_app ?? data?.foreground_app ?? '').trim()
      return currentApp.includes(expected)
    }

    if (condition === 'ui_element_visible') {
      const result = await executeDeviceAgentTool('get_ui_tree', { device_id: deviceId })
      if (result.status !== 'success') return false
      const content = JSON.stringify(result.data ?? '')
      return content.includes(expected)
    }

    if (condition === 'device_online') {
      const result = await executeDeviceAgentTool('list_user_devices', {})
      if (result.status !== 'success') return false
      const devices = (result.data as any)?.devices ?? result.data
      if (!Array.isArray(devices)) return false
      const device = devices.find((d: any) => d.id === deviceId)
      return device?.online === true
    }

    return false
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
