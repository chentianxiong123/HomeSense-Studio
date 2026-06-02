import { describe, expect, it, vi } from 'vitest'
import { matchCommand } from '../command/routes.js'
import type { RuntimeContextWindow } from '../runtime-context/index.js'

let capturedMessages: Array<{ role: string; content: string }> = []
let capturedTools: unknown
let contextOverflowOnce = false
let contextOverflowThrown = false
let queuedChatResponses: any[] = []
const routeMock = vi.hoisted(() => vi.fn(async (input: { message: string }) => ({
  original_message: input.message,
  routing_message: input.message,
  normalized_intent: 'mock.device.intent',
  route_level: 3,
  confidence: 0.4,
  reason: 'mock_route',
  completion: {
    original_message: input.message,
    completed_message: input.message,
    device_weights: [],
  },
  candidate_plans: [],
  observations: [],
  search_hits: [],
  evidence: [],
  allow_tool_calls: true,
})))

vi.mock('../llm-provider/service.js', () => ({
  llmService: {
    chat: vi.fn(async (params: { messages: Array<{ role: string; content: string }>; tools?: unknown }) => {
      capturedMessages = params.messages
      capturedTools = params.tools
      if (contextOverflowOnce && !contextOverflowThrown) {
        contextOverflowThrown = true
        throw new Error('context length exceeded')
      }
      if (queuedChatResponses.length > 0) {
        return queuedChatResponses.shift()
      }
      return {
        content: '你好，我在。',
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      }
    }),
  },
}))

vi.mock('../intent/index.js', () => ({
  intentRouter: {
    route: routeMock,
  },
}))

vi.mock('../command/routes.js', () => ({
  matchCommand: vi.fn(() => null),
}))

