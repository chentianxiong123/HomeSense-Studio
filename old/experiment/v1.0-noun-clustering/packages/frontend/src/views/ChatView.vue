<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import ContextPanel from '../components/ContextPanel.vue'
import RulePanel from '../components/RulePanel.vue'
import ChatMessageBubble from '../components/chat/ChatMessageBubble.vue'
import { useChat, type DisplayMessage } from '../composables/useChat'
import { useLocale } from '../composables/useLocale'
import { api } from '../api'
import { memoryAssetsApi } from '../api/memoryAssets'
import { workflowApi } from '../api/workflow'
import { buildExperiencePathPayload } from '../features/chat/experiencePathTools'
import { buildWorkflowDraftFromExperiencePath } from '../features/chat/workflowPromotionTools'
import { normalizePersistedMessages } from '../features/chat/persistedMessages'
import { buildWorkflowRoute } from '../features/studio/workflowEditorRoute'
import { formatChinaTime } from '../utils/chinaTime'

const {
  messages,
  loading,
  messageListRef,
  sendMessage,
  stopStreaming,
} = useChat()

const inputText = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)
const { locale } = useLocale()
const router = useRouter()
const rulePanelRef = ref<InstanceType<typeof RulePanel> | null>(null)
const contextPanelRef = ref<{ refresh?: () => Promise<void> | void } | null>(null)
const showRuntimeTrace = ref(true)
function openRuleModal() { rulePanelRef.value?.openModal() }

const latestContextTrace = computed(() => {
  for (let messageIndex = messages.value.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const trace = messages.value[messageIndex]?.runtimeTrace ?? []
    for (let traceIndex = trace.length - 1; traceIndex >= 0; traceIndex -= 1) {
      const item = trace[traceIndex]
      if (item.stage === 'runtime.context' && isRecord(item.data?.context_usage)) return item
    }
  }
  return undefined
})

const toolbarContextUsage = computed(() => {
  const usage = latestContextTrace.value?.data?.context_usage
  if (!isRecord(usage)) return null
  const used = Number(usage.used_tokens)
  const max = Number(usage.max_tokens)
  if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) return null
  return { used: Math.max(0, Math.round(used)), max: Math.round(max) }
})

const toolbarContextUsageLabel = computed(() => {
  const usage = toolbarContextUsage.value
  return usage ? `Context ${usage.used}/${usage.max}` : ''
})

const toolbarContextUsagePercent = computed(() => {
  const usage = toolbarContextUsage.value
  if (!usage) return 0
  return Math.min(100, Math.round((usage.used / usage.max) * 100))
})

const toolbarContextTitle = computed(() => {
  const data = latestContextTrace.value?.data
  if (!data) return ''
  const turns = Number(data.max_turns)
  const ttlMs = Number(data.ttl_ms)
  const hits = Number(data.retrieval_limit)
  const parts = [
    Number.isFinite(turns) ? `${turns} turns` : '',
    Number.isFinite(ttlMs) ? `${Math.round(ttlMs / 60000)}m TTL` : '',
    Number.isFinite(hits) ? `${hits} retrieval hits` : '',
  ].filter(Boolean)
  return parts.join(' / ')
})

// ── Models for right sidebar ──
interface ChatModel { id: number; provider_name: string; model_name: string; is_default: boolean }
const models = ref<ChatModel[]>([])
async function loadModels() {
  try {
    const r = await api.llm.chatModels()
    models.value = r.models
  } catch {}
}
async function selectModel(id: number) {
  try {
    await api.llm.selectModel(id)
    models.value.forEach(m => m.is_default = m.id === id)
  } catch {}
}
onMounted(loadModels)

// ── Sidebar resize ──
const COLLAPSE_THRESHOLD = 70
const COLLAPSED_WIDTH = 52

const leftWidth = ref(260)
const rightWidth = ref(260)
const leftCollapsed = ref(false)
const rightCollapsed = ref(false)
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
    leftWidth.value = Math.max(COLLAPSED_WIDTH, Math.min(400, e.clientX))
    leftCollapsed.value = leftWidth.value < COLLAPSE_THRESHOLD
    if (leftCollapsed.value) leftWidth.value = COLLAPSED_WIDTH
  } else {
    const w = window.innerWidth - e.clientX
    rightWidth.value = Math.max(COLLAPSED_WIDTH, Math.min(400, w))
    rightCollapsed.value = rightWidth.value < COLLAPSE_THRESHOLD
    if (rightCollapsed.value) rightWidth.value = COLLAPSED_WIDTH
  }
}

