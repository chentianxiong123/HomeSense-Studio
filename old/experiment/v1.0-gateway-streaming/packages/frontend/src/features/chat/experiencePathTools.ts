import type { RuntimeTraceEvent, ToolCallState } from '../../composables/useChat'
import type { RecordExperiencePathInput } from '../../api/memoryAssets'

export interface ExperiencePathMessageLike {
  id: string
  content: string
  pathCandidate?: RecordExperiencePathInput
  runtimeTrace?: RuntimeTraceEvent[]
  toolCalls?: ToolCallState[]
}

export interface ExperiencePathHistoryLike {
  role: string
  content: string
}

export function isPathExecutableTool(name: string): boolean {
  return [
    'execute_device_capability',
    'context-command',
    'run_workflow',
    'mi-cli',
    'adb',
    'adb-cli',
  ].includes(name) || name.startsWith('service.')
}

export function toolCallToExperienceStep(toolCall: ToolCallState): RecordExperiencePathInput['steps'][number] | null {
  const args = isRecord(toolCall.args) ? toolCall.args : {}
  const result = isRecord(toolCall.result) ? toolCall.result : {}

  if (toolCall.name === 'execute_device_capability') {
    return {
      tool: 'device_agent',
      action: 'execute_device_capability',
      params: {
        device_id: args.device_id,
        capability_id: args.capability_id,
        capability: args.capability,
        arguments: isRecord(args.arguments) ? args.arguments : {},
      },
    }
  }

  if (toolCall.name === 'context-command') {
    return {
      tool: 'device_agent',
      action: 'execute_device_capability',
      params: {
        device_id: args.device_id,
        capability: args.capability,
        arguments: args.ir_key ? { key: args.ir_key } : {},
      },
    }
  }

  if (toolCall.name === 'run_workflow') {
    const workflow = readWorkflowToolState(toolCall)
    return {
      tool: 'workflow',
      action: 'run_workflow',
      params: {
        workflow_id: workflow.workflow_id ?? args.workflow_id,
        workflow_name: workflow.workflow_name ?? args.workflow_name,
        inputs: workflow.inputs,
      },
    }
  }

  if (toolCall.name === 'mi-cli' || toolCall.name === 'adb' || toolCall.name === 'adb-cli') {
    const action = String(args.action ?? '').trim()
    if (!action) return null
    return {
      tool: toolCall.name.includes('adb') ? 'adb-cli' : 'mi-cli',
      action,
      params: isRecord(args.params) ? args.params : {},
    }
  }

  if (toolCall.name.startsWith('service.')) {
    return {
      tool: 'service',
      action: toolCall.name.replace(/^service\./, ''),
      params: isRecord(args.params) ? args.params : args,
    }
  }

  return null
}

