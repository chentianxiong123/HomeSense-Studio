import { describe, expect, it } from 'vitest'
import type { Workflow, WorkflowNodeDefinition } from '@/api/workflow'
import {
  buildNodeLibrarySections,
  buildWorkflowHeaderChips,
} from './studioEditorChrome'

const label = (zh: string, en: string) => `${zh}|${en}`

describe('buildNodeLibrarySections', () => {
  it('groups node definitions by category in a stable editor order', () => {
    const nodeTypes: WorkflowNodeDefinition[] = [
      {
        type: 'answer',
        label: 'Answer',
        icon: 'A',
        color: '#000',
        category: 'output',
        description: 'Answer node',
        default_config: {},
        config_schema: [],
        output_schema: [],
      },
      {
        type: 'start',
        label: 'Start',
        icon: 'S',
        color: '#000',
        category: 'trigger',
        description: 'Start node',
        default_config: {},
        config_schema: [],
        output_schema: [],
      },
      {
        type: 'llm',
        label: 'LLM',
        icon: 'L',
        color: '#000',
        category: 'compute',
        description: 'LLM node',
        default_config: {},
        config_schema: [],
        output_schema: [],
      },
    ]

    const sections = buildNodeLibrarySections(nodeTypes, label)

    expect(sections.map((section) => section.key)).toEqual(['trigger', 'compute', 'output'])
    expect(sections.map((section) => section.title)).toEqual([
      '触发器|Trigger',
      '计算|Compute',
      '输出|Output',
    ])
    expect(sections[0].nodes.map((node) => node.type)).toEqual(['start'])
  })
})

describe('buildWorkflowHeaderChips', () => {
  const workflow: Workflow = {
    id: 9,
    name: 'Watch Bilibili On Toshiba TV Demo',
    description: 'Intent -> TV flow',
    trigger_type: 'chat',
    cron_expression: null,
    published: 1,
    graph_json: '{"nodes":[],"edges":[]}',
    created_at: '2026-05-01T09:00:00.000Z',
    updated_at: '2026-05-02T10:00:00.000Z',
  }

  it('builds localized workflow header chips from publish, dirty, preview, and run state', () => {
    const chips = buildWorkflowHeaderChips(
      {
        workflow,
        isDirty: true,
        latestRunStatus: 'failed',
        previewExecutable: false,
      },
      label,
    )

    expect(chips).toEqual([
      { label: '聊天触发|Chat Trigger', tone: 'neutral' },
      { label: '已发布|Published', tone: 'success' },
      { label: '未保存|Unsaved', tone: 'warning' },
      { label: '预演阻塞|Preview Blocked', tone: 'danger' },
      { label: '最近运行失败|Last Run Failed', tone: 'danger' },
    ])
  })

  it('omits optional chips when no preview or run state exists', () => {
    const chips = buildWorkflowHeaderChips(
      {
        workflow: { ...workflow, published: 0, trigger_type: 'manual' },
        isDirty: false,
      },
      label,
    )

    expect(chips).toEqual([
      { label: '手动触发|Manual Trigger', tone: 'neutral' },
      { label: '草稿|Draft', tone: 'neutral' },
    ])
  })
})
