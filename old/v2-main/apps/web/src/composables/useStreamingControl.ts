import { computed, onBeforeUnmount, ref } from 'vue'

export type StreamingControlRole = 'controller' | 'viewer'

export type StreamingControlEvent = {
  id?: string
  kind: 'button' | 'axis' | 'pointer' | 'text' | 'system'
  action: string
  value?: unknown
  at?: string
}

export function useStreamingControl(sessionId: string, role: StreamingControlRole) {
  const socket = ref<WebSocket | null>(null)
  const connected = ref(false)
  const status = ref<'idle' | 'connecting' | 'connected' | 'error' | 'closed'>('idle')
  const error = ref('')
  const lastAck = ref('')
  const events = ref<Array<StreamingControlEvent & { source?: string }>>([])
  const peers = ref<{ controllers: number; viewers: number }>({ controllers: 0, viewers: 0 })

  const wsUrl = computed(() => {
    const envBase = import.meta.env.VITE_WS_BASE || ''
    const base = envBase || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    return `${base}/api/streaming-gateway/control/ws`
  })

  function connect() {
    if (socket.value && (socket.value.readyState === WebSocket.OPEN || socket.value.readyState === WebSocket.CONNECTING)) return
    status.value = 'connecting'
    error.value = ''
    const ws = new WebSocket(wsUrl.value)
    socket.value = ws

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        type: 'join',
        session_id: sessionId,
        role,
        client_id: `${role}_${Math.random().toString(36).slice(2, 8)}`,
      }))
    })

    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as {
          type: string
          data?: any
        }
        if (message.type === 'joined') {
          connected.value = true
          status.value = 'connected'
          peers.value = message.data?.peers ?? peers.value
        } else if (message.type === 'peer') {
          peers.value = message.data?.peers ?? peers.value
        } else if (message.type === 'input') {
          const incoming = message.data?.event
          if (incoming) events.value = [{ ...incoming }, ...events.value].slice(0, 80)
        } else if (message.type === 'ack') {
          lastAck.value = message.data?.at || new Date().toISOString()
        } else if (message.type === 'error') {
          error.value = message.data?.message || 'Streaming control error'
          status.value = 'error'
        }
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
      }
    })

    ws.addEventListener('close', () => {
      connected.value = false
      status.value = 'closed'
    })

    ws.addEventListener('error', () => {
      connected.value = false
      status.value = 'error'
      error.value = 'WebSocket connection failed'
    })
  }

  function disconnect() {
    socket.value?.close()
    socket.value = null
    connected.value = false
  }

  function sendControl(event: StreamingControlEvent) {
    if (!socket.value || socket.value.readyState !== WebSocket.OPEN || !connected.value) return false
    socket.value.send(JSON.stringify({
      type: 'input',
      session_id: sessionId,
      event: {
        id: event.id || `${event.kind}_${event.action}_${Date.now()}`,
        ...event,
        at: event.at || new Date().toISOString(),
      },
    }))
    return true
  }

  onBeforeUnmount(disconnect)

  return {
    connected,
    status,
    error,
    lastAck,
    events,
    peers,
    connect,
    disconnect,
    sendControl,
  }
}