export function buildExperiencePathPayload(params: {
  message: ExperiencePathMessageLike
  messageIndex: number
  history: ExperiencePathHistoryLike[]
  locale: string
}): RecordExperiencePathInput | null {
  const { message, messageIndex, history, locale } = params

  if (message.pathCandidate?.steps?.length) {
    return {
      ...message.pathCandidate,
      source: message.pathCandidate.source ?? 'runtime',
      status: message.pathCandidate.status ?? 'active',
      conversation_id: message.pathCandidate.conversation_id ?? 1,
      origin_trace_id: message.pathCandidate.origin_trace_id || message.id,
      metadata: {
        ...(message.pathCandidate.metadata ?? {}),
        saved_from: 'chat_path_card',
        assistant_message_id: message.id,
      },
    }
  }

  const executableTools = successfulPathTools(message)
  const steps = executableTools
    .map(toolCallToExperienceStep)
    .filter((step): step is NonNullable<ReturnType<typeof toolCallToExperienceStep>> => Boolean(step))
  if (steps.length === 0) return null

  const userMessage = findPreviousUserMessage(history, messageIndex)
  const decision = message.runtimeTrace?.find((item) => item.stage === 'runtime.decision' && item.status === 'execute')
  const intent = userMessage?.content || String(decision?.detail ?? decision?.title ?? 'chat experience path')
  const title = buildPathTitle(intent, decision)

  return {
    title,
    summary: locale === 'zh'
      ? `从 Chat 成功执行沉淀：${intent}`
      : `Saved from a successful Chat execution: ${intent}`,
    intent_pattern: intent,
    source: 'runtime',
    status: 'active',
    origin_trace_id: message.id,
    conversation_id: 1,
    steps,
    skill_refs: collectSkillRefs(executableTools),
    device_refs: collectDeviceRefs(executableTools),
    success_criteria: { all_steps_complete: true },
    failure_recovery: [],
    metadata: {
      saved_from: 'chat_path_card',
      assistant_message_id: message.id,
      ...firstWorkflowMetadata(executableTools),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readPositiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(number) && number > 0 ? number : undefined
}

function readWorkflowToolState(toolCall: ToolCallState): {
  workflow_id?: number
  workflow_name?: string
  workflow_graph_hash?: string
  workflow_run_id?: number
  inputs: Record<string, unknown>
} {
  const args = isRecord(toolCall.args) ? toolCall.args : {}
  const result = isRecord(toolCall.result) ? toolCall.result : {}
  const preview = isRecord(result.preview) ? result.preview : {}
  const run = isRecord(result.run) ? result.run : {}
  const workflowName = String(result.workflow_name ?? preview.workflow_name ?? args.workflow_name ?? '').trim()
  const workflowGraphHash = String(
    run.graph_hash
    ?? result.graph_hash
    ?? result.workflow_graph_hash
    ?? preview.graph_hash
    ?? preview.workflow_graph_hash
    ?? args.workflow_graph_hash
    ?? args.graph_hash
    ?? '',
  ).trim()
  const inputs = isRecord(result.inputs)
    ? result.inputs
    : isRecord(preview.inputs)
      ? preview.inputs
      : isRecord(args.inputs)
        ? args.inputs
        : {}

  return {
    workflow_id: readPositiveNumber(run.workflow_id ?? result.workflow_id ?? preview.workflow_id ?? args.workflow_id),
    workflow_name: workflowName || undefined,
    workflow_graph_hash: workflowGraphHash || undefined,
    workflow_run_id: readPositiveNumber(run.run_id ?? result.run_id),
    inputs,
  }
}

function successfulPathTools(message: ExperiencePathMessageLike): ToolCallState[] {
  return collectSuccessfulPathToolCalls(message.toolCalls ?? [])
}

export function isSuccessfulPathToolCall(toolCall: ToolCallState): boolean {
  if (toolCall.status !== 'success' || !isPathExecutableTool(toolCall.name)) return false
  if (toolCall.name !== 'run_workflow') return true

  const result = isRecord(toolCall.result) ? toolCall.result : {}
  const run = isRecord(result.run) ? result.run : {}
  return result.blocked !== true && String(run.status) === 'succeeded'
}

export function collectSuccessfulPathToolCalls(toolCalls: ToolCallState[]): ToolCallState[] {
  const executableTools = toolCalls.filter((toolCall) => isPathExecutableTool(toolCall.name))
  if (executableTools.length === 0) return []
  if (executableTools.some((toolCall) => !isSuccessfulPathToolCall(toolCall))) return []
  return executableTools
}

function firstWorkflowMetadata(toolCalls: ToolCallState[]): Record<string, unknown> {
  for (const toolCall of toolCalls) {
    if (toolCall.name !== 'run_workflow') continue
    const workflow = readWorkflowToolState(toolCall)
    const metadata: Record<string, unknown> = {}
    if (workflow.workflow_id != null) metadata.workflow_id = workflow.workflow_id
    if (workflow.workflow_name) metadata.workflow_name = workflow.workflow_name
    if (workflow.workflow_graph_hash) metadata.workflow_graph_hash = workflow.workflow_graph_hash
    if (workflow.workflow_run_id != null) metadata.workflow_run_id = workflow.workflow_run_id
    if (Object.keys(workflow.inputs).length > 0) metadata.workflow_inputs = workflow.inputs
    return metadata
  }
  return {}
}

function collectSkillRefs(toolCalls: ToolCallState[]): Array<{ kind: 'device_skill' | 'general_skill'; id: string; label?: string }> {
  const refs = new Map<string, { kind: 'device_skill' | 'general_skill'; id: string; label?: string }>()
  for (const toolCall of toolCalls) {
    const args = isRecord(toolCall.args) ? toolCall.args : {}
    const capabilityId = String(args.capability_id ?? toolCall.result?.capability_id ?? '')
    if (toolCall.name.includes('adb') || capabilityId.startsWith('adb.')) {
      refs.set('general_skill:adb-cli', { kind: 'general_skill', id: 'adb-cli', label: 'ADB CLI' })
    }
    if (toolCall.name.includes('mi') || capabilityId.startsWith('mi.')) {
      refs.set('general_skill:mi-cli', { kind: 'general_skill', id: 'mi-cli', label: 'Mi CLI' })
    }

    const deviceType = normalizeDeviceTypeForSkill(readDeviceType(toolCall))
    if (deviceType) {
      refs.set(`device_skill:device_skill.${deviceType}`, {
        kind: 'device_skill',
        id: `device_skill.${deviceType}`,
        label: deviceType,
      })
    }
  }
  return Array.from(refs.values())
}

function collectDeviceRefs(toolCalls: ToolCallState[]): string[] {
  const refs = new Set<string>()
  for (const toolCall of toolCalls) {
    const args = isRecord(toolCall.args) ? toolCall.args : {}
    const id = args.device_id ?? toolCall.device?.id ?? toolCall.device?.card?.id ?? toolCall.result?.device?.id
    if (id !== undefined && id !== null && String(id).trim()) refs.add(`device:${String(id).trim()}`)
  }
  return Array.from(refs)
}

function findPreviousUserMessage(history: ExperiencePathHistoryLike[], messageIndex: number): ExperiencePathHistoryLike | undefined {
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const message = history[index]
    if (message?.role === 'user' && message.content.trim()) return message
  }
  return undefined
}

function buildPathTitle(intent: string, decision: RuntimeTraceEvent | undefined): string {
  const selected = String(decision?.detail ?? '').trim()
  if (selected && selected !== intent) return selected.slice(0, 80)
  return intent.slice(0, 80)
}

function readDeviceType(toolCall: ToolCallState): string {
  return String(
    toolCall.device?.device_type
    ?? toolCall.device?.card?.device_type
    ?? toolCall.result?.device?.device_type
    ?? toolCall.result?.device?.card?.device_type
    ?? '',
  )
}

function normalizeDeviceTypeForSkill(deviceType: string): string {
  const value = deviceType.trim()
  if (!value) return ''
  if (value === 'stb' || value === 'television') return 'tv_box'
  return value
}
