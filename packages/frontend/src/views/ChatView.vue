<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import DeviceSidebar from '../components/DeviceSidebar.vue'
import { useChat } from '../composables/useChat'
import { useLocale } from '../composables/useLocale'
import { api } from '../api'
import type { DeviceInfo } from '../api'

const {
  messages,
  loading,
  messageListRef,
  sendMessage,
  stopStreaming,
} = useChat()

const inputText = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)
const selectedDevice = ref<DeviceInfo | null>(null)
const { locale } = useLocale()

// ── Sidebar resize ──
const leftWidth = ref(320)
const rightWidth = ref(320)
const resizing = ref<'left' | 'right' | null>(null)

function onResizeStart(side: 'left' | 'right', e: MouseEvent) {
  e.preventDefault()
  resizing.value = side
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onResizeMove(e: MouseEvent) {
  if (!resizing.value) return
  if (resizing.value === 'left') {
    leftWidth.value = Math.max(200, Math.min(600, e.clientX))
  } else {
    rightWidth.value = Math.max(200, Math.min(600, window.innerWidth - e.clientX))
  }
}

function onResizeEnd() {
  resizing.value = null
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
})

// ── LLM models ──
interface ChatModel {
  id: number
  provider_name: string
  model_name: string
  is_default: boolean
}
const models = ref<ChatModel[]>([])
const currentModel = ref<string>('')

async function loadModels() {
  try {
    const result = await api.llm.chatModels()
    models.value = result.models
    const def = models.value.find(m => m.is_default)
    if (def) currentModel.value = `${def.provider_name} / ${def.model_name}`
  } catch {}
}

async function onSelectModel(id: number) {
  try {
    await api.llm.selectModel(id)
    models.value.forEach(m => m.is_default = m.id === id)
    const sel = models.value.find(m => m.id === id)
    if (sel) currentModel.value = `${sel.provider_name} / ${sel.model_name}`
  } catch {}
}

onMounted(loadModels)

// ── Conversation + lazy load ──
const conversationId = ref<number | undefined>()
const hasMore = ref(true)
const loadingOlder = ref(false)
const PAGE_SIZE = 30

onMounted(async () => {
  try {
    const resp = await fetch('/api/chat/messages?limit=' + PAGE_SIZE)
    const data = await resp.json()
    if (data && 'messages' in data) {
      messages.value = data.messages.map((m: any) => {
        let toolCalls = []
        if (m.tool_calls_json) {
          try {
            const parsed = JSON.parse(m.tool_calls_json)
            toolCalls = parsed.map((tc: any) => ({
              call_id: tc.id,
              name: tc.function?.name || tc.name,
              args: JSON.parse(tc.function?.arguments || '{}'),
              status: 'success' as const,
              expanded: false,
            }))
          } catch {}
        }
        return {
          id: `msg_${m.id}`,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          thinking: '',
          thinkingExpanded: false,
          status: 'final' as const,
          timestamp: new Date(m.created_at),
          toolCalls,
        }
      })
      hasMore.value = data.hasMore ?? false
    }
    nextTick(scrollToBottom)
  } catch {}
})

function scrollToBottom() {
  if (messageListRef.value) {
    messageListRef.value.scrollTop = messageListRef.value.scrollHeight
  }
}

async function onScrollTop() {
  if (loadingOlder.value || !hasMore.value) return
  const el = messageListRef.value
  if (!el || el.scrollTop > 60) return

  loadingOlder.value = true
  const prevHeight = el.scrollHeight
  const oldestId = messages.value.length > 0 ? Number(messages.value[0].id.replace('msg_', '')) : undefined

  try {
    const url = '/api/chat/messages?cursor=' + oldestId + '&limit=' + PAGE_SIZE
    const resp = await fetch(url)
    const data = await resp.json()
    if (data && 'messages' in data && data.messages.length > 0) {
      const older = data.messages.map((m: any) => ({
        id: `msg_${m.id}`,
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        thinking: '',
        thinkingExpanded: false,
        status: 'final' as const,
        timestamp: new Date(m.created_at),
      }))
      messages.value = [...older, ...messages.value]
      hasMore.value = data.hasMore ?? false
      nextTick(() => { el.scrollTop = el.scrollHeight - prevHeight })
    } else {
      hasMore.value = false
    }
  } catch {
    hasMore.value = false
  } finally {
    loadingOlder.value = false
  }
}

