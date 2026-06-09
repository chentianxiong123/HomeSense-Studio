<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '@/api'
import type { SessionTarget } from '@/composables/useTerminal'

const props = withDefaults(defineProps<{
  targetId?: number          // resolve configured terminal target via HTTP /api/terminal/target/:id
  targetDeviceId?: number    // resolve user device via HTTP /api/terminal/device-target/:id
  target?: SessionTarget     // ...or pass target directly
  label?: string
  fontSize?: number
  height?: string
  showHeader?: boolean
}>(), {
  fontSize: 12,
  height: '320px',
  showHeader: true,
})

const containerRef = ref<HTMLElement | null>(null)
const state = ref<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle')
const error = ref<string | null>(null)
const headerLabel = ref(props.label ?? '')

let term: Terminal | null = null
let fit: FitAddon | null = null
let ws: WebSocket | null = null
let sessionId: string | null = null
let resizeObserver: ResizeObserver | null = null
let resolvedTarget: SessionTarget | null = null
let resolvedLabel = ''
let sessionStorageKey: string | null = null
let pendingAttachSessionId: string | null = null

const apiBase = (import.meta.env.VITE_API_BASE ?? '') || 'http://localhost:3100'
const wsBase = apiBase.replace(/^http/, 'ws')

function buildSessionStorageKey(target: SessionTarget, label: string): string {
  if (props.targetId) return `homesense-terminal:v1:target:${props.targetId}`
  if (props.targetDeviceId) return `homesense-terminal:v1:device:${props.targetDeviceId}`
  if (target.kind === 'local') {
    return [
      'homesense-terminal:v1:local',
      target.shell ?? 'default',
      target.cwd ?? 'default',
      label,
    ].map(encodeURIComponent).join(':')
  }
  if (target.kind === 'adb') {
    return [
      'homesense-terminal:v1:adb',
      target.serial,
      target.command ?? 'shell',
      label,
    ].map(encodeURIComponent).join(':')
  }
  return [
    'homesense-terminal:v1:ssh',
    target.host,
    String(target.port ?? 22),
    target.user,
    target.auth,
    target.keyName ?? 'password',
    label,
  ].map(encodeURIComponent).join(':')
}

function readStoredSessionId(): string | null {
  if (!sessionStorageKey) return null
  try {
    return window.localStorage.getItem(sessionStorageKey)
  } catch {
    return null
  }
}

function storeSessionId(id: string) {
  if (!sessionStorageKey) return
  try {
    window.localStorage.setItem(sessionStorageKey, id)
  } catch {
    // ignore localStorage failures
  }
}

function clearStoredSessionId() {
  if (!sessionStorageKey) return
  try {
    window.localStorage.removeItem(sessionStorageKey)
  } catch {
    // ignore localStorage failures
  }
}

function terminalSize() {
  return {
    cols: term?.cols || 120,
    rows: term?.rows || 32,
  }
}

function sendStartFrame() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !resolvedTarget) return
  pendingAttachSessionId = null
  ws.send(JSON.stringify({
    type: 'start',
    target: resolvedTarget,
    label: resolvedLabel,
    ...terminalSize(),
  }))
}

