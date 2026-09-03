import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChatMessageBubble from './ChatMessageBubble.vue'
import type { DisplayMessage } from '../../composables/useChat'

function assistantMessage(overrides: Partial<DisplayMessage>): DisplayMessage {
  return {
    id: 'assistant_test',
    role: 'assistant',
    content: '已停止。',
    thinking: '',
    thinkingExpanded: false,
    status: 'final',
    timestamp: new Date('2026-05-31T08:00:00.000Z'),
    toolCalls: [],
    runtimeTrace: [],
    traceExpanded: false,
    ...overrides,
  }
}

describe('ChatMessageBubble path actions', () => {
  it('does not show promotion actions for blocked workflow previews', () => {
    const wrapper = mount(ChatMessageBubble, {
      props: {
        locale: 'zh',
        showRuntimeTrace: true,
        msg: assistantMessage({
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
        }),
      },
      global: {
        stubs: {
          RuntimeToolCard: true,
          RuntimeTraceCard: true,
        },
      },
    })

    expect(wrapper.find('.path-action').exists()).toBe(false)
  })

  it('shows promotion actions for succeeded workflow runs', () => {
    const wrapper = mount(ChatMessageBubble, {
      props: {
        locale: 'zh',
        showRuntimeTrace: true,
        msg: assistantMessage({
          toolCalls: [
            {
              call_id: 'call_workflow_success',
              name: 'run_workflow',
              status: 'success',
              args: { workflow_id: 9, workflow_name: '看电视' },
              result: {
                inputs: { device_id: 2 },
                preview: {
                  workflow_id: 9,
                  executable: true,
                },
                run: {
                  run_id: 31,
                  workflow_id: 9,
                  graph_hash: 'workflow_graph_v1',
                  status: 'succeeded',
                  outputs: { ok: true },
                  trace: [],
                },
              },
            },
          ],
        }),
      },
      global: {
        stubs: {
          RuntimeToolCard: true,
          RuntimeTraceCard: true,
        },
      },
    })

    expect(wrapper.find('.path-action').exists()).toBe(true)
  })

  it('does not show promotion actions when any executable tool in the turn is blocked', () => {
    const wrapper = mount(ChatMessageBubble, {
      props: {
        locale: 'zh',
        showRuntimeTrace: true,
        msg: assistantMessage({
          toolCalls: [
            {
              call_id: 'call_device',
              name: 'execute_device_capability',
              status: 'success',
              args: { device_id: 7, capability_id: 'mi.ir_key', capability: '遥控按键', arguments: { key: 'BACK' } },
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
        }),
      },
      global: {
        stubs: {
          RuntimeToolCard: true,
          RuntimeTraceCard: true,
        },
      },
    })

    expect(wrapper.find('.path-action').exists()).toBe(false)
  })
})