// ── Input ──
function adjustTextareaHeight() {
  if (!textarea.value) return
  textarea.value.style.height = 'auto'
  textarea.value.style.height = `${Math.min(textarea.value.scrollHeight, 200)}px`
}

watch(inputText, () => adjustTextareaHeight())

function onSend() {
  if (!inputText.value.trim() || loading.value) return
  const text = inputText.value
  inputText.value = ''
  if (textarea.value) textarea.value.style.height = 'auto'
  sendMessage(text)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    onSend()
  }
}

function formatTime(date: Date) {
  return date.toLocaleTimeString(locale.value === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shouldShowTime(msg: any, idx?: number): boolean {
  if (idx == null) idx = messages.value.indexOf(msg)
  if (idx <= 0) return true
  const prev = messages.value[idx - 1]
  if (!prev?.timestamp) return true
  const diff = msg.timestamp.getTime() - prev.timestamp.getTime()
  return diff > 30 * 60 * 1000
}
</script>

<template>
  <div class="chat-view">
    <!-- Left sidebar: devices -->
    <aside class="left-pane" :style="{ width: leftWidth + 'px' }">
      <div class="pane-head">{{ locale === 'zh' ? '设备' : 'Devices' }}</div>
      <div class="pane-body">
        <DeviceSidebar @select="(device) => (selectedDevice = device)" />
      </div>
    </aside>

    <div class="resize-handle" @mousedown="(e) => onResizeStart('left', e)"></div>

    <!-- Center: chat -->
    <section class="center-pane">
      <div class="chat-toolbar">
        <div v-if="currentModel" class="model-chip">{{ currentModel }}</div>
        <div v-if="selectedDevice" class="device-chip">{{ selectedDevice.name }}</div>
        <button v-if="loading" class="stop-btn" @click="stopStreaming">
          {{ locale === 'zh' ? '停止' : 'Stop' }}
        </button>
      </div>

      <div ref="messageListRef" class="message-list" @scroll="onScrollTop">
        <div v-if="loadingOlder" class="loading-older">
          <span class="ld"></span><span class="ld"></span><span class="ld"></span>
        </div>

        <div v-if="messages.length === 0" class="welcome">
          <h2>HomeSense Chat</h2>
          <p>{{ locale === 'zh' ? '输入消息开始对话' : 'Type a message to start' }}</p>
        </div>

        <div v-for="(msg, msgIdx) in messages" :key="msg.id" :class="['msg-row', msg.role]">
          <div v-if="shouldShowTime(msg, msgIdx)" class="time-divider">{{ formatTime(msg.timestamp) }}</div>
          <div :class="['bubble', msg.role, msg.status]">
            <!-- Thinking Section -->
            <div v-if="msg.thinking" class="think-card" :class="{ collapsed: !msg.thinkingExpanded }">
            <button class="think-toggle" @click="msg.thinkingExpanded = !msg.thinkingExpanded">
                <svg :style="{ transform: msg.thinkingExpanded ? 'rotate(90deg)' : '' }" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                <span>{{ msg.status === 'streaming' ? (locale === 'zh' ? '思考中...' : 'Thinking...') : (locale === 'zh' ? '思考过程' : 'Thinking') }}</span>
              </button>
              <div v-show="msg.thinkingExpanded" class="think-content">{{ msg.thinking }}</div>
            </div>

            <!-- Tool Calls Section -->
            <div v-if="msg.toolCalls && msg.toolCalls.length > 0" class="tool-calls-container">
              <div
                v-for="tc in msg.toolCalls"
                :key="tc.call_id"
                :class="['tool-card', tc.status, { collapsed: !tc.expanded }]"
              >
                <div class="tool-header" @click="tc.expanded = !tc.expanded">
                  <span class="tool-status-icon">
                    <span v-if="tc.status === 'running'" class="tool-spinner"></span>
                    <span v-else-if="tc.status === 'success'" class="tool-success-check">✓</span>
                    <span v-else class="tool-error-cross">✗</span>
                  </span>
                  <span class="tool-name">{{ tc.name }}</span>
                  <span class="tool-toggle-icon">
                    <svg :style="{ transform: tc.expanded ? 'rotate(90deg)' : '' }" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                  </span>
                </div>
                <div v-show="tc.expanded" class="tool-body">
                  <div class="tool-section">
                    <div class="tool-section-title">Arguments</div>
                    <pre class="tool-code">{{ JSON.stringify(tc.args, null, 2) }}</pre>
                  </div>
                  <div v-if="tc.result" class="tool-section">
                    <div class="tool-section-title">Result</div>
                    <pre class="tool-code">{{ JSON.stringify(tc.result, null, 2) }}</pre>
                  </div>
                  <div v-if="tc.error" class="tool-section error">
                    <div class="tool-section-title">Error</div>
                    <pre class="tool-code error">{{ tc.error }}</pre>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="msg.content" class="content">{{ msg.content }}</div>
            <div v-else-if="msg.status === 'streaming' && msg.role === 'assistant' && !msg.thinking && (!msg.toolCalls || msg.toolCalls.length === 0)" class="typing">
              <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            </div>
          </div>
        </div>
      </div>

      <div class="input-area">
        <div class="input-wrap">
          <textarea
            ref="textarea"
            v-model="inputText"
            class="chat-input"
            :placeholder="locale === 'zh' ? '输入消息...' : 'Type a message...'"
            rows="1"
            :disabled="loading"
            @keydown="onKeydown"
          ></textarea>
          <button class="send-btn" :disabled="loading || !inputText.trim()" @click="onSend">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" v-if="!loading">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
            <span v-else class="spinner"></span>
          </button>
        </div>
      </div>
    </section>

    <div class="resize-handle" @mousedown="(e) => onResizeStart('right', e)"></div>

    <!-- Right sidebar: models -->
    <aside class="right-pane" :style="{ width: rightWidth + 'px' }">
      <div class="pane-head">{{ locale === 'zh' ? '模型' : 'Models' }}</div>
      <div class="pane-body">
        <div v-if="models.length === 0" class="empty">{{ locale === 'zh' ? '暂无模型' : 'No models' }}</div>
        <div
          v-for="m in models"
          :key="m.id"
          :class="['model-item', { active: m.is_default }]"
          @click="onSelectModel(m.id)"
        >
          <div class="model-provider">{{ m.provider_name }}</div>
          <div class="model-name">{{ m.model_name }}</div>
          <div v-if="m.is_default" class="model-badge">DEFAULT</div>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  height: 100%;
  background: #f7f9fa;
  overflow: hidden;
}

.left-pane, .right-pane {
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 60;
}

.left-pane { border-right: 1px solid rgba(229, 231, 235, 0.4); }
.right-pane { border-left: 1px solid rgba(229, 231, 235, 0.4); }

.resize-handle {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  flex-shrink: 0;
  z-index: 70;
  transition: background 0.2s;
}
.resize-handle:hover { background: #10b981; }

.pane-head {
  padding: 16px 20px;
  font-size: 13px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  border-bottom: 1px solid rgba(229, 231, 235, 0.4);
  flex-shrink: 0;
}

.pane-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.center-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: radial-gradient(circle at 50% 0%, rgba(255,255,255,0.8) 0%, rgba(247,249,250,1) 100%);
}

/* ── Toolbar ── */
.chat-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 32px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  border-bottom: 1px solid rgba(229, 231, 235, 0.4);
  z-index: 50;
}

