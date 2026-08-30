<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceCapability, DeviceExecutionHistoryEntry, DeviceIrKey } from '@/types/deviceCapabilities'

const props = defineProps<{
  label: (zh: string, en: string) => string
  hasCapabilitySource: boolean
  capsLoading: boolean
  capsError: string
  capabilitiesCount: number
  execResult: string
  execError: string
  isIrDevice: boolean
  irKeys: DeviceIrKey[]
  irKeysLoading: boolean
  isAdbDevice: boolean
  miActionCaps: DeviceCapability[]
  miPropertyCaps: DeviceCapability[]
  adbCaps: DeviceCapability[]
  executingCap: string
  textInputs: Record<string, string>
  execHistory: DeviceExecutionHistoryEntry[]
}>()

defineEmits<{
  refresh: []
  loadIrKeys: [refresh?: boolean]
  executeIrKey: [keyId: string]
  executeCapability: [capability: DeviceCapability]
  openAppBrowser: []
  updateTextInput: [capabilityName: string, value: string]
}>()

const remoteKeysByPosition = computed(() => {
  const map = new Map<string, DeviceIrKey>()
  for (const key of props.irKeys) {
    const position = key.position || key.normalized || key.name
    if (position && !map.has(position)) map.set(position, key)
  }
  return map
})

const numberKeys = computed(() => ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((position) => remoteKeysByPosition.value.get(position)).filter(Boolean) as DeviceIrKey[])

function remoteKey(position: string): DeviceIrKey | undefined {
  return remoteKeysByPosition.value.get(position)
}
</script>

