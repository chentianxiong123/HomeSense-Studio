import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  executeDeviceAgentTool: vi.fn(),
}))

vi.mock('../../llm-provider/service.js', () => ({
  llmService: {
    chat: mocks.chat,
  },
}))

vi.mock('../../device/device-agent-tools.js', () => ({
  DEVICE_AGENT_TOOL_DEFINITIONS: [
    {
      type: 'function',
      function: {
        name: 'rehearse_device_capability',
        description: 'Rehearse a device capability.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'execute_device_capability',
        description: 'Execute a device capability.',
        parameters: { type: 'object', properties: {} },
      },
    },
  ],
  executeDeviceAgentTool: mocks.executeDeviceAgentTool,
  isDeviceAgentTool: (name: string) => [
    'rehearse_device_capability',
    'execute_device_capability',
  ].includes(name),
}))

describe('PiL3Agent', () => {
  beforeEach(() => {
    mocks.chat.mockReset()
    mocks.executeDeviceAgentTool.mockReset()
  })

  it('runs a Pi agent loop with a HomeSense tool call and final answer', async () => {
    mocks.chat
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          {
            id: 'call_confirm',
            function: {
              name: 'confirm_outcome',
              arguments: JSON.stringify({
                question: '电视画面切到 B 站了吗？',
              }),
            },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 4 },
      })
      .mockResolvedValueOnce({
        content: '我会等你确认电视画面是否已经切到 B 站。',
        usage: { prompt_tokens: 32, completion_tokens: 12 },
      })

    const { piL3Agent } = await import('./pi-l3-agent.js')
    const result = await piL3Agent.inference({
      input: '看 B 站',
      messages: [{ role: 'user', content: '看 B 站' }],
      conversationId: 1,
      runtimeContext: {
        recent_messages: [{ role: 'user', content: '看 B 站' }],
        working_context: {},
        retrieval_hits: [],
      },
      lightIntent: {
        kind: 'device_control',
        prompt_mode: 'unified',
        context_policy: 'recent',
        allow_tools: true,
        confidence: 0.8,
        reason: 'test',
      },
      deviceInventory: [],
    } as any)

    expect(mocks.chat).toHaveBeenCalledTimes(2)
    expect(result.finalResponse).toContain('等你确认')
    expect(result.messages?.map((message: any) => message.role)).toEqual([
      'assistant',
      'tool',
      'assistant',
    ])
    expect((result.messages?.[0] as any).tool_calls?.[0].function.name).toBe('confirm_outcome')
    expect((result.messages?.[1] as any).tool_call_id).toBe('call_confirm')
    expect(result.runtimeTrace?.some((trace) =>
      trace.stage === 'runtime.execution' && trace.status === 'success',
    )).toBe(true)

    const secondCallMessages = mocks.chat.mock.calls[1][0].messages
    expect(secondCallMessages.some((message: any) =>
      message.role === 'assistant' && message.tool_calls?.[0]?.id === 'call_confirm',
    )).toBe(true)
    expect(secondCallMessages.some((message: any) =>
      message.role === 'tool' && message.tool_call_id === 'call_confirm',
    )).toBe(true)
  })

  it('rehearses device capability execution before touching the real device', async () => {
    mocks.chat
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          {
            id: 'call_execute',
            function: {
              name: 'execute_device_capability',
              arguments: JSON.stringify({
                device_id: 2,
                capability_id: 'adb.launch_app',
                arguments: { package: 'tv.danmaku.bilibili' },
              }),
            },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 4 },
      })
      .mockResolvedValueOnce({
        content: '已完成沙箱演练并执行。',
        usage: { prompt_tokens: 32, completion_tokens: 12 },
      })

    mocks.executeDeviceAgentTool
      .mockResolvedValueOnce({
        status: 'success',
        executor: 'rehearse_device_capability',
        data: { ok: true, executable: true },
      })
      .mockResolvedValueOnce({
        status: 'success',
        executor: 'execute_device_capability',
        data: { ok: true },
      })

    const { PiL3Agent } = await import('./pi-l3-agent.js')
    const result = await new PiL3Agent().inference({
      input: '打开 B 站',
      messages: [{ role: 'user', content: '打开 B 站' }],
      conversationId: 1,
      runtimeContext: {
        recent_messages: [{ role: 'user', content: '打开 B 站' }],
        working_context: {},
        retrieval_hits: [],
      },
      lightIntent: {
        kind: 'device_control',
        prompt_mode: 'unified',
        context_policy: 'recent',
        allow_tools: true,
        confidence: 0.8,
        reason: 'test',
      },
      deviceInventory: [],
    } as any)

    expect(mocks.executeDeviceAgentTool).toHaveBeenNthCalledWith(1, 'rehearse_device_capability', {
      device_id: 2,
      capability_id: 'adb.launch_app',
      arguments: { package: 'tv.danmaku.bilibili' },
    })
    expect(mocks.executeDeviceAgentTool).toHaveBeenNthCalledWith(2, 'execute_device_capability', {
      device_id: 2,
      capability_id: 'adb.launch_app',
      arguments: { package: 'tv.danmaku.bilibili' },
    })
    expect(result.finalResponse).toContain('已完成')
  })
})
