import { mkdtempSync } from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

function parseSseEvents(payload: string): any[] {
  return payload
    .split(/\n\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data:')) ?? '')
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(5).trim()))
}

describe('chat stream route smoke', () => {
  it('streams workflow traces, tool cards, final content, path candidate, and persists the turn', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'homesense-chat-stream-'))
    process.env.DB_PATH = path.join(tmp, 'homesense.db')
    process.env.CHAT2_DB_PATH = path.join(tmp, 'chat.db')

    vi.resetModules()
    vi.doMock('./graph.js', () => {
      const assistantToolMessage = {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_workflow',
            type: 'function',
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
      }
      const workflowResult = {
        inputs: { device_id: 2 },
        input_source: 'memory',
        preview: {
          workflow_id: 9,
          executable: true,
          input_source: 'memory',
          warnings: [],
          steps: [
            {
              node_id: 'n1',
              node_type: 'device_capability',
              label: '设备能力',
              summary: 'Run device capability.',
              risk: 'device',
              preview_state: 'ready',
            },
          ],
        },
        run: {
          run_id: 31,
          workflow_id: 9,
          status: 'succeeded',
          input_source: 'memory',
          outputs: { ok: true },
          trace: [
            {
              node_id: 'n1',
              node_type: 'device_capability',
              status: 'succeeded',
              outputs: { trigger: true },
              duration_ms: 2,
            },
          ],
          events: [],
        },
      }
      const toolMessage = {
        role: 'tool',
        tool_call_id: 'call_workflow',
        name: 'run_workflow',
        content: JSON.stringify(workflowResult),
      }
      const finalAssistant = {
        role: 'assistant',
        content: '流程已完成。',
      }
      const decisionTrace = {
        stage: 'runtime.decision',
        status: 'execute',
        title: '模型主导',
        detail: '执行看电视流程',
        data: { kind: 'llm_primary', allow_tools: true },
      }
      const workflowTrace = {
        stage: 'runtime.execution',
        status: 'success',
        title: '执行工作流',
        data: {
          tool: 'run_workflow',
          params: {
            workflow_id: 9,
            workflow_name: '看电视',
            inputs: { device_id: 2 },
          },
          workflow_tool: {
            name: 'run_workflow',
            args: {
              workflow_id: 9,
              workflow_name: '看电视',
              inputs: { device_id: 2 },
            },
            status: 'success',
            result: workflowResult,
          },
        },
      }

      return {
        ChatReActState: {},
        reactGraph: {
          stream: vi.fn(async function* (initialState: any) {
            yield {
              ...initialState,
              runtimeTrace: [decisionTrace],
              messages: [...initialState.messages, assistantToolMessage],
            }
            yield {
              ...initialState,
              runtimeTrace: [decisionTrace, workflowTrace],
              messages: [...initialState.messages, assistantToolMessage, toolMessage],
            }
            yield {
              ...initialState,
              runtimeTrace: [decisionTrace, workflowTrace],
              messages: [...initialState.messages, assistantToolMessage, toolMessage, finalAssistant],
              finalResponse: '流程已完成。',
              isComplete: true,
            }
          }),
        },
      }
    })

    const Fastify = (await import('fastify')).default
    const { initDb } = await import('../../db/index.js')
    initDb()
    const { chatRoutes } = await import('./routes.js')
    const app = Fastify({ logger: false })
    await app.register(chatRoutes)
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: {
        messages: [{ role: 'user', content: '执行看电视流程' }],
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSseEvents(response.payload)
    expect(events.map((event) => event.type ?? (event.done ? 'done' : 'content'))).toEqual([
      'trace',
      'tool_start',
      'trace',
      'tool_end',
      'content',
      'path_candidate',
      'done',
    ])
    expect(events.find((event) => event.type === 'trace' && event.trace?.title === '执行工作流')).toMatchObject({
      trace: {
        data: {
          workflow_tool: {
            name: 'run_workflow',
            status: 'success',
          },
        },
      },
    })
    expect(events.find((event) => event.type === 'tool_end')).toMatchObject({
      type: 'tool_end',
      call_id: 'call_workflow',
      status: 'success',
      result: {
        input_source: 'memory',
        run: {
          run_id: 31,
          status: 'succeeded',
        },
      },
    })
    expect(events.find((event) => event.type === 'path_candidate')).toMatchObject({
      candidate: {
        steps: [
          {
            tool: 'workflow',
            action: 'run_workflow',
          },
        ],
      },
    })

    const persisted = await app.inject({
      method: 'GET',
      url: '/api/chat/messages?limit=10',
    })
    expect(persisted.statusCode).toBe(200)
    const body = JSON.parse(persisted.payload)
    expect(body.messages.map((message: any) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ])
    expect(body.messages[1].tool_calls_json).toContain('run_workflow')
    expect(body.messages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_workflow',
    })
    expect(body.messages[3]).toMatchObject({
      role: 'assistant',
      content: '流程已完成。',
    })

    await app.close()
  })

  it('drops stale persisted history before invoking the graph after context TTL', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'homesense-chat-stale-'))
    process.env.DB_PATH = path.join(tmp, 'homesense.db')
    process.env.CHAT2_DB_PATH = path.join(tmp, 'chat.db')

    let capturedInitialState: any
    vi.resetModules()
    vi.doMock('./graph.js', () => ({
      ChatReActState: {},
      reactGraph: {
        stream: vi.fn(async function* (initialState: any) {
          capturedInitialState = initialState
          yield {
            ...initialState,
            messages: [
              ...initialState.messages,
              { role: 'assistant', content: '你好，我在。' },
            ],
            finalResponse: '你好，我在。',
            isComplete: true,
          }
        }),
      },
    }))

    const Fastify = (await import('fastify')).default
    const { initDb } = await import('../../db/index.js')
    const { chatService } = await import('./service.js')
    initDb()
    chatService.ensureConversation(1)
    chatService.addConversationMessage(1, 'user', '之前让我写小作文')
    chatService.addConversationMessage(1, 'assistant', '春日的午后，阳光懒洋洋地洒在窗台上。')

    const chatDb = new Database(process.env.CHAT2_DB_PATH)
    const staleAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    chatDb.prepare('UPDATE conversation_messages SET created_at = ? WHERE conversation_id = 1').run(staleAt)
    chatDb.close()

    const { chatRoutes } = await import('./routes.js')
    const app = Fastify({ logger: false })
    await app.register(chatRoutes)
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: {
        messages: [{ role: 'user', content: '你好' }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(capturedInitialState.runtimeContext.session_active).toBe(false)
    expect(capturedInitialState.runtimeContext.recent_messages).toEqual([
      { role: 'user', content: '你好' },
    ])
    expect(JSON.stringify(capturedInitialState.runtimeContext)).not.toContain('小作文')
    expect(JSON.stringify(capturedInitialState.runtimeContext)).not.toContain('春日的午后')

    await app.close()
  })

  it('does not stream a path candidate for blocked workflow previews', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'homesense-chat-blocked-workflow-'))
    process.env.DB_PATH = path.join(tmp, 'homesense.db')
    process.env.CHAT2_DB_PATH = path.join(tmp, 'chat.db')

    vi.resetModules()
    vi.doMock('./graph.js', () => {
      const assistantToolMessage = {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_workflow_blocked',
            type: 'function',
            function: {
              name: 'run_workflow',
              arguments: JSON.stringify({
                workflow_id: 9,
                workflow_name: '看电视',
              }),
            },
          },
        ],
      }
      const workflowResult = {
        blocked: true,
        message: 'Workflow preview blocked: 缺少设备输入',
        inputs: {},
        preview: {
          workflow_id: 9,
          executable: false,
          warnings: ['缺少设备输入'],
        },
      }
      const toolMessage = {
        role: 'tool',
        tool_call_id: 'call_workflow_blocked',
        name: 'run_workflow',
        content: JSON.stringify(workflowResult),
      }
      const finalAssistant = {
        role: 'assistant',
        content: '这个工作流缺少设备输入，已停止。请先选择设备。',
      }

      return {
        ChatReActState: {},
        reactGraph: {
          stream: vi.fn(async function* (initialState: any) {
            yield {
              ...initialState,
              messages: [...initialState.messages, assistantToolMessage],
            }
            yield {
              ...initialState,
              messages: [...initialState.messages, assistantToolMessage, toolMessage, finalAssistant],
              finalResponse: finalAssistant.content,
              isComplete: true,
            }
          }),
        },
      }
    })

    const Fastify = (await import('fastify')).default
    const { initDb } = await import('../../db/index.js')
    initDb()
    const { chatRoutes } = await import('./routes.js')
    const app = Fastify({ logger: false })
    await app.register(chatRoutes)
    await app.ready()

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      payload: {
        messages: [{ role: 'user', content: '执行看电视流程' }],
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSseEvents(response.payload)
    expect(events.some((event) => event.type === 'path_candidate')).toBe(false)

    await app.close()
  })
})
