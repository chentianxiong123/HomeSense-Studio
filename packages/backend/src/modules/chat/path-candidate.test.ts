import { describe, expect, it } from 'vitest'
import { buildRuntimePathCandidate } from './path-candidate.js'

describe('buildRuntimePathCandidate', () => {
  it('builds a candidate from successful executable tool calls', () => {
    const candidate = buildRuntimePathCandidate({
      intent: '打开客厅电视 B 站',
      conversationId: 1,
      originTraceId: 'chat:1:123',
      runtimeTrace: [
        {
          stage: 'runtime.decision',
          status: 'execute',
          title: 'L1 executed',
          detail: '遥控按键 / OK',
          confidence: 1,
        },
      ],
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool_1',
              function: {
                name: 'context-command',
                arguments: JSON.stringify({
                  device_id: 2,
                  capability: '遥控按键',
                  ir_key: 'OK',
                }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'tool_1',
          name: 'context-command',
          content: JSON.stringify({
            device: {
              id: 2,
              device_type: 'stb',
              card: { device_type: 'stb' },
            },
            capability_id: 'mi.ir_key',
            capability: '遥控按键',
            source: 'mi',
            arguments: { device_id: 2, capability: '遥控按键', ir_key: 'OK' },
          }),
        },
      ],
    })

    expect(candidate).not.toBeNull()
    expect(candidate?.title).toBe('遥控按键 / OK')
    expect(candidate?.steps).toHaveLength(1)
    expect(candidate?.skill_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'general_skill', id: 'mi-cli' }),
        expect.objectContaining({ kind: 'device_skill', id: 'device_skill.tv_box' }),
      ]),
    )
    expect(candidate?.device_refs).toEqual(['device:2'])
    expect(candidate?.origin_trace_id).toBe('chat:1:123')
  })

  it('skips candidates when an executable step fails', () => {
    const candidate = buildRuntimePathCandidate({
      intent: '打开电视',
      conversationId: 1,
      runtimeTrace: [],
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool_1',
              function: {
                name: 'execute_device_capability',
                arguments: JSON.stringify({
                  device_id: 2,
                  capability_id: 'adb.launch_app',
                  arguments: { package: 'com.bilibili.tv' },
                }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'tool_1',
          name: 'execute_device_capability',
          content: JSON.stringify({ error: 'Device offline' }),
        },
      ],
    })

    expect(candidate).toBeNull()
  })

  it('builds a candidate from a successful workflow run', () => {
    const candidate = buildRuntimePathCandidate({
      intent: '执行看电视流程',
      conversationId: 1,
      runtimeTrace: [
        {
          stage: 'runtime.decision',
          status: 'execute',
          title: '模型主导',
          detail: '执行看电视流程',
          confidence: 0.82,
        },
      ],
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool_workflow',
              function: {
                name: 'run_workflow',
                arguments: JSON.stringify({
                  workflow_id: 9,
                  workflow_name: '看电视',
                  inputs: { device_id: 2 },
                }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'tool_workflow',
          name: 'run_workflow',
          content: JSON.stringify({
            inputs: { device_id: 2 },
            input_source: 'memory',
            preview: { workflow_id: 9, executable: true },
            run: { run_id: 33, workflow_id: 9, graph_hash: 'workflow_graph_v1', status: 'succeeded', outputs: { ok: true }, trace: [] },
          }),
        },
      ],
    })

    expect(candidate).not.toBeNull()
    expect(candidate?.steps).toEqual([
      {
        tool: 'workflow',
        action: 'run_workflow',
        params: {
          workflow_id: 9,
          workflow_name: '看电视',
          inputs: { device_id: 2 },
        },
      },
    ])
    expect(candidate?.metadata).toMatchObject({
      workflow_id: 9,
      workflow_graph_hash: 'workflow_graph_v1',
      workflow_run_id: 33,
      workflow_inputs: { device_id: 2 },
    })
  })

  it('does not build a candidate when a mixed turn contains any blocked executable step', () => {
    const candidate = buildRuntimePathCandidate({
      intent: '打开客厅电视',
      conversationId: 1,
      runtimeTrace: [],
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool_device',
              function: {
                name: 'context-command',
                arguments: JSON.stringify({
                  device_id: 2,
                  capability: '遥控按键',
                  ir_key: 'BACK',
                }),
              },
            },
            {
              id: 'tool_workflow_blocked',
              function: {
                name: 'run_workflow',
                arguments: JSON.stringify({
                  workflow_id: 9,
                  workflow_name: '看电视',
                }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'tool_device',
          name: 'context-command',
          content: JSON.stringify({
            device: {
              id: 2,
              device_type: 'stb',
              card: { device_type: 'stb' },
            },
            capability_id: 'mi.ir_key',
            capability: '遥控按键',
            source: 'mi',
            arguments: { device_id: 2, capability: '遥控按键', ir_key: 'BACK' },
          }),
        },
        {
          role: 'tool',
          tool_call_id: 'tool_workflow_blocked',
          name: 'run_workflow',
          content: JSON.stringify({
            blocked: true,
            message: 'Workflow preview blocked: 缺少设备输入',
            inputs: {},
            preview: {
              workflow_id: 9,
              executable: false,
              warnings: ['缺少设备输入'],
            },
          }),
        },
      ],
    })

    expect(candidate).toBeNull()
  })

  it('uses effective workflow result inputs when the model called run_workflow without inputs', () => {
    const candidate = buildRuntimePathCandidate({
      intent: '执行看电视流程',
      conversationId: 1,
      runtimeTrace: [],
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool_workflow',
              function: {
                name: 'run_workflow',
                arguments: JSON.stringify({
                  workflow_id: 9,
                  workflow_name: '看电视',
                }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'tool_workflow',
          name: 'run_workflow',
          content: JSON.stringify({
            inputs: { device_id: 2, app: 'bilibili' },
            input_source: 'memory',
            preview: {
              workflow_id: 9,
              executable: true,
              input_source: 'memory',
            },
            run: { run_id: 34, workflow_id: 9, graph_hash: 'workflow_graph_v2', status: 'succeeded', outputs: { ok: true }, trace: [] },
          }),
        },
      ],
    })

    expect(candidate?.steps[0]).toMatchObject({
      tool: 'workflow',
      action: 'run_workflow',
      params: {
        workflow_id: 9,
        workflow_name: '看电视',
        inputs: { device_id: 2, app: 'bilibili' },
      },
    })
    expect(candidate?.metadata).toMatchObject({
      workflow_id: 9,
      workflow_graph_hash: 'workflow_graph_v2',
      workflow_run_id: 34,
      workflow_inputs: { device_id: 2, app: 'bilibili' },
    })
  })

  it('does not build a candidate from a blocked workflow preview', () => {
    const candidate = buildRuntimePathCandidate({
      intent: '执行看电视流程',
      conversationId: 1,
      runtimeTrace: [],
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool_workflow_blocked',
              function: {
                name: 'run_workflow',
                arguments: JSON.stringify({
                  workflow_id: 9,
                  workflow_name: '看电视',
                }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'tool_workflow_blocked',
          name: 'run_workflow',
          content: JSON.stringify({
            blocked: true,
            message: 'Workflow preview blocked: 缺少设备输入',
            inputs: {},
            preview: {
              workflow_id: 9,
              executable: false,
              warnings: ['缺少设备输入'],
            },
          }),
        },
      ],
    })

    expect(candidate).toBeNull()
  })
})
