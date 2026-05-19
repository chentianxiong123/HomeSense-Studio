import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { agentRuntime } from '../agent-runtime/index.js'
import type { AgentEvent } from '../agent-runtime/events.js'
import { conversationService } from '../conversation/index.js'
import { a2aClient } from '../a2a-client/index.js'
import { manifestRegistry } from '../manifest-registry/index.js'
import { executorGateway } from '../executor-gateway/index.js'
import { experienceService } from '../experience/index.js'

const A2A_ADAPTER_BINDINGS: Record<string, { endpoint_env: string; target: string }> = {
  codex: { endpoint_env: 'A2A_CODEX_ENDPOINT', target: 'codex' },
  claude_code: { endpoint_env: 'A2A_CLAUDE_CODE_ENDPOINT', target: 'claude_code' },
  claude: { endpoint_env: 'A2A_CLAUDE_CODE_ENDPOINT', target: 'claude_code' },
  xiaolongxia: { endpoint_env: 'A2A_XIAOLONGXIA_ENDPOINT', target: 'xiaolongxia' },
}

function parseA2ACommand(message: string): { adapter: string; task: string } | null {
  const match = message.trim().match(/^\/a2a\s+(\S+)\s+([\s\S]+)$/)
  if (!match) return null
  const adapter = match[1].toLowerCase()
  return { adapter, task: match[2].trim() }
}

function parseSkillCommand(message: string): { manifestId: string; bodyRaw: string } | null {
  const match = message.trim().match(/^\/skill\s+(\S+)(?:\s+([\s\S]+))?$/)
  if (!match) return null
  return { manifestId: match[1], bodyRaw: match[2] ?? '' }
}

async function *runSkillTurn(message: string, command: { manifestId: string; bodyRaw: string }): AsyncGenerator<AgentEvent, void, void> {
  const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const start = Date.now()
  yield { type: 'turn.start', turn_id: turnId, message, timestamp: start }

  const manifest = manifestRegistry.get(command.manifestId)
  if (!manifest) {
    yield { type: 'assistant.final', turn_id: turnId, content: `Manifest not found: ${command.manifestId}` }
    yield { type: 'turn.end', turn_id: turnId, duration_ms: Date.now() - start, level: 1 }
    return
  }

  let body: Record<string, unknown> = {}
  if (command.bodyRaw.trim()) {
    try {
      body = JSON.parse(command.bodyRaw) as Record<string, unknown>
    } catch {
      const sample = manifest.sample_invocation ?? {}
      body = manifest.kind === 'agent' || manifest.kind === 'a2a'
        ? { task: command.bodyRaw, payload: sample.payload ?? {}, execution_mode: sample.execution_mode ?? 'deferred' }
        : { params: { text: command.bodyRaw } }
    }
  } else {
    body = (manifest.sample_invocation as Record<string, unknown>) ?? {}
  }

  const callId = `call_${turnId}_skill`
  yield {
    type: 'tool.call.start',
    turn_id: turnId,
    call_id: callId,
    kind: manifest.kind === 'a2a' ? 'a2a' : manifest.kind === 'agent' ? 'a2a' : manifest.kind === 'channel' ? 'service' : (manifest.kind as 'cli' | 'service'),
    name: manifest.id,
    args: body,
  }

  const stepStart = Date.now()
  try {
    const targetId = manifest.id.includes('.') ? manifest.id.split('.').slice(1).join('.') : manifest.id
    let result: unknown
    if (manifest.kind === 'cli') {
      result = await executorGateway.invoke('cli.invoke', {
        cli_name: targetId,
        action: String(body.action ?? ''),
        params: (body.params as Record<string, unknown>) ?? {},
      })
    } else if (manifest.kind === 'service' || manifest.kind === 'channel') {
      result = await executorGateway.invoke('service.invoke', {
        service_name: targetId,
        params: (body.params as Record<string, unknown>) ?? {},
      })
    } else {
      result = await executorGateway.invoke('agent.dispatch', {
        target: targetId,
        task: String(body.task ?? ''),
        payload: (body.payload as Record<string, unknown>) ?? {},
        execution_mode: String(body.execution_mode ?? 'deferred'),
      })
    }

    yield {
      type: 'tool.call.end',
      turn_id: turnId,
      call_id: callId,
      status: 'success',
      result,
      duration_ms: Date.now() - stepStart,
    }
    yield { type: 'assistant.final', turn_id: turnId, content: `Skill ${manifest.id} ran in ${Date.now() - start}ms.` }
  } catch (err) {
    const msg = (err as Error).message
    yield {
      type: 'tool.call.end',
      turn_id: turnId,
      call_id: callId,
      status: 'error',
      error: msg,
      duration_ms: Date.now() - stepStart,
    }
    yield { type: 'assistant.final', turn_id: turnId, content: `Skill ${manifest.id} failed: ${msg}` }
  }

  yield { type: 'turn.end', turn_id: turnId, duration_ms: Date.now() - start, level: 1 }
}

