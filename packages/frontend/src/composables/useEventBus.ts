import { ref, onMounted, onBeforeUnmount } from 'vue'

export interface BusEvent {
  type: string
  data: unknown
  ts?: number
}

const API_BASE = (import.meta.env.VITE_API_BASE as string) || 'http://localhost:3000'

function wsUrl(): string {
  try {
    const u = new URL(API_BASE)
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${u.host}/ws`
  } catch {
    return 'ws://localhost:3000/ws'
  }
}

export function useEventBus() {
  const events = ref<BusEvent[]>([])
  const connected = ref(false)
  let socket: WebSocket | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Map<string, Set<(data: unknown) => void>>()

  function dispatch(evt: BusEvent) {
    events.value.push(evt)
    if (events.value.length > 200) events.value.splice(0, events.value.length - 200)
    const handlers = listeners.get(evt.type)
    if (handlers) for (const h of handlers) h(evt.data)
    const star = listeners.get('*')
    if (star) for (const h of star) h(evt)
  }

  function connect() {
    try {
      socket = new WebSocket(wsUrl())
      socket.onopen = () => {
        connected.value = true
        socket?.send(JSON.stringify({ type: 'subscribe', event: 'state_changed' }))
      }
      socket.onclose = () => {
        connected.value = false
        retryTimer = setTimeout(connect, 3000)
      }
      socket.onerror = () => {
        socket?.close()
      }
      socket.onmessage = (e) => {
        try {
          const parsed = JSON.parse(String(e.data))
          if (parsed && typeof parsed.type === 'string') {
            dispatch({ type: parsed.type, data: parsed.data, ts: parsed.ts ?? Date.now() })
          }
        } catch {}
      }
    } catch {
      retryTimer = setTimeout(connect, 3000)
    }
  }

  function on(type: string, handler: (data: unknown) => void) {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type)!.add(handler)
    return () => listeners.get(type)?.delete(handler)
  }

  onMounted(connect)
  onBeforeUnmount(() => {
    if (retryTimer) clearTimeout(retryTimer)
    socket?.close()
    socket = null
  })

  return { events, connected, on }
}
