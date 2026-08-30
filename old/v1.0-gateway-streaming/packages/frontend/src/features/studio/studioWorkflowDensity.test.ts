import { describe, expect, it } from 'vitest'
import type { Workflow, WorkflowRunResult } from '@/api/workflow'
import {
  buildWorkflowCollectionMetrics,
  buildWorkflowEditorSummaryItems,
  buildWorkflowSectionHeading,
} from './studioWorkflowDensity'

const label = (zh: string, en: string) => `${zh}|${en}`

const workflows: Workflow[] = [
  {
    id: 1,
    name: 'Watch Bilibili On Toshiba TV Demo',
    description: '',
    trigger_type: 'chat',
    cron_expression: null,
    published: 1,
    graph_json: '{"nodes":[],"edges":[]}',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-02T00:00:00.000Z',
  },
  {
    id: 2,
    name: 'Nightly Demo',
    description: '',
    trigger_type: 'cron',
    cron_expression: '0 20 * * *',
    published: 0,
    graph_json: '{"nodes":[],"edges":[]}',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-02T00:00:00.000Z',
  },
  {
    id: 3,
    name: 'Manual Demo',
    description: '',
    trigger_type: 'manual',
    cron_expression: null,
    published: 1,
    graph_json: '{"nodes":[],"edges":[]}',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-02T00:00:00.000Z',
  },
]

describe('buildWorkflowCollectionMetrics', () => {
  it('returns compact metrics for sidebar workflow overview', () => {
    expect(buildWorkflowCollectionMetrics(workflows, label)).toEqual([
      { label: '总数|Total', value: '3' },
      { label: '已发布|Published', value: '2' },
      { label: '聊天触发|Chat', value: '1' },
    ])
  })
})

describe('buildWorkflowSectionHeading', () => {
  it('returns localized section titles with counts for mainline and workbench groups', () => {
    expect(buildWorkflowSectionHeading('mainline', 2, label)).toEqual({
      title: '主线演示|Mainline Demos',
      summary: '2 个工作流|2 workflows',
    })
    expect(buildWorkflowSectionHeading('workbench', 1, label)).toEqual({
      title: '其余工作流|Other Workflows',
      summary: '1 个工作流|1 workflows',
    })
  })
})

describe('buildWorkflowEditorSummaryItems', () => {
  it('returns stable summary items for graph shape and last execution state', () => {
    const latestRun: WorkflowRunResult = {
      run_id: 1,
      workflow_id: 1,
      status: 'succeeded',
      outputs: {},
      trace: [],
      events: [],
    }

    expect(buildWorkflowEditorSummaryItems({
      nodeCount: 7,
      edgeCount: 6,
      previewExecutable: true,
      latestRunStatus: latestRun.status,
      successCount: 2,
      failureCount: 1,
    }, label)).toEqual([
      { label: '节点|Nodes', value: '7' },
      { label: '连线|Edges', value: '6' },
      { label: '预演|Preview', value: '就绪|Ready' },
      { label: '最近运行|Last Run', value: '成功|Succeeded' },
      { label: '运行证据|Run Evidence', value: '成功 2|Success 2 · 失败 1|Failure 1' },
    ])
  })

  it('falls back cleanly when no preview or run has happened yet', () => {
    expect(buildWorkflowEditorSummaryItems({
      nodeCount: 0,
      edgeCount: 0,
    }, label)).toEqual([
      { label: '节点|Nodes', value: '0' },
      { label: '连线|Edges', value: '0' },
      { label: '预演|Preview', value: '未预演|Not Previewed' },
      { label: '最近运行|Last Run', value: '未运行|No Runs Yet' },
      { label: '运行证据|Run Evidence', value: '尚无记录|No evidence yet' },
    ])
  })
})
