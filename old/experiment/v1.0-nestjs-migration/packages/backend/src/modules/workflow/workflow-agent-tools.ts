import { getDb } from '../../db/index.js'
import type Database from 'better-sqlite3'
import type { ExecutorInvokeResult } from '../executor-gateway/index.js'
import { workflowPreviewService, type WorkflowPreviewResult } from './preview-workflow.js'
import { workflowRuntime } from './run-workflow.js'
import type { WorkflowResult } from './types.js'
import { currentGraphRunFilter, readWorkflowGraphVersion, readWorkflowRunQuality, type WorkflowGraphVersion } from './run-quality.js'

type WorkflowToolPreviewResult = WorkflowPreviewResult & {
  inputs: Record<string, unknown>
  input_source: WorkflowToolInputSource
}

export const WORKFLOW_AGENT_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_workflows',
      description: 'List reusable HomeSense workflows that the assistant may preview or run for a multi-step smart-home task.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Maximum workflows to return. Defaults to 12.' },
          query: { type: 'string', description: 'Optional keyword filter for workflow name or description.' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'preview_workflow',
      description: 'Preview a workflow with structured inputs. Use this before running a workflow when checking whether its device steps are valid.',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: { type: 'integer' },
          workflow_name: { type: 'string' },
          inputs: { type: 'object', description: 'Workflow input JSON.' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_workflow',
      description: 'Run a reusable HomeSense workflow after it has a clear target and executable preview. The runtime previews again and blocks if preview is not executable.',
      parameters: {
        type: 'object',
        properties: {
          workflow_id: { type: 'integer' },
          workflow_name: { type: 'string' },
          inputs: { type: 'object', description: 'Workflow input JSON.' },
        },
      },
    },
  },
]

export function isWorkflowAgentTool(name: string): boolean {
  return WORKFLOW_AGENT_TOOL_DEFINITIONS.some((tool) => tool.function.name === name)
}

export async function executeWorkflowAgentTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ExecutorInvokeResult> {
  try {
    switch (name) {
      case 'list_workflows':
        return success(name, listWorkflows(args))
      case 'preview_workflow':
        return success(name, previewWorkflow(args))
      case 'run_workflow':
        return success(name, await runWorkflow(args))
      default:
        return error(name, 'UNKNOWN_WORKFLOW_TOOL', `Unknown workflow agent tool: ${name}`)
    }
  } catch (err) {
    return error(name, 'WORKFLOW_TOOL_ERROR', (err as Error).message)
  }
}

