import { ref, nextTick } from 'vue'
import { api, type ConversationMessage } from '../api'
import type {
  AgentEvent,
  DisplayMessage,
  ToolCallCard,
  PlanStep,
  A2ADispatch,
  ApprovalRequest,
} from '../types/chat'

const API_BASE = (import.meta.env.VITE_API_BASE as string) || 'http://localhost:3000'

function emptyAssistant(turnId?: string): DisplayMessage {
  return {
    id: `assistant_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    turn_id: turnId,
    role: 'assistant',
    content: '',
    status: 'streaming',
    timestamp: new Date(),
    toolCalls: [],
    memoryHits: [],
    candidatePlans: [],
    planSteps: [],
    approvals: [],
    a2aDispatches: [],
  }
}

export function useChat() {
  const messages = ref<DisplayMessage[]>([])
  const conversationId = ref<number | undefined>()
  const loading = ref(false)
  const error = ref<string | null>(null)
  const messageListRef = ref<HTMLElement | null>(null)
  const directLLM = ref(false) // bypass intent router
  let abortController: AbortController | null = null

  function scrollToBottom() {
    nextTick(() => {
      if (messageListRef.value) {
        messageListRef.value.scrollTop = messageListRef.value.scrollHeight
      }
    })
  }

  function applyEvent(event: AgentEvent, msg: DisplayMessage) {
    switch (event.type) {
      case 'turn.start':
        msg.turn_id = event.turn_id
        break
      case 'turn.end':
        msg.durationMs = event.duration_ms
        msg.level = event.level
        if (msg.status === 'streaming') msg.status = 'final'
        break
      case 'assistant.message':
        if (event.delta != null) msg.content += event.delta
        // Populate tool call cards from assistant.message tool_calls
        if (event.tool_calls && event.tool_calls.length > 0) {
          for (const tc of event.tool_calls) {
            const existing = msg.toolCalls.find((c) => c.call_id === tc.id)
            if (!existing) {
              msg.toolCalls.push({
                call_id: tc.id,
                kind: 'cli',
                name: tc.function.name,
                args: tc.function.arguments,
                status: 'running',
                started_at: Date.now(),
              })
            }
          }
        }
        break
      case 'assistant.final':
        msg.content = event.content
        msg.status = 'final'
        break
      case 'route.preview':
        msg.routePreview = {
          normalized_intent: event.normalized_intent,
          route_level: event.route_level,
          reason: event.reason,
          confidence: event.confidence,
          allow_tool_calls: event.allow_tool_calls,
          evidence: event.evidence,
          observations: event.observations,
          search_hits: event.search_hits,
        }
        msg.candidatePlans = event.candidate_plans
        break
      case 'tool.call.start': {
        const card: ToolCallCard = {
          call_id: event.call_id,
          kind: event.kind,
          name: event.name,
          args: event.args,
          status: 'running',
          started_at: Date.now(),
        }
        msg.toolCalls.push(card)
        break
      }
      case 'tool.call.end': {
        const card = msg.toolCalls.find((c) => c.call_id === event.call_id)
        if (card) {
          card.status = event.status
          card.result = event.result
          card.error = event.error
          card.duration_ms = event.duration_ms
        }
        break
      }
      case 'memory.recall':
        msg.memoryHits.push(...event.hits)
        break
      case 'plan.step.start': {
        const step: PlanStep = {
          plan_id: event.plan_id,
          step_order: event.step_order,
          tool: event.tool,
          action: event.action,
          status: 'running',
        }
        msg.planSteps.push(step)
        break
      }
      case 'plan.step.end': {
        const step = msg.planSteps.find(
          (s) => s.plan_id === event.plan_id && s.step_order === event.step_order,
        )
        if (step) {
          step.status = event.status
          step.result = event.result
          step.error = event.error
        }
        break
      }
      case 'approval.request': {
        const req: ApprovalRequest = {
          approval_id: event.approval_id,
          reason: event.reason,
          payload: event.payload,
        }
        msg.approvals.push(req)
        break
      }
      case 'a2a.dispatch.start': {
        const dispatch: A2ADispatch = {
          dispatch_id: event.dispatch_id,
          adapter: event.adapter,
          task: event.task,
          status: 'running',
        }
        msg.a2aDispatches.push(dispatch)
        break
      }
      case 'a2a.dispatch.end': {
        const dispatch = msg.a2aDispatches.find((d) => d.dispatch_id === event.dispatch_id)
        if (dispatch) {
          dispatch.status = event.status
          dispatch.result = event.result
          dispatch.error = event.error
        }
        break
      }
      case 'context.patch':
        msg.contextPatch = { ...(msg.contextPatch ?? {}), ...event.patch }
        break
      case 'error':
        msg.status = 'error'
        if (!msg.content) msg.content = event.message
        error.value = event.message
        break
    }
  }

  async function sendMessage(text: string, options: { agentInstanceId?: number | null } = {}) {
    const trimmed = text.trim()
    if (!trimmed || loading.value) return

    error.value = null
    messages.value.push({
      id: `user_${Date.now()}`,
      role: 'user',
      content: trimmed,
      status: 'final',
      timestamp: new Date(),
      toolCalls: [],
      memoryHits: [],
      candidatePlans: [],
      planSteps: [],
      approvals: [],
      a2aDispatches: [],
    })
    scrollToBottom()

    const assistantMsg = emptyAssistant()
    messages.value.push(assistantMsg)
    scrollToBottom()

    loading.value = true
    abortController = new AbortController()

    try {
      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          conversation_id: conversationId.value,
          agent_instance_id: options.agentInstanceId ?? undefined,
          direct_llm: directLLM.value, // bypass intent router
        }),
        signal: abortController.signal,
      })
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }

      const headerConv = response.headers.get('x-conversation-id')
      if (headerConv) conversationId.value = Number(headerConv)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''

        for (const block of blocks) {
          const lines = block.split('\n')
          let dataLine = ''
          let eventType = ''
          for (const line of lines) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLine += line.slice(5)
          }
          if (eventType === 'done') continue
          if (!dataLine) continue
          try {
            const event = JSON.parse(dataLine) as AgentEvent
            applyEvent(event, assistantMsg)
            scrollToBottom()
          } catch {}
        }
      }

      if (assistantMsg.status === 'streaming') assistantMsg.status = 'final'
    } catch (err) {
      const message = (err as Error).message
      assistantMsg.status = 'error'
      if (!assistantMsg.content) assistantMsg.content = `Stream error: ${message}`
      error.value = message
    } finally {
      loading.value = false
      abortController = null
      scrollToBottom()
    }
  }

  function stopStreaming() {
    abortController?.abort()
  }

  async function loadConversation(id: number) {
    try {
      const result = await api.chat.messages(id)
      conversationId.value = id
      messages.value = result.messages.map((message: ConversationMessage) => {
        const msg: DisplayMessage = {
          id: `msg_${message.id}`,
          role: message.role as 'user' | 'assistant' | 'system',
          content: message.content,
          status: 'final' as const,
          timestamp: new Date(message.created_at),
          toolCalls: [],
          memoryHits: [],
          candidatePlans: [],
          planSteps: [],
          approvals: [],
          a2aDispatches: [],
        }
        // Rebuild tool call cards from stored tool_calls_json
        if (message.role === 'assistant' && (message as any).tool_calls_json) {
          try {
            const toolCalls = JSON.parse((message as any).tool_calls_json) as Array<{
              id: string
              function: { name: string; arguments: string }
            }>
            for (const tc of toolCalls) {
              msg.toolCalls.push({
                call_id: tc.id,
                kind: 'cli',
                name: tc.function.name,
                args: tc.function.arguments,
                status: 'final',
                started_at: 0,
              })
            }
          } catch {}
        }
        return msg
      })
      scrollToBottom()
    } catch {}
  }

  function newConversation() {
    conversationId.value = undefined
    messages.value = []
    error.value = null
  }

  return {
    messages,
    conversationId,
    loading,
    error,
    messageListRef,
    directLLM,
    sendMessage,
    stopStreaming,
    loadConversation,
    newConversation,
  }
}