<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, type AuthStatus, type MiDeviceCandidate, type UserDevice } from '@/api'
import { useLocale } from '@/composables/useLocale'

type AuthTab = 'external' | 'local'
type ExternalProviderId = 'mi' | 'bilibili'
type LocalProviderId = 'adb' | 'streaming' | 'ssh' | 'frp' | 'smb'

type ProviderTone = 'ok' | 'warn' | 'bad' | 'muted'

const router = useRouter()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

const activeTab = ref<AuthTab>('external')
const selectedExternal = ref<ExternalProviderId>('mi')
const selectedLocal = ref<LocalProviderId>('adb')

const auth = ref<AuthStatus | null>(null)
const devices = ref<UserDevice[]>([])
const candidates = ref<MiDeviceCandidate[]>([])
const candidatesLoaded = ref(false)
const adbFormOpen = ref(false)
const editingAdbDevice = ref<UserDevice | null>(null)
const formName = ref('')
const formAdbAddress = ref('')

const busy = ref<Record<string, boolean>>({})
const errorMessage = ref('')
const successMessage = ref('')
const qrPolling = ref(false)
const qrStatusMessage = ref('')
let qrPollTimer: ReturnType<typeof setInterval> | null = null
let successTimer: ReturnType<typeof setTimeout> | null = null

