import { describe, expect, it } from 'vitest'
import {
  buildExperiencePathPayload,
  collectSuccessfulPathToolCalls,
  isPathExecutableTool,
  isSuccessfulPathToolCall,
  toolCallToExperienceStep,
} from './experiencePathTools'

describe('experiencePathTools', () => {
  it('treats successful workflow runs as experience-path executable steps', () => {
    expect(isPathExecutableTool('run_workflow')).toBe(true)

    expect(toolCallToExperienceStep({
      call_id: 'call_workflow',
      name: 'run_workflow',
      status: 'success',
      args: {
        workflow_id: 9,
        workflow_name: '看电视',
        inputs: { device_id: 2 },
      },
    })).toEqual({
      tool: 'workflow',
      action: 'run_workflow',
      params: {
        workflow_id: 9,
        workflow_name: '看电视',
        inputs: { device_id: 2 },
      },
    })
  })

  it('uses effective workflow result inputs when the model called run_workflow without inputs', () => {
    expect(toolCallToExperienceStep({
      call_id: 'call_workflow_memory',
      name: 'run_workflow',
      status: 'success',
      args: {
        workflow_id: 9,
        workflow_name: '看电视',
      },
      result: {
        inputs: { device_id: 2, app: 'bilibili' },
        input_source: 'memory',
        preview: {
          workflow_id: 9,
          executable: true,
          input_source: 'memory',
        },
      },
    })).toEqual({
      tool: 'workflow',
      action: 'run_workflow',
      params: {
        workflow_id: 9,
        workflow_name: '看电视',
        inputs: { device_id: 2, app: 'bilibili' },
      },
    })
  })

  it('keeps device capability steps compatible with existing saved paths', () => {
    expect(toolCallToExperienceStep({
      call_id: 'call_device',
      name: 'execute_device_capability',
      status: 'success',
      args: {
        device_id: 7,
        capability_id: 'mi.ir_key',
        capability: '遥控按键',
        arguments: { key: 'BACK' },
      },
    })).toEqual({
      tool: 'device_agent',
      action: 'execute_device_capability',
      params: {
        device_id: 7,
        capability_id: 'mi.ir_key',
        capability: '遥控按键',
        arguments: { key: 'BACK' },
      },
    })
  })

  it('returns a direct candidate payload without rebuilding when pathCandidate exists', () => {
    expect(buildExperiencePathPayload({
      message: {
        id: 'assistant_1',
        content: '流程已完成。',
        pathCandidate: {
          title: '看电视',
          summary: 'runtime path',
          intent_pattern: '看电视',
          source: 'runtime',
          status: 'active',
          origin_trace_id: 'trace-1',
          conversation_id: 1,
          steps: [
            { tool: 'workflow', action: 'run_workflow', params: { workflow_id: 9 } },
          ],
        },
      },
      messageIndex: 1,
      history: [
        { role: 'user', content: '执行看电视流程' },
        { role: 'assistant', content: '流程已完成。' },
      ],
      locale: 'zh',
    })?.metadata).toMatchObject({
      saved_from: 'chat_path_card',
      assistant_message_id: 'assistant_1',
    })
  })

  it('builds a workflow fallback payload from successful tool calls', () => {
    const payload = buildExperiencePathPayload({
      message: {
        id: 'assistant_2',
        content: '流程已完成。',
        runtimeTrace: [
          {
            stage: 'runtime.decision',
            status: 'execute',
            title: '模型主导',
            detail: '执行看电视流程',
          },
        ],
        toolCalls: [
          {
            call_id: 'call_workflow',
            name: 'run_workflow',
            status: 'success',
            args: {
              workflow_id: 9,
              workflow_name: '看电视',
              inputs: { device_id: 2 },
            },
            result: {
              run: { run_id: 44, workflow_id: 9, graph_hash: 'workflow_graph_v1', status: 'succeeded' },
            },
          },
        ],
      },
      messageIndex: 1,
      history: [
        { role: 'user', content: '执行看电视流程' },
        { role: 'assistant', content: '流程已完成。' },
      ],
      locale: 'zh',
    })

    expect(payload).toMatchObject({
      title: '执行看电视流程',
      summary: '从 Chat 成功执行沉淀：执行看电视流程',
      intent_pattern: '执行看电视流程',
      origin_trace_id: 'assistant_2',
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
      metadata: {
        workflow_id: 9,
        workflow_graph_hash: 'workflow_graph_v1',
        workflow_run_id: 44,
        workflow_inputs: { device_id: 2 },
      },
    })
  })

  it('does not save blocked workflow previews as successful experience paths', () => {
    expect(isSuccessfulPathToolCall({
      call_id: 'call_workflow_blocked',
      name: 'run_workflow',
      status: 'success',
      args: { workflow_id: 9, workflow_name: '看电视' },
      result: {
        blocked: true,
        preview: {
          workflow_id: 9,
          executable: false,
          warnings: ['缺少设备输入'],
        },
      },
    })).toBe(false)

    const payload = buildExperiencePathPayload({
      message: {
        id: 'assistant_blocked',
        content: '预演被阻塞。',
        toolCalls: [
          {
            call_id: 'call_workflow_blocked',
            name: 'run_workflow',
            status: 'success',
            args: { workflow_id: 9, workflow_name: '看电视' },
            result: {
              blocked: true,
              preview: {
                workflow_id: 9,
                executable: false,
                warnings: ['缺少设备输入'],
              },
            },
          },
        ],
      },
      messageIndex: 1,
      history: [
        { role: 'user', content: '执行看电视流程' },
        { role: 'assistant', content: '预演被阻塞。' },
      ],
      locale: 'zh',
    })

    expect(payload).toBeNull()
  })

  it('rejects mixed tool turns when any executable step is blocked or failed', () => {
    const toolCalls = collectSuccessfulPathToolCalls([
      {
        call_id: 'call_device',
        name: 'execute_device_capability',
        status: 'success',
        args: {
          device_id: 7,
          capability_id: 'mi.ir_key',
          capability: '遥控按键',
          arguments: { key: 'BACK' },
        },
      },
      {
        call_id: 'call_workflow_blocked',
        name: 'run_workflow',
        status: 'success',
        args: { workflow_id: 9, workflow_name: '看电视' },
        result: {
          blocked: true,
          preview: {
            workflow_id: 9,
            executable: false,
            warnings: ['缺少设备输入'],
          },
        },
      },
    ])

    expect(toolCalls).toEqual([])

    expect(buildExperiencePathPayload({
      message: {
        id: 'assistant_mixed',
        content: '一部分完成，一部分阻塞。',
        toolCalls: [
          {
            call_id: 'call_device',
            name: 'execute_device_capability',
            status: 'success',
            args: {
              device_id: 7,
              capability_id: 'mi.ir_key',
              capability: '遥控按键',
              arguments: { key: 'BACK' },
            },
          },
          {
            call_id: 'call_workflow_blocked',
            name: 'run_workflow',
            status: 'success',
            args: { workflow_id: 9, workflow_name: '看电视' },
            result: {
              blocked: true,
              preview: {
                workflow_id: 9,
                executable: false,
                warnings: ['缺少设备输入'],
              },
            },
          },
        ],
      },
      messageIndex: 1,
      history: [
        { role: 'user', content: '执行看电视流程' },
        { role: 'assistant', content: '一部分完成，一部分阻塞。' },
      ],
      locale: 'zh',
    })).toBeNull()
  })
})
