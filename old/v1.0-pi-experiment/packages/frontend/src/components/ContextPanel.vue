<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { api, type DeviceCardProjection, type Room } from '@/api'
import { formatChinaDateTime } from '@/utils/chinaTime'

const rooms = ref<Room[]>([])
const devices = ref<DeviceCardProjection[]>([])
const currentRoomId = ref<number | null>(null)
const currentDeviceId = ref<number | null>(null)
const contextExpired = ref(false)
const lastDeviceUpdate = ref('')
const contextWindow = ref<{ max_turns: number; ttl_ms: number } | null>(null)
const workingContext = ref<Record<string, unknown>>({})
const retrievalHits = ref<Array<{ id: string; kind: string; title: string; snippet: string; source?: string; score?: number }>>([])
const contextUsage = ref({ used_tokens: 0, max_tokens: 20000 })
const sessionActive = ref(false)
const maxTurnsDraft = ref(12)
const ttlMinutesDraft = ref(30)
const retrievalLimitDraft = ref(3)
const contextTokenBudgetDraft = ref(20000)
const savingContextSettings = ref(false)
const showRoomPicker = ref(false)
const showDevicePicker = ref(false)

// Models
interface ChatModel { id: number; provider_name: string; model_name: string; is_default: boolean }
const models = ref<ChatModel[]>([])
const currentModelName = ref('')
const showModelPicker = ref(false)
const deviceCapabilities = ref<Array<{ name: string; kind: string; source?: string; output?: Record<string, unknown> | null }>>([])
const capabilityLoading = ref(false)

type RuntimeContextEntry = {
  key: string
  value: string
  updated_at: string
  active: boolean
  age_ms: number
  ttl_ms: number
}

const currentRoom = () => rooms.value.find(r => r.id === currentRoomId.value)
const currentDevice = () => devices.value.find(d => d.id === currentDeviceId.value)
const devicesInRoom = () => currentRoomId.value != null
  ? devices.value.filter(d => d.room.id === currentRoomId.value)
  : devices.value
const contextWindowLabel = computed(() => {
  if (!contextWindow.value) return ''
  return `${contextWindow.value.max_turns} turns / ${Math.round(contextWindow.value.ttl_ms / 60000)}m / ${retrievalLimitDraft.value} hits`
})
const contextUsageLabel = computed(() => `Context ${contextUsage.value.used_tokens}/${contextUsage.value.max_tokens}`)
const contextUsagePercent = computed(() => {
  if (!contextUsage.value.max_tokens) return 0
  return Math.min(100, Math.round((contextUsage.value.used_tokens / contextUsage.value.max_tokens) * 100))
})
const runtimeRoomName = computed(() => {
  const name = workingContext.value.current_room_name
  return typeof name === 'string' && name.trim() ? name : ''
})
const runtimeDeviceName = computed(() => {
  const name = workingContext.value.current_device_name
  return typeof name === 'string' && name.trim() ? name : ''
})
const runtimeDeviceType = computed(() => {
  const type = workingContext.value.current_device_type
  return typeof type === 'string' && type.trim() ? type : ''
})
const runtimeLocated = computed(() => Boolean(runtimeDeviceName.value || runtimeRoomName.value))
const contextUpdatedLabel = computed(() => formatChinaDateTime(lastDeviceUpdate.value))
const capabilitySummary = computed(() => {
  if (capabilityLoading.value) return label('能力读取中', 'Loading capabilities')
  if (!currentDeviceId.value) return label('未选择设备', 'No device selected')
  if (deviceCapabilities.value.length === 0) return label('暂无能力数据', 'No capability data')
  const bySource = deviceCapabilities.value.reduce<Record<string, number>>((acc, item) => {
    const source = item.source || 'local'
    acc[source] = (acc[source] ?? 0) + 1
    return acc
  }, {})
  return Object.entries(bySource)
    .map(([source, count]) => `${source}:${count}`)
    .join(' · ')
})

const zh = ref(true)
function label(z: string, e: string) { return zh.value ? z : e }