<template>
  <section class="capabilities-section">
    <div class="section-head">
      <h2>{{ label('设备能力', 'Capabilities') }}</h2>
      <button v-if="hasCapabilitySource" class="refresh-caps-btn" :disabled="capsLoading" @click="$emit('refresh')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
        {{ label('刷新', 'Refresh') }}
      </button>
    </div>

    <div v-if="!hasCapabilitySource" class="no-mi">
      {{ label('该设备未绑定 Mi 或 ADB 能力来源，无法获取能力列表。', 'This device has no Mi or ADB capability binding, capabilities are unavailable.') }}
    </div>

    <div v-else-if="capsLoading" class="caps-loading">{{ label('正在加载能力…', 'Loading capabilities…') }}</div>

    <div v-else-if="capsError" class="caps-error">
      <p>{{ capsError }}</p>
    </div>

    <div v-else-if="capabilitiesCount === 0" class="no-caps">
      {{ label('未检测到该设备的能力。', 'No capabilities detected for this device.') }}
    </div>

    <div v-else class="caps-grid">
      <div v-if="execResult" class="exec-feedback exec-success">{{ execResult }}</div>
      <div v-if="execError" class="exec-feedback exec-error">{{ execError }}</div>

      <div v-if="isIrDevice" class="cap-group">
        <div class="cap-group-head">
          <h3 class="cap-group-title">{{ label('遥控按键', 'Remote Keys') }} · {{ irKeys.length }}</h3>
          <button class="mini-refresh-btn" :disabled="irKeysLoading" @click="$emit('loadIrKeys', true)">
            {{ label('刷新码表', 'Refresh Keys') }}
          </button>
        </div>
        <div v-if="irKeysLoading" class="caps-loading">{{ label('加载按键…', 'Loading keys…') }}</div>
        <div v-else-if="irKeys.length === 0" class="caps-loading clickable-loading" @click="$emit('loadIrKeys')">
          {{ label('点击加载按键码表', 'Click to load key map') }}
        </div>
        <div v-else class="remote-control-pad">
          <div class="remote-row remote-top-row">
            <button v-if="remoteKey('power')" class="remote-key key-danger" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('power')!.key_id)">{{ remoteKey('power')!.name }}</button>
            <button v-if="remoteKey('home')" class="remote-key" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('home')!.key_id)">{{ remoteKey('home')!.name }}</button>
            <button v-if="remoteKey('menu')" class="remote-key" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('menu')!.key_id)">{{ remoteKey('menu')!.name }}</button>
            <button v-if="remoteKey('back')" class="remote-key" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('back')!.key_id)">{{ remoteKey('back')!.name }}</button>
          </div>

          <div class="remote-main-row">
            <div class="remote-side-stack">
              <button v-if="remoteKey('volume_up')" class="remote-key tall-key" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('volume_up')!.key_id)">{{ remoteKey('volume_up')!.name }}</button>
              <button v-if="remoteKey('volume_down')" class="remote-key tall-key" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('volume_down')!.key_id)">{{ remoteKey('volume_down')!.name }}</button>
              <button v-if="remoteKey('mute')" class="remote-key" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('mute')!.key_id)">{{ remoteKey('mute')!.name }}</button>
            </div>

            <div class="remote-dpad">
              <span></span>
              <button v-if="remoteKey('up')" class="remote-key dpad-key" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('up')!.key_id)">{{ remoteKey('up')!.name }}</button>
              <span></span>
              <button v-if="remoteKey('left')" class="remote-key dpad-key" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('left')!.key_id)">{{ remoteKey('left')!.name }}</button>
              <button v-if="remoteKey('ok')" class="remote-key ok-key" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('ok')!.key_id)">{{ remoteKey('ok')!.name }}</button>
              <button v-if="remoteKey('right')" class="remote-key dpad-key" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('right')!.key_id)">{{ remoteKey('right')!.name }}</button>
              <span></span>
              <button v-if="remoteKey('down')" class="remote-key dpad-key" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('down')!.key_id)">{{ remoteKey('down')!.name }}</button>
              <span></span>
            </div>

            <div class="remote-side-stack">
              <button v-if="remoteKey('channel_up')" class="remote-key tall-key" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('channel_up')!.key_id)">{{ remoteKey('channel_up')!.name }}</button>
              <button v-if="remoteKey('channel_down')" class="remote-key tall-key" :disabled="executingCap === 'ir_press'" @click="$emit('executeIrKey', remoteKey('channel_down')!.key_id)">{{ remoteKey('channel_down')!.name }}</button>
            </div>
          </div>

          <div v-if="numberKeys.length > 0" class="remote-number-grid">
            <button
              v-for="key in numberKeys"
              :key="key.key_id"
              class="remote-key number-key"
              :disabled="executingCap === 'ir_press'"
              @click="$emit('executeIrKey', key.key_id)"
            >{{ key.name }}</button>
          </div>
        </div>
      </div>

      <div v-if="isAdbDevice" class="cap-group">
        <h3 class="cap-group-title">{{ label('应用', 'Apps') }}</h3>
        <button class="app-browser-btn" @click="$emit('openAppBrowser')">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
          {{ label('浏览已安装应用', 'Browse Installed Apps') }}
        </button>
      </div>

      <div v-if="miActionCaps.length > 0" class="cap-group">
        <h3 class="cap-group-title">Mi · {{ miActionCaps.length }}</h3>
        <div class="cap-cards">
          <div v-for="cap in miActionCaps" :key="cap.name" class="cap-card-wrapper">
            <div class="cap-card card-action" :class="{ 'cap-executing': executingCap === cap.name }" @click="cap.type !== 'string' && $emit('executeCapability', cap)">
              <div class="cap-card-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
              </div>
              <div class="cap-card-body">
                <span class="cap-card-name">{{ executingCap === cap.name ? label('发送中…', 'Sending…') : cap.name }}</span>
                <span v-if="cap.type" class="cap-card-type">{{ cap.type }}</span>
              </div>
            </div>
            <div v-if="cap.type === 'string'" class="cap-text-input-row">
              <input
                :value="textInputs[cap.name] ?? ''"
                type="text"
                class="cap-text-input"
                :placeholder="label('输入文本…', 'Enter text…')"
                @input="$emit('updateTextInput', cap.name, ($event.target as HTMLInputElement).value)"
                @click.stop
                @keydown.enter.stop="$emit('executeCapability', cap)"
              />
              <button class="cap-send-btn" :disabled="executingCap === cap.name || !textInputs[cap.name]" @click.stop="$emit('executeCapability', cap)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="miPropertyCaps.length > 0" class="cap-group">
        <h3 class="cap-group-title">Mi · {{ miPropertyCaps.length }}</h3>
        <div class="cap-cards">
          <div v-for="cap in miPropertyCaps" :key="cap.name" class="cap-card card-property">
            <div class="cap-card-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            </div>
            <div class="cap-card-body">
              <span class="cap-card-name">{{ cap.name }}</span>
              <span v-if="cap.type" class="cap-card-type">{{ cap.type }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="adbCaps.length > 0" class="cap-group">
        <h3 class="cap-group-title">ADB · {{ adbCaps.length }}</h3>
        <div class="cap-cards">
          <div v-for="cap in adbCaps" :key="cap.name" class="cap-card-wrapper">
            <div class="cap-card card-action" :class="{ 'cap-executing': executingCap === cap.name, 'card-cap-disabled': cap.type === 'string' }" @click="cap.type !== 'string' && $emit('executeCapability', cap)">
              <div class="cap-card-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
              </div>
              <div class="cap-card-body">
                <span class="cap-card-name">{{ executingCap === cap.name ? label('发送中…', 'Sending…') : cap.name }}</span>
                <span v-if="cap.type" class="cap-card-type">{{ cap.type }}</span>
              </div>
            </div>
            <div v-if="cap.type === 'string'" class="cap-text-input-row">
              <input
                :value="textInputs[cap.name] ?? ''"
                type="text"
                class="cap-text-input"
                :placeholder="label('输入文本…', 'Enter text…')"
                @input="$emit('updateTextInput', cap.name, ($event.target as HTMLInputElement).value)"
                @click.stop
                @keydown.enter.stop="$emit('executeCapability', cap)"
              />
              <button class="cap-send-btn" :disabled="executingCap === cap.name || !textInputs[cap.name]" @click.stop="$emit('executeCapability', cap)">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="execHistory.length > 0" class="cap-group">
        <h3 class="cap-group-title">{{ label('执行历史', 'History') }} · {{ execHistory.length }}</h3>
        <div class="exec-history">
          <div v-for="(entry, i) in execHistory" :key="i" class="history-item" :class="entry.result.startsWith('失败') || entry.result.startsWith('Failed') ? 'history-fail' : 'history-ok'">
            <div class="history-head">
              <span class="history-cap">{{ entry.capability }}</span>
              <span class="history-time">{{ entry.time }}</span>
            </div>
            <div class="history-detail">
              <span v-if="entry.params" class="history-params">{{ label('参数: ', 'Params: ') }}<code>{{ entry.params }}</code></span>
              <span class="history-result">{{ entry.result }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.capabilities-section {
  padding: 36px 44px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
}

.section-head h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: var(--text-primary);
}

.refresh-caps-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
  font-size: 16px;
  font-weight: 800;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.refresh-caps-btn:hover:not(:disabled) {
  border-color: #10b981;
  color: #10b981;
  background: #fff;
  box-shadow: 0 6px 16px rgba(16, 185, 129, 0.12);
}

.no-mi, .no-caps, .caps-loading, .caps-error {
  text-align: center;
  padding: 48px 0;
  color: var(--text-tertiary);
  font-weight: 700;
  font-size: 16px;
  opacity: 0.6;
}

.caps-error {
  color: #ef4444;
  opacity: 1;
}

.caps-loading {
  opacity: 0.4;
}

.clickable-loading {
  cursor: pointer;
}

.caps-grid {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.cap-group-title {
  margin: 0 0 16px;
  font-size: 15px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  opacity: 0.6;
}

.cap-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.cap-group-head .cap-group-title {
  margin-bottom: 0;
}

.mini-refresh-btn {
  min-height: 30px;
  padding: 6px 10px;
  border: 1px solid rgba(99, 102, 241, 0.22);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
  color: #6366f1;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.mini-refresh-btn:disabled {
  cursor: wait;
  opacity: 0.5;
}

.cap-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.cap-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-radius: 16px;
  border: 1px solid rgba(229, 231, 235, 0.6);
  background: rgba(255, 255, 255, 0.7);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  min-width: 140px;
  cursor: pointer;
}

.card-action.cap-executing {
  opacity: 0.5;
  pointer-events: none;
}

.cap-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
}