async function start() {
  await nextTick()
  if (!containerRef.value) return

  term = new Terminal({
    fontFamily: '"Cascadia Code", "Consolas", "Menlo", monospace',
    fontSize: props.fontSize,
    cursorBlink: true,
    convertEol: true,
    theme: {
      background: '#0a0a0a',
      foreground: '#e5e5e5',
      cursor: '#a3a3a3',
      selectionBackground: '#264f78',
    },
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(containerRef.value)
  // wait one frame for layout to settle before fitting
  requestAnimationFrame(() => {
    try { fit?.fit() } catch { /* ignore */ }
  })

  term.onData((d) => {
    if (ws?.readyState === WebSocket.OPEN && sessionId) {
      ws.send(JSON.stringify({ type: 'input', session_id: sessionId, data: d }))
    }
  })

  resizeObserver = new ResizeObserver(() => {
    try { fit?.fit() } catch { /* ignore */ }
    if (ws?.readyState === WebSocket.OPEN && sessionId && term) {
      ws.send(JSON.stringify({
        type: 'resize',
        session_id: sessionId,
        cols: term.cols,
        rows: term.rows,
      }))
    }
  })
  resizeObserver.observe(containerRef.value)

  let target: SessionTarget
  let label: string
  if (props.target) {
    target = props.target
    label = props.label ?? `${target.kind} session`
  } else if (props.targetDeviceId) {
    state.value = 'connecting'
    try {
      const res = await api.terminal.resolveDeviceTarget(props.targetDeviceId)
      target = res.data.target as SessionTarget
      label = res.data.label
    } catch (e) {
      state.value = 'error'
      error.value = `failed to resolve device target: ${(e as Error).message}`
      return
    }
  } else if (props.targetId) {
    state.value = 'connecting'
    try {
      const res = await api.terminal.resolveTarget(props.targetId)
      target = res.data.target as SessionTarget
      label = res.data.label
    } catch (e) {
      state.value = 'error'
      error.value = `failed to resolve target: ${(e as Error).message}`
      return
    }
  } else {
    state.value = 'error'
    error.value = 'TerminalPanel requires targetId, targetDeviceId, or target'
    return
  }
  headerLabel.value = label
  resolvedTarget = target
  resolvedLabel = label
  sessionStorageKey = buildSessionStorageKey(target, label)
  state.value = 'connecting'

  ws = new WebSocket(`${wsBase}/api/terminal/ws`)
  ws.onopen = () => {
    const storedSessionId = readStoredSessionId()
    if (storedSessionId) {
      pendingAttachSessionId = storedSessionId
      ws!.send(JSON.stringify({
        type: 'attach',
        session_id: storedSessionId,
        ...terminalSize(),
      }))
      return
    }
    sendStartFrame()
  }
  ws.onmessage = (ev) => {
    let msg: { type: string; data?: any }
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.type === 'session_opened') {
      sessionId = msg.data.session_id
      pendingAttachSessionId = null
      storeSessionId(sessionId!)
      if (typeof msg.data?.label === 'string') headerLabel.value = msg.data.label
      state.value = 'open'
    } else if ((msg.type === 'stdout' || msg.type === 'history') && typeof msg.data === 'string') {
      term?.write(msg.data)
    } else if (msg.type === 'exit') {
      clearStoredSessionId()
      sessionId = null
      state.value = 'closed'
      term?.write(`\r\n\x1b[33m[closed: code=${msg.data?.code}]\x1b[0m\r\n`)
    } else if (msg.type === 'error') {
      const message = msg.data?.message ?? 'unknown error'
      if (pendingAttachSessionId && message === 'session not found') {
        clearStoredSessionId()
        sendStartFrame()
        return
      }
      state.value = 'error'
      error.value = message
    }
  }
  ws.onerror = () => {
    state.value = 'error'
    error.value = 'websocket connection failed'
  }
  ws.onclose = () => {
    if (state.value !== 'error') state.value = 'closed'
    ws = null
    sessionId = null
    pendingAttachSessionId = null
  }
}

function detach() {
  if (ws && sessionId) {
    try { ws.send(JSON.stringify({ type: 'detach', session_id: sessionId })) } catch { /* ignore */ }
  }
  ws?.close()
  ws = null
  sessionId = null
  state.value = 'closed'
}

function terminate() {
  if (ws && sessionId) {
    try { ws.send(JSON.stringify({ type: 'kill', session_id: sessionId })) } catch { /* ignore */ }
  }
  clearStoredSessionId()
  ws?.close()
  ws = null
  sessionId = null
  state.value = 'closed'
}

function disconnect() {
  detach()
}

onMounted(start)
onBeforeUnmount(() => {
  detach()
  resizeObserver?.disconnect()
  try { term?.dispose() } catch { /* ignore */ }
})

defineExpose({ state, error, detach, terminate, disconnect })
</script>

<template>
  <div class="terminal-panel" :style="{ height }">
    <header v-if="showHeader" class="terminal-panel__header">
      <span class="dot" :class="`dot--${state}`" />
      <span class="label">{{ headerLabel }}</span>
      <span class="state">· {{ state }}</span>
      <button class="disconnect-btn" :disabled="!sessionId" @click="detach">暂离</button>
      <button class="disconnect-btn terminate-btn" :disabled="!sessionId" @click="terminate">终止</button>
    </header>
    <div v-if="error" class="terminal-panel__error">{{ error }}</div>
    <div ref="containerRef" class="terminal-panel__host" />
  </div>
</template>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  border: 1px solid #1f1f1f;
  border-radius: 8px;
  overflow: hidden;
  background: #0a0a0a;
  font-family: ui-monospace, "Cascadia Code", monospace;
}
.terminal-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid #1f1f1f;
  font-size: 12px;
  color: #e5e5e5;
  flex: 0 0 auto;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #525252;
  display: inline-block;
  flex: 0 0 auto;
}
.dot--connecting { background: #facc15; }
.dot--open { background: #22c55e; }
.dot--closed { background: #525252; }
.dot--error { background: #ef4444; }
.label { color: #e5e5e5; }
.state { color: #737373; flex: 1; }
.disconnect-btn {
  background: #1f1f1f;
  color: #e5e5e5;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
}
.disconnect-btn:hover { background: #2a2a2a; }
.disconnect-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.terminate-btn {
  border-color: #7f1d1d;
  color: #fecaca;
}
.terminate-btn:hover:not(:disabled) { background: #450a0a; }
.terminal-panel__error {
  background: #2a0a0a;
  color: #fca5a5;
  padding: 4px 12px;
  font-size: 11px;
  flex: 0 0 auto;
}
.terminal-panel__host {
  flex: 1 1 auto;
  min-height: 0;
  padding: 4px;
}
</style>
