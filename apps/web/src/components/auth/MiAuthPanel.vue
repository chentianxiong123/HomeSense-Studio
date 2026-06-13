<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { api, type AuthStatus, type MiDeviceCandidate, type UserDevice } from '@/api'
import MiCandidateList from './MiCandidateList.vue'

type LabelFn = (zh: string, en: string) => string
type MiStatusSummary = { loggedIn: boolean; boundCount: number }

const props = defineProps<{
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'status-change', value: MiStatusSummary): void
  (event: 'error', value: string): void
  (event: 'success', value: string): void
}>()

const auth = ref<AuthStatus | null>(null)
const devices = ref<UserDevice[]>([])
const candidates = ref<MiDeviceCandidate[]>([])
const candidatesLoaded = ref(false)
const qrDialogOpen = ref(false)
const candidatesDialogOpen = ref(false)
const busy = ref<Record<string, boolean>>({})
const qrPolling = ref(false)
const qrStatusMessage = ref('')

let qrPollTimer: ReturnType<typeof setInterval> | null = null

const authData = computed(() => auth.value?.data)
const authDataRecord = computed(() => authData.value as (AuthStatus['data'] & Record<string, unknown>) | undefined)
const loggedIn = computed(() => Boolean(authData.value?.logged_in))
const tokenValid = computed(() => authData.value?.token_valid !== false && loggedIn.value)
const miUser = computed(() => authData.value?.user_id || label('未连接', 'Not connected'))
const qrImage = computed(() => getString(authData.value?.qr?.qr_image) || getString(authDataRecord.value?.qr_image))
const qrLink = computed(() =>
  getString(authData.value?.qr?.login_url) ||
  getString(authDataRecord.value?.qr_url) ||
  getString(authDataRecord.value?.login_url) ||
  getString(authData.value?.qr_url) ||
  getString(authData.value?.qr?.lp_url) ||
  getString(authDataRecord.value?.status_url),
)
const miBoundCount = computed(() => devices.value.filter((device) => typeof device.props?.mi_did === 'string' && device.props.mi_did).length)

function label(zh: string, en: string) {
  return props.label(zh, en)
}

function setBusy(key: string, value: boolean) {
  const next = { ...busy.value }
  if (value) next[key] = true
  else delete next[key]
  busy.value = next
}

function isBusy(key: string) {
  return Boolean(busy.value[key])
}

function emitStatus() {
  emit('status-change', { loggedIn: loggedIn.value, boundCount: miBoundCount.value })
}

async function refresh() {
  await Promise.allSettled([loadAuthStatus(), loadDevices()])
  emitStatus()
}

async function loadAuthStatus(options?: { refresh?: boolean }) {
  setBusy('mi-status', true)
  try {
    auth.value = await api.auth.status(options)
    emitStatus()
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy('mi-status', false)
  }
}

async function refreshMiStatus() {
  await loadAuthStatus({ refresh: true })
}

async function loadDevices() {
  setBusy('devices', true)
  try {
    const deviceResult = await api.userDevices.list()
    devices.value = deviceResult.devices ?? []
    emitStatus()
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy('devices', false)
  }
}

async function startMiQrLogin() {
  stopQrPolling()
  setBusy('mi-login', true)
  qrStatusMessage.value = ''
  qrDialogOpen.value = true
  try {
    auth.value = await api.auth.qrStart()
    qrStatusMessage.value = auth.value.data?.message || label('请使用米家 App 扫码', 'Scan with Mi Home')
    emitStatus()
    if (qrImage.value || qrLink.value) {
      qrPolling.value = true
      qrPollTimer = setInterval(() => {
        void pollMiQrStatus()
      }, 3000)
    }
  } catch (error) {
    emit('error', (error as Error).message || String(error))
    await loadAuthStatus()
  } finally {
    setBusy('mi-login', false)
  }
}

