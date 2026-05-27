import { ref, nextTick } from 'vue'

export interface ToolCallState {
  call_id: string
  name: string
  args: any
  status: 'running' | 'success' | 'error'
  result?: any
  error?: string
  expanded?: boolean
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
}

const API_BASE = 'http://localhost:3000'

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
    })
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
    }
    messages.value.push(assistantMsg)
    scrollToBottom()

    loading.value = true
    abortController = new AbortController()

    let inThink = false
    let thinkBuffer = ''

    try {
      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Accept-Encoding': 'identity',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: trimmed }],
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
          console.log('[SSE] Stream reader completed');
          break;
        }
        const chunkStr = decoder.decode(value, { stream: true })
        console.log(`[SSE] Received raw chunk (${value.length} bytes):`, JSON.stringify(chunkStr));
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
            console.log('[SSE] Parsed event:', event);

            // Handle tool events
            if (event.type === 'tool_start') {
              if (!assistantMsg.toolCalls) assistantMsg.toolCalls = []
              assistantMsg.toolCalls.push({
                call_id: event.call_id,
                name: event.name,
                args: event.args,
                status: 'running',
                expanded: true,
              })
              scrollToBottom()
              continue
            }

            if (event.type === 'tool_end') {
              const tc = assistantMsg.toolCalls?.find(t => t.call_id === event.call_id)
              if (tc) {
                tc.status = event.status
                tc.result = event.result
                tc.error = event.error
                // Auto collapse after 2.5s
                setTimeout(() => {
                  tc.expanded = false
                }, 2500)
              }
              scrollToBottom()
              continue
            }

            if (event.done) continue
            if (event.error) {
              assistantMsg.status = 'error'
              assistantMsg.content = event.error
              continue
            }
            if (!event.content) continue

            // Parse <think> / </think> tags
            let chunk = event.content
            while (chunk.length > 0) {
              if (inThink) {
                const endIdx = chunk.indexOf('</think>')
                if (endIdx === -1) {
                  thinkBuffer += chunk
                  assistantMsg.thinking = thinkBuffer
                  chunk = ''
                } else {
                  thinkBuffer += chunk.slice(0, endIdx)
                  assistantMsg.thinking = thinkBuffer
                  inThink = false
                  thinkBuffer = ''
                  chunk = chunk.slice(endIdx + 8)
                  assistantMsg.thinkingExpanded = false
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
                  thinkBuffer = ''
                  assistantMsg.thinkingExpanded = true
                  chunk = chunk.slice(startIdx + 7)
                }
              }
            }

            scrollToBottom()
          } catch (e) {
            console.error('[SSE] Failed to parse event JSON:', e);
          }
        }
      }

      if (inThink && thinkBuffer) {
        assistantMsg.thinking = thinkBuffer
        assistantMsg.thinkingExpanded = false
      }

      if (assistantMsg.status === 'streaming') assistantMsg.status = 'final'
    } catch (err) {
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
