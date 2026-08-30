import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChat } from './useChat'

function sseEvent(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

describe('useChat', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('consumes chat SSE events into trace, tool cards, path candidate, and final content', async () => {
    vi.useFakeTimers()
    const traceEvent = sseEvent({
      type: 'trace',
      trace: {
        stage: 'runtime.intent',
        status: 'execute',
        title: 'Intent: device_control',
        data: { allow_tools: true },
      },
    })
    const toolStartEvent = sseEvent({
      type: 'tool_start',
      call_id: 'call_workflow',
      name: 'run_workflow',
      args: { workflow_id: 9, workflow_name: '看电视' },
      capability: 'workflow',
    })
    const toolEndEvent = sseEvent({
      type: 'tool_end',
      call_id: 'call_workflow',
      status: 'success',
      result: {
        input_source: 'memory',
        inputs: { device_id: 2 },
        run: { run_id: 31, workflow_id: 9, status: 'succeeded' },
      },
    })
    const pathCandidateEvent = sseEvent({
      type: 'path_candidate',
      candidate: {
        title: '看电视',
        summary: 'runtime path',
        intent_pattern: '看电视',
        source: 'runtime',
        status: 'active',
        conversation_id: 1,
        steps: [
          {
            tool: 'workflow',
            action: 'run_workflow',
            params: { workflow_id: 9, inputs: { device_id: 2 } },
          },
        ],
      },
    })
    const hiddenThinkEvent = sseEvent({ content: '<think>hidden reasoning', done: false })
    const visibleContentEvent = sseEvent({ content: '</think>流程已完成。', done: false })
    const doneEvent = sseEvent({ content: '', done: true })
    const payload = [
      traceEvent,
      toolStartEvent,
      toolEndEvent,
      pathCandidateEvent,
      hiddenThinkEvent,
      visibleContentEvent,
      doneEvent,
    ].join('')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: streamFromChunks([payload.slice(0, 113), payload.slice(113)]),
    } as Response)

    const chat = useChat()
    await chat.sendMessage('执行看电视流程')

    expect(chat.loading.value).toBe(false)
    expect(chat.messages.value).toHaveLength(2)
    expect(chat.messages.value[0]).toMatchObject({
      role: 'user',
      content: '执行看电视流程',
      status: 'final',
    })

    const assistant = chat.messages.value[1]
    expect(assistant).toMatchObject({
      role: 'assistant',
      content: '流程已完成。',
      status: 'final',
    })
    expect(assistant.content).not.toContain('hidden reasoning')
    expect(assistant.runtimeTrace).toEqual([
      expect.objectContaining({
        stage: 'runtime.intent',
        title: 'Intent: device_control',
      }),
    ])
    expect(assistant.toolCalls).toEqual([
      expect.objectContaining({
        call_id: 'call_workflow',
        name: 'run_workflow',
        status: 'success',
        args: { workflow_id: 9, workflow_name: '看电视' },
        result: expect.objectContaining({
          input_source: 'memory',
          inputs: { device_id: 2 },
        }),
      }),
    ])
    expect(assistant.pathCandidate).toMatchObject({
      title: '看电视',
      steps: [
        {
          tool: 'workflow',
          action: 'run_workflow',
          params: { workflow_id: 9, inputs: { device_id: 2 } },
        },
      ],
    })
  })
})
