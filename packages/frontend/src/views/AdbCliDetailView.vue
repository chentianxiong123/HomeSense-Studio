<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api'
import { useLocale } from '@/composables/useLocale'

const router = useRouter()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

interface AdbDevice {
  address?: string
  model?: string
  name?: string
  serial?: string
  state?: string
  device?: string
  status?: string
}

const loading = ref('')
const errorMessage = ref('')
const successMessage = ref('')
const adbList = ref<AdbDevice[]>([])
const selectedAddress = ref<string | null>(null)
const connectAddress = ref('')

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

function showSuccess(msg: string) {
  successMessage.value = msg
  setTimeout(() => { successMessage.value = '' }, 3000)
}

function showError(msg: string) {
  errorMessage.value = msg
  setTimeout(() => { errorMessage.value = '' }, 5000)
}

onMounted(async () => {
  await fetchList()
})

async function fetchList() {
  loading.value = 'list'
  errorMessage.value = ''
  try {
    const r = await api.adbDevices.list()
    const raw = r.devices || []
    adbList.value = raw.map((d: any) => {
      return {
        address: d.address || '',
        name: d.name || '',
        model: d.model || d.info || '',
        state: d.status || d.state || 'unknown',
      }
    })
    showSuccess(label('已刷新', 'Refreshed'))
  } catch (e: any) {
    showError(e.message)
  } finally {
    loading.value = ''
  }
}

async function connect(addr: string): Promise<boolean> {
  const target = normalizeAddress(addr)
  loading.value = `connect:${target}`
  errorMessage.value = ''
  try {
    const r = await api.adbDevices.connect(target)
    if ((r as any)?.status === 'error') {
      throw new Error((r as any)?.message || (r as any)?.error || 'Connect failed')
    }
    const msg = (r as any)?.data?.message || (r as any)?.message || ''
    await fetchList()
    showSuccess(msg || label(`已连接 ${target}`, `Connected ${target}`))
    return true
  } catch (e: any) {
    showError(e.message)
    return false
  } finally {
    loading.value = ''
  }
}

async function disconnect(addr: string) {
  const target = normalizeAddress(addr)
  loading.value = `disconnect:${target}`
  errorMessage.value = ''
  try {
    await api.adbDevices.disconnect(target)
    await fetchList()
    if (selectedAddress.value === target) selectedAddress.value = null
    showSuccess(label(`已断开 ${target}`, `Disconnected ${target}`))
  } catch (e: any) {
    showError(e.message)
  } finally {
    loading.value = ''
  }
}

function normalizeAddress(addr: string): string {
  addr = addr.trim()
  if (!addr.includes(':')) return `${addr}:5555`
  return addr
}

async function addManual() {
  const raw = connectAddress.value.trim()
  if (!raw) {
    showError(label('请输入 IP 地址', 'Enter IP address'))
    return
  }
  const addr = normalizeAddress(raw)
  const ok = await connect(addr)
  if (ok) {
    connectAddress.value = ''
  }
}

function deviceKey(d: AdbDevice): string {
  return normalizeAddress(d.address || d.serial || '')
}

const isBusy = (key: string) => loading.value === key

function selectDevice(addr: string) {
  selectedAddress.value = selectedAddress.value === normalizeAddress(addr) ? null : normalizeAddress(addr)
}

function deviceStatus(d: AdbDevice): string {
  return d.state || d.status || 'unknown'
}

function isOnline(d: AdbDevice): boolean {
  const s = deviceStatus(d).toLowerCase()
  return s === 'device' || s === 'online' || s === 'connected'
}
</script>

