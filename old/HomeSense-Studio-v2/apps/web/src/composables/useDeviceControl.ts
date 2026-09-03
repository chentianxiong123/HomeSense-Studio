import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '../api'

const entityStates = ref<Record<string, Record<string, unknown>>>({})
const loading = ref(false)

let ws: WebSocket | null = null
let subscribers = 0

function connectWS() {
  const wsBase = (import.meta.env.VITE_API_BASE || window.location.origin).replace(/^http/, 'ws')
  const wsUrl = `${wsBase}/ws`

  ws = new WebSocket(wsUrl)
  ws.onopen = () => {
    ws?.send(JSON.stringify({ type: 'subscribe', event: 'state_changed' }))
  }
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'state_changed' && msg.data) {
        const { entity_id, new_state, attributes } = msg.data
        entityStates.value = {
          ...entityStates.value,
          [entity_id]: {
            state: new_state,
            attributes: attributes ?? {},
            last_updated: new Date().toISOString(),
          },
        }
      }
    } catch {}
  }
  ws.onclose = () => {
    if (subscribers > 0) {
      setTimeout(connectWS, 3000)
    }
  }
}

function disconnectWS() {
  if (ws) {
    ws.close()
    ws = null
  }
}

export function useDeviceControl() {
  onMounted(() => {
    subscribers++
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      connectWS()
    }
  })

  onUnmounted(() => {
    subscribers--
    if (subscribers <= 0) {
      disconnectWS()
    }
  })

  async function control(entityId: string, command: string, value?: unknown): Promise<unknown> {
    loading.value = true
    try {
      if (command === 'turn_on') {
        return await api.serviceCall('device_control.turn_on', { entity_id: entityId })
      } else if (command === 'turn_off') {
        return await api.serviceCall('device_control.turn_off', { entity_id: entityId })
      } else if (command === 'set_value') {
        return await api.serviceCall('device_control.set_value', { entity_id: entityId, value })
      } else if (command === 'get_state') {
        return await api.serviceCall('device_control.get_state', { entity_id: entityId })
      }
    } finally {
      loading.value = false
    }
  }

  return {
    entityStates,
    loading,
    control,
  }
}
