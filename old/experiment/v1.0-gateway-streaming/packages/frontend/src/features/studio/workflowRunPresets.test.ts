import { describe, expect, it } from 'vitest'
import { buildWorkflowRunPresets } from './workflowRunPresets'

const workflow = {
  id: 7,
  name: '看电视',
  description: '',
  trigger_type: 'manual',
  cron_expression: null,
  published: 1,
  graph_json: '{}',
  created_at: '',
  updated_at: '',
} as const

describe('buildWorkflowRunPresets', () => {
  it('extracts workflow inputs from matching experience path metadata', () => {
    const presets = buildWorkflowRunPresets(workflow, [
      {
        id: 'memory.experience_path.workflow.7.run.22',
        kind: 'experience_path',
        title: '看电视 #22',
        summary: '',
        status: 'active',
        source: 'user',
        retrieval_hint: '',
        skill_refs: [],
        device_refs: [],
        metadata: {
          workflow_id: 7,
          workflow_inputs: { device_id: 3, capability_id: 'mi.ir_key' },
          saved_from: 'workflow_run_history',
          success_count: 2,
          failure_count: 0,
        },
      },
      {
        id: 'other',
        kind: 'experience_path',
        title: 'Other',
        summary: '',
        status: 'active',
        source: 'runtime',
        retrieval_hint: '',
        skill_refs: [],
        device_refs: [],
        metadata: { workflow_id: 8, workflow_inputs: { device_id: 9 } },
      },
    ])

    expect(presets).toEqual([
      {
        id: 'memory.experience_path.workflow.7.run.22',
        title: '看电视 #22',
        detail: 'workflow_run_history',
        status: 'active',
        inputs: { device_id: 3, capability_id: 'mi.ir_key' },
        successCount: 2,
        failureCount: 0,
      },
    ])
  })

  it('falls back to workflow step params when metadata inputs are missing', () => {
    const presets = buildWorkflowRunPresets(workflow, [
      {
        id: 'memory.experience_path.workflow.7',
        kind: 'experience_path',
        title: 'Runtime path',
        summary: '',
        status: 'active',
        source: 'runtime',
        retrieval_hint: '',
        skill_refs: [],
        device_refs: [],
        metadata: {
          workflow_id: 7,
          steps: [
            {
              tool: 'workflow',
              action: 'run_workflow',
              params: { inputs: { intent: 'watch_tv' } },
            },
          ],
        },
      },
    ])

    expect(presets[0]?.inputs).toEqual({ intent: 'watch_tv' })
    expect(presets[0]?.successCount).toBe(0)
  })
})