async function *runA2ATurn(message: string, command: { adapter: string; task: string }): AsyncGenerator<AgentEvent, void, void> {
  const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const start = Date.now()
  yield { type: 'turn.start', turn_id: turnId, message, timestamp: start }

  const binding = A2A_ADAPTER_BINDINGS[command.adapter]
  if (!binding) {
    yield {
      type: 'assistant.final',
      turn_id: turnId,
      content: `Unknown A2A adapter: ${command.adapter}. Known: ${Object.keys(A2A_ADAPTER_BINDINGS).join(', ')}`,
    }
    yield { type: 'turn.end', turn_id: turnId, duration_ms: Date.now() - start, level: 1 }
    return
  }

  const dispatchId = `a2a_${turnId}`
  yield {
    type: 'a2a.dispatch.start',
    turn_id: turnId,
    dispatch_id: dispatchId,
    adapter: command.adapter,
    task: command.task,
  }

  try {
    const result = await a2aClient.sendTask({
      target: binding.target,
      task: command.task,
      binding: { endpoint_env: binding.endpoint_env, agent_name: command.adapter },
      execution_mode: 'deferred',
    })

    yield {
      type: 'a2a.dispatch.end',
      turn_id: turnId,
      dispatch_id: dispatchId,
      status: 'success',
      result,
    }

    const summary = result.status === 'planned'
      ? `Dispatched to @${command.adapter} (planned, no endpoint bound via ${binding.endpoint_env}).`
      : `@${command.adapter} accepted the task.`
    yield { type: 'assistant.final', turn_id: turnId, content: summary }
  } catch (err) {
    const msg = (err as Error).message
    yield {
      type: 'a2a.dispatch.end',
      turn_id: turnId,
      dispatch_id: dispatchId,
      status: 'error',
      error: msg,
    }
    yield {
      type: 'assistant.final',
      turn_id: turnId,
      content: `A2A dispatch failed: ${msg}`,
    }
  }

  yield { type: 'turn.end', turn_id: turnId, duration_ms: Date.now() - start, level: 1 }
}