.cap-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex-shrink: 0;
}

.card-action .cap-card-icon {
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
}

.card-action {
  border-color: rgba(99, 102, 241, 0.15);
}

.card-action:hover {
  border-color: rgba(99, 102, 241, 0.3);
  background: rgba(255, 255, 255, 0.95);
}

.card-property .cap-card-icon {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
}

.card-property {
  border-color: rgba(16, 185, 129, 0.15);
}

.card-property:hover {
  border-color: rgba(16, 185, 129, 0.3);
  background: rgba(255, 255, 255, 0.95);
}

.cap-card-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cap-card-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.cap-card-type {
  font-size: 14px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  opacity: 0.6;
}

.remote-control-pad {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(520px, 100%);
}

.remote-row,
.remote-main-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.remote-top-row {
  flex-wrap: wrap;
}

.remote-main-row {
  justify-content: space-between;
}

.remote-side-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 92px;
}

.remote-dpad {
  display: grid;
  grid-template-columns: repeat(3, 64px);
  grid-template-rows: repeat(3, 54px);
  gap: 8px;
  justify-content: center;
}

.remote-number-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(44px, 58px));
  gap: 8px;
}

.remote-key {
  min-width: 58px;
  min-height: 42px;
  padding: 8px 12px;
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.76);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}

