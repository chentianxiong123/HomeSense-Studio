import { describe, expect, it } from 'vitest'
import {
  buildGraphMessageSseEvents,
  buildPromptMessagesFromConversationRows,
  selectLatestUserMessage,
} from './routes.js'

describe('chat route SSE events', () => {
  it('uses only the latest user input from the client request body', () => {
    expect(selectLatestUserMessage([
      { role: 'user', content: '之前让我写小作文' },
      { role: 'assistant', content: '春日的午后。' },
      { role: 'user', content: '  你好  ' },
    ])).toBe('你好')
  })

  it('rebuilds prompt history from server-side conversation rows without tool JSON bubbles', () => {
    expect(buildPromptMessagesFromConversationRows([
      { role: 'user', content: '打开电视' },
      { role: 'assistant', content: '' },
      { role: 'tool', content: '{"ok":true}' },
      { role: 'assistant', content: '已打开。' },
    ])).toEqual([
      { role: 'user', content: '打开电视' },
      { role: 'assistant', content: '已打开。' },
    ])
  })

  it('serializes assistant tool calls and tool results in graph message order', () => {
    const serialized = buildGraphMessageSseEvents([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_skill',
            function: {
              name: 'get_device_type_skill',
              arguments: JSON.stringify({ device_type: 'tv_box' }),
            },
          },
          {
            id: 'call_caps',
            function: {
              name: 'get_device_capabilities',
              arguments: JSON.stringify({ device_id: 12 }),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_skill',
        content: JSON.stringify({ found: true, title: 'TV Box Skill' }),
      },
      {
        role: 'tool',
        tool_call_id: 'call_caps',
        content: JSON.stringify({ capabilities: [{ capability_id: 'adb.launch_app' }] }),
      },
      {
        role: 'assistant',
        content: '已读取设备技能和能力。',
      },
    ])

    expect(serialized.emittedPlainAssistant).toBe(true)
    expect(serialized.events.map((event) => event.type ?? 'content')).toEqual([
      'tool_start',
      'tool_start',
      'tool_end',
      'tool_end',
      'content',
    ])
    expect(serialized.events[0]).toMatchObject({
      type: 'tool_start',
      call_id: 'call_skill',
      name: 'get_device_type_skill',
      args: { device_type: 'tv_box' },
    })
    expect(serialized.events[2]).toMatchObject({
      type: 'tool_end',
      call_id: 'call_skill',
      status: 'success',
      result: { found: true, title: 'TV Box Skill' },
    })
    expect(serialized.events[4]).toMatchObject({
      content: '已读取设备技能和能力。',
      done: false,
    })
  })
})
