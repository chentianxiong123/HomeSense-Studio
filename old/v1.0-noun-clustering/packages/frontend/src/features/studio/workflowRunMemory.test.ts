import { describe, expect, it } from 'vitest'
import { buildWorkflowRunExperiencePayload } from './workflowRunMemory'

describe('buildWorkflowRunExperiencePayload', () => {
  it('builds a reusable workflow memory path from a succeeded run', () => {
    const payload = buildWorkflowRunExperiencePayload({
      id: 7,
      name: '看电视',
      description: '打开电视并进入 B 站',
      trigger_type: 'manual',
      cron_expression: null,
      published: 1,
      graph_json: '{}',
      created_at: '',
      updated_at: '',
    }, {
      id: 22,
      workflow_id: 7,
      status: 'succeeded',
      triggered_by: 'manual',
      started_at: '2026-05-31 10:00:00',
      finished_at: '2026-05-31 10:00:03',
      inputs_json: JSON.stringify({ device_id: 3, capability_id: 'mi.ir_key', key: 'BACK' }),
      result_json: JSON.stringify({ answer: 'done' }),
      trace_json: '[]',
      events_json: '[]',
    })

    expect(payload).toMatchObject({
      id: 'memory.experience_path.workflow.7.run.22',
      title: '看电视 #22',
      source: 'user',
      status: 'active',
      origin_trace_id: 'workflow.7.run.22',
      steps: [
        {
          tool: 'workflow',
          action: 'run_workflow',
          params: {
            workflow_id: 7,
            workflow_name: '看电视',
            inputs: { device_id: 3, capability_id: 'mi.ir_key', key: 'BACK' },
          },
        },
      ],
      device_refs: ['device:3'],
      metadata: {
        saved_from: 'workflow_run_history',
        workflow_run_id: 22,
        run_status: 'succeeded',
      },
    })
  })

  it('returns null for invalid run inputs', () => {
    const payload = buildWorkflowRunExperiencePayload({
      id: 7,
      name: 'Broken',
      description: '',
      trigger_type: 'manual',
      cron_expression: null,
      published: 0,
      graph_json: '{}',
      created_at: '',
      updated_at: '',
    }, {
      id: 1,
      workflow_id: 7,
      status: 'failed',
      triggered_by: 'manual',
      started_at: null,
      finished_at: null,
      inputs_json: 'not json',
      result_json: '{}',
      trace_json: '[]',
      events_json: '[]',
    })

    expect(payload).toBeNull()
  })
})
