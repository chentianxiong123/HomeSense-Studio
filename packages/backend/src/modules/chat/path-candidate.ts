import { normalizeDeviceTypeForSkill } from '../device/device-capability-registry.js'
import { buildFingerprintFromSteps } from '../intent/index.js'
import type { MemorySkillRef, RecordExperiencePathInput } from '../memory-assets/index.js'
import type { RuntimeTraceEvent } from './graph.js'

interface ChatMessageLike {
  role?: string
  content?: string
  name?: string
  tool_calls?: Array<{
    id?: string
    function?: {
      name?: string
      arguments?: string
    }
    name?: string
    arguments?: string
  }>
  tool_call_id?: string
}

interface ToolSnapshot {
  id: string
  name: string
  args: Record<string, unknown>
  result?: Record<string, unknown>
  status?: 'success' | 'error'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function isPathExecutableTool(name: string): boolean {
  return [
    'execute_device_capability',
    'context-command',
    'run_workflow',
    'mi-cli',
    'adb',
    'adb-cli',
  ].includes(name) || name.startsWith('service.')
}

function isSuccessfulPathToolSnapshot(snapshot: ToolSnapshot): boolean {
  if (!isPathExecutableTool(snapshot.name)) return false
  if (snapshot.status !== 'success') return false
  if (snapshot.name !== 'run_workflow') return true

  const result = readRecord(snapshot.result)
  const run = readRecord(result?.run)
  return result?.blocked !== true && String(run?.status) === 'succeeded'
}

function parseJsonObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function collectToolSnapshots(messages: ChatMessageLike[]): ToolSnapshot[] {
  const snapshots = new Map<string, ToolSnapshot>()
  const order: string[] = []

  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        const id = String(toolCall.id ?? '').trim()
        if (!id) continue
        if (!snapshots.has(id)) order.push(id)
        snapshots.set(id, {
          id,
          name: String(toolCall.function?.name ?? toolCall.name ?? '').trim(),
          args: parseJsonObject(toolCall.function?.arguments ?? toolCall.arguments),
          result: snapshots.get(id)?.result,
          status: snapshots.get(id)?.status,
        })
      }
      continue
    }

    if (message.role === 'tool') {
      const id = String(message.tool_call_id ?? '').trim()
      if (!id) continue
      const parsed = parseJsonObject(message.content)
      if (!snapshots.has(id)) order.push(id)
      const existing = snapshots.get(id)
      snapshots.set(id, {
        id,
        name: existing?.name ?? String(message.name ?? '').trim(),
        args: existing?.args ?? {},
        result: parsed,
        status: parsed.error ? 'error' : 'success',
      })
    }
  }

  return order.map((id) => snapshots.get(id)).filter((item): item is ToolSnapshot => Boolean(item))
}

function extractDeviceId(snapshot: ToolSnapshot): number | null {
  const device = readRecord(snapshot.result?.device)
  const card = readRecord(device?.card)
  const raw = snapshot.args.device_id ?? snapshot.result?.device_id ?? device?.id ?? card?.id
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) ? value : null
}

function extractDeviceType(snapshot: ToolSnapshot): string {
  const device = readRecord(snapshot.result?.device)
  const card = readRecord(device?.card)
  const raw =
    device?.device_type
    ?? card?.device_type
    ?? snapshot.args.device_type
    ?? snapshot.args.deviceType
    ?? ''
  return normalizeDeviceTypeForSkill(String(raw).trim())
}

function readSkillRefs(snapshot: ToolSnapshot): MemorySkillRef[] {
  const refs = new Map<string, MemorySkillRef>()
  const capabilityId = String(snapshot.args.capability_id ?? snapshot.result?.capability_id ?? '').trim()
  const capability = String(snapshot.args.capability ?? snapshot.result?.capability ?? '').trim()
  const source = String(snapshot.result?.source ?? '').trim()

  if (snapshot.name.includes('adb') || source === 'adb' || capabilityId.startsWith('adb.')) {
    refs.set('general_skill:adb-cli', { kind: 'general_skill', id: 'adb-cli', label: 'ADB CLI' })
  }
  if (snapshot.name.includes('mi') || source === 'mi' || capabilityId.startsWith('mi.') || capability.includes('小爱')) {
    refs.set('general_skill:mi-cli', { kind: 'general_skill', id: 'mi-cli', label: 'Mi CLI' })
  }

  const deviceType = extractDeviceType(snapshot)
  if (deviceType) {
    refs.set(`device_skill:device_skill.${deviceType}`, {
      kind: 'device_skill',
      id: `device_skill.${deviceType}`,
      label: deviceType,
    })
  }

  return Array.from(refs.values())
}

function readDeviceRefs(snapshot: ToolSnapshot): string[] {
  const refs = new Set<string>()
  const deviceId = extractDeviceId(snapshot)
  if (deviceId != null) refs.add(`device:${deviceId}`)
  return Array.from(refs)
}

function readPositiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(number) && number > 0 ? number : undefined
}