async function load() {
  const [ctx, roomRes, devRes, modelRes] = await Promise.all([
    api.userContext.runtime().catch(() => ({
      context: {
        entries: {} as Record<string, RuntimeContextEntry>,
        max_turns: 0,
        ttl_ms: 0,
        retrieval_limit: 0,
        retrieval_hits: [],
        context_token_budget: 20000,
        context_usage: {
          used_tokens: 0,
          max_tokens: 20000,
          message_tokens: 0,
          working_context_tokens: 0,
          retrieval_tokens: 0,
        },
        session_active: false,
        last_activity_at: null,
        expires_at: null,
        working_context: {},
        recent_messages: [],
      },
    })),
    api.rooms.list().catch(() => ({ rooms: [] as Room[] })),
    api.userDevices.cards().catch(() => ({ cards: [] as DeviceCardProjection[] })),
    api.llm.chatModels().catch(() => ({ models: [] as ChatModel[] })),
  ])
  rooms.value = roomRes.rooms
  devices.value = devRes.cards
  models.value = modelRes.models
  workingContext.value = ctx.context.working_context ?? {}
  retrievalHits.value = ctx.context.retrieval_hits ?? []
  contextUsage.value = ctx.context.context_usage ?? { used_tokens: 0, max_tokens: ctx.context.context_token_budget ?? 20000 }
  sessionActive.value = Boolean(ctx.context.session_active)
  contextWindow.value = { max_turns: ctx.context.max_turns, ttl_ms: ctx.context.ttl_ms }
  maxTurnsDraft.value = ctx.context.max_turns
  ttlMinutesDraft.value = Math.round(ctx.context.ttl_ms / 60000)
  retrievalLimitDraft.value = ctx.context.retrieval_limit
  contextTokenBudgetDraft.value = ctx.context.context_token_budget
  const rv = ctx.context.entries.current_room
  const dv = ctx.context.entries.current_device
  if (rv) currentRoomId.value = Number(rv.value)
  if (dv) {
    currentDeviceId.value = Number(dv.value)
    lastDeviceUpdate.value = dv.updated_at
    contextExpired.value = !dv.active
  }
  const def = models.value.find(m => m.is_default)
  if (def) currentModelName.value = `${def.provider_name} / ${def.model_name}`
  await loadDeviceCapabilities()
}

onMounted(load)

defineExpose({ refresh: load })

async function selectRoom(id: number | null) {
  showRoomPicker.value = false
  currentRoomId.value = id
  const contextUpdates: Array<Promise<unknown>> = [
    api.userContext.set('current_room', id != null ? String(id) : '').catch(() => {}),
  ]
  if (id != null && currentDevice()) {
    const d = currentDevice()!
    if (d.room.id !== id) {
      currentDeviceId.value = null
      contextExpired.value = false
      lastDeviceUpdate.value = ''
      deviceCapabilities.value = []
      contextUpdates.push(api.userContext.set('current_device', '').catch(() => {}))
    }
  }
  await Promise.all(contextUpdates)
  await load().catch(() => {})
}

async function selectDevice(id: number | null) {
  showDevicePicker.value = false
  currentDeviceId.value = id
  contextExpired.value = false
  lastDeviceUpdate.value = id != null ? new Date().toISOString() : ''
  const contextUpdates: Array<Promise<unknown>> = [
    api.userContext.set('current_device', id != null ? String(id) : '').catch(() => {}),
  ]
  if (id != null) {
    const device = devices.value.find(d => d.id === id)
    if (device) {
      currentRoomId.value = device.room.id
      contextUpdates.push(api.userContext.set('current_room', device.room.id != null ? String(device.room.id) : '').catch(() => {}))
    }
  }
  await Promise.all(contextUpdates)
  await load().catch(() => {})
}

async function loadDeviceCapabilities() {
  deviceCapabilities.value = []
  if (currentDeviceId.value == null) return
  capabilityLoading.value = true
  try {
    const res = await api.userDevices.capabilities(currentDeviceId.value)
    deviceCapabilities.value = res.data?.capabilities ?? []
  } catch {
    deviceCapabilities.value = []
  } finally {
    capabilityLoading.value = false
  }
}

async function selectModel(id: number) {
  showModelPicker.value = false
  await api.llm.selectModel(id).catch(() => {})
  models.value.forEach(m => m.is_default = m.id === id)
  const sel = models.value.find(m => m.id === id)
  if (sel) currentModelName.value = `${sel.provider_name} / ${sel.model_name}`
}

async function saveContextSettings() {
  savingContextSettings.value = true
  try {
    const res = await api.userContext.updateSettings({
      max_turns: maxTurnsDraft.value,
      ttl_ms: ttlMinutesDraft.value * 60 * 1000,
      retrieval_limit: retrievalLimitDraft.value,
      context_token_budget: contextTokenBudgetDraft.value,
    })
    contextWindow.value = {
      max_turns: res.settings.max_turns,
      ttl_ms: res.settings.ttl_ms,
    }
    maxTurnsDraft.value = res.settings.max_turns
    ttlMinutesDraft.value = Math.round(res.settings.ttl_ms / 60000)
    retrievalLimitDraft.value = res.settings.retrieval_limit
    contextTokenBudgetDraft.value = res.settings.context_token_budget
    await load().catch(() => {})
  } finally {
    savingContextSettings.value = false
  }
}