.remote-key:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.4);
  transform: translateY(-1px);
}

.remote-key:active:not(:disabled) {
  transform: translateY(0);
  background: rgba(99, 102, 241, 0.2);
}

.remote-key:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.key-danger {
  border-color: rgba(239, 68, 68, 0.24);
  color: #dc2626;
}

.tall-key {
  width: 100%;
}

.dpad-key,
.ok-key {
  width: 64px;
  height: 54px;
  padding: 0;
}

.ok-key {
  border-color: rgba(16, 185, 129, 0.28);
  background: rgba(16, 185, 129, 0.1);
  color: #047857;
}

.number-key {
  min-width: 0;
  padding-inline: 8px;
}

.app-browser-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px;
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.7);
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.app-browser-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(99, 102, 241, 0.1);
}

.exec-feedback {
  padding: 12px 20px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 700;
  animation: fadeIn 0.2s ease;
}

.exec-success {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.exec-error {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.cap-card-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cap-text-input-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.cap-text-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 10px;
  font-size: 16px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-primary);
  outline: none;
  transition: all 0.2s;
  min-width: 120px;
}

.cap-text-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.cap-text-input::placeholder {
  color: var(--text-tertiary);
  opacity: 0.4;
}

.cap-send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 10px;
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.cap-send-btn:hover:not(:disabled) {
  background: #6366f1;
  color: #fff;
  border-color: #6366f1;
}

.cap-send-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.exec-history {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}

.history-item {
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(229, 231, 235, 0.5);
  background: rgba(255, 255, 255, 0.5);
  transition: background 0.2s;
}

.history-item:hover {
  background: rgba(255, 255, 255, 0.8);
}

.history-ok {
  border-left: 3px solid #10b981;
}

.history-fail {
  border-left: 3px solid #ef4444;
}

.history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.history-cap {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.history-time {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-tertiary);
  opacity: 0.5;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.history-detail {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.history-params {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.history-params code {
  background: rgba(99, 102, 241, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 15px;
  color: #6366f1;
}

.history-result {
  font-size: 15px;
  font-weight: 700;
}

.history-ok .history-result {
  color: #10b981;
}

.history-fail .history-result {
  color: #ef4444;
}
</style>
