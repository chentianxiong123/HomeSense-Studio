import { buildWorkflowStepSummary, type WorkflowRunnerStepLike } from './workflowRunSummary'

type Labeler = (zh: string, en: string) => string

export interface WorkflowRunHistoryStep extends WorkflowRunnerStepLike {
  compensationTaskId?: number
}

export interface WorkflowRunHistoryStepView {
  step: WorkflowRunHistoryStep
  summary: ReturnType<typeof buildWorkflowStepSummary>
}

export function parseWorkflowRunTrace(raw: string): WorkflowRunHistoryStep[] {
  const trace = safeParseArray(raw)
  return trace
    .map((item) => asRecord(item))
    .map((row) => ({
      nodeId: String(row.node_id ?? row.nodeId ?? ''),
      nodeType: String(row.node_type ?? row.nodeType ?? ''),
      status: normalizeStepStatus(String(row.status ?? 'skipped')),
      outputs: asRecord(row.outputs),
      error: row.error ? String(row.error) : undefined,
      durationMs: readNumber(row.duration_ms ?? row.durationMs),
      attempts: readOptionalNumber(row.attempts),
      retryErrors: Array.isArray(row.retry_errors) ? row.retry_errors.map((value) => String(value)).filter(Boolean) : undefined,
      compensationTaskId: readOptionalNumber(row.compensation_task_id),
    }))
    .filter((step) => Boolean(step.nodeId))
}

export function buildWorkflowRunHistorySteps(rawTrace: string, label: Labeler): WorkflowRunHistoryStepView[] {
  return parseWorkflowRunTrace(rawTrace).map((step) => ({
    step,
    summary: buildWorkflowStepSummary(step, label),
  }))
}

function safeParseArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeStepStatus(value: string): WorkflowRunnerStepLike['status'] {
  if (value === 'failed') return 'failed'
  if (value === 'skipped') return 'skipped'
  return 'succeeded'
}

function readNumber(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function readOptionalNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}
