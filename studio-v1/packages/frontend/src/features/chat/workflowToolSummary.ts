import type { ToolCallState } from '../../composables/useChat'
import type { SummaryTone } from '../studio/workflowRunSummary'

type Labeler = (zh: string, en: string) => string

export interface WorkflowToolSummary {
  title: string
  tone: SummaryTone
  subtitle?: string
  phases?: Array<{
    label: string
    value: string
    tone: SummaryTone
  }>
  rows: Array<{ label: string; value: string }>
  workflows?: Array<{
    title: string
    detail: string
    tags: string[]
  }>
  steps?: Array<{
    title: string
    detail: string
    tone: SummaryTone
  }>
  warnings?: string[]
}

export function buildWorkflowToolSummary(toolCall: ToolCallState, label: Labeler): WorkflowToolSummary | null {
  const args = asRecord(toolCall.args)
  const result = asRecord(toolCall.result)

  if (toolCall.name === 'list_workflows') {
    return summarizeWorkflowList(args, result, toolCall.status, label)
  }

  if (toolCall.name === 'preview_workflow') {
    return summarizeWorkflowPreview(args, result, toolCall.status, label)
  }

  if (toolCall.name === 'run_workflow') {
    return summarizeWorkflowRun(args, result, toolCall.status, label)
  }

  return null
}

function summarizeWorkflowList(
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  status: ToolCallState['status'],
  label: Labeler,
): WorkflowToolSummary {
  const workflows = readArray(result.workflows)
  const query = stringifyValue(args.query)
  const tone: SummaryTone = status === 'error' ? 'error' : workflows.length > 0 ? 'success' : 'neutral'
  return {
    title: label('工作流候选', 'Workflow Candidates'),
    tone,
    subtitle: query
      ? label('查询词', 'Query') + `: ${query}`
      : label('系统列出可复用流程', 'Reusable workflows discovered'),
    rows: compactRows([
      [label('候选数量', 'Candidates'), String(workflows.length)],
      [label('筛选', 'Filter'), query],
      [label('状态', 'Status'), statusLabel(status, label)],
    ]),
    workflows: workflows.slice(0, 6).map((item) => ({
      title: stringifyValue(item.name || item.title || item.id) || label('未命名', 'Untitled'),
      detail: [
        stringifyValue(item.description),
        stringifyValue(item.trigger_type),
        Number(item.success_count) > 0 ? `${label('成功', 'Success')} ${stringifyValue(item.success_count)}` : '',
        Number(item.failure_count) > 0 ? `${label('失败', 'Failure')} ${stringifyValue(item.failure_count)}` : '',
        stringifyValue(item.last_run_status) ? `${label('最近运行', 'Last Run')} ${stringifyValue(item.last_run_status)}` : '',
        stringifyValue(item.reuse_score) ? `${label('复用分', 'Reuse')} ${stringifyValue(item.reuse_score)}` : '',
      ].filter(Boolean).join(' · '),
      tags: compactTags([
        stringifyValue(item.published) === 'true' ? label('已发布', 'Published') : '',
        formatWorkflowEvidenceStatus(item.evidence_status, label),
        stringifyValue(item.reuse_score) ? `${label('复用分', 'Reuse')} ${stringifyValue(item.reuse_score)}` : '',
        stringifyValue(item.has_device_steps) === 'true' ? label('含设备步骤', 'Device steps') : '',
        Number(item.success_count) > 0 ? `${label('成功', 'Success')} ${stringifyValue(item.success_count)}` : '',
        Number(item.failure_count) > 0 ? `${label('失败', 'Failure')} ${stringifyValue(item.failure_count)}` : '',
        Number(item.device_step_count) > 0 ? `${label('设备步骤', 'Device steps')} ${stringifyValue(item.device_step_count)}` : '',
        Number(item.node_count) > 0 ? `${label('节点', 'Nodes')} ${stringifyValue(item.node_count)}` : '',
      ]),
    })),
  }
}