function label(zh: string, en: string) {
  return isZh.value ? zh : en
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

function showSuccess(message: string) {
  successMessage.value = message
  if (successTimer) clearTimeout(successTimer)
  successTimer = setTimeout(() => {
    successMessage.value = ''
  }, 2600)
}

const anyBusy = computed(() => Object.keys(busy.value).length > 0)
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
const miBoundCount = computed(() => devices.value.filter((device) => device.mi_did).length)
const adbBoundCount = computed(() => devices.value.filter((device) => device.adb_ip?.trim()).length)

const adbRows = computed(() => {
  return [...devices.value]
    .filter((device) => device.adb_ip?.trim())
    .sort((left, right) => left.name.localeCompare(right.name, isZh.value ? 'zh-Hans-CN' : 'en'))
    .map((device) => ({ device }))
})

const externalProviders = computed(() => [
  {
    id: 'mi' as const,
    name: 'Mi',
    subtitle: label('米家账号', 'Mi account'),
    status: loggedIn.value ? label('已登录', 'Logged in') : label('未登录', 'Logged out'),
    tone: loggedIn.value ? 'ok' as const : 'muted' as const,
    meta: `${miBoundCount.value} ${label('台设备', 'devices')}`,
  },
  {
    id: 'bilibili' as const,
    name: 'Bilibili',
    subtitle: label('B 站账号', 'Bilibili account'),
    status: label('待接入', 'Pending'),
    tone: 'muted' as const,
    meta: label('外部账号', 'External'),
  },
])

const localProviders = computed(() => [
  {
    id: 'adb' as const,
    name: 'ADB',
    subtitle: label('Android TV / 盒子', 'Android TV / box'),
    status: adbBoundCount.value > 0 ? label('已配置', 'Configured') : label('未配置', 'Not configured'),
    tone: adbBoundCount.value > 0 ? 'ok' as const : 'muted' as const,
    meta: `${adbBoundCount.value} ${label('个端点', 'endpoints')}`,
  },
  {
    id: 'streaming' as const,
    name: label('串流', 'Streaming'),
    subtitle: 'Sunshine / Moonlight',
    status: label('待接入', 'Pending'),
    tone: 'muted' as const,
    meta: label('局域网', 'Local'),
  },
  {
    id: 'ssh' as const,
    name: 'SSH',
    subtitle: label('主机登录', 'Host login'),
    status: label('待接入', 'Pending'),
    tone: 'muted' as const,
    meta: label('局域网', 'Local'),
  },
  {
    id: 'frp' as const,
    name: 'FRP',
    subtitle: label('内网穿透', 'Tunnel'),
    status: label('待接入', 'Pending'),
    tone: 'muted' as const,
    meta: label('局域网', 'Local'),
  },
  {
    id: 'smb' as const,
    name: 'SMB',
    subtitle: label('共享目录', 'File shares'),
    status: label('待接入', 'Pending'),
    tone: 'muted' as const,
    meta: label('局域网', 'Local'),
  },
])

onMounted(() => {
  void loadAll()
})

onUnmounted(() => {
  stopQrPolling()
  if (successTimer) clearTimeout(successTimer)
})

async function loadAll() {
  await Promise.allSettled([loadAuthStatus(), loadDevices()])
}

async function loadAuthStatus(options?: { refresh?: boolean }) {
  setBusy('mi-status', true)
  errorMessage.value = ''
  try {
    auth.value = await api.auth.status(options)
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy('mi-status', false)
  }
}

async function refreshMiStatus() {
  await loadAuthStatus({ refresh: true })
}

async function loadDevices() {
  setBusy('devices', true)
  errorMessage.value = ''
  try {
    const deviceResult = await api.userDevices.list()
    devices.value = deviceResult.devices ?? []
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy('devices', false)
  }
}

async function openCreateAdbDevice() {
  editingAdbDevice.value = null
  formName.value = ''
  formAdbAddress.value = ''
  adbFormOpen.value = true
}

function openEditAdbDevice(device: UserDevice) {
  editingAdbDevice.value = device
  formName.value = device.name
  formAdbAddress.value = device.adb_ip
  adbFormOpen.value = true
}

function closeAdbForm() {
  adbFormOpen.value = false
  editingAdbDevice.value = null
}

async function submitAdbDevice() {
  const name = formName.value.trim()
  if (!name) return

  const adbAddress = normalizeAdbAddress(formAdbAddress.value)
  if (!adbAddress) return
  const ipAddress = endpointHost(adbAddress)
  const payload = {
    name,
    device_type: editingAdbDevice.value?.device_type ?? 'other',
    room_id: editingAdbDevice.value?.room_id ?? null,
    adb_ip: adbAddress,
    ip_address: ipAddress || editingAdbDevice.value?.ip_address || '',
  }

  const key = editingAdbDevice.value ? `adb-edit-${editingAdbDevice.value.id}` : 'adb-create'
  setBusy(key, true)
  errorMessage.value = ''
  try {
    if (editingAdbDevice.value) {
      await api.userDevices.update(editingAdbDevice.value.id, payload)
      showSuccess(label('ADB 端点已更新', 'ADB endpoint updated'))
    } else {
      await api.userDevices.create(payload)
      showSuccess(label('ADB 端点已添加', 'ADB endpoint added'))
    }
    closeAdbForm()
    await loadDevices()
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy(key, false)
  }
}

async function deleteAdbDevice(device: UserDevice) {
  if (!window.confirm(label(`删除 ADB 端点「${device.name}」？`, `Delete ADB endpoint "${device.name}"?`))) return
  setBusy(`adb-delete-${device.id}`, true)
  errorMessage.value = ''
  try {
    await api.userDevices.delete(device.id)
    await loadDevices()
    showSuccess(label('ADB 端点已删除', 'ADB endpoint deleted'))
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy(`adb-delete-${device.id}`, false)
  }
}

async function startMiQrLogin() {
  stopQrPolling()
  setBusy('mi-login', true)
  errorMessage.value = ''
  qrStatusMessage.value = ''
  try {
    auth.value = await api.auth.qrStart()
    const message = auth.value.data?.message || label('请使用米家 App 扫码', 'Scan with Mi Home')
    qrStatusMessage.value = message

    if (qrImage.value || qrLink.value) {
      qrPolling.value = true
      qrPollTimer = setInterval(() => {
        void pollMiQrStatus()
      }, 2000)
      return
    }

    await loadAuthStatus()
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy('mi-login', false)
  }
}

async function pollMiQrStatus() {
  try {
    const result = await api.auth.qrStatus()
    const payload = result.data as (AuthStatus['data'] & Record<string, unknown>) | undefined
    const rawStatus = String(payload?.status ?? result.status ?? '')

    if (payload?.logged_in || rawStatus === 'success' || rawStatus === 'confirmed') {
      auth.value = result
      qrStatusMessage.value = payload?.message || label('已登录', 'Logged in')
      stopQrPolling()
      await loadAuthStatus()
      return
    }

    if (rawStatus === 'expired' || rawStatus === 'failed' || result.status === 'error') {
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
  errorMessage.value = ''
  try {
    const result = await api.auth.qrReset()
    qrStatusMessage.value = result.data?.message || label('已重置二维码状态', 'QR state reset')
    await loadAuthStatus()
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy('mi-reset', false)
  }
}

async function logoutMi() {
  stopQrPolling()
  setBusy('mi-logout', true)
  errorMessage.value = ''
  try {
    auth.value = await api.auth.logout()
    candidates.value = []
    candidatesLoaded.value = false
    qrStatusMessage.value = ''
    showSuccess(label('Mi 已退出', 'Mi logged out'))
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy('mi-logout', false)
  }
}

async function loadMiCandidates() {
  setBusy('mi-candidates', true)
  errorMessage.value = ''
  try {
    const result = await api.userDevices.miCandidates()
    candidates.value = result.devices ?? []
    candidatesLoaded.value = true
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy('mi-candidates', false)
  }
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeAdbAddress(value: string): string {
  const address = value.trim()
  return address && !address.includes(':') ? `${address}:5555` : address
}

function endpointHost(value: string): string {
  return value.split(':')[0]?.trim() ?? ''
}

</script>

<template>
  <div class="auth-page">
    <header class="page-head">
      <div>
        <span class="eyebrow">{{ label('统一认证与授权', 'Unified Auth') }}</span>
        <h1>{{ label('授权中心', 'Authorization Center') }}</h1>
      </div>
      <div class="head-actions">
        <button class="plain-btn" :disabled="anyBusy" @click="loadAll">{{ label('刷新', 'Refresh') }}</button>
      </div>
    </header>

    <div v-if="errorMessage" class="notice error">{{ errorMessage }}</div>
    <div v-if="successMessage" class="notice success">{{ successMessage }}</div>

    <nav class="scope-tabs" :aria-label="label('授权分类', 'Authorization scope')">
      <button :class="['scope-tab', { active: activeTab === 'external' }]" @click="activeTab = 'external'">
        <strong>{{ label('外部账号', 'External Accounts') }}</strong>
        <span>Mi / Bilibili</span>
      </button>
      <button :class="['scope-tab', { active: activeTab === 'local' }]" @click="activeTab = 'local'">
        <strong>{{ label('局域网账号', 'Local Network') }}</strong>
        <span>ADB / {{ label('串流', 'Streaming') }} / SSH / FRP / SMB</span>
      </button>
    </nav>

    <section v-if="activeTab === 'external'" class="workspace">
      <aside class="provider-rail">
        <button
          v-for="provider in externalProviders"
          :key="provider.id"
          :class="['provider-item', { active: selectedExternal === provider.id }]"
          @click="selectedExternal = provider.id"
        >
          <span :class="['dot', provider.tone]" />
          <strong>{{ provider.name }}</strong>
          <small>{{ provider.subtitle }}</small>
          <em>{{ provider.status }} · {{ provider.meta }}</em>
        </button>
      </aside>

      <section v-if="selectedExternal === 'mi'" class="detail-surface">
        <div class="detail-head">
          <div>
            <span class="eyebrow">{{ label('外部账号', 'External') }}</span>
            <h2>Mi</h2>
          </div>
          <span :class="['pill', loggedIn ? 'ok' : 'muted']">
            {{ loggedIn ? label('已登录', 'Logged in') : label('未登录', 'Logged out') }}
          </span>
        </div>

        <div class="mi-account">
          <div class="account-main">
            <span class="field-label">{{ label('账号', 'Account') }}</span>
            <strong>{{ miUser }}</strong>
            <div class="token-line">
              <span :class="['pill', tokenValid ? 'ok' : 'muted']">{{ tokenValid ? 'Token OK' : label('未验证', 'Unverified') }}</span>
              <span>{{ miBoundCount }} {{ label('台设备绑定 Mi', 'Mi device bindings') }}</span>
            </div>
          </div>
          <div class="account-actions">
            <button class="plain-btn" :disabled="isBusy('mi-status')" @click="refreshMiStatus">{{ label('检查', 'Check') }}</button>
            <button class="primary-btn" :disabled="isBusy('mi-login')" @click="startMiQrLogin">
              {{ isBusy('mi-login') ? label('生成中', 'Starting') : label('扫码登录', 'QR Login') }}
            </button>
            <button v-if="qrPolling || qrImage || qrLink" class="plain-btn" :disabled="isBusy('mi-reset')" @click="resetMiQr">
              {{ label('重置二维码', 'Reset QR') }}
            </button>
            <button class="plain-btn" @click="router.push('/authorizations/mi-cli')">mi-cli</button>
            <button v-if="loggedIn" class="danger-btn" :disabled="isBusy('mi-logout')" @click="logoutMi">{{ label('退出', 'Logout') }}</button>
          </div>
        </div>

        <div class="qr-row">
          <div class="qr-frame">
            <img v-if="qrImage" :src="qrImage" alt="Mi QR Code" />
            <a v-else-if="qrLink" :href="qrLink" target="_blank" rel="noreferrer">{{ label('打开二维码链接', 'Open QR link') }}</a>
            <span v-else>{{ loggedIn ? label('当前无需扫码', 'No QR needed') : label('未生成二维码', 'No QR generated') }}</span>
          </div>
          <div class="qr-copy">
            <strong>{{ loggedIn ? label('米家账号已接管', 'Mi account connected') : label('米家扫码登录', 'Mi QR login') }}</strong>
            <span>{{ qrStatusMessage || authData?.message || label('状态来自 mi-cli', 'Status from mi-cli') }}</span>
            <span v-if="qrPolling" class="polling-text">{{ label('轮询中', 'Polling') }}</span>
          </div>
        </div>

        <section class="subsection">
          <div class="subsection-head">
            <div>
              <strong>{{ label('Mi 候选设备', 'Mi Candidates') }}</strong>
              <small>{{ candidatesLoaded ? `${candidates.length}` : label('按需读取', 'Load on demand') }}</small>
            </div>
            <button class="plain-btn" :disabled="isBusy('mi-candidates')" @click="loadMiCandidates">
              {{ isBusy('mi-candidates') ? label('读取中', 'Loading') : label('读取候选', 'Load') }}
            </button>
          </div>
          <div v-if="!candidatesLoaded" class="empty-line">{{ label('尚未读取。', 'Not loaded yet.') }}</div>
          <div v-else-if="candidates.length === 0" class="empty-line">{{ label('没有候选设备。', 'No candidates.') }}</div>
          <div v-else class="candidate-table">
            <div class="candidate-row header">
              <span>{{ label('名称', 'Name') }}</span>
              <span>{{ label('型号', 'Model') }}</span>
              <span>DID</span>
              <span>{{ label('房间', 'Room') }}</span>
            </div>
            <div v-for="candidate in candidates.slice(0, 12)" :key="candidate.did" class="candidate-row">
              <strong>{{ candidate.name || candidate.did }}</strong>
              <code>{{ candidate.model || '-' }}</code>
              <code>{{ candidate.did }}</code>
              <span>{{ candidate.room_name || '-' }}</span>
            </div>
          </div>
        </section>
      </section>

      <section v-else class="detail-surface">
        <div class="detail-head">
          <div>
            <span class="eyebrow">{{ label('外部账号', 'External') }}</span>
            <h2>Bilibili</h2>
          </div>
          <span class="pill muted">{{ label('待接入', 'Pending') }}</span>
        </div>
        <div class="empty-line left">{{ label('Bilibili cookie、token 和媒体解析授权归这里。', 'Bilibili cookies, tokens, and media auth belong here.') }}</div>
      </section>
    </section>

    <section v-else class="workspace">
      <aside class="provider-rail">
        <button
          v-for="provider in localProviders"
          :key="provider.id"
          :class="['provider-item', { active: selectedLocal === provider.id }]"
          @click="selectedLocal = provider.id"
        >
          <span :class="['dot', provider.tone]" />
          <strong>{{ provider.name }}</strong>
          <small>{{ provider.subtitle }}</small>
          <em>{{ provider.status }} · {{ provider.meta }}</em>
        </button>
      </aside>

      <section v-if="selectedLocal === 'adb'" class="detail-surface">
        <div class="detail-head">
          <div>
            <span class="eyebrow">{{ label('局域网账号', 'Local Network') }}</span>
            <h2>ADB</h2>
          </div>
          <span :class="['pill', adbBoundCount > 0 ? 'ok' : 'muted']">
            {{ adbBoundCount }} {{ label('个端点', 'endpoints') }}
          </span>
        </div>

        <div class="list-toolbar">
          <div>
            <strong>ADB CLI</strong>
            <small>{{ label('只维护 ADB 连接地址；具体绑定到设备页处理。', 'Only maintain ADB endpoints; bind them to devices later.') }}</small>
          </div>
          <div class="toolbar-actions">
            <button class="primary-btn" :disabled="isBusy('adb-create')" @click="openCreateAdbDevice">{{ label('新增端点', 'Add Endpoint') }}</button>
            <button class="plain-btn" :disabled="isBusy('devices')" @click="loadDevices">{{ label('刷新', 'Refresh') }}</button>
          </div>
        </div>

        <div v-if="adbRows.length === 0" class="empty-line">
          {{ label('还没有 ADB 端点。', 'No ADB endpoints yet.') }}
        </div>

        <div v-else class="adb-table">
          <div class="adb-row header">
            <span>{{ label('名称', 'Name') }}</span>
            <span>{{ label('地址', 'Endpoint') }}</span>
            <span>{{ label('操作', 'Actions') }}</span>
          </div>
          <div v-for="row in adbRows" :key="row.device.id" class="adb-row">
            <div class="device-cell">
              <strong>{{ row.device.name }}</strong>
            </div>

            <div class="endpoint-cell">
              <code>{{ row.device.adb_ip }}</code>
            </div>

            <div class="row-actions">
              <button class="plain-btn compact" :disabled="isBusy(`adb-edit-${row.device.id}`)" @click="openEditAdbDevice(row.device)">
                {{ label('编辑', 'Edit') }}
              </button>
              <button class="danger-btn compact" :disabled="isBusy(`adb-delete-${row.device.id}`)" @click="deleteAdbDevice(row.device)">
                {{ label('删除', 'Delete') }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section v-else class="detail-surface">
        <div class="detail-head">
          <div>
            <span class="eyebrow">{{ label('局域网账号', 'Local Network') }}</span>
            <h2>{{ localProviders.find((item) => item.id === selectedLocal)?.name }}</h2>
          </div>
          <span class="pill muted">{{ label('待接入', 'Pending') }}</span>
        </div>
        <div class="empty-line left">{{ label('后续在这里接入主机、凭据、连通性检查和解绑。', 'Hosts, credentials, checks, and unbinding will be wired here.') }}</div>
      </section>
    </section>

    <Teleport to="body">
      <div v-if="adbFormOpen" class="dialog-overlay" @click.self="closeAdbForm">
        <form class="dialog-panel" @submit.prevent="submitAdbDevice">
          <div class="dialog-head">
            <div>
              <span class="eyebrow">{{ label('ADB 端点', 'ADB Endpoint') }}</span>
              <h2>{{ editingAdbDevice ? label('编辑端点', 'Edit Endpoint') : label('新增端点', 'Add Endpoint') }}</h2>
            </div>
            <button type="button" class="plain-btn compact" @click="closeAdbForm">{{ label('关闭', 'Close') }}</button>
          </div>

          <div class="form-grid">
            <label class="form-field">
              <span>{{ label('名称', 'Name') }}</span>
              <input v-model="formName" class="form-input" :placeholder="label('客厅盒子 ADB', 'Living Room ADB')" />
            </label>

            <label class="form-field">
              <span>{{ label('IP:端口', 'IP:Port') }}</span>
              <input v-model="formAdbAddress" class="form-input" placeholder="192.168.31.91:5555" />
            </label>
          </div>

          <div class="dialog-actions">
            <button type="button" class="plain-btn" @click="closeAdbForm">{{ label('取消', 'Cancel') }}</button>
            <button
              type="submit"
              class="primary-btn"
              :disabled="!formName.trim() || !formAdbAddress.trim() || isBusy('adb-create') || (editingAdbDevice ? isBusy(`adb-edit-${editingAdbDevice.id}`) : false)"
            >
              {{ editingAdbDevice ? label('保存', 'Save') : label('创建', 'Create') }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100%;
  overflow-y: auto;
  padding: 32px;
  background: #f7f9fa;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-head,
.detail-surface,
.scope-tab,
.provider-item,
.notice {
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.page-head {
  min-height: 96px;
  border-radius: 8px;
  padding: 22px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow {
  display: inline-flex;
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
}

h1,
h2 {
  margin: 5px 0 0;
  color: var(--text-primary);
  font-weight: 900;
  letter-spacing: 0;
}

h1 {
  font-size: 30px;
}

h2 {
  font-size: 24px;
}

.head-actions,
.account-actions,
.toolbar-actions,
.row-actions,
.subsection-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.scope-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.scope-tab {
  min-height: 72px;
  border-radius: 8px;
  padding: 14px 16px;
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.scope-tab strong,
.provider-item strong,
.account-main strong,
.subsection-head strong,
.list-toolbar strong,
.device-cell strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0;
}

.scope-tab span,
.provider-item small,
.provider-item em,
.field-label,
.token-line,
.qr-copy span,
.subsection-head small,
.empty-line,
.list-toolbar small,
.device-cell small,
.endpoint-cell small {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.scope-tab.active,
.provider-item.active {
  border-color: #14b8a6;
  background: #f0fdfa;
}

.workspace {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.provider-rail {
  display: grid;
  gap: 8px;
}

.provider-item {
  min-height: 86px;
  border-radius: 8px;
  padding: 13px 14px;
  cursor: pointer;
  text-align: left;
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 9px;
  row-gap: 4px;
}

.provider-item strong,
.provider-item small,
.provider-item em {
  grid-column: 2;
}

.provider-item em {
  font-style: normal;
}

.dot {
  width: 9px;
  height: 9px;
  margin-top: 5px;
  border-radius: 999px;
  background: #94a3b8;
}

.ok,
.dot.ok {
  background: #10b981;
}

.dot.warn {
  background: #f59e0b;
}

.dot.bad {
  background: #ef4444;
}

.detail-surface {
  min-height: 470px;
  border-radius: 8px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-head,
.mi-account,
.qr-row,
.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.mi-account,
.qr-row,
.list-toolbar,
.empty-line,
.candidate-row,
.adb-row {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
}

.mi-account,
.qr-row,
.list-toolbar {
  padding: 16px;
}

.account-main,
.qr-copy,
.list-toolbar > div,
.subsection-head > div,
.device-cell,
.endpoint-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.token-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
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

.subsection,
.candidate-table,
.adb-table {
  display: grid;
  gap: 8px;
}

.subsection-head {
  justify-content: space-between;
}

.empty-line {
  padding: 18px;
  text-align: center;
}

.empty-line.left {
  text-align: left;
}

.candidate-row {
  min-height: 42px;
  padding: 9px 11px;
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(150px, 1fr) minmax(130px, 0.8fr) minmax(80px, 0.5fr);
  gap: 10px;
  align-items: center;
}

.candidate-row.header,
.adb-row.header {
  min-height: 30px;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.candidate-row strong,
.candidate-row span,
code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

code {
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  font-weight: 800;
}

.adb-row {
  min-height: 52px;
  padding: 11px;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(220px, 1fr) minmax(150px, auto);
  gap: 10px;
  align-items: center;
}

.row-actions {
  justify-content: flex-end;
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.dialog-panel {
  width: min(480px, 100%);
  max-height: 88vh;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.2);
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.form-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field.full {
  grid-column: 1 / -1;
}

.form-field span {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.form-input {
  width: 100%;
  min-height: 38px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 800;
  outline: none;
  padding: 0 10px;
}

.form-input:focus {
  border-color: #14b8a6;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.plain-btn,
.primary-btn,
.danger-btn {
  min-height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}

.plain-btn {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: var(--text-secondary);
}

.plain-btn:hover:not(:disabled) {
  border-color: #14b8a6;
  color: #0f766e;
}

.primary-btn {
  border: 1px solid #0f766e;
  background: #0f766e;
  color: #fff;
}

.danger-btn {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #dc2626;
}

.compact {
  min-height: 30px;
  padding: 0 9px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 9px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 900;
  white-space: nowrap;
}

.pill.ok {
  background: #ecfdf5;
  color: #047857;
}

.pill.warn {
  background: #fffbeb;
  color: #b45309;
}

.pill.bad {
  background: #fef2f2;
  color: #dc2626;
}

.pill.muted {
  background: #f1f5f9;
  color: #64748b;
}

.notice {
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 14px;
  font-weight: 800;
}

.notice.error {
  border-color: #fecaca;
  background: #fef2f2;
  color: #dc2626;
}

.notice.success {
  border-color: #bbf7d0;
  background: #ecfdf5;
  color: #047857;
}

@media (max-width: 1240px) {
  .workspace {
    grid-template-columns: 1fr;
  }

  .provider-rail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .adb-row,
  .adb-row.header {
    grid-template-columns: 1fr;
  }

  .adb-row.header {
    display: none;
  }
}

@media (max-width: 760px) {
  .auth-page {
    padding: 16px;
  }

  .page-head,
  .detail-head,
  .mi-account,
  .qr-row,
  .list-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .scope-tabs,
  .provider-rail,
  .form-grid,
  .candidate-row {
    grid-template-columns: 1fr;
  }

  .form-field.full {
    grid-column: auto;
  }

  .qr-frame {
    width: 100%;
  }
}
</style>
