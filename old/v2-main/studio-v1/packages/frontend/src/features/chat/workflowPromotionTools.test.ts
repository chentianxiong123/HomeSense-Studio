import { describe, expect, it } from 'vitest'
import { buildWorkflowDraftFromExperiencePath } from './workflowPromotionTools'

describe('workflowPromotionTools', () => {
  it('promotes device capability experience paths into workflow nodes', () => {
    const draft = buildWorkflowDraftFromExperiencePath({
      title: '客厅电视返回',
      summary: '从 Chat 成功执行沉淀',
      intent_pattern: '返回',
      steps: [
        {
          tool: 'device_agent',
          action: 'execute_device_capability',
          params: {
            device_id: 7,
            capability_id: 'mi.ir_key',
            capability: '遥控按键',
            arguments: { key: 'BACK' },
          },
        },
      ],
    })

    expect(draft).toMatchObject({
      name: '客厅电视返回',
      trigger_type: 'manual',
      nodes: [
        {
          type: 'start',
          config: {
            inputs: {
              intent: '返回',
              device_id: 7,
              capability_id: 'mi.ir_key',
              capability: '遥控按键',
              arguments: { key: 'BACK' },
            },
          },
        },
        {
          type: 'device_capability',
          label: '遥控按键',
          config: {
            device_id: '{{input.device_id}}',
            capability_id: '{{input.capability_id}}',
            capability: '{{input.capability}}',
            arguments: '{{input.arguments}}',
          },
        },
        { type: 'answer' },
      ],
      edges: [
        { source_node_id: 0, target_node_id: 1 },
        { source_node_id: 1, target_node_id: 2 },
      ],
    })
  })

  it('promotes workflow run steps into subflow nodes', () => {
    const draft = buildWorkflowDraftFromExperiencePath({
      title: '执行看电视流程',
      steps: [
        {
          tool: 'workflow',
          action: 'run_workflow',
          params: {
            workflow_id: 9,
            workflow_name: '看电视',
            inputs: { device_id: 2 },
          },
        },
      ],
    })

    expect(draft?.nodes[1]).toMatchObject({
      type: 'subflow',
      label: '看电视',
      config: {
        workflow_id: '{{input.child_workflow_id}}',
        workflow_name: '{{input.child_workflow_name}}',
        inputs: '{{input.workflow_inputs}}',
      },
    })
    expect(draft?.nodes[0]).toMatchObject({
      type: 'start',
      config: {
        inputs: {
          child_workflow_id: 9,
          child_workflow_name: '看电视',
          workflow_inputs: { device_id: 2 },
        },
      },
    })
  })

  it('uses remembered workflow inputs when promoting a workflow step without explicit inputs', () => {
    const draft = buildWorkflowDraftFromExperiencePath({
      title: '执行看电视流程',
      metadata: {
        workflow_inputs: { device_id: 3, app: 'bilibili' },
      },
      steps: [
        {
          tool: 'workflow',
          action: 'run_workflow',
          params: {
            workflow_id: 9,
            workflow_name: '看电视',
          },
        },
      ],
    })

    expect(draft?.nodes[0]).toMatchObject({
      config: {
        inputs: {
          workflow_inputs: { device_id: 3, app: 'bilibili' },
        },
      },
    })
  })

  it('namespaces promoted inputs for multi-step paths', () => {
    const draft = buildWorkflowDraftFromExperiencePath({
      title: '返回后打开应用',
      steps: [
        {
          tool: 'device_agent',
          action: 'execute_device_capability',
          params: {
            device_id: 7,
            capability_id: 'mi.ir_key',
            arguments: { key: 'BACK' },
          },
        },
        {
          tool: 'adb-cli',
          action: 'launch_app',
          params: { package: 'tv.danmaku.bili' },
        },
      ],
    })

    expect(draft?.nodes[0]).toMatchObject({
      config: {
        inputs: {
          step_1_device_id: 7,
          step_1_capability_id: 'mi.ir_key',
          step_1_arguments: { key: 'BACK' },
          step_2_adb_cli_params: { package: 'tv.danmaku.bili' },
        },
      },
    })
    expect(draft?.nodes[1]).toMatchObject({
      config: {
        device_id: '{{input.step_1_device_id}}',
        capability_id: '{{input.step_1_capability_id}}',
        arguments: '{{input.step_1_arguments}}',
      },
    })
    expect(draft?.nodes[2]).toMatchObject({
      type: 'executor_call',
      config: {
        executor_name: 'cli.invoke',
        params: {
          cli_name: 'adb-cli',
          action: 'launch_app',
          params: '{{input.step_2_adb_cli_params}}',
        },
      },
    })
  })

  it('returns null when there are no executable steps', () => {
    expect(buildWorkflowDraftFromExperiencePath({
      title: 'empty',
      steps: [],
    })).toBeNull()
  })
})