function summarizeWorkflowPreview(
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  status: ToolCallState['status'],
  label: Labeler,
): WorkflowToolSummary {
  const steps = readArray(result.steps)
  const warnings = readArray(result.warnings).map((item) => stringifyValue(item)).filter(Boolean)
  const executable = Boolean(result.executable)
  const tone: SummaryTone = status === 'error'
    ? 'error'
    : executable
      ? 'success'
      : 'warning'
  return {
    title: label('工作流预演', 'Workflow Preview'),
    tone,
    subtitle: previewSubtitle(args, result, label),
    phases: [
      {
        label: label('预演', 'Preview'),
        value: executable ? label('可执行', 'Executable') : label('阻塞', 'Blocked'),
        tone: executable ? 'success' : 'warning',
      },
      {
        label: label('执行准备', 'Execution Ready'),
        value: status === 'error' ? label('失败', 'Failed') : label('完成', 'Done'),
        tone: status === 'error' ? 'error' : executable ? 'success' : 'warning',
      },
    ],
    rows: compactRows([
      [label('工作流 ID', 'Workflow ID'), stringifyValue(result.workflow_id ?? args.workflow_id)],
      [label('工作流名称', 'Workflow Name'), stringifyValue(args.workflow_name)],
      [label('输入来源', 'Input Source'), formatWorkflowInputSource(result.input_source, label)],
      [label('步骤数量', 'Steps'), String(steps.length)],
      [label('警告', 'Warnings'), String(warnings.length)],
    ]),
    steps: steps.slice(0, 5).map((step) => ({
      title: stringifyValue(step.label || step.node_id || step.node_type) || label('步骤', 'Step'),
      detail: buildPreviewStepDetail(step, label),
      tone: previewStateTone(String(step.preview_state)),
    })),
    warnings,
  }
}

function summarizeWorkflowRun(
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  status: ToolCallState['status'],
  label: Labeler,
): WorkflowToolSummary {
  const preview = asRecord(result.preview)
  const run = asRecord(result.run)
  const previewExecutable = Boolean(preview.executable)
  const blocked = Boolean(result.blocked) || (!result.run && !previewExecutable)
  const runSucceeded = String(run.status) === 'succeeded'
  const trace = readArray(run.trace)
  const warnings = [
    ...readArray(preview.warnings).map((item) => stringifyValue(item)).filter(Boolean),
    blocked ? stringifyValue(result.message) : '',
  ].filter(Boolean)
  const tone: SummaryTone = status === 'error'
    ? 'error'
    : runSucceeded
      ? 'success'
      : blocked
        ? 'warning'
        : previewExecutable
          ? 'warning'
          : 'error'
  return {
    title: label('工作流执行', 'Workflow Run'),
    tone,
    subtitle: previewSubtitle(args, preview, label),
    phases: [
      {
        label: label('预演', 'Preview'),
        value: previewExecutable ? label('通过', 'Passed') : label('阻塞', 'Blocked'),
        tone: previewExecutable ? 'success' : 'warning',
      },
      {
        label: label('执行', 'Execution'),
        value: blocked ? label('未执行', 'Not Run') : runSucceeded ? label('完成', 'Done') : label('失败', 'Failed'),
        tone: blocked ? 'warning' : runSucceeded ? 'success' : 'error',
      },
    ],
    rows: compactRows([
      [label('工作流 ID', 'Workflow ID'), stringifyValue(run.workflow_id ?? preview.workflow_id ?? args.workflow_id)],
      [label('运行 ID', 'Run ID'), stringifyValue(run.run_id)],
      [label('输入来源', 'Input Source'), formatWorkflowInputSource(run.input_source ?? preview.input_source, label)],
      [label('步骤数量', 'Steps'), String(trace.length || readArray(preview.steps).length)],
      [label('输出', 'Output'), formatWorkflowOutputSummary(run.outputs, label)],
      [label('说明', 'Message'), blocked ? stringifyValue(result.message) : ''],
    ]),
    steps: trace.length > 0
      ? buildTraceSteps(trace, label)
      : buildPreviewSteps(readArray(preview.steps), label),
    warnings,
  }
}

function buildTraceSteps(trace: unknown[], label: Labeler): WorkflowToolSummary['steps'] {
  return trace.slice(0, 5).map((item) => {
    const row = asRecord(item)
    const outputs = asRecord(row.outputs)
    return {
      title: stringifyValue(row.node_type || row.node_id) || label('步骤', 'Step'),
      detail: buildTraceStepDetail(row, outputs, label),
      tone: traceStateTone(String(row.status)),
    }
  })
}

function buildPreviewSteps(steps: unknown[], label: Labeler): WorkflowToolSummary['steps'] {
  return steps.slice(0, 5).map((item) => {
    const step = asRecord(item)
    return {
      title: stringifyValue(step.label || step.node_id || step.node_type) || label('步骤', 'Step'),
      detail: buildPreviewStepDetail(step, label),
      tone: previewStateTone(String(step.preview_state)),
    }
  })
}

function previewSubtitle(args: Record<string, unknown>, result: Record<string, unknown>, label: Labeler): string {
  const workflowId = stringifyValue(result.workflow_id ?? args.workflow_id)
  const workflowName = stringifyValue(args.workflow_name)
  if (workflowId && workflowName) return `${workflowName} · #${workflowId}`
  if (workflowName) return workflowName
  if (workflowId) return `${label('工作流', 'Workflow')} #${workflowId}`
  return label('工作流流程', 'Workflow routine')
}

