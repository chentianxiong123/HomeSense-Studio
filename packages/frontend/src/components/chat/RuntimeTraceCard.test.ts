import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RuntimeTraceCard from './RuntimeTraceCard.vue'
import type { RuntimeTraceEvent } from '../../composables/useChat'

describe('RuntimeTraceCard', () => {
  it('shows L3 tool policy and L1 reflex state in the trace header', () => {
    const trace: RuntimeTraceEvent[] = [
      {
        stage: 'runtime.intent',
        status: 'execute',
        title: 'Intent: device_control',
        detail: 'Device action request.',
        data: {
          context_policy: 'device_focused',
          tool_policy: 'preview_only',
          l1_allowed: false,
          tool_policy_reason: 'multi-step device request must preview before execution',
        },
      },
    ]

    const wrapper = mount(RuntimeTraceCard, {
      props: {
        trace,
        expanded: true,
      },
    })

    expect(wrapper.find('.trace-intent').text()).toContain('L3: 预览')
    expect(wrapper.find('.trace-intent').text()).toContain('L1: 关闭')
    expect(wrapper.find('.trace-policy-note').text()).toContain('多步骤设备请求先预演')
  })
})
