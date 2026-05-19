/**
 * StandaloneChatService — a pure, dependency-injected chat engine.
 *
 * No Fastify, no database, no filesystem dependencies.
 * Just a chat loop over an LLM, driven entirely by injected dependencies.
 *
 * Can be instantiated and tested with zero infrastructure:
 *   const chat = new StandaloneChatService({ llm, tools, history })
 *   for await (const event of chat.run("turn on the TV")) { ... }
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolResult {
  id: string
  name: string
  args: unknown
  status: 'success' | 'error'
  result?: unknown
  error?: string
  duration_ms: number
}

// ── Agent events emitted by the chat engine ──────────────────────────

export type ChatEvent =
  | { type: 'turn.start'; turn_id: string; message: string; timestamp: number }
  | { type: 'turn.end'; turn_id: string; duration_ms: number; level: 1 | 2 | 3 }
  | { type: 'assistant.message'; turn_id: string; delta: string | null; content: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { type: 'assistant.final'; turn_id: string; content: string }
  | { type: 'tool.call.start'; turn_id: string; call_id: string; kind: string; name: string; args: unknown }
  | { type: 'tool.call.end'; turn_id: string; call_id: string; status: 'success' | 'error'; result?: unknown; error?: string; duration_ms: number }
  | { type: 'error'; turn_id: string; message: string }

// ── Minimal LLM interface (so the engine stays storage-agnostic) ────

export interface LLMProvider {
  chatStream(params: {
    messages: Array<{ role: string; content: string }>
    tools?: ToolDefinition[]
    temperature?: number
    max_tokens?: number
  }): AsyncGenerator<{ delta: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }, void, void>
}

// ── Minimal tool-executor interface ──────────────────────────────────

export interface ToolExecutor {
  execute(name: string, args: unknown): Promise<{ success: boolean; data?: unknown; error?: string }>
}

// ── StandaloneChatService ─────────────────────────────────────────────

export interface StandaloneChatConfig {
  systemPrompt?: string
  maxRounds?: number
  temperature?: number
}

export class StandaloneChatService {
  private turnId = 0

  constructor(
    private readonly llm: LLMProvider,
    private readonly tools: ToolDefinition[],
    private readonly executor: ToolExecutor,
    private readonly config: StandaloneChatConfig = {},
  ) {}

  async *run(
    message: string,
    history: LLMMessage[] = [],
  ): AsyncGenerator<ChatEvent, void, void> {
    const turnId = `turn_${++this.turnId}_${Date.now()}`
    const start = Date.now()

    yield { type: 'turn.start', turn_id: turnId, message, timestamp: start }

    // Build the message list for this turn
    const messages: LLMMessage[] = []
    if (this.config.systemPrompt) {
      messages.push({ role: 'system', content: this.config.systemPrompt })
    }
    messages.push(...history.slice(-20)) // keep last 20 turns
    messages.push({ role: 'user', content: message })

    const maxRounds = this.config.maxRounds ?? 6
    let round = 0
    let finalContent = ''

    try {
      while (round < maxRounds) {
        round++
        let accContent = ''
        let accToolCalls: Array<{ id: string; function: { name: string; arguments: string } }> = []

        // ── Streaming pass ────────────────────────────────────────────
        for await (const delta of this.llm.chatStream({
          messages: messages as Array<{ role: string; content: string }>,
          tools: this.tools.length > 0 ? this.tools : undefined,
          temperature: this.config.temperature,
        })) {
          if (delta.delta != null) {
            accContent += delta.delta
            yield { type: 'assistant.message', turn_id: turnId, delta: delta.delta, content: accContent }
          }
          if (delta.tool_calls && delta.tool_calls.length > 0) {
            accToolCalls = delta.tool_calls
          }
        }

        // No tool calls → final response
        if (accToolCalls.length === 0) {
          finalContent = accContent || 'No response generated.'
          yield { type: 'assistant.final', turn_id: turnId, content: finalContent }
          break
        }

        // Emit complete assistant message with tool_calls (used by consumers)
        yield {
          type: 'assistant.message',
          turn_id: turnId,
          delta: null,
          content: accContent,
          tool_calls: accToolCalls.map((tc) => ({ id: tc.id, type: 'function' as const, function: tc.function })),
        }

        // Add assistant message to history
        messages.push({
          role: 'assistant',
          content: accContent,
          tool_calls: accToolCalls.map((tc) => ({ id: tc.id, type: 'function', function: tc.function })),
        })

        // ── Tool execution pass ──────────────────────────────────────
        for (const toolCall of accToolCalls) {
          const callId = toolCall.id
          let parsedArgs: unknown = {}
          try { parsedArgs = JSON.parse(toolCall.function.arguments) } catch {}

          yield { type: 'tool.call.start', turn_id: turnId, call_id: callId, kind: 'cli', name: toolCall.function.name, args: parsedArgs }

          const stepStart = Date.now()
          const execResult = await this.executor.execute(toolCall.function.name, parsedArgs)
          const duration = Date.now() - stepStart

          yield {
            type: 'tool.call.end',
            turn_id: turnId,
            call_id: callId,
            status: execResult.success ? 'success' : 'error',
            result: execResult.data,
            error: execResult.error,
            duration_ms: duration,
          }

          messages.push({
            role: 'tool',
            tool_call_id: callId,
            name: toolCall.function.name,
            content: JSON.stringify(execResult.success ? execResult.data : { error: execResult.error }),
          })
        }
      }

      if (round >= maxRounds) {
        yield { type: 'assistant.final', turn_id: turnId, content: `Max rounds (${maxRounds}) reached.` }
      }
    } catch (err) {
      yield { type: 'error', turn_id: turnId, message: (err as Error).message }
    }

    yield { type: 'turn.end', turn_id: turnId, duration_ms: Date.now() - start, level: 3 }
  }
}

// ── Virtual tool executor (for testing without real devices) ─────────

export class VirtualToolExecutor implements ToolExecutor {
  private tools = new Map<string, (args: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>>()

  register(name: string, handler: (args: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>) {
    this.tools.set(name, handler)
  }

  async execute(name: string, args: unknown): Promise<{ success: boolean; data?: unknown; error?: string }> {
    const handler = this.tools.get(name)
    if (!handler) {
      return { success: false, error: `Unknown tool: ${name}` }
    }
    try {
      return await handler(args)
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}

// ── Virtual LLM provider (returns configurable responses) ──────────────

export class VirtualLLMProvider implements LLMProvider {
  private responseIndex = 0
  private responses: Array<{
    content?: string
    tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
  }> = []

  constructor(private stream = true) {}

  setResponses(responses: typeof this.responses) {
    this.responses = responses
    this.responseIndex = 0
  }

  async *chatStream(params: {
    messages: Array<{ role: string; content: string }>
    tools?: ToolDefinition[]
    temperature?: number
    max_tokens?: number
  }): AsyncGenerator<{ delta: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }, void, void> {
    const response = this.responses[this.responseIndex++] ?? { content: 'Virtual response.' }

    if (response.tool_calls) {
      // Emit content first, then tool_calls
      if (response.content) {
        for (const char of response.content) {
          yield { delta: char }
          await new Promise((r) => setTimeout(r, 5))
        }
      }
      yield { delta: null, tool_calls: response.tool_calls }
    } else if (response.content !== undefined) {
      // Stream content token by token
      const tokens = response.content.split(/(\s+)/)
      for (const token of tokens) {
        if (token) {
          yield { delta: token }
          await new Promise((r) => setTimeout(r, 10))
        }
      }
    } else {
      yield { delta: 'Virtual response.' }
    }
  }
}