.model-chip, .device-chip {
  font-size: 12px;
  font-weight: 900;
  padding: 6px 16px;
  border-radius: 99px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.model-chip {
  background: rgba(124, 58, 237, 0.1);
  color: #7c3aed;
}

.device-chip {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.stop-btn {
  margin-left: auto;
  height: 36px;
  padding: 0 20px;
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 10px;
  background: rgba(254, 242, 242, 0.8);
  color: #ef4444;
  cursor: pointer;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  transition: all 0.2s;
}
.stop-btn:hover { background: #fef2f2; border-color: #ef4444; }

/* ── Messages ── */
.message-list {
  flex: 1;
  padding: 48px 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.loading-older { display: flex; justify-content: center; gap: 8px; padding: 16px 0; }
.ld { width: 6px; height: 6px; border-radius: 50%; background: var(--text-tertiary); opacity: 0.4; animation: typing 1s infinite both; }
.ld:nth-child(2) { animation-delay: 0.15s; }
.ld:nth-child(3) { animation-delay: 0.3s; }

.welcome {
  text-align: center;
  padding: 200px 48px;
  margin: auto;
}
.welcome h2 {
  font-size: 40px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.05em;
  background: linear-gradient(135deg, #1e293b 0%, #64748b 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0 0 16px;
}
.welcome p { color: var(--text-secondary); font-size: 18px; font-weight: 700; opacity: 0.6; margin: 0; }

.msg-row {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
  padding: 0 64px;
}
.msg-row.user { align-items: flex-end; }
.msg-row.assistant { align-items: flex-start; }

.bubble {
  max-width: min(85%, 800px);
  padding: 24px 36px;
  line-height: 1.8;
  font-size: 15px;
  font-weight: 700;
  word-break: break-word;
  letter-spacing: -0.01em;
}
.bubble.user {
  color: var(--text-primary);
  border-bottom-right-radius: 10px;
}
.bubble.assistant {
  color: var(--text-primary);
  border-bottom-left-radius: 10px;
}
.bubble.error {
  color: #ef4444;
}
.bubble.streaming {
  border: 2px dashed rgba(16, 185, 129, 0.4);
  background: rgba(255, 255, 255, 0.4);
  animation: borderPulse 2s infinite;
}

@keyframes borderPulse {
  0%, 100% { border-color: rgba(16, 185, 129, 0.2); }
  50% { border-color: rgba(16, 185, 129, 0.8); }
}

.content { white-space: pre-wrap; }

/* ── Tool Cards ── */
.tool-calls-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.tool-card {
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid rgba(229, 231, 235, 0.3);
  background: transparent;
  transition: all 0.3s;
}

.tool-card.running {
  border-color: rgba(59, 130, 246, 0.3);
  background: rgba(59, 130, 246, 0.03);
}

.tool-card.success {
  border-color: rgba(16, 185, 129, 0.3);
  background: rgba(16, 185, 129, 0.03);
}

.tool-card.error {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.03);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
}
.tool-header:hover {
  background: rgba(0, 0, 0, 0.02);
}

.tool-status-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tool-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(59, 130, 246, 0.2);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.tool-success-check {
  color: #10b981;
  font-weight: bold;
  font-size: 14px;
}

.tool-error-cross {
  color: #ef4444;
  font-weight: bold;
  font-size: 14px;
}

.tool-name {
  font-size: 12px;
  font-weight: 800;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--text-primary);
  flex: 1;
}

.tool-toggle-icon {
  display: flex;
  align-items: center;
  color: var(--text-tertiary);
  transition: transform 0.2s;
}

.tool-body {
  padding: 0 14px 14px;
  border-top: 1px solid rgba(0, 0, 0, 0.03);
}

.tool-section {
  margin-top: 10px;
}

.tool-section-title {
  font-size: 10px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 4px;
}

.tool-code {
  margin: 0;
  padding: 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.03);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-wrap;
  overflow-x: auto;
}

.tool-code.error {
  background: rgba(239, 68, 68, 0.05);
  color: #ef4444;
}

.think-card {
  background: rgba(124, 58, 237, 0.04);
  border: 1px solid rgba(124, 58, 237, 0.12);
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 12px;
}

.think-card.collapsed .think-content { display: none; }

.think-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: #7c3aed;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: background 0.2s;
}
.think-toggle:hover { background: rgba(124, 58, 237, 0.06); }
.think-toggle svg { flex-shrink: 0; transition: transform 0.2s; }

.think-content {
  padding: 0 14px 14px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
  font-weight: 600;
  white-space: pre-wrap;
  max-height: 400px;
  overflow-y: auto;
  opacity: 0.8;
}

.time-divider {
  text-align: center;
  padding: 16px 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-tertiary);
  opacity: 0.5;
  letter-spacing: 0.1em;
  position: relative;
}
.time-divider::before,
.time-divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: calc(50% - 60px);
  height: 1px;
  background: rgba(0, 0, 0, 0.06);
}
.time-divider::before { left: 0; }
.time-divider::after { right: 0; }