function readWorkflowSnapshot(snapshot: ToolSnapshot): {
  workflow_id?: number
  workflow_name?: string
  workflow_graph_hash?: string
  workflow_run_id?: number
  inputs: Record<string, unknown>
} | null {
  if (snapshot.name !== 'run_workflow') return null

  const result = readRecord(snapshot.result)
  const preview = readRecord(result?.preview)
  const run = readRecord(result?.run)
  const workflowName = String(result?.workflow_name ?? preview?.workflow_name ?? snapshot.args.workflow_name ?? '').trim()
  const workflowGraphHash = String(
    run?.graph_hash
    ?? result?.graph_hash
    ?? result?.workflow_graph_hash
    ?? preview?.graph_hash
    ?? preview?.workflow_graph_hash
    ?? snapshot.args.workflow_graph_hash
    ?? snapshot.args.graph_hash
    ?? '',
  ).trim()

  return {
    workflow_id: readPositiveNumber(run?.workflow_id ?? result?.workflow_id ?? preview?.workflow_id ?? snapshot.args.workflow_id),
    workflow_name: workflowName || undefined,
    workflow_graph_hash: workflowGraphHash || undefined,
    workflow_run_id: readPositiveNumber(run?.run_id ?? result?.run_id),
    inputs: asRecord(result?.inputs ?? preview?.inputs ?? snapshot.args.inputs),
  }
}

function toolCallToStep(snapshot: ToolSnapshot): RecordExperiencePathInput['steps'][number] | null {
  const args = snapshot.args
  const result = readRecord(snapshot.result)

  if (snapshot.name === 'execute_device_capability' || snapshot.name === 'context-command') {
    return {
      tool: 'device_agent',
      action: 'execute_device_capability',
      params: {
        device_id: args.device_id,
        capability_id: args.capability_id,
        capability: args.capability,
        arguments: isRecord(args.arguments) ? args.arguments : (args.ir_key !== undefined ? { key: args.ir_key } : {}),
      },
    }
  }

  if (snapshot.name === 'mi-cli' || snapshot.name === 'adb' || snapshot.name === 'adb-cli') {
    const action = String(args.action ?? '').trim()
    if (!action) return null
    return {
      tool: snapshot.name.includes('adb') ? 'adb-cli' : 'mi-cli',
      action,
      params: isRecord(args.params) ? args.params : {},
    }
  }

  if (snapshot.name.startsWith('service.')) {
    return {
      tool: 'service',
      action: snapshot.name.replace(/^service\./, ''),
      params: isRecord(args.params) ? args.params : args,
    }
  }

  if (snapshot.name === 'run_workflow') {
    const workflow = readWorkflowSnapshot(snapshot)
    return {
      tool: 'workflow',
      action: 'run_workflow',
      params: {
        workflow_id: workflow?.workflow_id ?? args.workflow_id,
        workflow_name: workflow?.workflow_name ?? args.workflow_name,
        inputs: workflow?.inputs ?? {},
      },
    }
  }

  return null
}

function buildCandidateTitle(intent: string, decision: RuntimeTraceEvent | undefined): string {
  const selected = String(decision?.detail ?? '').trim()
  if (selected && selected !== intent) return selected.slice(0, 80)
  return intent.slice(0, 80)
}

function readDecisionConfidence(trace: RuntimeTraceEvent[]): number | undefined {
  const decision = [...trace].reverse().find((item) => item.stage === 'runtime.decision' && typeof item.confidence === 'number')
  return decision?.confidence
}

export function buildRuntimePathCandidate(params: {
  intent: string
  messages: ChatMessageLike[]
  runtimeTrace: RuntimeTraceEvent[]
  conversationId: number
  originTraceId?: string
}): RecordExperiencePathInput | null {
  const snapshots = collectToolSnapshots(params.messages)
  const executableSnapshots = snapshots.filter((snapshot) => isPathExecutableTool(snapshot.name))
  if (executableSnapshots.length === 0) return null
  if (executableSnapshots.some((snapshot) => !isSuccessfulPathToolSnapshot(snapshot))) return null

  const steps = executableSnapshots
    .map((snapshot) => toolCallToStep(snapshot))
    .filter((step): step is NonNullable<ReturnType<typeof toolCallToStep>> => Boolean(step))

  if (steps.length === 0) return null

  const decision = [...params.runtimeTrace].reverse().find((item) => item.stage === 'runtime.decision')
  const skillRefs = new Map<string, MemorySkillRef>()
  const deviceRefs = new Set<string>()

  for (const snapshot of executableSnapshots) {
    for (const ref of readSkillRefs(snapshot)) {
      skillRefs.set(`${ref.kind}:${ref.id}`, ref)
    }
    for (const ref of readDeviceRefs(snapshot)) {
      deviceRefs.add(ref)
    }
  }

  const title = buildCandidateTitle(params.intent, decision)
  const intentFingerprint = buildFingerprintFromSteps(steps)
  return {
    title,
    summary: `Runtime executed a successful device path for: ${params.intent}`,
    intent_pattern: params.intent,
    source: 'runtime',
    status: 'active',
    origin_trace_id: params.originTraceId,
    conversation_id: params.conversationId,
    steps,
    skill_refs: Array.from(skillRefs.values()),
    device_refs: Array.from(deviceRefs.values()),
    success_criteria: { all_steps_complete: true },
    failure_recovery: [],
    confidence: readDecisionConfidence(params.runtimeTrace) ?? 0.88,
    priority: 0.7,
    metadata: {
      saved_from: 'runtime_path_candidate',
      intent_fingerprint: intentFingerprint,
      tool_count: executableSnapshots.length,
      executable_tool_names: executableSnapshots.map((snapshot) => snapshot.name),
      ...extractWorkflowMetadata(executableSnapshots),
    },
  }
}

function extractWorkflowMetadata(snapshots: ToolSnapshot[]): Record<string, unknown> {
  for (const snapshot of snapshots) {
    const workflow = readWorkflowSnapshot(snapshot)
    if (!workflow) continue
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