function deviceIcon(t: string) {
  const m: Record<string, string> = {
    television: '📺', stb: '📡', speaker: '🔊', router: '📶',
    outlet: '🔌', phone: '📱', tv_box: '📦', tablet: '📋',
    computer: '💻',
  }
  return m[t] ?? '⚙'
}

function deviceStatusTitle(device: DeviceCardProjection) {
  if (!device.network.checked) return label('未检测在线状态', 'Not checked')
  return device.network.online ? label('在线', 'Online') : label('离线', 'Offline')
}

function onBgClick() {
  showRoomPicker.value = false
  showDevicePicker.value = false
  showModelPicker.value = false
}
</script>

<template>
  <div class="ctx-panel" @click="onBgClick">
    <!-- Room -->
    <div v-if="contextWindowLabel" class="ctx-window">
      {{ label('上下文窗口', 'Context window') }} · {{ contextWindowLabel }}
    </div>
    <div class="ctx-usage">
      <div class="ctx-usage-head">
        <span>{{ contextUsageLabel }}</span>
        <strong>{{ contextUsagePercent }}%</strong>
      </div>
      <div class="ctx-usage-bar"><span :style="{ width: contextUsagePercent + '%' }"></span></div>
    </div>

    <details class="ctx-settings">
      <summary>{{ label('窗口设置', 'Window settings') }}</summary>
      <div class="ctx-setting-line">
        <label>{{ label('轮数', 'Turns') }}</label>
        <input v-model.number="maxTurnsDraft" type="number" min="2" max="50" />
        <label>TTL</label>
        <input v-model.number="ttlMinutesDraft" type="number" min="1" max="1440" />
        <label>{{ label('检索', 'Hits') }}</label>
        <input v-model.number="retrievalLimitDraft" type="number" min="0" max="8" />
      </div>
      <div class="ctx-setting-line budget">
        <label>{{ label('预算', 'Budget') }}</label>
        <input v-model.number="contextTokenBudgetDraft" type="number" min="1000" max="200000" step="1000" />
      </div>
      <button class="ctx-save" :disabled="savingContextSettings" @click.stop="saveContextSettings">
        {{ savingContextSettings ? label('保存中', 'Saving') : label('保存窗口', 'Save window') }}
      </button>
    </details>

    <div :class="['ctx-runtime', { empty: !runtimeLocated }]">
      <div class="ctx-runtime-head">
        <span class="ctx-runtime-dot"></span>
        <span>{{ label('运行时定位', 'Runtime location') }}</span>
        <strong>{{ sessionActive && runtimeLocated ? label('有效', 'Active') : label('未定位', 'Empty') }}</strong>
      </div>
      <div v-if="runtimeLocated" class="ctx-runtime-body">
        <span v-if="runtimeRoomName">{{ label('房间', 'Room') }}: {{ runtimeRoomName }}</span>
        <span v-if="runtimeDeviceName">{{ label('设备', 'Device') }}: {{ runtimeDeviceName }}</span>
        <span v-if="runtimeDeviceType">{{ label('类型', 'Type') }}: {{ runtimeDeviceType }}</span>
        <span v-if="contextUpdatedLabel">{{ label('更新', 'Updated') }}: {{ contextUpdatedLabel }}</span>
      </div>
      <div v-else class="ctx-runtime-body muted">
        {{ label('当前选择已过期或未写入，Chat 不会默认带设备。', 'Selection is expired or empty; chat has no default device.') }}
      </div>
    </div>

    <div v-if="retrievalHits.length > 0" class="ctx-retrieval">
      <div class="ctx-cap-head">
        <span>{{ label('本轮轻检索', 'Light retrieval') }}</span>
        <strong>{{ retrievalHits.length }}</strong>
      </div>
      <div v-for="hit in retrievalHits" :key="hit.id" class="ctx-hit">
        <strong>{{ hit.title }}</strong>
        <span>{{ hit.kind }}</span>
      </div>
    </div>

    <div class="ctx-row" @click.stop="showRoomPicker = !showRoomPicker; showDevicePicker = false; showModelPicker = false">
      <span class="ctx-icon">🏠</span>
      <span v-if="currentRoom()" class="ctx-val">{{ currentRoom()!.name }}</span>
      <span v-else class="ctx-placeholder">{{ label('选择房间', 'Select room') }}</span>
      <svg class="ctx-arrow" :class="{ open: showRoomPicker }" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </div>
    <div v-if="showRoomPicker" class="ctx-dropdown" @click.stop>
      <div
        v-for="r in rooms" :key="r.id"
        :class="['ctx-opt', { active: currentRoomId === r.id }]"
        @click="selectRoom(r.id)"
      >{{ r.name }}</div>
      <div v-if="rooms.length === 0" class="ctx-empty-hint">{{ label('暂无房间', 'No rooms') }}</div>
    </div>

    <!-- Device -->
    <div class="ctx-row" @click.stop="showDevicePicker = !showDevicePicker; showRoomPicker = false; showModelPicker = false">
      <span class="ctx-icon">{{ currentDevice() ? deviceIcon(currentDevice()!.device_type) : '📱' }}</span>
      <span v-if="currentDevice()" :class="['ctx-val', { expired: contextExpired }]">{{ currentDevice()!.name }}</span>
      <span v-else class="ctx-placeholder">{{ label('选择设备', 'Select device') }}</span>
      <span v-if="contextExpired && currentDevice()" class="ctx-expired-badge" title="上下文已过期，命令将匹配所有设备">过期</span>
      <svg class="ctx-arrow" :class="{ open: showDevicePicker }" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </div>
    <div v-if="showDevicePicker" class="ctx-dropdown" @click.stop>
      <div
        v-for="d in devicesInRoom()" :key="d.id"
        :class="['ctx-opt', { active: currentDeviceId === d.id }]"
        :title="deviceStatusTitle(d)"
        @click="selectDevice(d.id)"
      >
        <span :class="['ctx-device-status', d.display.status]"></span>
        {{ deviceIcon(d.device_type) }} {{ d.display.title }}
      </div>
      <div v-if="devicesInRoom().length === 0" class="ctx-empty-hint">{{ label('该房间暂无设备', 'No devices') }}</div>
      <div v-if="currentDeviceId != null" class="ctx-opt ctx-clear" @click="selectDevice(null)">{{ label('清除选择', 'Clear') }}</div>
    </div>

    <div v-if="currentDeviceId != null" class="ctx-capabilities">
      <div class="ctx-cap-head">
        <span>{{ label('真实能力', 'Real capabilities') }}</span>
        <strong>{{ deviceCapabilities.length }}</strong>
      </div>
      <div class="ctx-cap-summary">{{ capabilitySummary }}</div>
      <div v-if="deviceCapabilities.length > 0" class="ctx-cap-list">
        <span v-for="cap in deviceCapabilities.slice(0, 6)" :key="`${cap.source || 'local'}-${cap.name}`">
          {{ cap.name }}
        </span>
      </div>
    </div>

    <!-- Model -->
    <div class="ctx-row" @click.stop="showModelPicker = !showModelPicker; showRoomPicker = false; showDevicePicker = false">
      <span class="ctx-icon">🧠</span>
      <span v-if="currentModelName" class="ctx-val">{{ currentModelName }}</span>
      <span v-else class="ctx-placeholder">{{ label('选择模型', 'Select model') }}</span>
      <svg class="ctx-arrow" :class="{ open: showModelPicker }" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </div>
    <div v-if="showModelPicker" class="ctx-dropdown" @click.stop>
      <div
        v-for="m in models" :key="m.id"
        :class="['ctx-opt', { active: m.is_default }]"
        @click="selectModel(m.id)"
      >
        <span class="model-opt-name">{{ m.model_name }}</span>
        <span class="model-opt-provider">{{ m.provider_name }}</span>
      </div>
      <div v-if="models.length === 0" class="ctx-empty-hint">{{ label('暂无模型', 'No models') }}</div>
    </div>
  </div>
