import type { WorkflowRun } from '@/api/workflow'

type Labeler = (zh: string, en: string) => string

export type WorkflowPublishEvidenceTone = 'neutral' | 'success' | 'warning' | 'danger'
export type WorkflowPublishEvidenceStatus = 'untested' | 'proven' | 'regressed' | 'failing' | 'running'

export interface WorkflowPublishEvidence {
  status: WorkflowPublishEvidenceStatus
  tone: WorkflowPublishEvidenceTone
  label: string
  hint: string
  successCount: number
  failureCount: number
}

export function buildWorkflowPublishEvidence(
  runs: WorkflowRun[],
  label: Labeler,
  graphHash?: string | null,
  graphUpdatedAt?: string | null,
): WorkflowPublishEvidence {
  const scopedRuns = filterWorkflowRunsForGraph(runs, graphHash, graphUpdatedAt)
  const successCount = scopedRuns.filter((run) => run.status === 'succeeded').length
  const failureCount = scopedRuns.filter((run) => run.status === 'failed').length
  const latest = scopedRuns[0]

  if (!latest) {
    return {
      status: 'untested',
      tone: 'neutral',
      label: label('未运行', 'Untested'),
      hint: label('先跑通一次，再发布给 Chat 复用。', 'Run it successfully once before publishing to Chat.'),
      successCount,
      failureCount,
    }
  }

  if (latest.status === 'succeeded') {
    return {
      status: 'proven',
      tone: 'success',
      label: label('最近成功', 'Recently Proven'),
      hint: label('已有成功运行证据，适合发布。', 'Successful run evidence exists; suitable to publish.'),
      successCount,
      failureCount,
    }
  }

  if (latest.status === 'running' || latest.status === 'pending') {
    return {
      status: 'running',
      tone: 'warning',
      label: latest.status === 'running' ? label('运行中', 'Running') : label('等待中', 'Pending'),
      hint: label('等待这次运行结束后再判断。', 'Wait for the current run before judging readiness.'),
      successCount,
      failureCount,
    }
  }

  if (successCount > 0) {
    return {
      status: 'regressed',
      tone: 'warning',
      label: label('最近失败，曾成功', 'Failed After Success'),
      hint: label('曾经成功，但最近失败；建议重新跑通。', 'It has succeeded before, but the latest run failed; rerun before publishing.'),
      successCount,
      failureCount,
    }
  }

  return {
    status: 'failing',
    tone: 'danger',
    label: label('最近失败', 'Recently Failed'),
    hint: label('还没有成功证据；建议先修复。', 'No successful evidence yet; fix it first.'),
    successCount,
    failureCount,
  }
}

export function filterWorkflowRunsForGraph(
  runs: WorkflowRun[],
  graphHash?: string | null,
  graphUpdatedAt?: string | null,
): WorkflowRun[] {
  const cutoff = toTimestamp(graphUpdatedAt)
  if (!graphHash && cutoff === 0) return runs
  return runs.filter((run) => {
    if (graphHash) {
      if (run.graph_hash && run.graph_hash === graphHash) return true
      if (run.graph_hash && run.graph_hash !== graphHash) return false
    }
    if (cutoff === 0) return true
    return toTimestamp(run.finished_at || run.started_at) >= cutoff
  })
}

function toTimestamp(raw?: string | null): number {
  if (!raw) return 0
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const time = Date.parse(normalized)
  return Number.isFinite(time) ? time : 0
}
