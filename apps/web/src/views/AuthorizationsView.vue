<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, type AuthStatus, type MiDeviceCandidate, type UserDevice } from '@/api'
import { mediaApi } from '@/api/media'
import { streamingGatewayApi, type MoonlightWebRuntimeStatus, type StreamingHost, type StreamingHostProbe } from '@/api/streamingGateway'
import AdbAuthPanel from '@/components/auth/AdbAuthPanel.vue'
import SshAuthPanel from '@/components/auth/SshAuthPanel.vue'
import StreamingGatewayPanel from '@/components/remote-workspace/StreamingGatewayPanel.vue'
import StorageCredentialsPanel from '@/components/storage/StorageCredentialsPanel.vue'
import { useLocale } from '@/composables/useLocale'

type AuthTab = 'external' | 'local'
type ExternalProviderId = 'mi' | 'bilibili'
type LocalProviderId = 'adb' | 'dlna' | 'streaming' | 'alist' | 'ssh' | 'frp' | 'smb'

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
const dlnaFormOpen = ref(false)
const editingDlnaDevice = ref<UserDevice | null>(null)
const formDlnaName = ref('')
const formDlnaLocation = ref('')
const dlnaScanLoaded = ref(false)
const dlnaScanResults = ref<DlnaCandidate[]>([])
const dlnaTestResults = ref<Record<string, { ok: boolean; message: string }>>({})
const streamingHosts = ref<StreamingHost[]>([])
const streamingHostProbes = ref<Record<string, StreamingHostProbe>>({})
const streamingRuntimeStatus = ref<MoonlightWebRuntimeStatus | null>(null)
const streamingError = ref('')
const streamingMessage = ref('')
const streamingHostFormOpen = ref(false)
const streamingHostLabel = ref('')
const streamingHostEndpoint = ref('')
const streamingHostBasePort = ref('47989')
const streamingHostMac = ref('')
const streamingHostRoom = ref('')
const streamingHostNetworkPath = ref('lan')
const storageCredentialCount = ref(0)
const storageCredentialsPanel = ref<InstanceType<typeof StorageCredentialsPanel> | null>(null)
const adbAuthPanel = ref<InstanceType<typeof AdbAuthPanel> | null>(null)
const adbBoundCount = ref(0)
const sshAuthPanel = ref<InstanceType<typeof SshAuthPanel> | null>(null)
const sshTargetCount = ref(0)

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
const miBoundCount = computed(() => devices.value.filter((device) => typeof device.props?.mi_did === 'string' && device.props.mi_did).length)
const dlnaBoundCount = computed(() => devices.value.filter((device) => typeof device.props?.dlna_location === 'string' && (device.props.dlna_location as string).trim()).length)
const streamingHostCount = computed(() => streamingHosts.value.length)

type DlnaCandidate = {
  id: string
  name: string
  endpoint?: string
  meta?: Record<string, unknown>
}

type StreamingGatewaySpec = {
  key: string
  title: string
  subtitle: string
  status: string
  detail: string
  capabilities: string[]
}