function listWorkflows(args: Record<string, unknown>): { workflows: Array<Record<string, unknown>> } {
  const db = getDb()
  const limit = clampLimit(Number(args.limit ?? 12), 1, 24)
  const fetchLimit = Math.min(Math.max(limit * 4, limit), 80)
  const query = String(args.query ?? '').trim()
  const like = `%${query}%`
  const rows = query
    ? db.prepare(`
        SELECT id, name, description, trigger_type, published, updated_at
        FROM workflows
        WHERE trigger_type IN ('manual', 'chat')
          AND published = 1
          AND (name LIKE ? OR description LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(like, like, fetchLimit)
    : db.prepare(`
        SELECT id, name, description, trigger_type, published, updated_at
        FROM workflows
        WHERE trigger_type IN ('manual', 'chat')
          AND published = 1
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(fetchLimit)

  const workflows = rows
    .map((row) => summarizeWorkflow(row as Record<string, unknown>))
    .filter((workflow) => workflow.evidence_status === 'proven')
    .sort((left, right) => {
      const scoreDelta = Number(right.reuse_score ?? 0) - Number(left.reuse_score ?? 0)
      if (scoreDelta !== 0) return scoreDelta
      return String(right.updated_at ?? '').localeCompare(String(left.updated_at ?? ''))
    })
    .slice(0, limit)

  return {
    workflows,
  }
}

function previewWorkflow(args: Record<string, unknown>): WorkflowToolPreviewResult {
  const workflowId = resolvePublishedWorkflowId(args)
  const resolved = resolveWorkflowToolInputs(getDb(), workflowId, args)
  const preview = workflowPreviewService.previewWorkflow(workflowId, resolved.inputs)
  return {
    ...preview,
    inputs: resolved.inputs,
    input_source: resolved.source,
  }
}

async function runWorkflow(args: Record<string, unknown>): Promise<{
  preview: WorkflowToolPreviewResult
  run?: WorkflowResult
  inputs: Record<string, unknown>
  input_source: WorkflowToolInputSource
  blocked?: boolean
  message?: string
}> {
  const workflowId = resolvePublishedWorkflowId(args)
  const resolved = resolveWorkflowToolInputs(getDb(), workflowId, args)
  const preview = workflowPreviewService.previewWorkflow(workflowId, resolved.inputs)
  const previewResult = {
    ...preview,
    inputs: resolved.inputs,
    input_source: resolved.source,
  }
  if (!preview.executable) {
    return {
      preview: previewResult,
      inputs: resolved.inputs,
      input_source: resolved.source,
      blocked: true,
      message: `Workflow preview blocked: ${preview.warnings.join('; ') || 'not executable'}`,
    }
  }

  const run = await workflowRuntime.runWorkflow(workflowId, resolved.inputs, { triggeredBy: 'chat' })
  return {
    preview: previewResult,
    run,
    inputs: resolved.inputs,
    input_source: resolved.source,
  }
}

function resolvePublishedWorkflowId(args: Record<string, unknown>): number {
  const workflow = resolvePublishedWorkflow(args)
  return Number(workflow.id)
}

function resolvePublishedWorkflow(args: Record<string, unknown>): { id: number } {
  const rawId = args.workflow_id
  const workflowId = Number(rawId)
  if (Number.isInteger(workflowId) && workflowId > 0) {
    const row = getDb().prepare(`
      SELECT id
      FROM workflows
      WHERE id = ?
        AND published = 1
        AND trigger_type IN ('manual', 'chat')
      LIMIT 1
    `).get(workflowId) as { id?: number } | undefined
    if (!row?.id) {
      throw new Error(`Workflow is not published for Chat: #${workflowId}`)
    }
    assertWorkflowReadyForChat(Number(row.id), `#${workflowId}`)
    return { id: Number(row.id) }
  }

  const workflowName = String(args.workflow_name ?? '').trim()
  if (!workflowName) {
    throw new Error('workflow_id or workflow_name is required')
  }

  const row = getDb().prepare(`
    SELECT id
    FROM workflows
    WHERE name = ?
      AND published = 1
      AND trigger_type IN ('manual', 'chat')
    LIMIT 1
  `).get(workflowName) as { id?: number } | undefined
  if (!row?.id) {
    throw new Error(`Workflow is not published for Chat: ${workflowName}`)
  }
  assertWorkflowReadyForChat(Number(row.id), workflowName)
  return { id: Number(row.id) }
}

function assertWorkflowReadyForChat(workflowId: number, label: string): void {
  const quality = readWorkflowRunQuality(getDb(), workflowId)
  if (quality.evidence_status === 'proven') return
  throw new Error(`Workflow is not ready for Chat reuse: ${label} (${quality.evidence_status})`)
}

function summarizeWorkflow(row: Record<string, unknown>): Record<string, unknown> {
  const workflowId = Number(row.id)
  const counts = getWorkflowNodeCounts(workflowId)
  const quality = readWorkflowRunQuality(getDb(), workflowId)
  return {
    id: workflowId,
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    trigger_type: String(row.trigger_type ?? ''),
    published: Boolean(row.published),
    updated_at: row.updated_at,
    node_count: counts.node_count,
    device_step_count: counts.device_step_count,
    has_device_steps: counts.device_step_count > 0,
    success_count: quality.success_count,
    failure_count: quality.failure_count,
    last_run_status: quality.last_run_status,
    last_run_at: quality.last_run_at,
    evidence_status: quality.evidence_status,
    reuse_score: workflowReuseScore(quality, counts),
  }
}

function getWorkflowNodeCounts(workflowId: number): { node_count: number; device_step_count: number } {
  const db = getDb()
  const row = db.prepare(`
    SELECT
      COUNT(*) AS node_count,
      SUM(CASE WHEN type = 'device_capability' THEN 1 ELSE 0 END) AS device_step_count
    FROM workflow_nodes
    WHERE workflow_id = ?
  `).get(workflowId) as { node_count?: number; device_step_count?: number } | undefined

  return {
    node_count: Number(row?.node_count ?? 0),
    device_step_count: Number(row?.device_step_count ?? 0),
  }
}

function workflowReuseScore(
  runStats: { success_count: number; failure_count: number; last_run_status: string },
  counts: { node_count: number; device_step_count: number },
): number {
  let score = 0.48
  score += Math.min(runStats.success_count, 5) * 0.08
  score -= Math.min(runStats.failure_count, 5) * 0.06
  if (runStats.last_run_status === 'succeeded') score += 0.18
  if (runStats.last_run_status === 'failed') score -= 0.16
  if (runStats.last_run_status === 'running' || runStats.last_run_status === 'pending') score -= 0.04
  if (counts.device_step_count > 0) score += 0.04
  if (counts.node_count === 0) score -= 0.12
  return Math.max(0.05, Math.min(0.98, Number(score.toFixed(2))))
}

export type WorkflowToolInputSource = 'explicit' | 'memory' | 'run_history' | 'empty'

export function resolveWorkflowToolInputs(
  db: Database.Database,
  workflowId: number,
  args: Record<string, unknown>,
): { inputs: Record<string, unknown>; source: WorkflowToolInputSource } {
  const explicit = asRecord(args.inputs)
  if (Object.keys(explicit).length > 0) {
    return { inputs: explicit, source: 'explicit' }
  }

  const graphVersion = readWorkflowGraphVersion(db, workflowId)
  const fromMemory = readBestWorkflowInputs(db, workflowId, graphVersion.graph_hash)
  if (fromMemory && Object.keys(fromMemory).length > 0) {
    return { inputs: fromMemory, source: 'memory' }
  }

  const fromRunHistory = readLastSuccessfulWorkflowInputs(db, workflowId, graphVersion)
  if (fromRunHistory && Object.keys(fromRunHistory).length > 0) {
    return { inputs: fromRunHistory, source: 'run_history' }
  }

  return { inputs: {}, source: 'empty' }
}

function readBestWorkflowInputs(
  db: Database.Database,
  workflowId: number,
  currentGraphHash: string,
): Record<string, unknown> | null {
  const rows = db.prepare(`
    SELECT m.metadata_json, p.success_count, p.failure_count, m.updated_at
    FROM memory_items m
    JOIN memory_experience_paths p ON p.memory_item_id = m.id
    WHERE m.kind = 'experience_path'
      AND m.status = 'active'
      AND json_extract(m.metadata_json, '$.workflow_id') = ?
    ORDER BY p.success_count DESC, p.failure_count ASC, m.updated_at DESC
    LIMIT 5
  `).all(workflowId) as Array<{
    metadata_json: string
    success_count: number
    failure_count: number
    updated_at: string
  }>

  for (const row of rows) {
    const metadata = safeParseObject(row.metadata_json)
    const memoryGraphHash = String(metadata.workflow_graph_hash ?? metadata.graph_hash ?? '').trim()
    if (memoryGraphHash && currentGraphHash && memoryGraphHash !== currentGraphHash) {
      continue
    }
    const inputs = asRecord(metadata.workflow_inputs)
    if (Object.keys(inputs).length > 0) return inputs
  }

  return null
}

function readLastSuccessfulWorkflowInputs(
  db: Database.Database,
  workflowId: number,
  graphVersion: WorkflowGraphVersion,
): Record<string, unknown> | null {
  const filter = currentGraphRunFilter(graphVersion)
  const rows = db.prepare(`
    SELECT inputs_json
    FROM workflow_runs
    WHERE workflow_id = ?
      AND status = 'succeeded'
      ${filter.sql}
    ORDER BY datetime(COALESCE(finished_at, started_at, '')) DESC, id DESC
    LIMIT 5
  `).all(workflowId, ...filter.params) as Array<{ inputs_json: string }>

  for (const row of rows) {
    const inputs = safeParseObject(row.inputs_json)
    if (Object.keys(inputs).length > 0) return inputs
  }

  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeParseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return asRecord(parsed)
  } catch {
    return {}
  }
}

function clampLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function success(executor: string, data: unknown): ExecutorInvokeResult {
  return { status: 'success', executor, data }
}

function error(executor: string, code: string, message: string): ExecutorInvokeResult {
  return { status: 'error', executor, error: code, message }
}
