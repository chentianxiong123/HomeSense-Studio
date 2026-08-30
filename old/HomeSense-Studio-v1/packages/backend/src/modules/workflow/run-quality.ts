import type Database from 'better-sqlite3'

export type WorkflowEvidenceStatus = 'untested' | 'proven' | 'regressed' | 'failing' | 'running'

export interface WorkflowRunQuality {
  workflow_id: number
  total_runs: number
  success_count: number
  failure_count: number
  last_run_status: string
  last_run_at: string
  last_success_at: string
  last_success_inputs_json: string
  last_success_input_keys: string[]
  evidence_status: WorkflowEvidenceStatus
}

type Db = Database.Database

const MIN_TIMESTAMP = '1970-01-01 00:00:00'
const RUN_AT_EXPR = "datetime(COALESCE(finished_at, started_at, ''))"

export interface WorkflowGraphVersion {
  graph_hash: string
  graph_updated_at: string
}

export function readWorkflowGraphVersion(db: Db, workflowId: number): WorkflowGraphVersion {
  const row = db.prepare(`
    SELECT graph_hash, graph_updated_at, updated_at, created_at
    FROM workflows
    WHERE id = ?
    LIMIT 1
  `).get(workflowId) as {
    graph_hash?: string
    graph_updated_at?: string
    updated_at?: string
    created_at?: string
  } | undefined

  return {
    graph_hash: String(row?.graph_hash ?? ''),
    graph_updated_at: String(row?.graph_updated_at || row?.updated_at || row?.created_at || ''),
  }
}

export function readWorkflowGraphUpdatedAt(db: Db, workflowId: number): string {
  return readWorkflowGraphVersion(db, workflowId).graph_updated_at
}

export function currentGraphRunFilter(version: WorkflowGraphVersion): { sql: string; params: unknown[] } {
  const cutoff = version.graph_updated_at || MIN_TIMESTAMP
  if (version.graph_hash) {
    return {
      sql: `
        AND (
          graph_hash = ?
          OR (COALESCE(graph_hash, '') = '' AND ${RUN_AT_EXPR} >= datetime(?))
        )
      `,
      params: [version.graph_hash, cutoff],
    }
  }

  return {
    sql: `AND ${RUN_AT_EXPR} >= datetime(?)`,
    params: [cutoff],
  }
}

export function readWorkflowRunQuality(db: Db, workflowId: number): WorkflowRunQuality {
  const graphVersion = readWorkflowGraphVersion(db, workflowId)
  const filter = currentGraphRunFilter(graphVersion)
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total_runs,
      SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failure_count
    FROM workflow_runs
    WHERE workflow_id = ?
      ${filter.sql}
  `).get(workflowId, ...filter.params) as {
    total_runs?: number
    success_count?: number
    failure_count?: number
  } | undefined
  const lastRun = db.prepare(`
    SELECT status, COALESCE(finished_at, started_at, '') AS run_at
    FROM workflow_runs
    WHERE workflow_id = ?
      ${filter.sql}
    ORDER BY ${RUN_AT_EXPR} DESC, id DESC
    LIMIT 1
  `).get(workflowId, ...filter.params) as { status?: string; run_at?: string } | undefined
  const lastSuccess = db.prepare(`
    SELECT COALESCE(finished_at, started_at, '') AS run_at, inputs_json
    FROM workflow_runs
    WHERE workflow_id = ?
      AND status = 'succeeded'
      ${filter.sql}
    ORDER BY ${RUN_AT_EXPR} DESC, id DESC
    LIMIT 1
  `).get(workflowId, ...filter.params) as { run_at?: string; inputs_json?: string } | undefined
  const lastSuccessInputs = safeParseObject(lastSuccess?.inputs_json ?? '', {})

  const totalRuns = Number(totals?.total_runs ?? 0)
  const successCount = Number(totals?.success_count ?? 0)
  const failureCount = Number(totals?.failure_count ?? 0)
  const lastStatus = String(lastRun?.status ?? '')
  return {
    workflow_id: workflowId,
    total_runs: totalRuns,
    success_count: successCount,
    failure_count: failureCount,
    last_run_status: lastStatus,
    last_run_at: String(lastRun?.run_at ?? ''),
    last_success_at: String(lastSuccess?.run_at ?? ''),
    last_success_inputs_json: Object.keys(lastSuccessInputs).length > 0 ? JSON.stringify(lastSuccessInputs) : '',
    last_success_input_keys: Object.keys(lastSuccessInputs),
    evidence_status: workflowEvidenceStatus({
      total_runs: totalRuns,
      success_count: successCount,
      last_run_status: lastStatus,
    }),
  }
}

export function workflowEvidenceStatus(runStats: {
  total_runs: number
  success_count: number
  last_run_status: string
}): WorkflowEvidenceStatus {
  if (runStats.total_runs === 0) return 'untested'
  if (runStats.last_run_status === 'succeeded') return 'proven'
  if (runStats.last_run_status === 'failed') return runStats.success_count > 0 ? 'regressed' : 'failing'
  if (runStats.last_run_status === 'running' || runStats.last_run_status === 'pending') return 'running'
  return runStats.total_runs > 0 ? 'regressed' : 'untested'
}

function safeParseObject(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return fallback
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : fallback
  } catch {
    return fallback
  }
}
