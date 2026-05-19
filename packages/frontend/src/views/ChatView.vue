<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import DeviceSidebar from '../components/DeviceSidebar.vue'
import PlanPreviewCard from '../components/PlanPreviewCard.vue'
import ToolCallCard from '../components/chat/ToolCallCard.vue'
import PlanStepTimeline from '../components/chat/PlanStepTimeline.vue'
import MemoryChip from '../components/chat/MemoryChip.vue'
import RoutePreviewCard from '../components/chat/RoutePreviewCard.vue'
import A2ADispatchCard from '../components/chat/A2ADispatchCard.vue'
import ApprovalCard from '../components/chat/ApprovalCard.vue'
import ConversationSidebar from '../components/chat/ConversationSidebar.vue'
import BtwStrip from '../components/chat/BtwStrip.vue'
import ManifestExplorer from '../components/ManifestExplorer.vue'
import { useEventBus } from '../composables/useEventBus'
import { useChat } from '../composables/useChat'
import { useLocale } from '../composables/useLocale'
import { api } from '../api'
import type { DeviceInfo } from '../api'
import type { DisplayMessage } from '../types/chat'

const {
  messages,
  conversationId,
  loading,
  messageListRef,
  sendMessage,
  stopStreaming,
  newConversation,
  loadConversation,
  directLLM,
} = useChat()

const inputText = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)

function adjustTextareaHeight() {
  if (!textarea.value) return
  textarea.value.style.height = 'auto'
  textarea.value.style.height = `${Math.min(textarea.value.scrollHeight, 200)}px`
}

