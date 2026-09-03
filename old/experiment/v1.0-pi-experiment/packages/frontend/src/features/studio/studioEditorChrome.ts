import type { Workflow, WorkflowNodeDefinition, WorkflowRunResult } from '@/api/workflow'

type Labeler = (zh: string, en: string) => string

export type NodeLibrarySection = {
  key: WorkflowNodeDefinition['category']
  title: string
  nodes: WorkflowNodeDefinition[]
}

export type WorkflowHeaderChip = {
  label: string
  tone: 'neutral' | 'success' | 'warning' | 'danger'
}

const CATEGORY_ORDER: WorkflowNodeDefinition['category'][] = [
  'trigger',
  'device',
  'logic',
  'compute',
  'control',
  'output',
]

const CATEGORY_LABELS: Record<WorkflowNodeDefinition['category'], [string, string]> = {
  trigger: ['触发器', 'Trigger'],
  device: ['设备', 'Device'],
  logic: ['逻辑', 'Logic'],
  compute: ['计算', 'Compute'],
  control: ['控制', 'Control'],
  output: ['输出', 'Output'],
}

const TRIGGER_LABELS: Record<Workflow['trigger_type'], [string, string]> = {
  chat: ['聊天触发', 'Chat Trigger'],
  cron: ['定时触发', 'Cron Trigger'],
  manual: ['手动触发', 'Manual Trigger'],
}

export function buildNodeLibrarySections(
  nodeTypes: WorkflowNodeDefinition[],
  label: Labeler,
): NodeLibrarySection[] {
  return CATEGORY_ORDER
    .map((category) => ({
      key: category,
      title: label(CATEGORY_LABELS[category][0], CATEGORY_LABELS[category][1]),
      nodes: nodeTypes.filter((nodeType) => nodeType.category === category),
    }))
    .filter((section) => section.nodes.length > 0)
}

export function buildWorkflowHeaderChips(
  input: {
    workflow: Workflow
    isDirty: boolean
    previewExecutable?: boolean
    latestRunStatus?: WorkflowRunResult['status']
  },
  label: Labeler,
): WorkflowHeaderChip[] {
  const chips: WorkflowHeaderChip[] = [
    { label: label(TRIGGER_LABELS[input.workflow.trigger_type][0], TRIGGER_LABELS[input.workflow.trigger_type][1]), tone: 'neutral' },
    {
      label: input.workflow.published ? label('已发布', 'Published') : label('草稿', 'Draft'),
      tone: input.workflow.published ? 'success' : 'neutral',
    },
  ]

  if (input.isDirty) {
    chips.push({ label: label('未保存', 'Unsaved'), tone: 'warning' })
  }

  if (input.previewExecutable != null) {
    chips.push({
      label: input.previewExecutable ? label('预演可执行', 'Preview Ready') : label('预演阻塞', 'Preview Blocked'),
      tone: input.previewExecutable ? 'success' : 'danger',
    })
  }

  if (input.latestRunStatus) {
    chips.push({
      label: input.latestRunStatus === 'succeeded'
        ? label('最近运行成功', 'Last Run Succeeded')
        : label('最近运行失败', 'Last Run Failed'),
      tone: input.latestRunStatus === 'succeeded' ? 'success' : 'danger',
    })
  }

  return chips
}