</template>

<style scoped>
.ctx-panel {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(229, 231, 235, 0.4);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ctx-window {
  padding: 2px 12px 6px;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.ctx-usage {
  margin: 0 6px 6px;
  padding: 8px 10px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.035);
}

.ctx-usage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  font-weight: 900;
  color: var(--text-secondary);
}

.ctx-usage-head strong {
  color: var(--text-tertiary);
}

.ctx-usage-bar {
  height: 5px;
  margin-top: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
}

.ctx-usage-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #10b981;
}

.ctx-settings {
  margin: 0 6px 6px;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.55);
}

.ctx-settings summary {
  cursor: pointer;
  user-select: none;
  font-size: 11px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.ctx-settings:not([open]) {
  padding: 7px 10px;
}

.ctx-settings[open] summary {
  margin-bottom: 8px;
}

.ctx-setting-line {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr auto 1fr;
  align-items: center;
  gap: 5px;
}

.ctx-setting-line.budget {
  grid-template-columns: auto 1fr;
  margin-top: 6px;
}

.ctx-setting-line label {
  font-size: 10px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.ctx-setting-line input {
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 800;
}

.ctx-save {
  width: 100%;
  height: 28px;
  margin-top: 7px;
  border: 1px solid rgba(16, 185, 129, 0.22);
  border-radius: 7px;
  background: rgba(236, 253, 245, 0.8);
  color: #047857;
  cursor: pointer;
  font-size: 11px;
  font-weight: 900;
}

.ctx-save:disabled {
  opacity: 0.55;
  cursor: default;
}

.ctx-runtime,
.ctx-capabilities,
.ctx-retrieval {
  margin: 2px 6px 6px;
  padding: 9px 10px;
  border: 1px solid rgba(16, 185, 129, 0.16);
  border-radius: 8px;
  background: rgba(236, 253, 245, 0.5);
}

.ctx-runtime.empty {
  border-color: rgba(148, 163, 184, 0.18);
  background: rgba(248, 250, 252, 0.7);
}

.ctx-runtime-head,
.ctx-cap-head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 11px;
  font-weight: 900;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ctx-runtime-head span:nth-child(2),
.ctx-cap-head span {
  flex: 1;
  min-width: 0;
}

.ctx-runtime-head strong,
.ctx-cap-head strong {
  font-size: 10px;
  color: #059669;
}

.ctx-runtime.empty .ctx-runtime-head strong {
  color: var(--text-tertiary);
}

.ctx-runtime-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  flex-shrink: 0;
}

.ctx-runtime.empty .ctx-runtime-dot {
  background: #94a3b8;
}

.ctx-runtime-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 7px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
  color: var(--text-primary);
}