<template>
  <div class="detail-page">
    <!-- Header -->
    <header class="page-head glass-panel">
      <button class="back-btn" @click="router.push('/integrations')">← {{ label('返回', 'Back') }}</button>
      <div class="header-content">
        <div class="header-main">
          <span class="eyebrow">adb-cli</span>
          <h1>{{ label('ADB 连接列表', 'ADB Connections') }}</h1>
          <p>{{ label('管理 Android ADB 调试连接。', 'Manage Android ADB debug connections.') }}</p>
        </div>
        <button class="secondary-btn" @click="fetchList" :disabled="loading === 'list'">
          {{ loading === 'list' ? label('刷新中...', 'Refreshing...') : label('刷新', 'Refresh') }}
        </button>
      </div>
    </header>

    <!-- Success -->
    <Transition name="fade">
      <section v-if="successMessage" class="msg-box success">
        <span class="msg-icon">✓</span>
        <span>{{ successMessage }}</span>
      </section>
    </Transition>

    <!-- Error -->
    <Transition name="fade">
      <section v-if="errorMessage" class="msg-box error">
        <span class="msg-icon">⚠️</span>
        <span>{{ errorMessage }}</span>
      </section>
    </Transition>

    <!-- Add Connection -->
    <section class="section-card glass-panel">
      <div class="card-header">
        <div class="card-header-left">
          <span class="card-icon">➕</span>
          <div>
            <h3>{{ label('添加连接', 'Add Connection') }}</h3>
            <p class="card-desc">{{ label('输入 IP 地址手动连接', 'Enter IP address to connect') }}</p>
          </div>
        </div>
      </div>
      <div class="add-row">
        <input
          v-model="connectAddress"
          class="styled-input"
          :placeholder="label('192.168.1.100:5555', '192.168.1.100:5555')"
          @keyup.enter="addManual"
        />
        <button class="primary-btn" @click="addManual" :disabled="!connectAddress.trim() || loading.startsWith('connect')">
          <span v-if="loading.startsWith('connect')" class="spinner" style="border-top-color:#fff;border-color:rgba(255,255,255,0.3)"></span>
          {{ loading.startsWith('connect') ? label('连接中...', 'Connecting...') : label('连接', 'Connect') }}
        </button>
      </div>
    </section>

    <!-- Connection List -->
    <section class="section-card glass-panel">
      <div class="card-header">
        <div class="card-header-left">
          <span class="card-icon">📡</span>
          <div>
            <h3>{{ label('连接列表', 'Connection List') }}</h3>
            <p class="card-desc">{{ adbList.length ? label(`共 ${adbList.length} 个连接`, `${adbList.length} connections`) : label('暂无连接', 'No connections') }}</p>
          </div>
        </div>
      </div>

      <div v-if="!adbList.length && loading !== 'list'" class="empty-result">
        <span class="empty-icon">⎚</span>
        <p>{{ label('尚无 ADB 连接。点击"刷新"扫描或手动添加。', 'No ADB connections. Refresh or add manually.') }}</p>
      </div>

      <div v-if="loading === 'list'" class="empty-result">
        <span class="spinner large"></span>
        <p>{{ label('扫描中...', 'Scanning...') }}</p>
      </div>

      <div v-if="adbList.length" class="list-container">
        <div
          v-for="d in adbList"
          :key="deviceKey(d)"
          :class="['conn-row', { expanded: selectedAddress === deviceKey(d) }]"
          @click="selectDevice(deviceKey(d))"
        >
          <div class="conn-main">
            <span class="conn-indicator" :class="isOnline(d) ? 'online' : 'offline'"></span>
            <div class="conn-info">
              <strong class="conn-address">{{ d.address || d.serial || '-' }}</strong>
              <span class="conn-meta">
                {{ d.model || d.name || d.device || '' }}
                <span v-if="d.model && d.state" class="conn-sep">·</span>
                <span :class="['conn-state', isOnline(d) ? 'online' : 'offline']">{{ d.state || d.status || 'unknown' }}</span>
              </span>
            </div>
            <div class="conn-actions" @click.stop>
              <button
                v-if="isOnline(d)"
                class="action-btn disconnect"
                @click="disconnect(deviceKey(d))"
                :disabled="loading === `disconnect:${deviceKey(d)}`"
                :title="label('断开', 'Disconnect')"
              >
                <span v-if="loading === `disconnect:${deviceKey(d)}`" class="spinner"></span>
                {{ loading === `disconnect:${deviceKey(d)}` ? label('断开中...', 'DC...') : label('断开', 'DC') }}
              </button>
              <button
                v-else
                class="action-btn connect"
                @click="connect(deviceKey(d))"
                :disabled="loading === `connect:${deviceKey(d)}`"
                :title="label('连接', 'Connect')"
              >
                <span v-if="loading === `connect:${deviceKey(d)}`" class="spinner"></span>
                {{ loading === `connect:${deviceKey(d)}` ? label('连接中...', 'CON...') : label('连接', 'CON') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.detail-page {
  height: 100%;
  overflow-y: auto;
  padding: 40px;
  background: #f7f9fa;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

/* ── Glass ── */
.glass-panel {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.glass-panel:hover {
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.05);
}

/* ── Page Head ── */
.page-head {
  padding: 36px 40px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.back-btn {
  align-self: flex-start;
  padding: 8px 20px;
  height: 38px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-primary);
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 12px;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.3s;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.back-btn:hover {
  border-color: #10b981;
  color: #10b981;
  background: #fff;
  transform: translateY(-2px);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}

.eyebrow {
  display: inline-block;
  color: #10b981;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 12px;
  border-radius: 8px;
  margin-bottom: 12px;
}

h1 {
  margin: 0;
  font-size: 32px;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: var(--text-primary);
  line-height: 1.1;
}

.page-head p {
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.6;
  font-weight: 600;
  max-width: 600px;
  margin-top: 12px;
}

/* ── Section Card ── */
.section-card {
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.card-header-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.card-icon {
  font-size: 24px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.6);
  border-radius: 12px;
  border: 1px solid rgba(229, 231, 235, 0.4);
}

.card-header h3 {
  font-size: 15px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  margin: 0;
}

.card-desc {
  font-size: 16px;
  color: var(--text-tertiary);
  font-weight: 600;
  margin: 4px 0 0;
}

/* ── Add Row ── */
.add-row {
  display: flex;
  gap: 12px;
  align-items: center;
}
.add-row .styled-input {
  flex: 1;
  max-width: 400px;
}

.styled-input {
  min-height: 44px;
  border: 1px solid rgba(229, 231, 235, 0.6);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.6);
  padding: 0 18px;
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  outline: none;
  transition: all 0.3s;
  box-sizing: border-box;
}
.styled-input:focus {
  border-color: #10b981;
  background: #fff;
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.1);
}

/* ── Connection List ── */
.list-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conn-row {
  border: 1px solid rgba(229, 231, 235, 0.3);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.3);
  cursor: pointer;
  transition: all 0.25s;
  overflow: hidden;
}
.conn-row:hover {
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(16, 185, 129, 0.2);
}
.conn-row.expanded {
  border-color: #10b981;
  background: rgba(255, 255, 255, 0.7);
}

.conn-main {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
}

.conn-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #94a3b8;
  flex-shrink: 0;
}
.conn-indicator.online {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
}
.conn-indicator.offline {
  background: #ef4444;
}

