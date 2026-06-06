import { ref, nextTick } from 'vue'
import { api } from '../api'
import type { RecordExperiencePathInput } from '../api/memoryAssets'

export interface ToolCallState {
  call_id: string
  name: string
  args: any
  status: 'running' | 'success' | 'error'
  device?: any
  capability?: string
  predictedEffect?: string
  nextStep?: string
  result?: any
  error?: string
  expanded?: boolean
}

export interface RuntimeTraceEvent {
  stage: string
  status: 'hit' | 'miss' | 'skipped' | 'execute' | 'fallback' | 'success' | 'error' | 'approval_required'
  title: string
  detail?: string
  confidence?: number
  data?: Record<string, unknown>
}

export interface DisplayMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking: string
  thinkingExpanded: boolean
  status: 'streaming' | 'final' | 'error'
  timestamp: Date
  toolCalls?: ToolCallState[]
  runtimeTrace?: RuntimeTraceEvent[]
  traceExpanded?: boolean
  pathCandidate?: RecordExperiencePathInput
  pathSaveStatus?: 'idle' | 'saving' | 'saved' | 'error'
  pathSaveError?: string
  workflowSaveStatus?: 'idle' | 'saving' | 'saved' | 'error'
  workflowSaveError?: string
  workflowId?: number
}

export function useChat() {
  const messages = ref<DisplayMessage[]>([])
  const loading = ref(false)
  const messageListRef = ref<HTMLElement | null>(null)
  let abortController: AbortController | null = null

  function scrollToBottom() {
    nextTick(() => {
      if (messageListRef.value) {
        messageListRef.value.scrollTop = messageListRef.value.scrollHeight
      }
    })
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading.value) return

    messages.value.push({
      id: `user_${Date.now()}`,
      role: 'user',
      content: trimmed,
      thinking: '',
      thinkingExpanded: false,
      status: 'final',
      timestamp: new Date(),
      runtimeTrace: [],
      traceExpanded: false,
    })
    const requestMessages = [{ role: 'user' as const, content: trimmed }]
    scrollToBottom()

    const assistantMsg: DisplayMessage = {
      id: `assistant_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'assistant',
      content: '',
      thinking: '',
      thinkingExpanded: true,
      status: 'streaming',
      timestamp: new Date(),
      toolCalls: [],
      runtimeTrace: [],
      traceExpanded: false,
    }
    messages.value.push(assistantMsg)
    scrollToBottom()

    loading.value = true
    abortController = new AbortController()

    let inThink = false

    try {
      const response = await fetch(api.chat.streamUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Accept-Encoding': 'identity',
        },
        body: JSON.stringify({
          messages: requestMessages,
        }),
        signal: abortController.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let lineBuffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) {
          break
        }
        const chunkStr = decoder.decode(value, { stream: true })
        lineBuffer += chunkStr

        const lines = lineBuffer.split('\n')
        lineBuffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine.startsWith('data:')) continue

          const rawData = trimmedLine.slice(5).trim()
          if (!rawData) continue

          try {
            const event = JSON.parse(rawData)

            if (event.type === 'trace' && event.trace) {
              if (!assistantMsg.runtimeTrace) assistantMsg.runtimeTrace = []
              assistantMsg.runtimeTrace.push(event.trace)
              scrollToBottom()
              continue
            }

            if (event.type === 'path_candidate' && event.candidate) {
              assistantMsg.pathCandidate = event.candidate
              scrollToBottom()
              continue
            }

            // Handle tool events
            if (event.type === 'tool_start') {
              if (!assistantMsg.toolCalls) assistantMsg.toolCalls = []
              assistantMsg.toolCalls.push({
                call_id: event.call_id,
                name: event.name,
                args: event.args,
                device: event.device,
                capability: event.capability,
                status: 'running',
                expanded: false,
              })
              scrollToBottom()
              continue
            }

            if (event.type === 'tool_end') {
              const tc = assistantMsg.toolCalls?.find(t => t.call_id === event.call_id)
              if (tc) {
                tc.status = event.status
                tc.result = event.result
                tc.device = event.result?.device ?? tc.device
                tc.capability = event.result?.capability
                tc.predictedEffect = event.result?.predicted_effect
                tc.nextStep = event.result?.next_step
                tc.error = event.error
                // Auto collapse after 2.5s
                setTimeout(() => {
                  tc.expanded = false
                }, 2500)
              }
              scrollToBottom()
              continue
            }

            if (event.error) {
              assistantMsg.status = 'error'
              assistantMsg.content = event.error
              continue
            }
            if (event.done) continue
            if (!event.content) continue

            // Strip internal think tags without exposing hidden reasoning text.
            let chunk = event.content
            while (chunk.length > 0) {
              if (inThink) {
                const endIdx = chunk.indexOf('</think>')
                if (endIdx === -1) {
                  chunk = ''
                } else {
                  inThink = false
                  chunk = chunk.slice(endIdx + 8)
                }
              } else {
                const startIdx = chunk.indexOf('<think>')
                if (startIdx === -1) {
                  assistantMsg.content += chunk
                  chunk = ''
                } else {
                  if (startIdx > 0) {
                    assistantMsg.content += chunk.slice(0, startIdx)
                  }
                  inThink = true
                  chunk = chunk.slice(startIdx + 7)
                }
              }
            }

            scrollToBottom()
          } catch (e) {
            console.error('[SSE] Failed to parse event JSON:', e)
          }
        }
      }

      if (assistantMsg.status === 'streaming') assistantMsg.status = 'final'
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        assistantMsg.status = 'final'
        if (!assistantMsg.content && !assistantMsg.thinking && (!assistantMsg.toolCalls || assistantMsg.toolCalls.length === 0)) {
          assistantMsg.content = '已停止。'
        }
        return
      }
      const message = (err as Error).message
      assistantMsg.status = 'error'
      if (!assistantMsg.content) assistantMsg.content = `Stream error: ${message}`
    } finally {
      loading.value = false
      abortController = null
      scrollToBottom()
    }
  }

  function stopStreaming() {
    abortController?.abort()
  }

  return {
    messages,
    loading,
    messageListRef,
    sendMessage,
    stopStreaming,
  }
}
