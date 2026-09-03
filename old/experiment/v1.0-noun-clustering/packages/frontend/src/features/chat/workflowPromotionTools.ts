import type { RecordExperiencePathInput } from '../../api/memoryAssets'
import type { WorkflowEdgeData, WorkflowNodeData } from '../../api/workflow'

export interface WorkflowDraftFromPath {
  name: string
  description: string
  trigger_type: 'manual'
  nodes: WorkflowNodeData[]
  edges: WorkflowEdgeData[]
}

export function buildWorkflowDraftFromExperiencePath(path: RecordExperiencePathInput): WorkflowDraftFromPath | null {
  if (!Array.isArray(path.steps) || path.steps.length === 0) return null

  const title = cleanText(path.title || path.intent_pattern || 'Chat promoted workflow')
  const inputPlan = buildPromotedWorkflowInputs(path)
  const nodes: WorkflowNodeData[] = [
    {
      type: 'start',
      label: 'Start',
      config: {
        inputs: inputPlan.defaults,
        promotion: {
          source: 'chat_experience_path',
          origin_trace_id: path.origin_trace_id ?? '',
          conversation_id: path.conversation_id ?? null,
          device_refs: path.device_refs ?? [],
          skill_refs: path.skill_refs ?? [],
        },
      },
      position: { x: 0, y: 0 },
    },
    ...path.steps.map((step, index) => stepToWorkflowNode(step, index, inputPlan.stepRefs[index] ?? {})),
    {
      type: 'answer',
      label: 'Done',
      config: {
        message: `${title} completed`,
      },
      position: { x: (path.steps.length + 1) * 240, y: 0 },
    },
  ]

  const edges: WorkflowEdgeData[] = []
  for (let index = 0; index < nodes.length - 1; index += 1) {
    edges.push({
      source_node_id: index,
      target_node_id: index + 1,
      source_port: 'out',
      target_port: 'in',
      condition: {},
    })
  }

  return {
    name: title,
    description: cleanText(path.summary || `Promoted from Chat experience path: ${title}`),
    trigger_type: 'manual',
    nodes,
    edges,
  }
}

function stepToWorkflowNode(
  step: RecordExperiencePathInput['steps'][number],
  index: number,
  refs: Record<string, string>,
): WorkflowNodeData {
  const params = asRecord(step.params)
  const label = cleanText(`${step.tool}.${step.action}`)
  const position = { x: (index + 1) * 240, y: 0 }

  if (step.tool === 'device_agent' && step.action === 'execute_device_capability') {
    return {
      type: 'device_capability',
      label: cleanText(String(params.capability || params.capability_id || 'Device Capability')),
      config: {
        device_id: refs.device_id ?? params.device_id ?? '',
        capability_id: refs.capability_id ?? params.capability_id ?? '',
        capability: refs.capability ?? params.capability ?? '',
        arguments: refs.arguments ?? asRecord(params.arguments),
      },
      position,
    }
  }

  if (step.tool === 'workflow' && step.action === 'run_workflow') {
    return {
      type: 'subflow',
      label: cleanText(String(params.workflow_name || params.workflow_id || 'Workflow')),
      config: {
        workflow_id: refs.workflow_id ?? params.workflow_id ?? null,
        workflow_name: refs.workflow_name ?? params.workflow_name ?? '',
        inputs: refs.workflow_inputs ?? asRecord(params.inputs),
        output_key: '',
      },
      position,
    }
  }

  return {
    type: 'executor_call',
    label,
    config: {
      executor_name: inferExecutorName(step.tool),
      params: buildExecutorParams(step.tool, step.action, params, refs),
    },
    position,
  }
}

function inferExecutorName(tool: string): string {
  if (tool === 'mi-cli' || tool === 'adb-cli') return 'cli.invoke'
  if (tool === 'service') return 'service.invoke'
  return tool || 'executor.invoke'
}

function buildExecutorParams(
  tool: string,
  action: string,
  params: Record<string, unknown>,
  refs: Record<string, string>,
): Record<string, unknown> {
  if (tool === 'mi-cli' || tool === 'adb-cli') {
    return {
      cli_name: tool,
      action,
      params: refs.params ?? params,
    }
  }
  if (tool === 'service') {
    return {
      service_name: action,
      params: refs.params ?? params,
    }
  }
  return {
    action,
    params: refs.params ?? params,
  }
}

function buildPromotedWorkflowInputs(path: RecordExperiencePathInput): {
  defaults: Record<string, unknown>
  stepRefs: Array<Record<string, string>>
} {
  const defaults: Record<string, unknown> = {
    intent: path.intent_pattern || path.title || 'Chat promoted workflow',
  }
  const stepRefs: Array<Record<string, string>> = []
  const singleStep = path.steps.length === 1

  path.steps.forEach((step, index) => {
    const params = asRecord(step.params)
    const refs: Record<string, string> = {}
    const prefix = singleStep ? '' : `step_${index + 1}_`

    if (step.tool === 'device_agent' && step.action === 'execute_device_capability') {
      refs.device_id = addInput(defaults, `${prefix}device_id`, params.device_id)
      refs.capability_id = addInput(defaults, `${prefix}capability_id`, params.capability_id)
      refs.capability = addInput(defaults, `${prefix}capability`, params.capability)
      refs.arguments = addInput(defaults, `${prefix}arguments`, asRecord(params.arguments))
    } else if (step.tool === 'workflow' && step.action === 'run_workflow') {
      refs.workflow_id = addInput(defaults, `${prefix}child_workflow_id`, params.workflow_id)
      refs.workflow_name = addInput(defaults, `${prefix}child_workflow_name`, params.workflow_name)
      const workflowInputs = Object.keys(asRecord(params.inputs)).length > 0
        ? asRecord(params.inputs)
        : asRecord(path.metadata?.workflow_inputs)
      refs.workflow_inputs = addInput(defaults, `${prefix}workflow_inputs`, workflowInputs)
    } else {
      refs.params = addInput(defaults, `${prefix}${inputKeyStem(step.tool)}_params`, params)
    }

    stepRefs[index] = refs
  })

  return { defaults, stepRefs }
}

function addInput(defaults: Record<string, unknown>, key: string, value: unknown): string {
  defaults[key] = value ?? ''
  return `{{input.${key}}}`
}

function inputKeyStem(tool: string): string {
  return cleanInputKey(tool || 'step')
}

function cleanInputKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'step'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 120) || 'Chat promoted workflow'
}