.conn-info {
  flex: 1;
  min-width: 0;
}

.conn-address {
  display: block;
  font-size: 15px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.conn-meta {
  display: block;
  font-size: 16px;
  color: var(--text-tertiary);
  font-weight: 600;
  margin-top: 4px;
}

.conn-sep {
  margin: 0 6px;
  opacity: 0.3;
}

.conn-state.online { color: #10b981; }
.conn-state.offline { color: #ef4444; }

.conn-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.action-btn {
  padding: 6px 14px;
  height: 32px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  border: 1px solid;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  transition: all 0.25s;
}
.action-btn.connect {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.2);
  color: #10b981;
}
.action-btn.connect:hover:not(:disabled) {
  background: #10b981;
  color: #fff;
}
.action-btn.disconnect {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}
.action-btn.disconnect:hover:not(:disabled) {
  background: #ef4444;
  color: #fff;
}

/* ── Buttons ── */
.primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 28px;
  height: 44px;
  background: #10b981;
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 900;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.2);
  transition: all 0.3s;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.primary-btn:hover:not(:disabled) {
  background: #059669;
  transform: translateY(-3px);
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.3);
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px;
  height: 44px;
  background: rgba(255, 255, 255, 0.7);
  color: var(--text-primary);
  border: 1px solid rgba(229, 231, 235, 0.6);
  border-radius: 12px;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.3s;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.secondary-btn:hover:not(:disabled) {
  border-color: #10b981;
  color: #10b981;
  background: #fff;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(16, 185, 129, 0.08);
}

/* ── Spinner ── */
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0,0,0,0.1);
  border-top-color: #10b981;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
.spinner.large {
  width: 24px;
  height: 24px;
  border-width: 3px;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Message ── */
.msg-box {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 22px;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 700;
  backdrop-filter: blur(16px);
}
.msg-box.error {
  background: rgba(254, 242, 242, 0.85);
  border: 1px solid rgba(239, 68, 68, 0.15);
  color: #ef4444;
}
.msg-box.success {
  background: rgba(236, 253, 245, 0.85);
  border: 1px solid rgba(16, 185, 129, 0.15);
  color: #10b981;
}
.msg-icon { font-size: 16px; }

/* ── Empty ── */
.empty-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px;
  color: var(--text-tertiary);
}
.empty-icon { font-size: 32px; opacity: 0.3; }
.empty-result p { font-size: 15px; font-weight: 600; margin: 0; }

/* ── Transition ── */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>