describe('chat graph context policy', () => {
  const matchCommandMock = vi.mocked(matchCommand)

  async function runGraph(input: string, params?: {
    messages?: Array<{ role: string; content: string }>
    runtimeContext?: RuntimeContextWindow
    contextOverflowOnce?: boolean
    chatResponses?: any[]
  }) {
    capturedMessages = []
    capturedTools = undefined
    routeMock.mockClear()
    matchCommandMock.mockClear()
    contextOverflowOnce = params?.contextOverflowOnce === true
    contextOverflowThrown = false
    queuedChatResponses = [...(params?.chatResponses ?? [])]
    const { reactGraph, ChatReActState } = await import('./graph.js')
    const messages = params?.messages ?? [{ role: 'user', content: input }]
    const runtimeContext: RuntimeContextWindow = params?.runtimeContext ?? {
      entries: {},
      working_context: {},
      recent_messages: messages,
      retrieval_hits: [],
      context_usage: {
        used_tokens: 0,
        max_tokens: 20_000,
        message_tokens: 0,
        working_context_tokens: 0,
        retrieval_tokens: 0,
      },
      max_turns: 12,
      ttl_ms: 30 * 60 * 1000,
      retrieval_limit: 3,
      context_token_budget: 20_000,
      session_active: true,
      last_activity_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }
    const initialState: typeof ChatReActState.State = {
      messages,
      input,
      conversationId: 1,
      currentToolCall: undefined,
      pendingToolCalls: [],
      isComplete: false,
      finalResponse: '',
      runtimeRoute: undefined,
      l1Command: undefined,
      runtimeTrace: [],
      runtimeContext,
      lightIntent: undefined,
      deviceInventory: [],
      error: undefined,
    }

    let finalState: typeof ChatReActState.State = initialState
    const stream = await reactGraph.stream(initialState, { streamMode: 'values' })
    for await (const state of stream) {
      // Exhaust the graph stream.
      finalState = state as typeof ChatReActState.State
    }
    return finalState
  }

  it('uses the runtime context window instead of stale request history', async () => {
    await runGraph('你好', {
      messages: [
        { role: 'user', content: '之前让我写小作文' },
        { role: 'assistant', content: '春日的午后，阳光懒洋洋地洒在窗台上。' },
        { role: 'user', content: '你好' },
      ],
      runtimeContext: {
        entries: {},
        working_context: {},
        recent_messages: [{ role: 'user', content: '你好' }],
        retrieval_hits: [],
        context_usage: {
          used_tokens: 4,
          max_tokens: 20_000,
          message_tokens: 4,
          working_context_tokens: 0,
          retrieval_tokens: 0,
        },
        max_turns: 12,
        ttl_ms: 30 * 60 * 1000,
        retrieval_limit: 3,
        context_token_budget: 20_000,
        session_active: false,
        last_activity_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        expires_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
      },
    })

    expect(capturedMessages.map((message) => message.content)).toContain('你好')
    expect(capturedMessages.map((message) => message.content).join('\n')).not.toContain('小作文')
    expect(capturedMessages.map((message) => message.content).join('\n')).not.toContain('春日的午后')
    expect(capturedTools).toBeUndefined()
  })

  it('does not turn greeting into a tool call just because active device context exists', async () => {
    await runGraph('你好', {
      runtimeContext: {
        entries: {},
        working_context: {
          current_device: '2',
          current_device_name: '客厅机顶盒',
          current_device_type: 'stb',
          current_room_name: '客厅',
        },
        recent_messages: [{ role: 'user', content: '你好' }],
        retrieval_hits: [],
        context_usage: {
          used_tokens: 0,
          max_tokens: 20_000,
          message_tokens: 0,
          working_context_tokens: 0,
          retrieval_tokens: 0,
        },
        max_turns: 12,
        ttl_ms: 30 * 60 * 1000,
        retrieval_limit: 3,
        context_token_budget: 20_000,
        session_active: true,
        last_activity_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    })

    expect(capturedMessages.map((message) => message.content)).toContain('你好')
    expect(capturedTools).toBeUndefined()
    expect(matchCommandMock).not.toHaveBeenCalled()
  })

  it('does not route to L1 when the user explicitly asks not to execute device actions', async () => {
    await runGraph('我想看电视，但先别操作设备，你会怎么确认？', {
      runtimeContext: {
        entries: {},
        working_context: {
          current_device: '2',
          current_device_name: '客厅机顶盒',
          current_device_type: 'stb',
          current_room_name: '客厅',
        },
        recent_messages: [{ role: 'user', content: '我想看电视，但先别操作设备，你会怎么确认？' }],
        retrieval_hits: [],
        context_usage: {
          used_tokens: 0,
          max_tokens: 20_000,
          message_tokens: 0,
          working_context_tokens: 0,
          retrieval_tokens: 0,
        },
        max_turns: 12,
        ttl_ms: 30 * 60 * 1000,
        retrieval_limit: 3,
        context_token_budget: 20_000,
        session_active: true,
        last_activity_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    })

    expect(matchCommandMock).not.toHaveBeenCalled()
    const toolNames = ((capturedTools as any[]) ?? []).map((tool) => tool?.function?.name).filter(Boolean)
    expect(toolNames).not.toContain('execute_device_capability')
    expect(toolNames).not.toContain('run_workflow')
    expect(capturedMessages.map((message) => message.content).join('\n')).toContain('先别操作设备')
  })

  it('does not route to L1 for explanatory device questions that explicitly say not to really execute', async () => {
    await runGraph('我只是想了解怎么开电视，不用真的执行。', {
      runtimeContext: {
        entries: {},
        working_context: {
          current_device: '2',
          current_device_name: '客厅机顶盒',
          current_device_type: 'stb',
          current_room_name: '客厅',
        },
        recent_messages: [{ role: 'user', content: '我只是想了解怎么开电视，不用真的执行。' }],
        retrieval_hits: [],
        context_usage: {
          used_tokens: 0,
          max_tokens: 20_000,
          message_tokens: 0,
          working_context_tokens: 0,
          retrieval_tokens: 0,
        },
        max_turns: 12,
        ttl_ms: 30 * 60 * 1000,
        retrieval_limit: 3,
        context_token_budget: 20_000,
        session_active: true,
        last_activity_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    })

    expect(matchCommandMock).not.toHaveBeenCalled()
    const toolNames = ((capturedTools as any[]) ?? []).map((tool) => tool?.function?.name).filter(Boolean)
    expect(toolNames).not.toContain('execute_device_capability')
    expect(toolNames).not.toContain('run_workflow')
  })

  it('keeps questions and complex action sentences out of the L1 reflex matcher', async () => {
    await runGraph('打开电视吗？')
    expect(matchCommandMock).not.toHaveBeenCalled()

    await runGraph('我想打开电视')
    expect(matchCommandMock).not.toHaveBeenCalled()

    await runGraph('打开电视，然后播放B站')
    expect(matchCommandMock).not.toHaveBeenCalled()
  })

  it('keeps active-session greetings with a small recent chat window', async () => {
    await runGraph('你好', {
      messages: [
        { role: 'user', content: '很早以前让我写日报' },
        { role: 'assistant', content: '这是很早以前的日报内容。' },
        { role: 'user', content: '之前让我写小作文' },
        { role: 'assistant', content: '春日的午后，阳光懒洋洋地洒在窗台上。' },
        { role: 'user', content: '你好' },
      ],
      runtimeContext: {
        entries: {},
        working_context: {},
        recent_messages: [
          { role: 'user', content: '很早以前让我写日报' },
          { role: 'assistant', content: '这是很早以前的日报内容。' },
          { role: 'user', content: '之前让我写小作文' },
          { role: 'assistant', content: '春日的午后，阳光懒洋洋地洒在窗台上。' },
          { role: 'user', content: '你好' },
        ],
        retrieval_hits: [],
        context_usage: {
          used_tokens: 12,
          max_tokens: 20_000,
          message_tokens: 12,
          working_context_tokens: 0,
          retrieval_tokens: 0,
        },
        max_turns: 12,
        ttl_ms: 30 * 60 * 1000,
        retrieval_limit: 3,
        context_token_budget: 20_000,
        session_active: true,
        last_activity_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    })

    const promptText = capturedMessages.map((message) => message.content).join('\n')
    expect(promptText).toContain('你好')
    expect(promptText).toContain('小作文')
    expect(promptText).toContain('春日的午后')
    expect(promptText).not.toContain('很早以前让我写日报')
    expect(promptText).not.toContain('这是很早以前的日报内容')
    expect(capturedTools).toBeUndefined()
  })

  it('keeps device inventory in awareness even for pure greetings', async () => {
    await runGraph('你好')

    const systemPrompt = capturedMessages.find((message) => message.role === 'system')?.content ?? ''
    expect(systemPrompt).toContain('Device inventory snapshot:')
  })

  it('emits runtime context window usage in trace', async () => {
    const state = await runGraph('你好')
    const contextTrace = state.runtimeTrace.find((item) =>
      item.stage === 'runtime.context' && Boolean(item.data?.context_usage),
    )

    expect(contextTrace?.data?.context_usage).toMatchObject({
      used_tokens: expect.any(Number),
      max_tokens: 20_000,
    })
    expect(contextTrace?.data?.max_turns).toBe(12)
    expect(contextTrace?.data?.ttl_ms).toBe(30 * 60 * 1000)
  })

  it('compacts and retries once when the LLM reports context overflow', async () => {
    await runGraph('继续', {
      contextOverflowOnce: true,
      messages: [
        ...Array.from({ length: 10 }, (_, index) => ({
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: `很长的历史 ${index}`,
        })),
        { role: 'user', content: '继续' },
      ],
    })

    expect(contextOverflowThrown).toBe(true)
    expect(capturedMessages.map((message) => message.content).join('\n')).toContain('Compressed earlier conversation summary')
  })

  it('asks through L3 without tools for action text when there is no active target device', async () => {
    await runGraph('打开')

    const systemPrompt = capturedMessages.find((message) => message.role === 'system')?.content ?? ''
    expect(systemPrompt).toContain('one unified smart-home assistant')
    expect(systemPrompt).toContain('no active target device')
    expect(systemPrompt).toContain('Active runtime context: {}')
    expect(capturedTools).toBeUndefined()
  })

  it('runs L2 route after L1 misses for direct device actions', async () => {
    const state = await runGraph('打开电视')

    expect(routeMock).toHaveBeenCalledTimes(1)
    expect(state.runtimeTrace.some((item) => item.stage === 'runtime.l2.candidates')).toBe(true)
    expect(capturedTools).toBeDefined()
  })

  it('keeps workflow requests in preview mode instead of exposing direct execution tools', async () => {
    await runGraph('执行看电视流程')

    const toolNames = ((capturedTools as any[]) ?? [])
      .map((tool) => tool?.function?.name)
      .filter(Boolean)

    expect(toolNames).toContain('list_user_devices')
    expect(toolNames).toContain('list_workflows')
    expect(toolNames).toContain('preview_workflow')
    expect(toolNames).not.toContain('run_workflow')
  })

  it('adds structured workflow tool data to runtime execution trace', async () => {
    const state = await runGraph('执行看电视流程', {
      chatResponses: [
        {
          content: '',
          tool_calls: [
            {
              id: 'call_workflows',
              function: {
                name: 'list_workflows',
                arguments: JSON.stringify({ query: '电视' }),
              },
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        },
        {
          content: '我没有读取到可用流程。',
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        },
      ],
    })

    const workflowTrace = state.runtimeTrace.find((item) =>
      item.stage === 'runtime.execution'
      && (item.data as any)?.workflow_tool?.name === 'list_workflows',
    )

    expect(workflowTrace).toBeDefined()
    expect((workflowTrace?.data as any).workflow_tool).toMatchObject({
      name: 'list_workflows',
      args: { query: '电视' },
      status: expect.any(String),
    })
  })

  it('executes every tool call from the same assistant turn before returning to the model', async () => {
    const state = await runGraph('打开电视', {
      chatResponses: [
        {
          content: '',
          tool_calls: [
            {
              id: 'call_devices',
              function: {
                name: 'list_user_devices',
                arguments: '{}',
              },
            },
            {
              id: 'call_skill',
              function: {
                name: 'get_device_type_skill',
                arguments: JSON.stringify({ device_type: 'tv_box' }),
              },
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        },
        {
          content: '已读取设备列表和电视技能。',
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        },
      ],
    })

    const toolMessages = state.messages.filter((message) => message.role === 'tool')
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['call_devices', 'call_skill'])
    expect(capturedMessages.filter((message) => message.role === 'tool')).toHaveLength(2)
    expect(state.finalResponse).toBe('已读取设备列表和电视技能。')
  })

  it('rehearses model-requested real device execution before touching the real tool', async () => {
    const state = await runGraph('打开电视', {
      chatResponses: [
        {
          content: '',
          tool_calls: [
            {
              id: 'call_execute',
              function: {
                name: 'execute_device_capability',
                arguments: JSON.stringify({ device_id: 999_999, capability: '开机', arguments: {} }),
              },
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        },
        {
          content: '没有找到设备，未执行。',
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        },
      ],
    })

    const rehearsalTrace = state.runtimeTrace.find((item) =>
      item.stage === 'runtime.execution' && item.title === '沙箱演练',
    )
    const toolMessage = state.messages.find((message) => message.role === 'tool' && message.tool_call_id === 'call_execute')

    expect(rehearsalTrace).toBeDefined()
    expect(toolMessage?.content).toContain('error')
    expect(state.finalResponse).toBe('没有找到设备，未执行。')
  })

  it('keeps L2 memory candidates as LLM context instead of direct execution', async () => {
    routeMock.mockImplementationOnce(async (input: { message: string }) => ({
      original_message: input.message,
      routing_message: input.message,
      normalized_intent: 'media.watch.bilibili.tv',
      route_level: 2,
      confidence: 0.88,
      reason: 'compiled_knowledge_or_memory',
      completion: {
        original_message: input.message,
        completed_message: input.message,
        device_weights: [],
      },
      matched_plan: undefined,
      matched_rule: undefined,
      matched_skill: undefined,
      candidate_plans: [
        {
          id: 'memory:path.watch-bilibili',
          title: '客厅电视打开 B 站',
          source: 'memory',
          candidate_kind: 'workflow_candidate',
          confidence: 0.94,
          goal: '在客厅电视上打开 B 站',
          entities: ['bilibili'],
          steps: [
            {
              tool: 'adb-cli',
              action: 'launch_app',
              params: { package: 'tv.danmaku.bili' },
            },
          ],
          assumptions: [],
          risks: [],
          evidence: [],
          intent: '我要看 B 站',
          workflow_id: 7,
          workflow_inputs: { device_id: 2, app: 'bilibili' },
          success_count: 4,
          failure_count: 1,
          evidence_status: 'proven',
          reuse_score: 0.88,
        },
      ],
      observations: [],
      search_hits: [
        {
          id: 'memory:path.watch-bilibili',
          content: '客厅电视打开 B 站',
          type: 'experience_path',
          wing: 'memory',
          room: '',
          score: 0.9,
          fts_score: 0.9,
          graph_score: 0,
          source: 'memory',
        },
      ],
      evidence: [],
      allow_tool_calls: true,
    }) as any)

    const state = await runGraph('打开电视看 B 站')
    const decision = state.runtimeTrace.find((item) =>
      item.stage === 'runtime.decision' && item.title === '模型校验候选路径',
    )

    expect(decision?.title).toBe('模型校验候选路径')
    expect(state.finalResponse).toBe('你好，我在。')
    expect(capturedTools).toBeDefined()
    const systemPrompt = capturedMessages.find((message) => message.role === 'system')?.content ?? ''
    expect(systemPrompt).toContain('Runtime candidate paths:')
    expect(systemPrompt).toContain('workflow_candidate')
    expect(systemPrompt).toContain('preview_workflow')
    expect(systemPrompt).toContain('"workflow_id":7')
    expect(systemPrompt).toContain('"workflow_inputs":{"device_id":2,"app":"bilibili"}')
    expect(systemPrompt).toContain('"evidence_status":"proven"')
    expect(systemPrompt).toContain('"reuse_score":0.88')

    const l2Trace = state.runtimeTrace.find((item) => item.stage === 'runtime.l2.candidates')
    expect((l2Trace?.data as any)?.candidates?.[0]).toMatchObject({
      id: 'memory:path.watch-bilibili',
      kind: 'workflow_candidate',
      workflow_id: 7,
      workflow_inputs: { device_id: 2, app: 'bilibili' },
      success_count: 4,
      failure_count: 1,
      evidence_status: 'proven',
      reuse_score: 0.88,
    })
  })
})