async function pollMiQrStatus() {
  try {
    const result = await api.auth.qrStatus()
    const payload = result.data as (AuthStatus['data'] & Record<string, unknown>) | undefined
    if (result.status === 'success' && payload?.logged_in) {
      auth.value = result
      qrStatusMessage.value = payload?.message || label('已登录', 'Logged in')
      stopQrPolling()
      await refresh()
      emit('success', label('Mi 登录成功', 'Mi login succeeded'))
      return
    }
    if (result.status === 'error') {
      qrStatusMessage.value = result.message || payload?.message || label('二维码已失效', 'QR code expired')
      stopQrPolling()
      return
    }
    qrStatusMessage.value = payload?.message || result.message || label('等待扫码确认', 'Waiting for confirmation')
  } catch (error) {
    qrStatusMessage.value = (error as Error).message || String(error)
    stopQrPolling()
  }
}

function stopQrPolling() {
  qrPolling.value = false
  if (qrPollTimer) {
    clearInterval(qrPollTimer)
    qrPollTimer = null
  }
}

async function resetMiQr() {
  stopQrPolling()
  setBusy('mi-reset', true)
  try {
    const result = await api.auth.qrReset()
    qrStatusMessage.value = result.data?.message || label('已重置二维码状态', 'QR state reset')
    await loadAuthStatus()
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy('mi-reset', false)
  }
}

async function logoutMi() {
  stopQrPolling()
  setBusy('mi-logout', true)
  try {
    auth.value = await api.auth.logout()
    candidates.value = []
    candidatesLoaded.value = false
    qrStatusMessage.value = ''
    emitStatus()
    emit('success', label('Mi 已退出', 'Mi logged out'))
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy('mi-logout', false)
  }
}