export async function chatStreamRoutes(app: FastifyInstance) {
  app.post('/api/chat/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      message: string
      conversation_id?: number
      channel?: string
      user_id?: string
      agent_instance_id?: number
      working_context?: Record<string, unknown>
      direct_llm?: boolean
    }

    if (!body.message) {
      reply.code(400)
      return { status: 'error', error: 'INVALID_PARAMS', message: 'Missing message parameter' }
    }

    const started = conversationService.createOrAttach({
      conversation_id: body.conversation_id,
      channel: body.channel,
      user_id: body.user_id,
      agent_instance_id: body.agent_instance_id,
      surface: 'chat',
      working_context: body.working_context,
    })
    const conversationId = started.conversation_id
    conversationService.appendMessage(conversationId, 'user', body.message)
    const contextRecord = conversationService.getContext(conversationId, 20)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.write(`: conversation_id=${conversationId}\n\n`)

    const workingContextBase = parseJson(
      contextRecord.session.working_context_json,
      {} as Record<string, unknown>,
    )
    let finalContent = ''
    let matchedPlanId: string | undefined
    let resolvedTargetDevice: string | undefined
    let lastContextPatch: Record<string, unknown> = {}
    let aborted = false
    // Tool-loop message persistence: accumulate in-flight tool calls
    let pendingAssistantContent = ''
    let pendingAssistantToolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = []
    const pendingToolCalls: Array<{ id: string; name: string; args: unknown; result?: unknown; status?: string }> = []
    let inToolRound = false

    request.raw.on('close', () => {
      // BUG: Node.js 的 request 'close' 在 POST body 消费完就触发，不是客户端断开
      // 所以改成监听 response 的 close：那才是真正的客户端断开/连接关闭
    })
    reply.raw.on('close', () => {
      aborted = true
    })

    try {
      const a2aCommand = parseA2ACommand(body.message)
      const skillCommand = a2aCommand ? null : parseSkillCommand(body.message)

      const stream = a2aCommand
        ? runA2ATurn(body.message, a2aCommand)
        : skillCommand
          ? runSkillTurn(body.message, skillCommand)
          : body.direct_llm
            ? agentRuntime.processDirectStream(body.message, {
                conversation_id: conversationId,
                history: contextRecord.history.slice(0, -1),
                channel: contextRecord.session.channel,
                user_id: contextRecord.session.user_id,
                agent_instance_id: contextRecord.session.agent_instance_id,
                working_context: workingContextBase,
                summary: contextRecord.session.summary,
              })
            : agentRuntime.processMessageStream(body.message, {
              conversation_id: conversationId,
              history: contextRecord.history.slice(0, -1),
              channel: contextRecord.session.channel,
              user_id: contextRecord.session.user_id,
              agent_instance_id: contextRecord.session.agent_instance_id,
              working_context: workingContextBase,
              summary: contextRecord.session.summary,
            })

      for await (const event of stream) {
        if (aborted) break
        writeEvent(reply, event)

        // Track streaming assistant content
        if (event.type === 'assistant.message') {
          pendingAssistantContent = event.content
          inToolRound = true
        }
        // Capture tool_calls when they arrive on the assistant message
        if (event.type === 'assistant.message' && 'tool_calls' in event && event.tool_calls) {
          pendingAssistantToolCalls = event.tool_calls as typeof pendingAssistantToolCalls
        }
        // Queue incoming tool call
        if (event.type === 'tool.call.start') {
          pendingToolCalls.push({ id: event.call_id, name: event.name, args: event.args })
        }
        // Resolve tool result when call ends
        if (event.type === 'tool.call.end') {
          const p = pendingToolCalls.find((t) => t.id === event.call_id)
          if (p) { p.result = event.result; p.status = event.status }
        }
        if (event.type === 'assistant.final') {
          finalContent = event.content
          // Persist tool-round messages (assistant with tool_calls + tool results) at turn end
          if (inToolRound && pendingAssistantToolCalls.length > 0) {
            conversationService.appendMessage(conversationId, 'assistant', pendingAssistantContent, {
              tool_calls: pendingAssistantToolCalls,
            })
            for (const tc of pendingToolCalls) {
              const toolResultContent = tc.status === 'error'
                ? JSON.stringify({ error: tc.result })
                : JSON.stringify(tc.result)
              conversationService.appendMessage(conversationId, 'tool', toolResultContent, {
                tool_call_id: tc.id,
                name: tc.name,
              })
            }
            pendingAssistantContent = ''
            pendingAssistantToolCalls = []
            pendingToolCalls.length = 0
            inToolRound = false
          }
        }
        if (event.type === 'plan.step.start' && !matchedPlanId) matchedPlanId = event.plan_id
        if (event.type === 'context.patch' && typeof event.patch.target_device_id === 'string') {
          resolvedTargetDevice = event.patch.target_device_id
        }
        if (event.type === 'context.patch') {
          lastContextPatch = { ...lastContextPatch, ...event.patch }
        }
      }
    } catch (error) {
      writeEvent(reply, {
        type: 'error',
        turn_id: 'fatal',
        message: (error as Error).message,
      } as AgentEvent)
    }

    if (finalContent) {
      conversationService.appendMessage(conversationId, 'assistant', finalContent)
      const nextWorkingContext = {
        ...workingContextBase,
        last_completed_message: body.message,
        last_target_device_id: resolvedTargetDevice ?? null,
        last_normalized_intent:
          typeof lastContextPatch.normalized_intent === 'string'
            ? lastContextPatch.normalized_intent
            : null,
        last_route_reason:
          typeof lastContextPatch.route_reason === 'string'
            ? lastContextPatch.route_reason
            : null,
        last_candidate_plan_ids: Array.isArray(lastContextPatch.candidate_plan_ids)
          ? lastContextPatch.candidate_plan_ids
          : [],
        preferred_tv_device_id:
          resolvedTargetDevice ?? workingContextBase.preferred_tv_device_id ?? null,
      }
      conversationService.updateSession(conversationId, {
        working_context: nextWorkingContext,
        last_intent: body.message,
        last_plan_id: matchedPlanId ?? null,
        summary: finalContent.slice(0, 240),
      })

      try {
        const title = body.message.slice(0, 80).replace(/\s+/g, ' ').trim() || `Turn ${conversationId}`
        const content = [
          `User: ${body.message}`,
          `Assistant: ${finalContent}`,
          resolvedTargetDevice ? `Target device: ${resolvedTargetDevice}` : '',
          matchedPlanId ? `Matched plan: ${matchedPlanId}` : '',
        ]
          .filter(Boolean)
          .join('\n')
        const importance = matchedPlanId ? 0.8 : resolvedTargetDevice ? 0.6 : 0.4
        experienceService.writeExperience('chat', title, content, importance)
      } catch {}
    }

    reply.raw.write(`event: done\ndata: {}\n\n`)
    reply.raw.end()
  })
}

function writeEvent(reply: FastifyReply, event: AgentEvent) {
  try {
    const payload = JSON.stringify(event)
    const line = `event: ${event.type}\ndata: ${payload}\n\n`
    const ok = reply.raw.write(line)
    if (!ok) {
      console.error('[DEBUG stream] writeEvent: write returned false, backpressure')
    }
    // Force flush for SSE
    ;(reply.raw as NodeJS.WritableStream & { flush?: () => void }).flush?.()
  } catch (err) {
    console.error('[DEBUG stream] writeEvent error:', err)
  }
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