function buildPreviewStepDetail(step: Record<string, unknown>, label: Labeler): string {
  const detailParts = [
    stringifyValue(step.summary),
    stringifyValue(step.risk),
  ]

  if (String(step.node_type) === 'subflow') {
    const subflow = asRecord(step.subflow)
    const workflowName = stringifyValue(subflow.workflow_name)
    const workflowId = stringifyValue(subflow.workflow_id)
    const inputCount = Array.isArray(subflow.input_keys) ? subflow.input_keys.length : 0
    const nodeCount = stringifyValue(subflow.node_count)
    const subflowParts = [
      workflowName && workflowId ? `${workflowName} #${workflowId}` : workflowName || workflowId,
      inputCount ? `${label('输入', 'Inputs')} ${inputCount}` : '',
      nodeCount && nodeCount !== '-' ? `${label('节点', 'Nodes')} ${nodeCount}` : '',
    ].filter(Boolean)
    detailParts.push(...subflowParts)
  }

  return detailParts.filter(Boolean).join(' · ')
}

function buildTraceStepDetail(
  step: Record<string, unknown>,
  outputs: Record<string, unknown>,
  label: Labeler,
): string {
  const detailParts = [
    stringifyValue(step.status),
    stringifyValue(step.error),
  ]
  const attempts = Number(step.attempts)
  if (Number.isFinite(attempts) && attempts > 1) {
    detailParts.push(`${label('尝试', 'Attempts')} ${attempts}`)
  }

  if (String(step.node_type) === 'subflow') {
    const subflow = asRecord(outputs.subflow)
    const workflowName = stringifyValue(subflow.workflow_name)
    const workflowId = stringifyValue(subflow.workflow_id)
    const traceCount = stringifyValue(subflow.trace_count)
    const subflowParts = [
      workflowName && workflowId ? `${workflowName} #${workflowId}` : workflowName || workflowId,
      traceCount && traceCount !== '-' ? `${label('节点', 'Nodes')} ${traceCount}` : '',
    ].filter(Boolean)
    detailParts.push(...subflowParts)
  }

  return detailParts.filter(Boolean).join(' · ')
}

function previewStateTone(state: string): SummaryTone {
  if (state === 'blocked') return 'warning'
  if (state === 'skipped') return 'neutral'
  if (state === 'ready') return 'success'
  return 'neutral'
}

function traceStateTone(state: string): SummaryTone {
  if (state === 'succeeded') return 'success'
  if (state === 'failed') return 'error'
  if (state === 'skipped') return 'warning'
  return 'neutral'
}

function statusLabel(status: ToolCallState['status'], label: Labeler): string {
  if (status === 'running') return label('运行中', 'Running')
  if (status === 'error') return label('失败', 'Failed')
  return label('完成', 'Done')
}

function readArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function compactRows(rows: Array<[string, string]>): Array<{ label: string; value: string }> {
  return rows
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => ({ label, value }))
}

function compactTags(values: string[]): string[] {
  return values.filter(Boolean).slice(0, 4)
}

function formatWorkflowInputSource(value: unknown, label: Labeler): string {
  if (value === 'run_history') return label('最近成功输入', 'Last Successful Inputs')
  return stringifyValue(value)
}

function formatWorkflowEvidenceStatus(value: unknown, label: Labeler): string {
  if (value === 'proven') return label('最近成功', 'Recently Proven')
  if (value === 'regressed') return label('最近失败，曾成功', 'Failed After Success')
  if (value === 'failing') return label('最近失败', 'Recently Failed')
  if (value === 'running') return label('运行中', 'Running')
  if (value === 'untested') return label('未运行', 'Untested')
  return ''
}

function formatWorkflowOutputSummary(value: unknown, label: Labeler): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${label('数组', 'Array')} ${value.length}`
  if (!value || typeof value !== 'object') return stringifyValue(value)

  const record = value as Record<string, unknown>
  const preferred = ['message', 'summary', 'answer', 'result', 'status', 'ok', 'count', 'total', 'title']
  const selected: Array<[string, unknown]> = []
  for (const key of preferred) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') selected.push([key, record[key]])
    if (selected.length >= 3) break
  }

  const entries = selected.length > 0
    ? selected
    : Object.entries(record)
      .filter(([, item]) => item !== undefined && item !== null && item !== '')
      .slice(0, 3)

  if (entries.length === 0) return label('无输出', 'No output')
  const suffix = Object.keys(record).length > entries.length ? ' ...' : ''
  return entries.map(([key, item]) => `${key}: ${briefWorkflowValue(item, label)}`).join(' · ') + suffix
}

function briefWorkflowValue(value: unknown, label: Labeler): string {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${label('数组', 'Array')} ${value.length}`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const title = record.message ?? record.summary ?? record.title ?? record.name ?? record.id
    if (title !== undefined && title !== null && title !== '') return stringifyValue(title)
    return `${label('对象', 'Object')} ${Object.keys(record).length}`
  }
  return String(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