async function loadMiCandidates(refresh = false) {
  candidatesDialogOpen.value = true
  setBusy('mi-candidates', true)
  try {
    const result = await api.userDevices.miCandidates({ refresh })
    candidates.value = result.devices ?? []
    candidatesLoaded.value = true
  } catch (error) {
    emit('error', (error as Error).message || String(error))
  } finally {
    setBusy('mi-candidates', false)
  }
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

onUnmounted(stopQrPolling)

defineExpose({ refresh, stopQrPolling })
</script>

<template>
  <section class="detail-surface">
    <div class="detail-head">
      <div>
        <span class="eyebrow">{{ label('外部账号', 'External') }}</span>
        <h2>Mi</h2>
      </div>
      <span :class="['pill', loggedIn ? 'ok' : 'muted']">
        {{ loggedIn ? label('已登录', 'Logged in') : label('未登录', 'Logged out') }}
      </span>
    </div>

    <div class="mi-account compact">
      <div class="account-main">
        <span class="field-label">{{ label('账号', 'Account') }}</span>
        <strong>{{ miUser }}</strong>
        <span class="compact-line">{{ miBoundCount }} {{ label('台设备已绑定', 'bound devices') }}</span>
      </div>
      <div class="account-actions">
        <button class="plain-btn" :disabled="isBusy('mi-status')" @click="refreshMiStatus">{{ label('检查', 'Check') }}</button>
        <button class="primary-btn" :disabled="isBusy('mi-login')" @click="startMiQrLogin">
          {{ isBusy('mi-login') ? label('生成中', 'Starting') : label('扫码登录', 'QR Login') }}
        </button>
        <button class="plain-btn" :disabled="isBusy('mi-candidates')" @click="loadMiCandidates(false)">
          {{ isBusy('mi-candidates') ? label('发现中', 'Discovering') : label('发现设备', 'Discover') }}
        </button>
        <button v-if="loggedIn" class="danger-btn" :disabled="isBusy('mi-logout')" @click="logoutMi">{{ label('退出', 'Logout') }}</button>
      </div>
    </div>

    <div class="simple-status">
      <span>{{ authData?.message || label('状态来自 mi-cli', 'Status from mi-cli') }}</span>
      <span v-if="!tokenValid && loggedIn">{{ label('需要重新检查登录状态', 'Login should be checked again') }}</span>
    </div>

    <div v-if="qrDialogOpen" class="modal-backdrop" @click.self="qrDialogOpen = false">
      <section class="mi-modal">
        <div class="modal-head">
          <div>
            <span class="eyebrow">Mi</span>
            <h3>{{ label('扫码登录', 'QR Login') }}</h3>
          </div>
          <button class="icon-btn" @click="qrDialogOpen = false">×</button>
        </div>
        <div class="qr-row">
          <div class="qr-frame">
            <img v-if="qrImage" :src="qrImage" alt="Mi QR Code" />
            <a v-else-if="qrLink" :href="qrLink" target="_blank" rel="noreferrer">{{ label('打开二维码链接', 'Open QR link') }}</a>
            <span v-else>{{ loggedIn ? label('当前无需扫码', 'No QR needed') : label('未生成二维码', 'No QR generated') }}</span>
          </div>
          <div class="qr-copy">
            <strong>{{ loggedIn ? label('米家账号已连接', 'Mi account connected') : label('请使用米家 App 扫码', 'Scan with Mi Home') }}</strong>
            <span>{{ qrStatusMessage || authData?.message || label('等待 mi-cli 返回状态', 'Waiting for mi-cli status') }}</span>
            <span v-if="qrPolling" class="polling-text">{{ label('轮询中', 'Polling') }}</span>
            <button v-if="qrPolling || qrImage || qrLink" class="plain-btn" :disabled="isBusy('mi-reset')" @click="resetMiQr">
              {{ label('重置二维码', 'Reset QR') }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <div v-if="candidatesDialogOpen" class="modal-backdrop" @click.self="candidatesDialogOpen = false">
      <section class="mi-modal wide">
        <div class="modal-head">
          <div>
            <span class="eyebrow">Mi</span>
            <h3>{{ label('发现设备', 'Discover Devices') }}</h3>
          </div>
          <button class="icon-btn" @click="candidatesDialogOpen = false">×</button>
        </div>
        <MiCandidateList
          :candidates="candidates"
          :loaded="candidatesLoaded"
          :loading="isBusy('mi-candidates')"
          :label="label"
          @load="loadMiCandidates(false)"
          @refresh="loadMiCandidates(true)"
        />
      </section>
    </div>
  </section>
</template>

<style scoped>
.detail-surface {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.detail-head,
.mi-account,
.qr-row,
.account-actions,
.token-line,
.modal-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-head,
.mi-account,
.modal-head {
  justify-content: space-between;
}

.eyebrow {
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
}

h2 {
  margin: 5px 0 0;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 900;
}

.mi-account,
.qr-row {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  background: #fff;
}

.mi-account.compact {
  align-items: center;
}

.account-main,
.qr-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.account-main strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
}

.field-label,
.token-line,
.qr-copy span,
.compact-line,
.simple-status {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.simple-status {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
}

.mi-modal {
  width: min(620px, 100%);
  max-height: min(86vh, 720px);
  overflow-y: auto;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 12px;
  background: #fff;
  padding: 22px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
}

.mi-modal.wide {
  width: min(920px, 100%);
}

.modal-head {
  margin-bottom: 16px;
}

.modal-head h3 {
  margin: 4px 0 0;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 900;
}

.icon-btn {
  width: 34px;
  height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #334155;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.qr-row {
  justify-content: flex-start;
}

.qr-frame {
  width: 164px;
  min-height: 164px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  text-align: center;
}

.qr-frame img {
  width: 138px;
  height: 138px;
  border-radius: 6px;
  background: #fff;
}

.qr-frame a,
.qr-frame span {
  color: #0f766e;
  font-size: 13px;
  font-weight: 900;
  overflow-wrap: anywhere;
}

.polling-text {
  color: #2563eb;
}

.pill {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 900;
}

.pill.ok,
.ok {
  background: #10b981;
  color: #fff;
}

.pill.muted {
  background: #f4f4f5;
  color: #71717a;
}

.plain-btn,
.primary-btn,
.danger-btn {
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0 12px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.primary-btn {
  border-color: #0f766e;
  background: #0f766e;
  color: #fff;
}

.danger-btn {
  border-color: #fecaca;
  color: #b91c1c;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 760px) {
  .detail-head,
  .mi-account,
  .qr-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .qr-frame {
    width: 100%;
  }

  .account-actions {
    width: 100%;
  }

  .account-actions button {
    flex: 1 1 120px;
  }
}
</style>
