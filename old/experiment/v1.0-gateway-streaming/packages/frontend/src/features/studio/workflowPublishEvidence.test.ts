import { describe, expect, it } from 'vitest'
import type { WorkflowRun } from '@/api/workflow'
import { buildWorkflowPublishEvidence } from './workflowPublishEvidence'

const label = (zh: string, en: string) => `${zh}|${en}`

describe('buildWorkflowPublishEvidence', () => {
  it('marks workflows without runs as untested', () => {
    expect(buildWorkflowPublishEvidence([], label)).toEqual({
      status: 'untested',
      tone: 'neutral',
      label: '未运行|Untested',
      hint: '先跑通一次，再发布给 Chat 复用。|Run it successfully once before publishing to Chat.',
      successCount: 0,
      failureCount: 0,
    })
  })

  it('marks a latest successful run as proven', () => {
    expect(buildWorkflowPublishEvidence([
      run(3, 'succeeded'),
      run(2, 'failed'),
      run(1, 'succeeded'),
    ], label)).toMatchObject({
      status: 'proven',
      tone: 'success',
      label: '最近成功|Recently Proven',
      successCount: 2,
      failureCount: 1,
    })
  })

  it('marks a latest failure after previous success as regressed', () => {
    expect(buildWorkflowPublishEvidence([
      run(4, 'failed'),
      run(3, 'succeeded'),
    ], label)).toMatchObject({
      status: 'regressed',
      tone: 'warning',
      label: '最近失败，曾成功|Failed After Success',
      successCount: 1,
      failureCount: 1,
    })
  })

  it('marks failures without previous success as failing', () => {
    expect(buildWorkflowPublishEvidence([
      run(4, 'failed'),
      run(3, 'failed'),
    ], label)).toMatchObject({
      status: 'failing',
      tone: 'danger',
      label: '最近失败|Recently Failed',
      successCount: 0,
      failureCount: 2,
    })
  })

  it('ignores runs that happened before the current graph update', () => {
    expect(buildWorkflowPublishEvidence([
      run(3, 'succeeded', '2026-05-31 08:00:00'),
      run(2, 'failed', '2026-05-31 09:00:00'),
    ], label, undefined, '2026-05-31 10:00:00')).toEqual({
      status: 'untested',
      tone: 'neutral',
      label: '未运行|Untested',
      hint: '先跑通一次，再发布给 Chat 复用。|Run it successfully once before publishing to Chat.',
      successCount: 0,
      failureCount: 0,
    })
  })

  it('prefers workflow hash over same-second timestamps', () => {
    expect(buildWorkflowPublishEvidence([
      run(3, 'succeeded', '2026-05-31 10:00:00', 'old_hash'),
      run(2, 'failed', '2026-05-31 10:00:00', 'old_hash'),
    ], label, 'new_hash', '2026-05-31 10:00:00')).toEqual({
      status: 'untested',
      tone: 'neutral',
      label: '未运行|Untested',
      hint: '先跑通一次，再发布给 Chat 复用。|Run it successfully once before publishing to Chat.',
      successCount: 0,
      failureCount: 0,
    })
  })
})

function run(id: number, status: WorkflowRun['status'], finishedAt = '2026-05-31 08:00:00', graphHash = ''): WorkflowRun {
  return {
    id,
    workflow_id: 7,
    status,
    triggered_by: 'manual',
    started_at: '',
    finished_at: finishedAt,
    result_json: '{}',
    graph_hash: graphHash,
    inputs_json: '{}',
    trace_json: '[]',
    events_json: '[]',
  }
}
