import { describe, expect, it } from 'vitest'
import { buildWorkflowToolSummary } from './workflowToolSummary'

const label = (zh: string, en: string) => `${zh}|${en}`

describe('buildWorkflowToolSummary', () => {
  it('builds a workflow candidate list summary', () => {
    const summary = buildWorkflowToolSummary({
      call_id: '1',
      name: 'list_workflows',
      args: { query: '电视' },
      status: 'success',
      result: {
        workflows: [
          {
            id: 7,
            name: '看电视',
            description: '打开机顶盒并进入常用频道',
            trigger_type: 'chat',
            published: true,
            node_count: 5,
            device_step_count: 2,
            has_device_steps: true,
            success_count: 3,
            failure_count: 1,
            last_run_status: 'succeeded',
            evidence_status: 'proven',
            reuse_score: 0.88,
          },
        ],
      },
    } as any, label)

    expect(summary?.title).toBe('工作流候选|Workflow Candidates')
    expect(summary?.tone).toBe('success')
    expect(summary?.workflows).toEqual([
      {
        title: '看电视',
        detail: '打开机顶盒并进入常用频道 · chat · 成功|Success 3 · 失败|Failure 1 · 最近运行|Last Run succeeded · 复用分|Reuse 0.88',
        tags: expect.arrayContaining(['已发布|Published', '最近成功|Recently Proven', '复用分|Reuse 0.88', '含设备步骤|Device steps']),
      },
    ])
  })

  it('builds a workflow preview summary with phases and warnings', () => {
    const summary = buildWorkflowToolSummary({
      call_id: '2',
      name: 'preview_workflow',
      args: { workflow_id: 12, workflow_name: '看电视流程' },
      status: 'success',
      result: {
        workflow_id: 12,
        executable: false,
        input_source: 'memory',
        steps: [
          { node_id: '1', node_type: 'start', label: 'Start', summary: 'Inject workflow inputs.', risk: 'none', preview_state: 'ready' },
        ],
        warnings: ['缺少设备输入'],
      },
    } as any, label)

    expect(summary?.title).toBe('工作流预演|Workflow Preview')
    expect(summary?.phases).toEqual([
      { label: '预演|Preview', value: '阻塞|Blocked', tone: 'warning' },
      { label: '执行准备|Execution Ready', value: '完成|Done', tone: 'warning' },
    ])
    expect(summary?.steps?.[0]).toMatchObject({
      title: 'Start',
      detail: 'Inject workflow inputs. · none',
      tone: 'success',
    })
    expect(summary?.rows).toContainEqual({ label: '输入来源|Input Source', value: 'memory' })
    expect(summary?.warnings).toEqual(['缺少设备输入'])
  })

  it('shows subflow metadata in preview step details', () => {
    const summary = buildWorkflowToolSummary({
      call_id: '2b',
      name: 'preview_workflow',
      args: { workflow_id: 12, workflow_name: '看电视流程' },
      status: 'success',
      result: {
        workflow_id: 12,
        executable: true,
        input_source: 'explicit',
        steps: [
          {
            node_id: '2',
            node_type: 'subflow',
            label: 'Run Child',
            summary: 'Run child workflow Child Runtime Test (#34).',
            risk: 'external',
            preview_state: 'ready',
            subflow: {
              workflow_id: 34,
              workflow_name: 'Child Runtime Test',
              input_keys: ['message'],
              output_key: 'answer',
              node_count: 2,
            },
          },
        ],
        warnings: [],
      },
    } as any, label)

    expect(summary?.steps?.[0]?.detail).toBe('Run child workflow Child Runtime Test (#34). · external · Child Runtime Test #34 · 输入|Inputs 1 · 节点|Nodes 2')
  })

  it('labels workflow run-history inputs as last successful inputs', () => {
    const summary = buildWorkflowToolSummary({
      call_id: '2c',
      name: 'preview_workflow',
      args: { workflow_id: 12 },
      status: 'success',
      result: {
        workflow_id: 12,
        executable: true,
        input_source: 'run_history',
        steps: [],
        warnings: [],
      },
    } as any, label)

    expect(summary?.rows).toContainEqual({
      label: '输入来源|Input Source',
      value: '最近成功输入|Last Successful Inputs',
    })
  })

  it('builds a workflow run summary from preview and execution results', () => {
    const summary = buildWorkflowToolSummary({
      call_id: '3',
      name: 'run_workflow',
      args: { workflow_id: 15, workflow_name: '晚间场景' },
      status: 'success',
      result: {
        preview: {
          workflow_id: 15,
          executable: true,
          input_source: 'memory',
          warnings: [],
          steps: [
            { node_id: 'a', node_type: 'device_capability', label: 'Device', summary: 'Run device capability.', risk: 'device', preview_state: 'ready' },
          ],
        },
        run: {
          run_id: 88,
          workflow_id: 15,
          status: 'succeeded',
          outputs: { ok: true },
          trace: [
            { node_id: 'a', node_type: 'device_capability', status: 'succeeded' },
          ],
        },
      },
    } as any, label)

    expect(summary?.title).toBe('工作流执行|Workflow Run')
    expect(summary?.phases).toEqual([
      { label: '预演|Preview', value: '通过|Passed', tone: 'success' },
      { label: '执行|Execution', value: '完成|Done', tone: 'success' },
    ])
    expect(summary?.rows).toEqual(expect.arrayContaining([
      { label: '运行 ID|Run ID', value: '88' },
      { label: '输入来源|Input Source', value: 'memory' },
      { label: '输出|Output', value: 'ok: true' },
    ]))
    expect(summary?.steps?.[0]).toMatchObject({
      title: 'device_capability',
      detail: 'succeeded',
      tone: 'success',
    })
  })

  it('shows subflow details in workflow run trace steps', () => {
    const summary = buildWorkflowToolSummary({
      call_id: '4',
      name: 'run_workflow',
      args: { workflow_id: 15, workflow_name: '晚间场景' },
      status: 'success',
      result: {
        preview: {
          workflow_id: 15,
          executable: true,
          warnings: [],
          steps: [],
        },
        run: {
          run_id: 88,
          workflow_id: 15,
          status: 'succeeded',
          outputs: { ok: true },
          trace: [
            {
              node_id: 's',
              node_type: 'subflow',
              status: 'succeeded',
              outputs: {
                subflow: {
                  workflow_id: 34,
                  workflow_name: 'Child Runtime Test',
                  trace_count: 2,
                },
              },
            },
          ],
        },
      },
    } as any, label)

    expect(summary?.steps?.[0]).toMatchObject({
      title: 'subflow',
      detail: 'succeeded · Child Runtime Test #34 · 节点|Nodes 2',
      tone: 'success',
    })
  })

  it('shows blocked run_workflow preview details without requiring a run result', () => {
    const summary = buildWorkflowToolSummary({
      call_id: '5',
      name: 'run_workflow',
      args: { workflow_id: 15, workflow_name: '晚间场景' },
      status: 'success',
      result: {
        blocked: true,
        message: 'Workflow preview blocked: 缺少设备输入',
        input_source: 'empty',
        preview: {
          workflow_id: 15,
          executable: false,
          input_source: 'empty',
          warnings: ['缺少设备输入'],
          steps: [
            { node_id: 'a', node_type: 'device_capability', label: 'Device', summary: 'Missing device_id.', risk: 'device', preview_state: 'blocked' },
          ],
        },
      },
    } as any, label)

    expect(summary?.tone).toBe('warning')
    expect(summary?.phases).toEqual([
      { label: '预演|Preview', value: '阻塞|Blocked', tone: 'warning' },
      { label: '执行|Execution', value: '未执行|Not Run', tone: 'warning' },
    ])
    expect(summary?.rows).toEqual(expect.arrayContaining([
      { label: '输入来源|Input Source', value: 'empty' },
      { label: '说明|Message', value: 'Workflow preview blocked: 缺少设备输入' },
    ]))
    expect(summary?.steps?.[0]).toMatchObject({
      title: 'Device',
      detail: 'Missing device_id. · device',
      tone: 'warning',
    })
    expect(summary?.warnings).toEqual(['缺少设备输入', 'Workflow preview blocked: 缺少设备输入'])
  })
})
