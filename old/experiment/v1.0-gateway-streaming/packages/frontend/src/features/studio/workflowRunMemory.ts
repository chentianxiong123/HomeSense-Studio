import type { RecordExperiencePathInput } from '../../api/memoryAssets'
import type { Workflow, WorkflowRun } from '../../api/workflow'

export function buildWorkflowRunExperiencePayload(
  workflow: Workflow,
  run: WorkflowRun,
): RecordExperiencePathInput | null {
  const inputs = parseJsonObject(run.inputs_json)
  if (!inputs) return null

  const workflowName = String(workflow.name || `Workflow ${workflow.id}`).trim()
  const runId = Number(run.id)
  const status = run.status === 'succeeded' ? 'active' : 'draft'
  return {
    id: `memory.experience_path.workflow.${workflow.id}.run.${runId}`,
    title: `${workflowName} #${runId}`,
    summary: `Saved from workflow run #${runId}: ${workflow.description || workflowName}`,
    intent_pattern: [workflowName, workflow.description].filter(Boolean).join(' '),
    source: 'user',
    status,
    origin_trace_id: `workflow.${workflow.id}.run.${runId}`,
    steps: [
      {
        tool: 'workflow',
        action: 'run_workflow',
        params: {
          workflow_id: workflow.id,
          workflow_name: workflowName,
          inputs,
        },
      },
    ],
    skill_refs: [],
    device_refs: inferDeviceRefs(inputs),
    success_criteria: { workflow_status: run.status },
    failure_recovery: run.status === 'failed'
      ? [{ run_id: runId, result: parseJsonObject(run.result_json) ?? run.result_json }]
      : [],
    confidence: run.status === 'succeeded' ? 0.78 : 0.45,
    priority: run.status === 'succeeded' ? 0.7 : 0.4,
    metadata: {
      saved_from: 'workflow_run_history',
      workflow_id: workflow.id,
      workflow_name: workflowName,
      workflow_run_id: runId,
      workflow_inputs: inputs,
      run_status: run.status,
      triggered_by: run.triggered_by,
      started_at: run.started_at,
      finished_at: run.finished_at,
    },
  }
}

function inferDeviceRefs(inputs: Record<string, unknown>): string[] {
  const deviceId = inputs.device_id
  if (typeof deviceId === 'number' && Number.isFinite(deviceId)) return [`device:${deviceId}`]
  if (typeof deviceId === 'string' && deviceId.trim()) return [`device:${deviceId.trim()}`]
  return []
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}