.typing { display: flex; gap: 8px; align-items: center; padding: 16px 4px; }
.dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #10b981; opacity: 0.6;
  animation: typing 1.2s infinite both;
}
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

/* ── Input ── */
.input-area {
  padding: 24px 64px 64px;
  position: relative;
}
.input-area::before {
  content: '';
  position: absolute;
  top: -100px; left: 0; right: 0; height: 100px;
  background: linear-gradient(to top, #f7f9fa, transparent);
  pointer-events: none;
}

.input-wrap {
  position: relative;
  display: flex;
  align-items: flex-end;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(64px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 32px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.1);
  transition: all 0.4s;
  max-width: 900px;
  margin: 0 auto;
}
.input-wrap:focus-within {
  background: #fff;
  border-color: #10b981;
  box-shadow: 0 32px 80px rgba(16, 185, 129, 0.2);
  transform: translateY(-4px);
}

.chat-input {
  flex: 1;
  min-height: 72px;
  max-height: 260px;
  padding: 20px 100px 20px 32px;
  border: none;
  background: transparent;
  resize: none;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.6;
  outline: none;
  overflow-y: auto;
  color: var(--text-primary);
}
.chat-input::placeholder {
  color: var(--text-tertiary);
  font-weight: 700;
  opacity: 0.5;
}

.send-btn {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: 48px;
  height: 48px;
  border: none;
  border-radius: 16px;
  background: #10b981;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.35);
  transition: all 0.3s;
  z-index: 2;
}
.send-btn:hover:not(:disabled) { background: #059669; transform: translateY(-2px); }
.send-btn:disabled { background: #f1f5f9; color: #94a3b8; box-shadow: none; cursor: not-allowed; opacity: 0.6; }

.spinner {
  width: 18px; height: 18px;
  border: 3px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

/* ── Model list ── */
.model-item {
  padding: 14px 20px;
  cursor: pointer;
  border-bottom: 1px solid rgba(229, 231, 235, 0.3);
  transition: all 0.2s;
}
.model-item:hover { background: rgba(255, 255, 255, 0.8); }
.model-item.active {
  background: rgba(124, 58, 237, 0.06);
  border-left: 3px solid #7c3aed;
}
.model-provider {
  font-size: 11px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.15em;
}
.model-name {
  font-size: 14px;
  font-weight: 800;
  color: var(--text-primary);
  margin-top: 2px;
}
.model-badge {
  display: inline-block;
  margin-top: 4px;
  font-size: 10px;
  font-weight: 900;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(124, 58, 237, 0.1);
  color: #7c3aed;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 14px;
  font-weight: 600;
}

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes typing {
  0%, 80%, 100% { opacity: 0.2; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-6px); }
}

@media (max-width: 1200px) {
  .msg-row { padding: 0 36px; }
  .input-area { padding: 20px 36px 48px; }
}
</style>
