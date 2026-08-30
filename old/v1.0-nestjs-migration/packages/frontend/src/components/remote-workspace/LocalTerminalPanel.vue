<script setup lang="ts">
import { nextTick, onUnmounted, ref } from 'vue'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { remoteWorkspaceApi } from '@/api/remoteWorkspace'

defineProps<{
  targets: Array<{ id: string; label: string }>
  label: (zh: string, en: string) => string
}>()

const terminalTargetId = ref('local:shell')
const terminalOutput = ref('')
const terminalInput = ref('')
const terminalConnected = ref(false)
const terminalConnecting = ref(false)
const terminalError = ref('')
const terminalSessionId = ref('')
const terminalElement = ref<HTMLElement | null>(null)

let terminalSocket: WebSocket | null = null
let terminalInstance: Terminal | null = null
let terminalFitAddon: FitAddon | null = null
let terminalResizeObserver: ResizeObserver | null = null

function appendTerminalOutput(value: string) {
  terminalOutput.value = `${terminalOutput.value}${value}`.slice(-60000)
  terminalInstance?.write(value)
}

async function connectTerminal(label: (zh: string, en: string) => string) {
  disconnectTerminal()
  terminalConnecting.value = true
  terminalConnected.value = false
  terminalError.value = ''
  terminalOutput.value = ''
  await ensureTerminalInstance()
  const size = fitTerminal()
  terminalInstance?.writeln(`${label('连接终端', 'Connecting terminal')} ${terminalTargetId.value}`)
  const socket = new WebSocket(remoteWorkspaceApi.terminalUrl({
    targetId: terminalTargetId.value,
    sessionId: terminalSessionId.value,
    cols: size.cols,
    rows: size.rows,
  }))
  terminalSocket = socket
  socket.onopen = () => {
    terminalConnecting.value = false
    terminalConnected.value = true
    sendTerminalResize()
  }
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as { type?: string; data?: any }
      if (message.type === 'session_opened') {
        terminalSessionId.value = String(message.data?.session_id ?? '')
        terminalInstance?.writeln(`[${message.data?.label ?? 'terminal'}] ${message.data?.command ?? ''} ${(message.data?.args ?? []).join(' ')}`)
        return
      }
      if (message.type === 'stdout' || message.type === 'stderr') {
        appendTerminalOutput(String(message.data ?? ''))
        return
      }
      if (message.type === 'exit') {
        appendTerminalOutput(`\n[exit] code=${message.data?.code ?? ''} signal=${message.data?.signal ?? ''}\n`)
        return
      }
      if (message.type === 'error') {
        terminalError.value = String(message.data?.message ?? 'terminal error')
        appendTerminalOutput(`\n[error] ${terminalError.value}\n`)
      }
    } catch {
      appendTerminalOutput(String(event.data))
    }
  }
  socket.onerror = () => {
    terminalError.value = label('终端连接失败。', 'Terminal connection failed.')
  }
  socket.onclose = () => {
    terminalConnecting.value = false
    terminalConnected.value = false
    if (terminalSocket === socket) terminalSocket = null
  }
}

function disconnectTerminal() {
  if (!terminalSocket) return
  try {
    terminalSocket.send('close')
    terminalSocket.close()
  } catch {}
  terminalSocket = null
  terminalConnected.value = false
  terminalConnecting.value = false
}

function sendTerminalInput() {
  if (!terminalSocket || terminalSocket.readyState !== WebSocket.OPEN || !terminalInput.value) return
  const value = `${terminalInput.value}\n`
  terminalSocket.send(JSON.stringify({ type: 'input', data: value }))
  terminalInput.value = ''
}

async function ensureTerminalInstance() {
  await nextTick()
  if (!terminalElement.value) return
  if (terminalInstance) return
  terminalInstance = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    theme: {
      background: '#0f172a',
      foreground: '#d1fae5',
      cursor: '#34d399',
      selectionBackground: '#1e40af',
    },
  })
  terminalFitAddon = new FitAddon()
  terminalInstance.loadAddon(terminalFitAddon)
  terminalInstance.open(terminalElement.value)
  terminalInstance.onData((data) => {
    if (terminalSocket?.readyState === WebSocket.OPEN) {
      terminalSocket.send(JSON.stringify({ type: 'input', data }))
    }
  })
  terminalResizeObserver = new ResizeObserver(() => {
    const size = fitTerminal()
    if (terminalSocket?.readyState === WebSocket.OPEN) {
      terminalSocket.send(JSON.stringify({ type: 'resize', data: size }))
    }
  })
  terminalResizeObserver.observe(terminalElement.value)
}

function fitTerminal() {
  try {
    terminalFitAddon?.fit()
  } catch {}
  return {
    cols: terminalInstance?.cols || 120,
    rows: terminalInstance?.rows || 32,
  }
}

function sendTerminalResize() {
  if (!terminalSocket || terminalSocket.readyState !== WebSocket.OPEN) return
  terminalSocket.send(JSON.stringify({ type: 'resize', data: fitTerminal() }))
}

function disposeTerminal() {
  terminalResizeObserver?.disconnect()
  terminalResizeObserver = null
  terminalInstance?.dispose()
  terminalInstance = null
  terminalFitAddon = null
}

onUnmounted(() => {
  disconnectTerminal()
  disposeTerminal()
})
</script>

<template>
  <section class="runtime-panel terminal-panel local-workspace-panel">
    <div class="runtime-head">
      <div>
        <span class="eyebrow inline">{{ label('本机终端', 'Local Terminal') }}</span>
        <h2>{{ label('NAS 源码终端', 'NAS Source Terminal') }}</h2>
      </div>
      <div class="runtime-actions">
        <select v-model="terminalTargetId" class="target-select" :disabled="terminalConnected || terminalConnecting">
          <option v-for="target in targets" :key="target.id" :value="target.id">
            {{ target.label }}
          </option>
        </select>
        <button
          v-if="terminalConnected || terminalConnecting"
          class="danger-btn"
          @click="disconnectTerminal"
        >
          {{ label('断开', 'Disconnect') }}
        </button>
        <button
          v-else
          class="primary-btn"
          @click="connectTerminal(label)"
        >
          {{ terminalConnecting ? label('连接中', 'Connecting') : label('打开终端', 'Open Terminal') }}
        </button>
      </div>
    </div>
    <p v-if="terminalError" class="error-line">{{ terminalError }}</p>
    <div ref="terminalElement" class="terminal-output">
      <span v-if="!terminalConnected && !terminalConnecting && !terminalOutput" class="terminal-placeholder">
        {{ label('终端尚未连接。', 'Terminal is not connected yet.') }}
      </span>
    </div>
    <div class="terminal-input-row">
      <input
        v-model="terminalInput"
        :disabled="!terminalConnected"
        :placeholder="label('输入命令后回车', 'Type a command and press Enter')"
        @keyup.enter="sendTerminalInput"
      />
      <button class="secondary-btn" :disabled="!terminalConnected || !terminalInput" @click="sendTerminalInput">
        {{ label('发送', 'Send') }}
      </button>
    </div>
  </section>
</template>