.ctx-runtime-body.muted {
  color: var(--text-tertiary);
}

.ctx-capabilities {
  border-color: rgba(59, 130, 246, 0.16);
  background: rgba(239, 246, 255, 0.55);
}

.ctx-retrieval {
  border-color: rgba(168, 85, 247, 0.14);
  background: rgba(250, 245, 255, 0.58);
}

.ctx-cap-head strong {
  color: #2563eb;
}

.ctx-retrieval .ctx-cap-head strong {
  color: #7c3aed;
}

.ctx-hit {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
  min-width: 0;
}

.ctx-hit strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 900;
  color: var(--text-primary);
}

.ctx-hit span {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 900;
  color: #7c3aed;
}

.ctx-cap-summary {
  margin-top: 5px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  font-weight: 800;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.ctx-cap-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}

.ctx-cap-list span {
  max-width: 100%;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.08);
  color: #2563eb;
  font-size: 11px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}
.ctx-row:hover { background: rgba(16, 185, 129, 0.06); }

.ctx-icon { font-size: 15px; flex-shrink: 0; }
.ctx-val {
  flex: 1;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ctx-placeholder {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-tertiary);
}
.ctx-val.expired { color: var(--text-tertiary); text-decoration: line-through; }
.ctx-expired-badge {
  font-size: 10px; font-weight: 900; color: #f59e0b;
  background: rgba(245, 158, 11, 0.1); padding: 1px 6px; border-radius: 4px;
  flex-shrink: 0;
}
.ctx-arrow {
  color: var(--text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}
.ctx-arrow.open { transform: rotate(180deg); }

.ctx-dropdown {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: #fff;
  box-shadow: var(--shadow-md);
  overflow: hidden;
  max-height: 200px;
  overflow-y: auto;
}
.ctx-opt {
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
  color: var(--text-primary);
}
.ctx-opt:hover { background: rgba(16, 185, 129, 0.06); }
.ctx-opt.active { background: rgba(16, 185, 129, 0.1); color: #10b981; }
.ctx-clear { color: var(--text-tertiary); border-top: 1px solid var(--border-color); }
.ctx-clear:hover { color: #ef4444; background: rgba(239, 68, 68, 0.04); }

.ctx-device-status {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 7px;
  border-radius: 50%;
  background: #cbd5e1;
  vertical-align: middle;
}
.ctx-device-status.online { background: #10b981; }
.ctx-device-status.offline { background: #ef4444; }

.model-opt-name { display: block; font-size: 13px; font-weight: 700; color: var(--text-primary); }
.model-opt-provider { display: block; font-size: 11px; font-weight: 600; color: var(--text-tertiary); margin-top: 1px; }

.ctx-empty-hint {
  padding: 12px 14px;
  font-size: 13px;
  color: var(--text-tertiary);
  text-align: center;
}
</style>
