import { ref, onBeforeUnmount, type Ref } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export type SessionTarget =
  | { kind: 'local'; shell?: string; cwd?: string }
  | { kind: 'ssh'; host: string; port?: number; user: string; auth: 'password' | 'key'; password?: string; keyName?: string }
  | { kind: 'adb'; serial: string; command?: string }

export type TerminalState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export function useTerminal(opts: {
  containerRef: Ref<HTMLElement | null>
  baseWsUrl: string
}) {
  const term = ref<Terminal | null>(null)
  const fit = ref<FitAddon | null>(null)
  const ws = ref<WebSocket | null>(null)
  const state = ref<TerminalState>('idle')
  const error = ref<string | null>(null)
  const sessionId = ref<string | null>(null)
  const label = ref<string>('')
  let resizeObserver: ResizeObserver | null = null

  function mount() {
    if (!opts.containerRef.value) return
    const t = new Terminal({
      fontFamily: '"Cascadia Code", "Consolas", "Menlo", monospace',
      fontSize: 14,
      cursorBlink: true,
      convertEol: true,
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#a3a3a3',
        selectionBackground: '#264f78',
      },
    })
    const f = new FitAddon()
    t.loadAddon(f)
    t.open(opts.containerRef.value)
    f.fit()
    term.value = t
    fit.value = f

    t.onData((data) => {
      if (ws.value?.readyState === WebSocket.OPEN && sessionId.value) {
        ws.value.send(JSON.stringify({ type: 'input', session_id: sessionId.value, data }))
      }
    })

    resizeObserver = new ResizeObserver(() => {
      try { f.fit() } catch { /* ignore */ }
      if (ws.value?.readyState === WebSocket.OPEN && sessionId.value && term.value) {
        ws.value.send(JSON.stringify({
          type: 'resize',
          session_id: sessionId.value,
          cols: term.value.cols,
          rows: term.value.rows,
        }))
      }
    })
    resizeObserver.observe(opts.containerRef.value)
  }

  function open(target: SessionTarget, sessionLabel: string) {
    if (!term.value) return
    state.value = 'connecting'
    error.value = null
    label.value = sessionLabel

    const socket = new WebSocket(opts.baseWsUrl)
    ws.value = socket

    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'start',
        target,
        label: sessionLabel,
        cols: term.value!.cols,
        rows: term.value!.rows,
      }))
    }

    socket.onmessage = (ev) => {
      let msg: { type: string; data?: any }
      try { msg = JSON.parse(ev.data) } catch { return }
      if (msg.type === 'session_opened') {
        sessionId.value = msg.data.session_id
        state.value = 'open'
        return
      }
      if ((msg.type === 'stdout' || msg.type === 'history') && typeof msg.data === 'string') {
        term.value?.write(msg.data)
        return
      }
      if (msg.type === 'exit') {
        state.value = 'closed'
        term.value?.write(`\r\n\x1b[33m[session closed: code=${msg.data?.code} signal=${msg.data?.signal ?? 'none'}]\x1b[0m\r\n`)
        return
      }
      if (msg.type === 'error') {
        state.value = 'error'
        error.value = msg.data?.message ?? 'unknown error'
        term.value?.write(`\r\n\x1b[31m[error: ${error.value}]\x1b[0m\r\n`)
        return
      }
    }

    socket.onerror = () => {
      state.value = 'error'
      error.value = 'websocket connection failed'
    }

    socket.onclose = () => {
      if (state.value !== 'closed') state.value = 'closed'
    }
  }

  function detach() {
    if (ws.value && sessionId.value) {
      try { ws.value.send(JSON.stringify({ type: 'detach', session_id: sessionId.value })) } catch { /* ignore */ }
    }
    ws.value?.close()
    ws.value = null
    sessionId.value = null
  }

  function terminate() {
    if (ws.value && sessionId.value) {
      try { ws.value.send(JSON.stringify({ type: 'kill', session_id: sessionId.value })) } catch { /* ignore */ }
    }
    ws.value?.close()
    ws.value = null
    sessionId.value = null
  }

  function close() {
    detach()
  }

  function dispose() {
    detach()
    resizeObserver?.disconnect()
    resizeObserver = null
    try { term.value?.dispose() } catch { /* ignore */ }
    term.value = null
  }

  onBeforeUnmount(dispose)

  return { term, state, error, sessionId, label, mount, open, close, detach, terminate }
}
