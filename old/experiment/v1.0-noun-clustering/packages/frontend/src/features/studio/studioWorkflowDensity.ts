import type { Workflow } from '@/api/workflow'

type Labeler = (zh: string, en: string) => string

export type WorkflowMetric = {
  label: string
  value: string
}

export type WorkflowSectionHeading = {
  title: string
  summary: string
}

export type WorkflowEditorSummaryItem = {
  label: string
  value: string
}

export function buildWorkflowCollectionMetrics(
  workflows: Workflow[],
  label: Labeler,
): WorkflowMetric[] {
  return [
    { label: label('总数', 'Total'), value: String(workflows.length) },
    { label: label('已发布', 'Published'), value: String(workflows.filter((workflow) => Boolean(workflow.published)).length) },
    { label: label('聊天触发', 'Chat'), value: String(workflows.filter((workflow) => workflow.trigger_type === 'chat').length) },
  ]
}

export function buildWorkflowSectionHeading(
  key: 'mainline' | 'workbench',
  count: number,
  label: Labeler,
): WorkflowSectionHeading {
  return key === 'mainline'
    ? {
        title: label('主线演示', 'Mainline Demos'),
        summary: label(`${count} 个工作流`, `${count} workflows`),
      }
    : {
        title: label('其余工作流', 'Other Workflows'),
        summary: label(`${count} 个工作流`, `${count} workflows`),
      }
}

export function buildWorkflowEditorSummaryItems(
  input: {
    nodeCount: number
    edgeCount: number
    previewExecutable?: boolean
    latestRunStatus?: 'pending' | 'running' | 'succeeded' | 'failed'
    successCount?: number
    failureCount?: number
  },
  label: Labeler,
): WorkflowEditorSummaryItem[] {
  const evidenceParts: string[] = []
  if (Number(input.successCount ?? 0) > 0) evidenceParts.push(label(`成功 ${input.successCount}`, `Success ${input.successCount}`))
  if (Number(input.failureCount ?? 0) > 0) evidenceParts.push(label(`失败 ${input.failureCount}`, `Failure ${input.failureCount}`))

  return [
    { label: label('节点', 'Nodes'), value: String(input.nodeCount) },
    { label: label('连线', 'Edges'), value: String(input.edgeCount) },
    {
      label: label('预演', 'Preview'),
      value: input.previewExecutable == null
        ? label('未预演', 'Not Previewed')
        : input.previewExecutable
          ? label('就绪', 'Ready')
          : label('阻塞', 'Blocked'),
    },
    {
      label: label('最近运行', 'Last Run'),
      value: input.latestRunStatus == null
        ? label('未运行', 'No Runs Yet')
        : input.latestRunStatus === 'succeeded'
          ? label('成功', 'Succeeded')
          : input.latestRunStatus === 'failed'
            ? label('失败', 'Failed')
            : input.latestRunStatus === 'running'
              ? label('运行中', 'Running')
              : label('等待中', 'Pending'),
    },
    {
      label: label('运行证据', 'Run Evidence'),
      value: evidenceParts.length > 0
        ? evidenceParts.join(' · ')
        : label('尚无记录', 'No evidence yet'),
    },
  ]
}