watch(inputText, () => {
  adjustTextareaHeight()
})
const showLeftPane = ref(true)
const showRightPane = ref(true)
const selectedDevice = ref<DeviceInfo | null>(null)
const { t, locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

type Instance = Awaited<ReturnType<typeof api.agents.listInstances>>['instances'][number]
const agentInstances = ref<Instance[]>([])
const selectedAgentId = ref<number | null>(null)

async function loadAgents() {
  try {
    const result = await api.agents.listInstances()
    agentInstances.value = result.instances.filter((instance) => instance.surface === 'chat' || instance.surface === 'remote')
    if (!selectedAgentId.value && agentInstances.value.length > 0) {
      selectedAgentId.value = agentInstances.value[0].id
    }
  } catch {}
}

onMounted(loadAgents)

interface BtwItem {
  id: string
  kind: string
  text: string
  ts: number
}

const btwItems = ref<BtwItem[]>([])
const bus = useEventBus()

function pushBtw(kind: string, text: string) {
  btwItems.value.push({
    id: `btw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    kind,
    text,
    ts: Date.now(),
  })
  if (btwItems.value.length > 10) {
    btwItems.value.splice(0, btwItems.value.length - 10)
  }
}

function dismissBtw(id: string) {
  btwItems.value = btwItems.value.filter((item) => item.id !== id)
}

bus.on('cron_fired', (data) => {
  const detail = data as { schedule_id?: string; cron?: string }
  pushBtw('cron_fired', t('chat.btw.cron', { value: detail.cron ?? detail.schedule_id ?? '' }))
})

bus.on('memory_observation', (data) => {
  const detail = data as { entity_id?: string; intent?: string }
  pushBtw('memory_observation', t('chat.btw.memory', { value: detail.intent ?? detail.entity_id ?? '' }))
})

bus.on('service_called', (data) => {
  const detail = data as { name?: string }
  pushBtw('service_called', t('chat.btw.service', { value: detail.name ?? '' }))
})

bus.on('workflow_completed', (data) => {
  const detail = data as { workflow_id?: number; status?: string }
  pushBtw('workflow_completed', t('chat.btw.workflow', { id: detail.workflow_id ?? '', status: detail.status ?? 'done' }))
})

const lastAssistant = computed<DisplayMessage | null>(() => {
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    if (messages.value[index].role === 'assistant') return messages.value[index]
  }
  return null
})

const quickActions = computed(() => [
  { label: t('chat.quick.watchBili'), text: '看电视的 B 站' },
  { label: t('chat.quick.openToshiba'), text: '打开东芝电视' },
  { label: t('chat.quick.deviceState'), text: '查看设备状态' },
  { label: t('chat.quick.a2aCodex'), text: '/a2a codex 帮我看一下这段报错' },
])

function onSend() {
  if (!inputText.value.trim()) return
  const text = inputText.value
  inputText.value = ''
  if (textarea.value) textarea.value.style.height = 'auto'
  sendMessage(text, { agentInstanceId: selectedAgentId.value })
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

async function resolveApproval(messageId: string, approvalId: string, decision: 'approved' | 'denied') {
  try {
    await api.approvals.resolve(approvalId, decision)
  } catch {}
  const message = messages.value.find((item) => item.id === messageId)
  const request = message?.approvals.find((item) => item.approval_id === approvalId)
  if (request) request.resolved = decision
  if (message && message.status === 'in_progress') message.status = 'completed'
}

function levelLabel(level?: 1 | 2 | 3) {
  if (!level) return ''
  return { 1: 'L1 Compiled', 2: 'L2 Memory', 3: 'L3 LLM' }[level]
}

function levelColor(level?: 1 | 2 | 3) {
  if (!level) return '#94a3b8'
  return { 1: '#10b981', 2: '#2080f0', 3: '#f0a020' }[level]
}
</script>

<template>
  <div class="chat-view">
    <aside class="left-pane" :class="{ collapsed: !showLeftPane }">
      <div class="pane-split">
        <div class="pane-conv">
          <ConversationSidebar
            :active-id="conversationId"
            @select="(id) => loadConversation(id)"
            @new="newConversation"
          />
        </div>
        <div class="pane-manifests">
          <ManifestExplorer layout="sidebar" />
        </div>
      </div>
    </aside>

    <section class="center-pane">
      <div class="chat-toolbar">
        <button class="toolbar-btn" @click="showLeftPane = !showLeftPane">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" :style="{ transform: showLeftPane ? '' : 'rotate(180deg)' }">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <button class="toolbar-btn text-btn primary-hover" @click="newConversation">{{ t('chat.newChat') }}</button>
        <div class="agent-selector-wrapper">
          <select
            v-if="agentInstances.length > 0"
            v-model.number="selectedAgentId"
            class="agent-picker"
            :title="t('chat.agentProfile')"
          >
            <option
              v-for="inst in agentInstances"
              :key="inst.id"
              :value="inst.id"
            >{{ inst.name }} · {{ inst.profile }}</option>
          </select>
        </div>
        <button
          v-if="loading"
          class="toolbar-btn stop text-btn"
          @click="stopStreaming"
        >{{ t('chat.stop') }}</button>
        <button
          class="toolbar-btn text-btn"
          :class="{ 'direct-active': directLLM }"
          @click="directLLM = !directLLM"
          :title="isZh ? '跳过意图路由，直接送 LLM' : 'Bypass intent router, direct to LLM'"
        >{{ directLLM ? 'Direct' : 'Router' }}</button>
        <div v-if="selectedDevice" class="selected-device">{{ selectedDevice.name }}</div>
        <button class="toolbar-btn right" @click="showRightPane = !showRightPane">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" :style="{ transform: showRightPane ? '' : 'rotate(180deg)' }">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>

      <div ref="messageListRef" class="message-list">
        <BtwStrip :items="btwItems" @dismiss="dismissBtw" />
        <div v-if="messages.length === 0" class="welcome">
          <span class="eyebrow">{{ label('对话式控制中心', 'Conversational AI') }}</span>
          <h2>{{ t('chat.welcomeTitle') }}</h2>
          <p>{{ t('chat.welcomeSubtitle') }}</p>
          <div class="quick-actions">
            <button
              v-for="action in quickActions"
              :key="action.label"
              class="quick-btn"
              @click="sendMessage(action.text, { agentInstanceId: selectedAgentId ?? undefined })"
            >{{ action.label }}</button>
          </div>
        </div>

        <div
          v-for="msg in messages"
          :key="msg.id"
          :class="['message-row', msg.role]"
        >
          <div :class="['message-bubble', msg.role, msg.status]">
            <div v-if="msg.content" class="message-content">{{ msg.content }}</div>
            <div v-else-if="msg.status === 'streaming' && msg.role === 'assistant'" class="typing">
              <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            </div>

            <div
              v-if="msg.role === 'assistant' && (msg.level || msg.durationMs)"
              class="message-meta"
            >
              <span v-if="msg.level" class="level-badge" :style="{ background: levelColor(msg.level) }">
                {{ levelLabel(msg.level) }}
              </span>
              <span v-if="msg.durationMs != null" class="processing-time">{{ msg.durationMs }}ms</span>
              <span v-if="msg.status === 'streaming'" class="streaming-chip">{{ t('chat.streaming') }}</span>
            </div>

            <MemoryChip v-if="msg.memoryHits.length" :hits="msg.memoryHits" class="msg-sub" />

            <RoutePreviewCard
              v-if="msg.routePreview"
              class="msg-sub"
              :normalized-intent="msg.routePreview.normalized_intent"
              :route-level="msg.routePreview.route_level"
              :reason="msg.routePreview.reason"
              :confidence="msg.routePreview.confidence"
              :allow-tool-calls="msg.routePreview.allow_tool_calls"
              :candidate-plans="msg.candidatePlans"
              :route-evidence="msg.routePreview.evidence"
              :observations="msg.routePreview.observations"
              :search-hits="msg.routePreview.search_hits"
            />

            <PlanStepTimeline v-if="msg.planSteps.length" :steps="msg.planSteps" class="msg-sub" />

            <div v-if="msg.toolCalls.length" class="tool-stack msg-sub">
              <ToolCallCard v-for="card in msg.toolCalls" :key="card.call_id" :card="card" />
            </div>

            <div v-if="msg.a2aDispatches.length" class="tool-stack msg-sub">
              <A2ADispatchCard
                v-for="dispatch in msg.a2aDispatches"
                :key="dispatch.dispatch_id"
                :dispatch="dispatch"
              />
            </div>

            <div v-if="msg.approvals.length" class="tool-stack msg-sub">
              <ApprovalCard
                v-for="request in msg.approvals"
                :key="request.approval_id"
                :request="request"
                @resolve="(approvalId, decision) => resolveApproval(msg.id, approvalId, decision)"
              />
            </div>

            <div
              v-if="msg.role === 'assistant' && msg.planSteps.length && msg.planSteps[0]"
              class="plan-preview-shell msg-sub"
            >
              <PlanPreviewCard :plan-id="msg.planSteps[0].plan_id" compact />
            </div>
          </div>
          <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
        </div>
      </div>

      <div class="input-area">
        <div class="input-wrapper">
          <textarea
            ref="textarea"
            v-model="inputText"
            class="chat-input"
            :placeholder="t('chat.placeholder')"
            rows="1"
            :disabled="loading"
            @keydown="onKeydown"
          ></textarea>
          <button class="send-btn" :disabled="loading || !inputText.trim()" @click="onSend">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" v-if="!loading">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
            <span v-else class="btn-spinner"></span>
          </button>
        </div>
      </div>
    </section>

    <aside class="right-pane" :class="{ collapsed: !showRightPane }">
      <div class="pane-head"><span>{{ t('chat.artifact') }}</span></div>

      <div class="pane-section">
        <div class="pane-label">{{ t('chat.targetDevice') }}</div>
        <div v-if="lastAssistant?.contextPatch?.target_device_id" class="pane-strong">
          {{ lastAssistant.contextPatch.target_device_id }}
        </div>
        <div v-else class="pane-empty">{{ t('chat.empty') }}</div>
      </div>

      <div
        v-if="lastAssistant?.contextPatch?.normalized_intent || lastAssistant?.contextPatch?.route_reason"
        class="pane-section"
      >
        <div class="pane-label">Intent Route</div>
        <div v-if="lastAssistant?.contextPatch?.normalized_intent" class="pane-strong">
          {{ lastAssistant.contextPatch.normalized_intent }}
        </div>
        <div v-if="lastAssistant?.contextPatch?.route_reason" class="pane-empty">
          {{ lastAssistant.contextPatch.route_reason }}
        </div>
      </div>

      <div v-if="lastAssistant?.routePreview" class="pane-section">
        <div class="pane-label">Candidate Plans</div>
        <RoutePreviewCard
          :normalized-intent="lastAssistant.routePreview.normalized_intent"
          :route-level="lastAssistant.routePreview.route_level"
          :reason="lastAssistant.routePreview.reason"
          :confidence="lastAssistant.routePreview.confidence"
          :allow-tool-calls="lastAssistant.routePreview.allow_tool_calls"
          :candidate-plans="lastAssistant.candidatePlans"
          :route-evidence="lastAssistant.routePreview.evidence"
          :observations="lastAssistant.routePreview.observations"
          :search-hits="lastAssistant.routePreview.search_hits"
        />
      </div>

      <div v-if="lastAssistant?.planSteps.length" class="pane-section">
        <div class="pane-label">{{ t('chat.lastPlan') }}</div>
        <PlanStepTimeline :steps="lastAssistant.planSteps" />
      </div>

      <div v-if="lastAssistant?.memoryHits.length" class="pane-section">
        <div class="pane-label">{{ t('chat.memoryHits') }}</div>
        <ul class="memory-list">
          <li v-for="hit in lastAssistant.memoryHits" :key="hit.id">
            <span class="memory-type">{{ hit.type }}</span>
            <span class="memory-name">{{ hit.name }}</span>
            <span v-if="hit.snippet" class="memory-snippet">{{ hit.snippet }}</span>
          </li>
        </ul>
      </div>

      <div class="pane-section">
        <div class="pane-label">{{ t('chat.devices') }}</div>
        <DeviceSidebar class="device-embed" @select="(device) => (selectedDevice = device)" />
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

.left-pane {
  width: 380px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  border-right: 1px solid rgba(229, 231, 235, 0.4);
  display: flex;
  flex-direction: column;
  transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 60;
}

.left-pane.collapsed {
  width: 0;
  border-right: none;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-40px);
}

.right-pane {
  width: 440px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  border-left: 1px solid rgba(229, 231, 235, 0.4);
  display: flex;
  flex-direction: column;
  transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  overflow-y: auto;
  z-index: 60;
}

.right-pane.collapsed {
  width: 0;
  border-left: none;
  opacity: 0;
  pointer-events: none;
  transform: translateX(40px);
}

.center-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: radial-gradient(circle at 50% 0%, rgba(255,255,255,0.8) 0%, rgba(247,249,250,1) 100%);
  position: relative;
}

.pane-split {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.pane-conv {
  flex: 1 1 40%;
  min-height: 200px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.5);
  overflow: hidden;
}
.pane-manifests {
  flex: 1 1 60%;
  overflow-y: auto;
  padding: 40px;
  min-height: 0;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 48px 40px 24px;
  font-size: 10px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.6;
}

.pane-section {
  padding: 40px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.4);
}

.pane-section:last-child {
  border-bottom: none;
}

.pane-label {
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--text-tertiary);
  margin-bottom: 24px;
  opacity: 0.7;
}

.pane-empty {
  font-size: 14px;
  color: var(--text-tertiary);
  font-weight: 700;
  font-style: italic;
  opacity: 0.5;
  padding-left: 4px;
}

.pane-strong {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px;
  font-weight: 900;
  color: #10b981;
  background: rgba(16, 185, 129, 0.08);
  padding: 20px 24px;
  border-radius: 18px;
  border: 1px solid rgba(16, 185, 129, 0.12);
  overflow-wrap: anywhere;
  letter-spacing: -0.01em;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
}

.memory-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.memory-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 14px;
  align-items: center;
  background: rgba(255, 255, 255, 0.6);
  padding: 24px;
  border-radius: 28px;
  border: 1px solid rgba(229, 231, 235, 0.5);
  box-shadow: 0 8px 24px rgba(0,0,0,0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.memory-list li:hover {
  background: #fff;
  transform: translateY(-4px);
  box-shadow: 0 16px 40px rgba(0,0,0,0.05);
}

.memory-type {
  font-size: 8px;
  font-weight: 900;
  text-transform: uppercase;
  color: #7c3aed;
  letter-spacing: 0.12em;
  background: rgba(124, 58, 237, 0.1);
  padding: 4px 12px;
  border-radius: 8px;
}

.memory-name {
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.memory-snippet {
  color: var(--text-secondary);
  flex: 1 1 100%;
  font-size: 13px;
  margin-top: 12px;
  line-height: 1.8;
  font-weight: 700;
  opacity: 0.8;
}

.chat-toolbar {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 24px 48px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  border-bottom: 1px solid rgba(229, 231, 235, 0.4);
  z-index: 50;
}

.toolbar-btn {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 6px rgba(0,0,0,0.02);
}

.toolbar-btn:hover {
  border-color: #10b981;
  color: #10b981;
  background: #fff;
  transform: translateY(-2px);
  box-shadow: 0 12px 28px rgba(16, 185, 129, 0.12);
}

.toolbar-btn.stop {
  border-color: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  background: rgba(254, 242, 242, 0.8);
}

.toolbar-btn.stop:hover {
  background: #fef2f2;
  border-color: #ef4444;
  box-shadow: 0 12px 28px rgba(239, 68, 68, 0.15);
}

.toolbar-btn.text-btn {
  width: auto;
  padding: 0 28px;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.toolbar-btn.primary-hover:hover {
  background: #10b981;
  color: #fff;
  border-color: #10b981;
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.25);
}

.toolbar-btn.right { margin-left: auto; }

.direct-active {
  background: #7c3aed;
  color: #fff;
  border-color: #7c3aed;
  box-shadow: 0 12px 32px rgba(124, 58, 237, 0.3);
}

.agent-selector-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.agent-picker {
  height: 48px;
  padding: 0 44px 0 28px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.8);
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
  max-width: 400px;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0,0,0,0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  letter-spacing: -0.01em;
  appearance: none;
}

.agent-selector-wrapper::after {
  content: '';
  position: absolute;
  right: 18px;
  width: 10px;
  height: 10px;
  background-color: var(--text-tertiary);
  mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>') center / contain no-repeat;
  pointer-events: none;
  opacity: 0.6;
}

.agent-picker:hover {
  border-color: #10b981;
  transform: translateY(-2px);
  background: #fff;
}

.selected-device {
  font-size: 9px;
  font-weight: 900;
  color: #10b981;
  margin-left: auto;
  background: rgba(16, 185, 129, 0.1);
  padding: 10px 24px;
  border-radius: 99px;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.1);
}

.message-list {
  flex: 1;
  padding: 80px 0;
  overflow-y: auto;
  scroll-behavior: smooth;
  display: flex;
  flex-direction: column;
}

.welcome {
  text-align: center;
  padding: 160px 48px;
  max-width: 1000px;
  margin: 0 auto;
}

.eyebrow {
  display: inline-block;
  color: #10b981;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  background: rgba(16, 185, 129, 0.1);
  padding: 6px 18px;
  border-radius: 10px;
  margin-bottom: 32px;
}

.welcome h2 {
  margin: 0 0 32px;
  font-size: 64px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.06em;
  line-height: 1.1;
  background: linear-gradient(135deg, #1e293b 0%, #64748b 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.welcome p {
  margin: 0 0 80px;
  color: var(--text-secondary);
  font-size: 22px;
  line-height: 1.7;
  font-weight: 700;
  letter-spacing: -0.02em;
  opacity: 0.9;
  max-width: 720px;
  margin-left: auto;
  margin-right: auto;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 24px;
}

.quick-btn {
  padding: 24px 40px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(16px);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 16px;
  font-weight: 900;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 16px rgba(0,0,0,0.03);
  letter-spacing: -0.02em;
}

.quick-btn:hover {
  border-color: #10b981;
  color: #10b981;
  background: #fff;
  transform: translateY(-8px);
  box-shadow: 0 32px 80px rgba(16, 185, 129, 0.18);
}

.message-row {
  display: flex;
  flex-direction: column;
  margin-bottom: 64px;
  padding: 0 100px;
}

.message-row.user { align-items: flex-end; }
.message-row.assistant { align-items: flex-start; }

.message-bubble {
  max-width: min(85%, 1000px);
  padding: 36px 48px;
  border-radius: 40px;
  line-height: 1.8;
  font-size: 17px;
  word-break: break-word;
  display: flex;
  flex-direction: column;
  gap: 32px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.04);
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  font-weight: 700;
  letter-spacing: -0.015em;
}

.message-bubble.user {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #fff;
  border-bottom-right-radius: 12px;
  box-shadow: 0 20px 64px rgba(16, 185, 129, 0.3);
}

.message-bubble.assistant {
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(48px);
  color: var(--text-primary);
  border-bottom-left-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.5);
}

.message-bubble.assistant:hover {
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.08);
  transform: translateY(-4px);
}

.message-bubble.error {
  background: rgba(254, 242, 242, 0.9);
  backdrop-filter: blur(32px);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
  box-shadow: 0 12px 32px rgba(239, 68, 68, 0.1);
}

.message-bubble.streaming {
  border: 2px dashed rgba(16, 185, 129, 0.4);
  background: rgba(255, 255, 255, 0.4);
  animation: borderPulse 2s infinite ease-in-out;
}

@keyframes borderPulse {
  0%, 100% { border-color: rgba(16, 185, 129, 0.2); box-shadow: 0 12px 48px rgba(0,0,0,0.04); }
  50% { border-color: rgba(16, 185, 129, 0.8); box-shadow: 0 12px 80px rgba(16, 185, 129, 0.12); }
}

.message-content { white-space: pre-wrap; }
.msg-sub { margin-top: 16px; }

.message-meta {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.level-badge {
  display: inline-block;
  padding: 8px 20px;
  border-radius: 99px;
  font-size: 9px;
  font-weight: 900;
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  box-shadow: 0 6px 16px rgba(0,0,0,0.15);
}

.processing-time {
  font-size: 11px;
  font-weight: 900;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: 0.05em;
  opacity: 0.7;
}

.streaming-chip {
  font-size: 9px;
  font-weight: 900;
  padding: 8px 20px;
  border-radius: 99px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  display: flex;
  align-items: center;
  gap: 12px;
}

.streaming-chip::before {
  content: '';
  display: block;
  width: 8px;
  height: 8px;
  background-color: currentColor;
  border-radius: 50%;
  animation: pulse 1.5s infinite;
}

.tool-stack { display: flex; flex-direction: column; gap: 20px; }
.plan-preview-shell { margin-top: 32px; }

.message-time {
  margin-top: 18px;
  font-size: 10px;
  font-weight: 900;
  color: var(--text-tertiary);
  padding: 0 24px;
  text-transform: uppercase;
  letter-spacing: 0.25em;
  opacity: 0.6;
}

.typing { display: flex; gap: 12px; align-items: center; padding: 24px 12px; }
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #10b981;
  opacity: 0.6;
  animation: typing 1.2s infinite both;
}
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

.input-area {
  padding: 40px 100px 100px;
  background: transparent;
  position: relative;
  z-index: 40;
}

.input-area::before {
  content: '';
  position: absolute;
  top: -160px;
  left: 0;
  right: 0;
  height: 160px;
  background: linear-gradient(to top, #f7f9fa, transparent);
  pointer-events: none;
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: flex-end;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(64px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 44px;
  box-shadow: 0 40px 100px rgba(0, 0, 0, 0.12);
  transition: all 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  max-width: 1200px;
  margin: 0 auto;
}

.input-wrapper:focus-within {
  background: #fff;
  border-color: #10b981;
  box-shadow: 0 48px 120px rgba(16, 185, 129, 0.22);
  transform: translateY(-8px);
}

.chat-input {
  flex: 1;
  min-height: 96px;
  max-height: 400px;
  padding: 32px 140px 32px 48px;
  border: none;
  background: transparent;
  resize: none;
  font: inherit;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.6;
  outline: none;
  overflow-y: auto;
  color: var(--text-primary);
  letter-spacing: -0.015em;
}

.chat-input::placeholder {
  color: var(--text-tertiary);
  font-weight: 900;
  opacity: 0.6;
  letter-spacing: -0.015em;
}

.send-btn {
  position: absolute;
  right: 24px;
  bottom: 24px;
  width: 56px;
  height: 56px;
  border: none;
  border-radius: 20px;
  background: #10b981;
  color: #fff;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.35);
}

.send-btn:hover:not(:disabled) {
  background: #059669;
  transform: translateY(-4px) scale(1.05);
  box-shadow: 0 16px 48px rgba(16, 185, 129, 0.45);
}

.send-btn:disabled {
  background: #f1f5f9;
  color: #94a3b8;
  box-shadow: none;
  cursor: not-allowed;
  opacity: 0.6;
}

.btn-spinner {
  width: 20px;
  height: 20px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.device-embed {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(24px);
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.04);
}

@keyframes pulse {
  0% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
  100% { opacity: 1; transform: scale(1); }
}

@keyframes typing {
  0%, 80%, 100% { opacity: 0.2; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-8px); }
}

@media (max-width: 1400px) {
  .message-row { padding: 0 60px; }
  .input-area { padding: 40px 60px 60px; }
}

@media (max-width: 1024px) {
  .left-pane { width: 320px; }
  .right-pane { width: 360px; }
  .welcome h2 { font-size: 48px; }
}
</style>
