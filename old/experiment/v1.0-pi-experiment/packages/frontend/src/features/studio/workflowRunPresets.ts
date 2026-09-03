import type { MemoryAssetRecord } from '../../api/memoryAssets'
import type { Workflow } from '../../api/workflow'

export interface WorkflowRunPreset {
  id: string
  title: string
  detail: string
  status: string
  inputs: Record<string, unknown>
  successCount: number
  failureCount: number
}

export function buildWorkflowRunPresets(
  workflow: Workflow,
  assets: MemoryAssetRecord[],
): WorkflowRunPreset[] {
  return assets
    .filter((asset) => asset.kind === 'experience_path')
    .map((asset) => assetToPreset(workflow, asset))
    .filter((preset): preset is WorkflowRunPreset => Boolean(preset))
    .sort((left, right) =>
      Number(right.status === 'active') - Number(left.status === 'active')
      || right.successCount - left.successCount
      || left.failureCount - right.failureCount
      || left.title.localeCompare(right.title),
    )
}

function assetToPreset(workflow: Workflow, asset: MemoryAssetRecord): WorkflowRunPreset | null {
  const metadata = isRecord(asset.metadata) ? asset.metadata : {}
  const workflowId = Number(metadata.workflow_id)
  if (workflowId !== Number(workflow.id)) return null

  const inputs = isRecord(metadata.workflow_inputs)
    ? metadata.workflow_inputs
    : firstWorkflowStepInputs(asset)
  if (!inputs || Object.keys(inputs).length === 0) return null

  return {
    id: asset.id,
    title: asset.title || workflow.name,
    detail: String(metadata.saved_from ?? asset.source ?? ''),
    status: asset.status,
    inputs,
    successCount: readCount(metadata.success_count),
    failureCount: readCount(metadata.failure_count),
  }
}

function firstWorkflowStepInputs(asset: MemoryAssetRecord): Record<string, unknown> | null {
  const steps = Array.isArray(asset.metadata?.steps) ? asset.metadata.steps : []
  for (const step of steps) {
    if (!isRecord(step)) continue
    const params = isRecord(step.params) ? step.params : {}
    if (isRecord(params.inputs)) return params.inputs
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readCount(value: unknown): number {
  const count = Number(value ?? 0)
  return Number.isFinite(count) ? count : 0
}