const dlnaRows = computed(() => {
  return [...devices.value]
    .filter((device) => typeof device.props?.dlna_location === 'string' && (device.props.dlna_location as string).trim())
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
    id: 'dlna' as const,
    name: 'DLNA',
    subtitle: label('投屏 / 媒体渲染器', 'Cast / media renderer'),
    status: dlnaBoundCount.value > 0 ? label('已配置', 'Configured') : label('未配置', 'Not configured'),
    tone: dlnaBoundCount.value > 0 ? 'ok' as const : 'muted' as const,
    meta: `${dlnaBoundCount.value} ${label('个目标', 'targets')}`,
  },
  {
    id: 'streaming' as const,
    name: label('串流', 'Streaming'),
    subtitle: 'Sunshine / Moonlight',
    status: streamingHostCount.value > 0 ? label('已配置', 'Configured') : label('未配置', 'Not configured'),
    tone: streamingHostCount.value > 0 ? 'ok' as const : 'muted' as const,
    meta: `${streamingHostCount.value} ${label('台主机', 'hosts')}`,
  },
  {
    id: 'alist' as const,
    name: label('文件源', 'Storage Sources'),
    subtitle: label('WebDAV / SFTP / ADB / 本地文件', 'WebDAV / SFTP / ADB / local files'),
    status: storageCredentialCount.value > 0 ? label('已配置', 'Configured') : label('未配置', 'Not configured'),
    tone: storageCredentialCount.value > 0 ? 'ok' as const : 'muted' as const,
    meta: `${storageCredentialCount.value} ${label('个凭据', 'credentials')}`,
  },
  {
    id: 'ssh' as const,
    name: 'SSH',
    subtitle: label('主机登录', 'Host login'),
    status: sshTargetCount.value > 0 ? label('已配置', 'Configured') : label('待接入', 'Pending'),
    tone: sshTargetCount.value > 0 ? 'ok' as const : 'muted' as const,
    meta: `${sshTargetCount.value} ${label('个接入', 'targets')}`,
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
  await Promise.allSettled([
    loadAuthStatus(),
    loadDevices(),
    adbAuthPanel.value?.refresh(),
    loadSshTargetCount(),
    sshAuthPanel.value?.refresh(),
    loadStreamingHosts(),
    loadStreamingRuntimeStatus(),
    storageCredentialsPanel.value?.refresh(),
  ])
}

async function loadSshTargetCount() {
  try {
    const res = await api.terminal.listTargets()
    sshTargetCount.value = res.data.filter((target) => target.kind === 'ssh').length
  } catch (error) {
    console.warn('failed to load ssh target count', error)
  }
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

const streamingGatewaySpecs = computed<StreamingGatewaySpec[]>(() => [
  {
    key: 'sunshine-hosts',
    title: label('Sunshine 主机', 'Sunshine Hosts'),
    subtitle: label('登记家里的高性能电脑、工作站或游戏主机。', 'Register gaming PCs, workstations, or high-performance hosts at home.'),
    status: streamingHostCount.value > 0 ? label('已有主机', 'Hosts Ready') : label('待登记', 'Pending'),
    detail: label('保存地址、端口、MAC 和网络路径；配对证书后续也归这里托管。', 'Save address, ports, MAC, and network path; pairing material will also be owned here later.'),
    capabilities: ['streaming.host.sunshine', 'device.wake_on_lan', 'service.status.probe'],
  },
  {
    key: 'pairing',
    title: label('配对凭据', 'Pairing Credentials'),
    subtitle: label('后续按 Moonlight/Sunshine PIN 流程保存证书。', 'Later store certificates through the Moonlight/Sunshine PIN flow.'),
    status: label('下一步', 'Next'),
    detail: label('参考 moonlight-web-stream 的 pair flow，私钥和证书只留在服务端。', 'Follow moonlight-web-stream pair flow; private keys and certificates stay server-side only.'),
    capabilities: ['streaming.host.pair', 'streaming.credentials.store'],
  },
  {
    key: 'web-runtime',
    title: label('Web 串流运行时', 'Web Stream Runtime'),
    subtitle: label('可选接入外部 Moonlight Web / WebRTC 桥。', 'Optionally connect an external Moonlight Web / WebRTC bridge.'),
    status: streamingRuntimeStatus.value?.registered ? label('已登记', 'Registered') : label('预留', 'Reserved'),
    detail: label('HomeSense 负责管理和打开，视频流内核不塞进主后端。', 'HomeSense manages and opens it; the media core does not live in the main backend.'),
    capabilities: ['streaming.web_player.open', 'streaming.runtime.probe'],
  },
])

async function loadStreamingHosts() {
  setBusy('streaming-hosts', true)
  streamingError.value = ''
  try {
    const res = await streamingGatewayApi.hosts()
    streamingHosts.value = res.data ?? []
  } catch (error) {
    streamingError.value = (error as Error).message || String(error)
  } finally {
    setBusy('streaming-hosts', false)
  }
}

async function loadStreamingRuntimeStatus() {
  try {
    const res = await streamingGatewayApi.runtimeStatus()
    streamingRuntimeStatus.value = res.data ?? null
  } catch {
    streamingRuntimeStatus.value = null
  }
}

async function registerStreamingHost() {
  if (!streamingHostLabel.value.trim() || !streamingHostEndpoint.value.trim()) return
  setBusy('streaming-register', true)
  streamingError.value = ''
  streamingMessage.value = ''
  try {
    await streamingGatewayApi.registerHost({
      label: streamingHostLabel.value.trim(),
      endpoint: streamingHostEndpoint.value.trim(),
      base_port: streamingHostBasePort.value.trim(),
      mac_address: streamingHostMac.value.trim(),
      room: streamingHostRoom.value.trim(),
      network_path: streamingHostNetworkPath.value,
    })
    streamingHostLabel.value = ''
    streamingHostEndpoint.value = ''
    streamingHostBasePort.value = '47989'
    streamingHostMac.value = ''
    streamingHostRoom.value = ''
    streamingHostNetworkPath.value = 'lan'
    streamingHostFormOpen.value = false
    streamingMessage.value = label('Sunshine 主机已保存', 'Sunshine host saved')
    await loadStreamingHosts()
    await loadDevices()
  } catch (error) {
    streamingError.value = (error as Error).message || String(error)
  } finally {
    setBusy('streaming-register', false)
  }
}

async function probeStreamingHost(host: StreamingHost) {
  setBusy(`streaming-probe-${host.id}`, true)
  streamingError.value = ''
  streamingMessage.value = ''
  try {
    const res = await streamingGatewayApi.probeHost(host.id)
    streamingHostProbes.value = { ...streamingHostProbes.value, [host.id]: res.data }
    streamingMessage.value = res.data.reachable
      ? label('Sunshine 主机探测通过', 'Sunshine host probe passed')
      : label('Sunshine 主机不可达', 'Sunshine host is not reachable')
  } catch (error) {
    streamingError.value = (error as Error).message || String(error)
  } finally {
    setBusy(`streaming-probe-${host.id}`, false)
  }
}

async function wakeStreamingHost(host: StreamingHost) {
  setBusy(`streaming-wake-${host.id}`, true)
  streamingError.value = ''
  streamingMessage.value = ''
  try {
    const res = await streamingGatewayApi.wakeHost(host.id)
    streamingMessage.value = `${label('已发送 Wake-on-LAN', 'Wake-on-LAN sent')} ${res.data.broadcast_address}:${res.data.port}`
  } catch (error) {
    streamingError.value = (error as Error).message || String(error)
  } finally {
    setBusy(`streaming-wake-${host.id}`, false)
  }
}

async function removeStreamingHost(host: StreamingHost) {
  if (!window.confirm(label(`删除 Sunshine 主机「${host.label}」？`, `Delete Sunshine host "${host.label}"?`))) return
  setBusy(`streaming-remove-${host.id}`, true)
  streamingError.value = ''
  streamingMessage.value = ''
  try {
    await streamingGatewayApi.removeHost(host.id)
    streamingMessage.value = label('Sunshine 主机已删除', 'Sunshine host removed')
    await loadStreamingHosts()
    await loadDevices()
  } catch (error) {
    streamingError.value = (error as Error).message || String(error)
  } finally {
    setBusy(`streaming-remove-${host.id}`, false)
  }
}

function openStreamingRuntime() {
  const endpoint = streamingRuntimeStatus.value?.endpoint || ''
  if (!endpoint.startsWith('http')) return
  window.open(endpoint, '_blank', 'noopener,noreferrer')
}

function openCreateDlnaDevice() {
  editingDlnaDevice.value = null
  formDlnaName.value = ''
  formDlnaLocation.value = ''
  dlnaFormOpen.value = true
}

function openEditDlnaDevice(device: UserDevice) {
  editingDlnaDevice.value = device
  formDlnaName.value = device.name
  formDlnaLocation.value = (device.props?.dlna_location as string) ?? ''
  dlnaFormOpen.value = true
}

function closeDlnaForm() {
  dlnaFormOpen.value = false
  editingDlnaDevice.value = null
}

async function submitDlnaDevice() {
  const name = formDlnaName.value.trim()
  const location = formDlnaLocation.value.trim()
  if (!name || !location) return
  const payload = {
    name,
    props: {
      ...(editingDlnaDevice.value?.props ?? {}),
      device_type: 'dlna_renderer',
      dlna_location: location,
    },
  }
  const key = editingDlnaDevice.value ? `dlna-edit-${editingDlnaDevice.value.id}` : 'dlna-create'
  setBusy(key, true)
  errorMessage.value = ''
  try {
    if (editingDlnaDevice.value) {
      await api.userDevices.update(editingDlnaDevice.value.id, payload)
      showSuccess(label('DLNA 目标已更新', 'DLNA target updated'))
    } else {
      await api.userDevices.create(payload)
      showSuccess(label('DLNA 目标已添加', 'DLNA target added'))
    }
    closeDlnaForm()
    await loadDevices()
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy(key, false)
  }
}

async function deleteDlnaDevice(device: UserDevice) {
  if (!window.confirm(label(`删除 DLNA 目标「${device.name}」？`, `Delete DLNA target "${device.name}"?`))) return
  setBusy(`dlna-delete-${device.id}`, true)
  errorMessage.value = ''
  try {
    await api.userDevices.delete(device.id)
    await loadDevices()
    showSuccess(label('DLNA 目标已删除', 'DLNA target deleted'))
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy(`dlna-delete-${device.id}`, false)
  }
}

async function scanDlnaTargets() {
  setBusy('dlna-scan', true)
  errorMessage.value = ''
  dlnaScanLoaded.value = false
  try {
    dlnaScanResults.value = await mediaApi.listDlnaOutputs()
    dlnaScanLoaded.value = true
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy('dlna-scan', false)
  }
}

async function saveDlnaCandidate(candidate: DlnaCandidate) {
  const location = candidate.endpoint?.trim()
  if (!location) return
  if (isDlnaLocationSaved(location)) {
    showSuccess(label('DLNA 目标已存在', 'DLNA target already exists'))
    return
  }
  const meta = candidate.meta ?? {}
  const ipAddress = getString(meta.ip)
  const port = typeof meta.port === 'number' ? meta.port : undefined
  setBusy(`dlna-save-candidate-${candidate.id}`, true)
  errorMessage.value = ''
  try {
    await api.userDevices.create({
      name: candidate.name || `DLNA ${ipAddress || location}`,
      props: {
        device_type: 'dlna_renderer',
        dlna_location: location,
        dlna_udn: getString(meta.udn),
        dlna_kind: meta.virtual ? 'virtual' : 'real',
        dlna_device_type: getString(meta.device_type),
        manufacturer: getString(meta.manufacturer),
        model: getString(meta.model),
        ...(ipAddress ? { ip_address: ipAddress } : {}),
        ...(port != null ? { port } : {}),
      },
    })
    await loadDevices()
    showSuccess(label('DLNA 候选已保存', 'DLNA candidate saved'))
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy(`dlna-save-candidate-${candidate.id}`, false)
  }
}

async function testDlnaLocation(location: string) {
  const normalized = location.trim()
  if (!normalized) return
  setBusy(`dlna-test-${normalized}`, true)
  dlnaTestResults.value = { ...dlnaTestResults.value, [normalized]: { ok: false, message: label('测试中', 'Testing') } }
  try {
    const result = await mediaApi.getDlnaStatus(normalized)
    const state = result.data?.state || result.data?.transport_status || result.message || result.error || result.status
    dlnaTestResults.value = {
      ...dlnaTestResults.value,
      [normalized]: { ok: result.status === 'success', message: String(state) },
    }
  } catch (error) {
    dlnaTestResults.value = { ...dlnaTestResults.value, [normalized]: { ok: false, message: (error as Error).message || String(error) } }
  } finally {
    setBusy(`dlna-test-${normalized}`, false)
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

function endpointHost(value: string): string {
  return value.split(':')[0]?.trim() ?? ''
}

function isDlnaLocationSaved(location: string): boolean {
  const normalized = location.trim()
  return devices.value.some((device) => getString(device.props?.dlna_location).trim() === normalized)
}

function dlnaKind(device: UserDevice): string {
  const kind = getString(device.props?.dlna_kind)
  return kind === 'virtual' ? label('虚拟', 'Virtual') : label('真实', 'Real')
}

function dlnaEndpoint(candidate: DlnaCandidate): string {
  return candidate.endpoint || ''
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
        <span>ADB / DLNA / {{ label('串流', 'Streaming') }} / AList / SSH / FRP / SMB</span>
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

      <AdbAuthPanel
        v-if="selectedLocal === 'adb'"
        ref="adbAuthPanel"
        :label="label"
        @count-change="adbBoundCount = $event"
        @error="errorMessage = $event"
        @success="showSuccess"
      />

      <section v-else-if="selectedLocal === 'dlna'" class="detail-surface">
        <div class="detail-head">
          <div>
            <span class="eyebrow">{{ label('局域网账号', 'Local Network') }}</span>
            <h2>DLNA</h2>
          </div>
          <span :class="['pill', dlnaBoundCount > 0 ? 'ok' : 'muted']">
            {{ dlnaBoundCount }} {{ label('个目标', 'targets') }}
          </span>
        </div>

        <div class="list-toolbar">
          <div>
            <strong>{{ label('媒体渲染目标', 'Media Render Targets') }}</strong>
            <small>{{ label('真实 DLNA 与 HomeSense 虚拟 DLNA 都在这里统一保存。', 'Real DLNA and HomeSense virtual DLNA targets are saved here.') }}</small>
          </div>
          <div class="toolbar-actions">
            <button class="plain-btn" :disabled="isBusy('dlna-scan')" @click="scanDlnaTargets">
              {{ isBusy('dlna-scan') ? label('扫描中', 'Scanning') : label('扫描', 'Scan') }}
            </button>
            <button class="primary-btn" :disabled="isBusy('dlna-create')" @click="openCreateDlnaDevice">{{ label('新增目标', 'Add Target') }}</button>
            <button class="plain-btn" :disabled="isBusy('devices')" @click="loadDevices">{{ label('刷新', 'Refresh') }}</button>
          </div>
        </div>

        <section class="subsection">
          <div class="subsection-head">
            <div>
              <strong>{{ label('扫描候选', 'Scan Candidates') }}</strong>
              <small>{{ dlnaScanLoaded ? `${dlnaScanResults.length}` : label('按需扫描', 'Scan on demand') }}</small>
            </div>
          </div>
          <div v-if="!dlnaScanLoaded" class="empty-line left">
            {{ label('DLNA 通过 SSDP 在局域网发现渲染器。', 'DLNA discovers renderers through SSDP on the LAN.') }}
          </div>
          <div v-else-if="dlnaScanResults.length === 0" class="empty-line">
            {{ label('没有发现 DLNA 渲染器。', 'No DLNA renderers found.') }}
          </div>
          <div v-else class="target-table">
            <div class="target-row header">
              <span>{{ label('名称', 'Name') }}</span>
              <span>{{ label('地址', 'Endpoint') }}</span>
              <span>{{ label('操作', 'Actions') }}</span>
            </div>
            <div v-for="candidate in dlnaScanResults" :key="candidate.id" class="target-row">
              <div class="device-cell">
                <strong>{{ candidate.name }}</strong>
                <small>{{ candidate.meta?.virtual ? label('HomeSense 虚拟 DLNA', 'HomeSense virtual DLNA') : (candidate.meta?.manufacturer || 'DLNA') }}</small>
              </div>
              <div class="endpoint-cell">
                <code>{{ dlnaEndpoint(candidate) }}</code>
                <small v-if="dlnaTestResults[dlnaEndpoint(candidate)]" :class="['probe-result', dlnaTestResults[dlnaEndpoint(candidate)].ok ? 'ok-text' : 'bad-text']">
                  {{ dlnaTestResults[dlnaEndpoint(candidate)].message }}
                </small>
              </div>
              <div class="row-actions">
                <button class="plain-btn compact" :disabled="!dlnaEndpoint(candidate) || isBusy(`dlna-test-${dlnaEndpoint(candidate)}`)" @click="testDlnaLocation(dlnaEndpoint(candidate))">
                  {{ label('测试', 'Test') }}
                </button>
                <button class="primary-btn compact" :disabled="!dlnaEndpoint(candidate) || isDlnaLocationSaved(dlnaEndpoint(candidate)) || isBusy(`dlna-save-candidate-${candidate.id}`)" @click="saveDlnaCandidate(candidate)">
                  {{ isDlnaLocationSaved(dlnaEndpoint(candidate)) ? label('已保存', 'Saved') : label('保存', 'Save') }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <div v-if="dlnaRows.length === 0" class="empty-line">
          {{ label('还没有 DLNA 目标。', 'No DLNA targets yet.') }}
        </div>

        <div v-else class="target-table">
          <div class="target-row header">
            <span>{{ label('名称', 'Name') }}</span>
            <span>{{ label('地址', 'Endpoint') }}</span>
            <span>{{ label('操作', 'Actions') }}</span>
          </div>
          <div v-for="row in dlnaRows" :key="row.device.id" class="target-row">
            <div class="device-cell">
              <strong>{{ row.device.name }}</strong>
              <small>{{ dlnaKind(row.device) }} · {{ row.device.props?.manufacturer || row.device.props?.model || 'DLNA' }}</small>
            </div>

            <div class="endpoint-cell">
              <code>{{ row.device.props?.dlna_location }}</code>
              <small v-if="dlnaTestResults[getString(row.device.props?.dlna_location)]" :class="['probe-result', dlnaTestResults[getString(row.device.props?.dlna_location)].ok ? 'ok-text' : 'bad-text']">
                {{ dlnaTestResults[getString(row.device.props?.dlna_location)].message }}
              </small>
            </div>

            <div class="row-actions">
              <button class="plain-btn compact" :disabled="isBusy(`dlna-test-${row.device.props?.dlna_location}`)" @click="testDlnaLocation(getString(row.device.props?.dlna_location))">
                {{ label('测试', 'Test') }}
              </button>
              <button class="plain-btn compact" :disabled="isBusy(`dlna-edit-${row.device.id}`)" @click="openEditDlnaDevice(row.device)">
                {{ label('编辑', 'Edit') }}
              </button>
              <button class="danger-btn compact" :disabled="isBusy(`dlna-delete-${row.device.id}`)" @click="deleteDlnaDevice(row.device)">
                {{ label('删除', 'Delete') }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="selectedLocal === 'streaming'" class="detail-surface">
        <div class="detail-head">
          <div>
            <span class="eyebrow">{{ label('局域网账号', 'Local Network') }}</span>
            <h2>{{ label('串流', 'Streaming') }}</h2>
          </div>
          <div class="row-actions">
            <span :class="['pill', streamingHostCount > 0 ? 'ok' : 'muted']">
              {{ streamingHostCount }} {{ label('台主机', 'hosts') }}
            </span>
            <button class="plain-btn compact" type="button" @click="router.push('/streaming')">
              {{ label('打开工作台', 'Open Workbench') }}
            </button>
          </div>
        </div>

        <StreamingGatewayPanel
          :specs="streamingGatewaySpecs"
          :hosts="streamingHosts"
          :probes="streamingHostProbes"
          :runtime-status="streamingRuntimeStatus"
          :registered="streamingHostCount > 0"
          :loading="isBusy('streaming-hosts')"
          :action-loading="isBusy('streaming-register')"
          :error="streamingError"
          :message="streamingMessage"
          :show-form="streamingHostFormOpen"
          :host-label="streamingHostLabel"
          :host-endpoint="streamingHostEndpoint"
          :host-base-port="streamingHostBasePort"
          :host-mac="streamingHostMac"
          :host-room="streamingHostRoom"
          :host-network-path="streamingHostNetworkPath"
          :label="label"
          @refresh-hosts="loadStreamingHosts"
          @refresh-runtime="loadStreamingRuntimeStatus"
          @toggle-form="streamingHostFormOpen = !streamingHostFormOpen"
          @register-host="registerStreamingHost"
          @probe-host="probeStreamingHost"
          @wake-host="wakeStreamingHost"
          @remove-host="removeStreamingHost"
          @open-runtime="openStreamingRuntime"
          @update:host-label="streamingHostLabel = $event"
          @update:host-endpoint="streamingHostEndpoint = $event"
          @update:host-base-port="streamingHostBasePort = $event"
          @update:host-mac="streamingHostMac = $event"
          @update:host-room="streamingHostRoom = $event"
          @update:host-network-path="streamingHostNetworkPath = $event"
        />
      </section>

      <StorageCredentialsPanel
        v-else-if="selectedLocal === 'alist'"
        ref="storageCredentialsPanel"
        :label="label"
        @count-change="storageCredentialCount = $event"
        @error="errorMessage = $event"
        @success="showSuccess"
      />

      <SshAuthPanel
        v-else-if="selectedLocal === 'ssh'"
        ref="sshAuthPanel"
        :label="label"
        @count-change="sshTargetCount = $event"
        @error="errorMessage = $event"
        @success="showSuccess"
      />
    </section>

    <Teleport to="body">
      <div v-if="dlnaFormOpen" class="dialog-overlay" @click.self="closeDlnaForm">
        <form class="dialog-panel" @submit.prevent="submitDlnaDevice">
          <div class="dialog-head">
            <div>
              <span class="eyebrow">{{ label('DLNA 目标', 'DLNA Target') }}</span>
              <h2>{{ editingDlnaDevice ? label('编辑目标', 'Edit Target') : label('新增目标', 'Add Target') }}</h2>
            </div>
            <button type="button" class="plain-btn compact" @click="closeDlnaForm">{{ label('关闭', 'Close') }}</button>
          </div>

          <div class="form-grid">
            <label class="form-field">
              <span>{{ label('名称', 'Name') }}</span>
              <input v-model="formDlnaName" class="form-input" :placeholder="label('客厅音箱 DLNA', 'Living Room Speaker DLNA')" />
            </label>

            <label class="form-field full">
              <span>Location URL</span>
              <input v-model="formDlnaLocation" class="form-input" placeholder="http://192.168.31.20:8200/description.xml" />
            </label>
          </div>

          <div class="dialog-actions">
            <button type="button" class="plain-btn" @click="closeDlnaForm">{{ label('取消', 'Cancel') }}</button>
            <button
              type="submit"
              class="primary-btn"
              :disabled="!formDlnaName.trim() || !formDlnaLocation.trim() || isBusy('dlna-create') || (editingDlnaDevice ? isBusy(`dlna-edit-${editingDlnaDevice.id}`) : false)"
            >
              {{ editingDlnaDevice ? label('保存', 'Save') : label('创建', 'Create') }}
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
.target-row {
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
.target-table {
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
.target-row.header {
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

.target-row {
  min-height: 52px;
  padding: 11px;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(220px, 1.35fr) minmax(190px, auto);
  gap: 10px;
  align-items: center;
}

.row-actions {
  justify-content: flex-end;
}

.toolbar-input {
  width: 160px;
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  font-weight: 800;
  outline: none;
  padding: 0 10px;
}

.toolbar-input:focus {
  border-color: #14b8a6;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.1);
}

.probe-result {
  overflow-wrap: anywhere;
}

.ok-text {
  color: #047857;
}

.bad-text {
  color: #b91c1c;
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

  .target-row,
  .target-row.header {
    grid-template-columns: 1fr;
  }

  .target-row.header {
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