function onResizeEnd() {
  resizing.value = null
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

function toggleLeft() { leftCollapsed.value = !leftCollapsed.value; leftWidth.value = leftCollapsed.value ? COLLAPSED_WIDTH : 260 }
function toggleRight() { rightCollapsed.value = !rightCollapsed.value; rightWidth.value = rightCollapsed.value ? COLLAPSED_WIDTH : 260 }

onUnmounted(() => {
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
})

// ── Conversation + lazy load ──
const conversationId = ref<number | undefined>()
const hasMore = ref(true)
const loadingOlder = ref(false)
const PAGE_SIZE = 30

onMounted(async () => {
  try {
    const data = await api.chat.messages(undefined, PAGE_SIZE)
    if (data && 'messages' in data) {
      messages.value = normalizePersistedMessages(data.messages)
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
    const data = await api.chat.messages(oldestId, PAGE_SIZE)
    if (data && 'messages' in data && data.messages.length > 0) {
      const older = normalizePersistedMessages(data.messages)
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
  void sendMessage(text).finally(() => {
    void contextPanelRef.value?.refresh?.()
  })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    onSend()
  }
}

function formatTime(date: Date) {
  return formatChinaTime(date)
}

const CONTEXT_TTL_MS = 30 * 60 * 1000

function shouldShowTime(msg: any, idx?: number): boolean {
  if (idx == null) idx = messages.value.indexOf(msg)
  if (idx <= 0) return true
  const prev = messages.value[idx - 1]
  if (!prev?.timestamp) return true
  const diff = msg.timestamp.getTime() - prev.timestamp.getTime()
  return diff > CONTEXT_TTL_MS
}

async function saveExperiencePath(msg: DisplayMessage, msgIdx: number) {
  if (msg.pathSaveStatus === 'saving' || msg.pathSaveStatus === 'saved') return

  const payload = buildExperiencePathPayload({
    message: msg,
    messageIndex: msgIdx,
    history: messages.value,
    locale: locale.value,
  })
  if (!payload) {
    msg.pathSaveStatus = 'error'
    msg.pathSaveError = locale.value === 'zh' ? '没有可沉淀的成功执行步骤' : 'No successful executable step'
    return
  }

  msg.pathSaveStatus = 'saving'
  msg.pathSaveError = ''
  try {
    const result = await memoryAssetsApi.recordExperiencePath(payload)
    if (result.status !== 'success') throw new Error(result.message || 'Save failed')
    msg.pathSaveStatus = 'saved'
  } catch (error) {
    msg.pathSaveStatus = 'error'
    msg.pathSaveError = (error as Error).message
  }
}

async function saveWorkflowFromPath(msg: DisplayMessage, msgIdx: number) {
  if (msg.workflowSaveStatus === 'saving' || msg.workflowSaveStatus === 'saved') return

  const pathPayload = buildExperiencePathPayload({
    message: msg,
    messageIndex: msgIdx,
    history: messages.value,
    locale: locale.value,
  })
  const workflowDraft = pathPayload ? buildWorkflowDraftFromExperiencePath(pathPayload) : null
  if (!workflowDraft) {
    msg.workflowSaveStatus = 'error'
    msg.workflowSaveError = locale.value === 'zh' ? '没有可提升的成功步骤' : 'No successful step to promote'
    return
  }

  msg.workflowSaveStatus = 'saving'
  msg.workflowSaveError = ''
  try {
    const result = await workflowApi.create(workflowDraft)
    const workflowId = result.data?.id
    if (!workflowId) throw new Error('Create workflow failed')
    msg.workflowId = workflowId
    msg.workflowSaveStatus = 'saved'
  } catch (error) {
    msg.workflowSaveStatus = 'error'
    msg.workflowSaveError = (error as Error).message
  }
}

function openWorkflowFromMessage(msg: DisplayMessage) {
  if (!msg.workflowId) return
  void router.push(buildWorkflowRoute(msg.workflowId, 'editor'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

</script>

<template>
  <div class="chat-view">
    <!-- Left sidebar: context -->
    <aside class="side-pane left" :class="{ collapsed: leftCollapsed }" :style="{ width: leftWidth + 'px' }">
      <template v-if="leftCollapsed">
        <div class="icon-strip">
          <span class="strip-icon" title="展开" @click="toggleLeft">🏠</span>
          <span class="strip-icon">📱</span>
          <span class="strip-icon">🧠</span>
        </div>
      </template>
      <template v-else>
        <div class="pane-head">
          <span>{{ locale === 'zh' ? '上下文' : 'Context' }}</span>
          <button class="collapse-btn" @click="toggleLeft" title="折叠">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
        </div>
        <div class="pane-body">
          <ContextPanel ref="contextPanelRef" />
          <div class="sidebar-rule-btn" @click="openRuleModal">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
            <span>{{ locale === 'zh' ? '规则引擎' : 'Rule Engine' }}</span>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
        </div>
      </template>
    </aside>
    <div class="resize-handle" @mousedown="(e) => onResizeStart('left', e)"></div>

    <!-- Center: chat -->
    <section class="center-pane">
      <div class="chat-toolbar">
        <button
          type="button"
          class="trace-toggle-btn"
          :class="{ active: showRuntimeTrace }"
          @click="showRuntimeTrace = !showRuntimeTrace"
        >
          {{ locale === 'zh' ? '过程' : 'Trace' }}
          <span>{{ showRuntimeTrace ? 'ON' : 'OFF' }}</span>
        </button>
        <div
          v-if="toolbarContextUsageLabel"
          class="context-usage-chip"
          :title="toolbarContextTitle"
        >
          <span>{{ toolbarContextUsageLabel }}</span>
          <span class="context-usage-meter">
            <span :style="{ width: toolbarContextUsagePercent + '%' }"></span>
          </span>
        </div>
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
          <ChatMessageBubble
            :msg="msg"
            :locale="locale"
            :show-runtime-trace="showRuntimeTrace"
            @toggle-thinking="msg.thinkingExpanded = !msg.thinkingExpanded"
            @toggle-trace="msg.traceExpanded = !msg.traceExpanded"
            @toggle-tool="(tc) => { tc.expanded = !tc.expanded }"
            @save-path="saveExperiencePath(msg, msgIdx)"
            @save-workflow="saveWorkflowFromPath(msg, msgIdx)"
            @open-workflow="openWorkflowFromMessage(msg)"
          />
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
    <aside class="side-pane right" :class="{ collapsed: rightCollapsed }" :style="{ width: rightWidth + 'px' }">
      <template v-if="rightCollapsed">
        <div class="icon-strip">
          <span class="strip-icon" title="展开" @click="toggleRight">🧠</span>
        </div>
      </template>
      <template v-else>
        <div class="pane-head">
          <span>{{ locale === 'zh' ? '模型' : 'Models' }}</span>
          <button class="collapse-btn" @click="toggleRight" title="折叠">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </div>
        <div class="pane-body">
          <div v-if="models.length === 0" class="empty-hint">{{ locale === 'zh' ? '暂无模型' : 'No models' }}</div>
          <div
            v-for="m in models" :key="m.id"
            :class="['model-item', { active: m.is_default }]"
            @click="selectModel(m.id)"
          >
            <div class="model-provider">{{ m.provider_name }}</div>
            <div class="model-name">{{ m.model_name }}</div>
            <div v-if="m.is_default" class="model-badge">DEFAULT</div>
          </div>
        </div>
      </template>
    </aside>

    <RulePanel ref="rulePanelRef" :showEntry="false" />
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  height: 100%;
  background: #f7f9fa;
  overflow: hidden;
}

.side-pane {
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 60;
  transition: width 0.2s ease;
}
.side-pane.left { border-right: 1px solid rgba(229, 231, 235, 0.4); }
.side-pane.right { border-left: 1px solid rgba(229, 231, 235, 0.4); }
.side-pane.collapsed { width: 52px !important; }

.icon-strip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 0;
}
.strip-icon {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.strip-icon:hover { background: rgba(16, 185, 129, 0.1); }

.collapse-btn {
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: none; cursor: pointer;
  color: var(--text-tertiary); border-radius: 6px;
  transition: all 0.15s;
}
.collapse-btn:hover { background: rgba(0,0,0,0.05); color: var(--text-primary); }

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
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  border-bottom: 1px solid rgba(229, 231, 235, 0.4);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.trace-toggle-btn {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.65);
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  transition: all 0.2s;
}

.trace-toggle-btn span {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
}

.trace-toggle-btn.active {
  border-color: rgba(16, 185, 129, 0.35);
  background: rgba(236, 253, 245, 0.8);
  color: #059669;
}

.trace-toggle-btn:hover {
  transform: translateY(-1px);
  border-color: rgba(16, 185, 129, 0.4);
}

.context-usage-chip {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.55);
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.context-usage-meter {
  width: 58px;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.22);
}

.context-usage-meter span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #10b981, #0ea5e9);
}

/* ── Sidebar rule button ── */
.sidebar-rule-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; margin: 0 8px 8px; border-radius: 10px;
  cursor: pointer; transition: all 0.15s; user-select: none;
  border: 1px solid rgba(229, 231, 235, 0.3);
}
.sidebar-rule-btn:hover { background: rgba(16, 185, 129, 0.06); border-color: rgba(16, 185, 129, 0.2); }
.sidebar-rule-btn svg:first-child { color: #10b981; flex-shrink: 0; }
.sidebar-rule-btn span { flex: 1; font-size: 13px; font-weight: 700; color: var(--text-primary); }
.sidebar-rule-btn svg:last-child { color: var(--text-tertiary); flex-shrink: 0; }

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
  padding: 24px 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
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

/* ── Input ── */
.input-area {
  padding: 0 64px 24px;
  flex-shrink: 0;
}

.input-wrap {
  position: relative;
  display: flex;
  align-items: flex-end;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(64px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 16px;
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

@keyframes spin { to { transform: rotate(360deg); } }
/* ── Model list ── */
.model-item {
  padding: 12px 16px;
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
  font-size: 11px; font-weight: 900; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 0.15em;
}
.model-name {
  font-size: 14px; font-weight: 800; color: var(--text-primary); margin-top: 2px;
}
.model-badge {
  display: inline-block; margin-top: 4px; font-size: 10px; font-weight: 900;
  padding: 2px 8px; border-radius: 6px;
  background: rgba(124, 58, 237, 0.1); color: #7c3aed;
  text-transform: uppercase; letter-spacing: 0.1em;
}
.empty-hint {
  padding: 40px 16px; text-align: center;
  color: var(--text-tertiary); font-size: 14px; font-weight: 600;
}

@media (max-width: 1200px) {
  .msg-row { padding: 0 36px; }
  .input-area { padding: 0 36px 20px; }
}

@media (max-width: 760px) {
  .chat-view {
    height: 100%;
    min-height: 0;
  }

  .side-pane,
  .resize-handle {
    display: none;
  }

  .center-pane {
    width: 100%;
    min-width: 0;
  }

  .chat-toolbar {
    min-height: 52px;
    padding: 8px 12px;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .chat-toolbar::-webkit-scrollbar {
    display: none;
  }

  .trace-toggle-btn,
  .context-usage-chip,
  .stop-btn {
    height: 34px;
    flex: 0 0 auto;
  }

  .context-usage-chip {
    max-width: 178px;
    gap: 8px;
    font-size: 11px;
  }

  .context-usage-meter {
    width: 44px;
  }

  .stop-btn {
    margin-left: 0;
    padding: 0 14px;
    font-size: 12px;
  }

  .message-list {
    padding: 12px 0;
  }

  .msg-row {
    padding: 0 12px;
    margin-bottom: 6px;
  }

  .welcome {
    padding: 120px 24px;
  }

  .welcome h2 {
    font-size: 30px;
  }

  .welcome p {
    font-size: 15px;
  }

  .time-divider {
    padding: 12px 0;
    font-size: 11px;
  }

  .time-divider::before,
  .time-divider::after {
    width: calc(50% - 46px);
  }

  .input-area {
    padding: 0 12px calc(12px + var(--app-mobile-nav-height, 72px) + env(safe-area-inset-bottom, 0px));
  }

  .input-wrap {
    max-width: none;
    border-radius: 16px;
    box-shadow: 0 14px 38px rgba(15, 23, 42, 0.12);
  }

  .input-wrap:focus-within {
    transform: none;
  }

  .chat-input {
    min-height: 56px;
    max-height: 160px;
    padding: 15px 74px 15px 16px;
    font-size: 15px;
  }

  .send-btn {
    right: 8px;
    bottom: 8px;
    width: 40px;
    height: 40px;
    border-radius: 13px;
  }
}
</style>
