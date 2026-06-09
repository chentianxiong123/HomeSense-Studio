<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, type AuthStatus, type MiDeviceCandidate, type UserDevice } from '@/api'
import { alistApi, type AlistAuthorizationRecord } from '@/api/alist'
import { cliApi } from '@/api/cli'
import { mediaApi } from '@/api/media'
import { streamingGatewayApi, type MoonlightWebRuntimeStatus, type StreamingHost, type StreamingHostProbe } from '@/api/streamingGateway'
import StreamingGatewayPanel from '@/components/remote-workspace/StreamingGatewayPanel.vue'
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
const adbFormOpen = ref(false)
const editingAdbDevice = ref<UserDevice | null>(null)
const formName = ref('')
const formAdbAddress = ref('')
const adbScanSubnet = ref('')
const adbScanLoaded = ref(false)
const adbScanResults = ref<AdbScanCandidate[]>([])
const adbTestResults = ref<Record<string, { ok: boolean; message: string }>>({})
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
const alistAuthorizations = ref<AlistAuthorizationRecord[]>([])
const alistAuthFormOpen = ref(false)
const editingAlistAuthId = ref<number | null>(null)
const alistAuthName = ref('')
const alistAuthDriver = ref<'webdav' | 'local'>('webdav')
const alistAuthEndpoint = ref('')
const alistAuthRootPath = ref('')
const alistAuthUsername = ref('')
const alistAuthPassword = ref('')

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
const adbBoundCount = computed(() => devices.value.filter((device) => typeof device.props?.adb_ip === 'string' && (device.props.adb_ip as string).trim()).length)
const dlnaBoundCount = computed(() => devices.value.filter((device) => typeof device.props?.dlna_location === 'string' && (device.props.dlna_location as string).trim()).length)
const streamingHostCount = computed(() => streamingHosts.value.length)
const alistAuthorizationCount = computed(() => alistAuthorizations.value.length)

type AdbScanCandidate = {
  ip: string
  port: number
  address: string
  open?: boolean
  latency_ms?: number
  adb_status?: string
}

type AdbScanData = {
  subnet: string
  ports: number[]
  scanned: number
  candidates: AdbScanCandidate[]
  count: number
}

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

// ─── SSH terminal targets ────────────────────────────────────────────────────
type TerminalTarget = {
  id: number
  name: string
  kind: 'local' | 'ssh' | 'adb'
  target: Record<string, unknown>
  created_at: string
  updated_at: string
}
const sshTargets = ref<TerminalTarget[]>([])
const sshForm = ref({
  name: '',
  host: '',
  port: 22,
  user: '',
  auth: 'key' as 'key' | 'password',
  keyName: 'n8n_watchdog',
  password: '',
})
const sshEditingId = ref<number | null>(null)
const sshTestingId = ref<number | null>(null)
const sshTestResult = ref<{ id: number; ok: boolean; message: string } | null>(null)

async function loadSshTargets() {
  try {
    const res = await api.terminal.listTargets()
    sshTargets.value = res.data.filter((t) => t.kind === 'ssh')
  } catch (e) {
    console.warn('failed to load ssh targets', e)
  }
}

async function saveSshTarget() {
  if (!sshForm.value.name || !sshForm.value.host || !sshForm.value.user) {
    errorMessage.value = label('名称 / 主机 / 用户必填', 'name / host / user required')
    return
  }
  setBusy('ssh-save', true)
  errorMessage.value = ''
  try {
    const target: Record<string, unknown> = {
      host: sshForm.value.host,
      port: sshForm.value.port,
      user: sshForm.value.user,
      auth: sshForm.value.auth,
    }
    if (sshForm.value.auth === 'key') {
      target.keyName = sshForm.value.keyName
    } else {
      target.password = sshForm.value.password
    }
    if (sshEditingId.value) {
      await api.terminal.updateTarget(sshEditingId.value, { name: sshForm.value.name, target })
    } else {
      await api.terminal.createTarget({ name: sshForm.value.name, kind: 'ssh', target })
    }
    await loadSshTargets()
    resetSshForm()
    showSuccess(label('已保存', 'Saved'))
  } catch (e) {
    errorMessage.value = (e as Error).message
  } finally {
    setBusy('ssh-save', false)
  }
}

function resetSshForm() {
  sshForm.value = { name: '', host: '', port: 22, user: '', auth: 'key', keyName: 'n8n_watchdog', password: '' }
  sshEditingId.value = null
}

function editSshTarget(t: TerminalTarget) {
  const tgt = t.target as any
  sshForm.value = {
    name: t.name,
    host: tgt.host ?? '',
    port: tgt.port ?? 22,
    user: tgt.user ?? '',
    auth: tgt.auth ?? 'key',
    keyName: tgt.keyName ?? 'n8n_watchdog',
    password: tgt.password ?? '',
  }
  sshEditingId.value = t.id
}

async function removeSshTarget(id: number) {
  if (!confirm(label('确认删除?', 'Confirm delete?'))) return
  await api.terminal.removeTarget(id)
  await loadSshTargets()
  if (sshEditingId.value === id) resetSshForm()
}

async function testSshTarget(id: number) {
  sshTestingId.value = id
  sshTestResult.value = null
  try {
    const res = await api.terminal.testTarget(id)
    sshTestResult.value = { id, ...res.data }
  } catch (e) {
    sshTestResult.value = { id, ok: false, message: (e as Error).message }
  } finally {
    sshTestingId.value = null
  }
}

const sshTargetCount = computed(() => sshTargets.value.length)

const adbRows = computed(() => {
  return [...devices.value]
    .filter((device) => typeof device.props?.adb_ip === 'string' && (device.props.adb_ip as string).trim())
    .sort((left, right) => left.name.localeCompare(right.name, isZh.value ? 'zh-Hans-CN' : 'en'))
    .map((device) => ({ device }))
})

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
    name: 'AList Driver',
    subtitle: label('WebDAV / 本地文件', 'WebDAV / local files'),
    status: alistAuthorizationCount.value > 0 ? label('已配置', 'Configured') : label('未配置', 'Not configured'),
    tone: alistAuthorizationCount.value > 0 ? 'ok' as const : 'muted' as const,
    meta: `${alistAuthorizationCount.value} ${label('个凭据', 'credentials')}`,
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
  await Promise.allSettled([loadAuthStatus(), loadDevices(), loadSshTargets(), loadStreamingHosts(), loadStreamingRuntimeStatus(), loadAlistAuthorizations()])
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
  formAdbAddress.value = (device.props?.adb_ip as string) ?? ''
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
  const payload: { name: string; props: Record<string, unknown> } = {
    name,
    props: {
      device_type: editingAdbDevice.value?.props?.device_type ?? 'other',
      adb_ip: adbAddress,
      ...(ipAddress ? { ip_address: ipAddress } : {}),
    },
  }
  if (editingAdbDevice.value?.props?.room_id != null) {
    payload.props.room_id = editingAdbDevice.value.props.room_id
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

async function loadAlistAuthorizations() {
  setBusy('alist-auths', true)
  errorMessage.value = ''
  try {
    const result = await alistApi.listAuthorizations()
    alistAuthorizations.value = result.authorizations ?? []
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy('alist-auths', false)
  }
}

function openCreateAlistAuth() {
  editingAlistAuthId.value = null
  alistAuthName.value = ''
  alistAuthDriver.value = 'webdav'
  alistAuthEndpoint.value = ''
  alistAuthRootPath.value = ''
  alistAuthUsername.value = ''
  alistAuthPassword.value = ''
  alistAuthFormOpen.value = true
}

function openEditAlistAuth(record: AlistAuthorizationRecord) {
  const rootPath = getString(record.props?.root_path)
  editingAlistAuthId.value = record.id
  alistAuthName.value = record.name
  alistAuthDriver.value = record.driver === 'local' ? 'local' : 'webdav'
  alistAuthEndpoint.value = record.driver === 'local' ? '' : record.endpoint
  alistAuthRootPath.value = rootPath || (record.driver === 'local' ? record.endpoint : '')
  alistAuthUsername.value = record.username ?? ''
  alistAuthPassword.value = ''
  alistAuthFormOpen.value = true
}

function closeAlistAuthForm() {
  alistAuthFormOpen.value = false
  editingAlistAuthId.value = null
}

async function submitAlistAuth() {
  const name = alistAuthName.value.trim()
  const driver = alistAuthDriver.value
  const endpoint = alistAuthEndpoint.value.trim()
  const rootPath = alistAuthRootPath.value.trim()
  if (!name) return
  if (driver === 'webdav' && !endpoint) return
  if (driver === 'local' && !rootPath) return

  const body: {
    name: string
    driver: string
    endpoint?: string
    username?: string
    password?: string
    secret?: Record<string, unknown>
    props: Record<string, unknown>
  } = {
    name,
    driver,
    endpoint: driver === 'local' ? rootPath : endpoint,
    props: rootPath ? { root_path: rootPath } : {},
  }
  if (driver === 'webdav') {
    body.username = alistAuthUsername.value.trim()
  } else {
    body.username = ''
    body.secret = {}
  }
  if (alistAuthPassword.value) {
    body.password = alistAuthPassword.value
  }

  const key = editingAlistAuthId.value ? `alist-auth-edit-${editingAlistAuthId.value}` : 'alist-auth-create'
  setBusy(key, true)
  errorMessage.value = ''
  try {
    if (editingAlistAuthId.value) {
      await alistApi.updateAuthorization(editingAlistAuthId.value, body)
      showSuccess(label('AList 授权已更新', 'AList authorization updated'))
    } else {
      await alistApi.createAuthorization(body)
      showSuccess(label('AList 授权已保存', 'AList authorization saved'))
    }
    closeAlistAuthForm()
    await loadAlistAuthorizations()
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy(key, false)
  }
}

async function deleteAlistAuth(record: AlistAuthorizationRecord) {
  if (!window.confirm(label(`删除 AList 授权「${record.name}」？`, `Delete AList authorization "${record.name}"?`))) return
  setBusy(`alist-auth-delete-${record.id}`, true)
  errorMessage.value = ''
  try {
    await alistApi.removeAuthorization(record.id)
    await loadAlistAuthorizations()
    showSuccess(label('AList 授权已删除', 'AList authorization removed'))
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy(`alist-auth-delete-${record.id}`, false)
  }
}

function alistAuthRoot(record: AlistAuthorizationRecord): string {
  return getString(record.props?.root_path) || (record.driver === 'local' ? record.endpoint : '/')
}

async function scanAdbTargets() {
  setBusy('adb-scan', true)
  errorMessage.value = ''
  adbScanLoaded.value = false
  try {
    const params: Record<string, unknown> = { ports: [5555], timeout_ms: 350 }
    if (adbScanSubnet.value.trim()) params.subnet = adbScanSubnet.value.trim()
    const result = await cliApi.run<AdbScanData>('adb-cli', {
      action: 'scan_network',
      params,
      ttl_ms: 0,
      bypass_cache: true,
    })
    if (result.status !== 'success' || !result.data) {
      throw new Error(result.message || result.error || 'Failed to scan ADB targets')
    }
    adbScanResults.value = result.data.candidates ?? []
    if (!adbScanSubnet.value.trim()) adbScanSubnet.value = result.data.subnet
    adbScanLoaded.value = true
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy('adb-scan', false)
  }
}

async function saveAdbCandidate(candidate: AdbScanCandidate) {
  const address = normalizeAdbAddress(candidate.address)
  if (!address) return
  if (isAdbAddressSaved(address)) {
    showSuccess(label('ADB 端点已存在', 'ADB endpoint already exists'))
    return
  }
  const ipAddress = endpointHost(address)
  setBusy(`adb-save-candidate-${address}`, true)
  errorMessage.value = ''
  try {
    await api.userDevices.create({
      name: `ADB ${address}`,
      props: {
        device_type: 'other',
        adb_ip: address,
        ...(ipAddress ? { ip_address: ipAddress } : {}),
      },
    })
    await loadDevices()
    showSuccess(label('ADB 候选已保存', 'ADB candidate saved'))
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    setBusy(`adb-save-candidate-${address}`, false)
  }
}

async function testAdbAddress(address: string) {
  const normalized = normalizeAdbAddress(address)
  if (!normalized) return
  setBusy(`adb-test-${normalized}`, true)
  adbTestResults.value = { ...adbTestResults.value, [normalized]: { ok: false, message: label('测试中', 'Testing') } }
  try {
    const result = await cliApi.run<{ message?: string; address?: string }>('adb-cli', {
      action: 'connect',
      params: { device: normalized, max_attempts: 1, backoff_seconds: 1 },
      ttl_ms: 0,
      bypass_cache: true,
    })
    adbTestResults.value = {
      ...adbTestResults.value,
      [normalized]: {
        ok: result.status === 'success',
        message: result.data?.message || result.message || result.error || result.status,
      },
    }
  } catch (error) {
    adbTestResults.value = { ...adbTestResults.value, [normalized]: { ok: false, message: (error as Error).message || String(error) } }
  } finally {
    setBusy(`adb-test-${normalized}`, false)
  }
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

function normalizeAdbAddress(value: string): string {
  const address = value.trim()
  return address && !address.includes(':') ? `${address}:5555` : address
}

function endpointHost(value: string): string {
  return value.split(':')[0]?.trim() ?? ''
}

function isAdbAddressSaved(address: string): boolean {
  const normalized = normalizeAdbAddress(address)
  return devices.value.some((device) => normalizeAdbAddress(getString(device.props?.adb_ip)) === normalized)
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
            <small>{{ label('扫描候选只探测 5555 端口；保存后才进入设备授权。', 'Scan only probes port 5555; save a candidate to authorize it.') }}</small>
          </div>
          <div class="toolbar-actions">
            <input v-model="adbScanSubnet" class="toolbar-input" placeholder="192.168.31.0/24" />
            <button class="plain-btn" :disabled="isBusy('adb-scan')" @click="scanAdbTargets">
              {{ isBusy('adb-scan') ? label('扫描中', 'Scanning') : label('扫描', 'Scan') }}
            </button>
            <button class="primary-btn" :disabled="isBusy('adb-create')" @click="openCreateAdbDevice">{{ label('新增端点', 'Add Endpoint') }}</button>
            <button class="plain-btn" :disabled="isBusy('devices')" @click="loadDevices">{{ label('刷新', 'Refresh') }}</button>
          </div>
        </div>

        <section class="subsection">
          <div class="subsection-head">
            <div>
              <strong>{{ label('扫描候选', 'Scan Candidates') }}</strong>
              <small>{{ adbScanLoaded ? `${adbScanResults.length}` : label('按需扫描', 'Scan on demand') }}</small>
            </div>
          </div>
          <div v-if="!adbScanLoaded" class="empty-line left">
            {{ label('输入网段或留空自动推断本机 /24 网段。', 'Enter a subnet or leave blank to infer the local /24 subnet.') }}
          </div>
          <div v-else-if="adbScanResults.length === 0" class="empty-line">
            {{ label('没有发现开放 ADB 端口。', 'No open ADB ports found.') }}
          </div>
          <div v-else class="target-table">
            <div class="target-row header">
              <span>{{ label('地址', 'Address') }}</span>
              <span>{{ label('状态', 'Status') }}</span>
              <span>{{ label('操作', 'Actions') }}</span>
            </div>
            <div v-for="candidate in adbScanResults" :key="candidate.address" class="target-row">
              <div class="endpoint-cell">
                <code>{{ candidate.address }}</code>
                <small v-if="candidate.latency_ms != null">{{ candidate.latency_ms }}ms</small>
              </div>
              <div class="endpoint-cell">
                <span class="pill" :class="isAdbAddressSaved(candidate.address) ? 'ok' : 'muted'">
                  {{ isAdbAddressSaved(candidate.address) ? label('已保存', 'Saved') : (candidate.adb_status || label('候选', 'Candidate')) }}
                </span>
                <small v-if="adbTestResults[candidate.address]" :class="['probe-result', adbTestResults[candidate.address].ok ? 'ok-text' : 'bad-text']">
                  {{ adbTestResults[candidate.address].message }}
                </small>
              </div>
              <div class="row-actions">
                <button class="plain-btn compact" :disabled="isBusy(`adb-test-${candidate.address}`)" @click="testAdbAddress(candidate.address)">
                  {{ isBusy(`adb-test-${candidate.address}`) ? label('测试中', 'Testing') : label('测试', 'Test') }}
                </button>
                <button class="primary-btn compact" :disabled="isAdbAddressSaved(candidate.address) || isBusy(`adb-save-candidate-${candidate.address}`)" @click="saveAdbCandidate(candidate)">
                  {{ label('保存', 'Save') }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <div v-if="adbRows.length === 0" class="empty-line">
          {{ label('还没有 ADB 端点。', 'No ADB endpoints yet.') }}
        </div>

        <div v-else class="target-table">
          <div class="target-row header">
            <span>{{ label('名称', 'Name') }}</span>
            <span>{{ label('地址', 'Endpoint') }}</span>
            <span>{{ label('操作', 'Actions') }}</span>
          </div>
          <div v-for="row in adbRows" :key="row.device.id" class="target-row">
            <div class="device-cell">
              <strong>{{ row.device.name }}</strong>
            </div>

            <div class="endpoint-cell">
              <code>{{ row.device.props?.adb_ip }}</code>
              <small v-if="adbTestResults[getString(row.device.props?.adb_ip)]" :class="['probe-result', adbTestResults[getString(row.device.props?.adb_ip)].ok ? 'ok-text' : 'bad-text']">
                {{ adbTestResults[getString(row.device.props?.adb_ip)].message }}
              </small>
            </div>

            <div class="row-actions">
              <button class="plain-btn compact" :disabled="isBusy(`adb-test-${row.device.props?.adb_ip}`)" @click="testAdbAddress(getString(row.device.props?.adb_ip))">
                {{ label('测试', 'Test') }}
              </button>
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

      <section v-else-if="selectedLocal === 'alist'" class="detail-surface">
        <div class="detail-head">
          <div>
            <span class="eyebrow">{{ label('局域网账号', 'Local Network') }}</span>
            <h2>AList Driver</h2>
          </div>
          <span :class="['pill', alistAuthorizationCount > 0 ? 'ok' : 'muted']">
            {{ alistAuthorizationCount }} {{ label('个凭据', 'credentials') }}
          </span>
        </div>

        <div class="list-toolbar">
          <div>
            <strong>{{ label('网盘与文件源凭据', 'Storage Source Credentials') }}</strong>
            <small>{{ label('授权中心只保存凭据；系统挂载和文件浏览在文件工作台完成。', 'The authorization center only stores credentials; system mounts and file browsing belong to the storage workbench.') }}</small>
          </div>
          <div class="toolbar-actions">
            <button class="primary-btn" :disabled="isBusy('alist-auth-create')" @click="openCreateAlistAuth">
              {{ label('新增授权', 'Add Authorization') }}
            </button>
            <button class="plain-btn" @click="router.push('/storage')">
              {{ label('打开文件工作台', 'Open Storage') }}
            </button>
            <button class="plain-btn" :disabled="isBusy('alist-auths')" @click="loadAlistAuthorizations">
              {{ label('刷新', 'Refresh') }}
            </button>
          </div>
        </div>

        <div v-if="alistAuthorizations.length === 0" class="empty-line left">
          {{ label('还没有 AList/WebDAV 授权。先保存凭据，再到文件工作台创建系统挂载。', 'No AList/WebDAV authorization yet. Save credentials here, then create a system mount in the storage workbench.') }}
        </div>

        <div v-else class="target-table">
          <div class="target-row header">
            <span>{{ label('名称', 'Name') }}</span>
            <span>{{ label('挂载凭据', 'Mount Credential') }}</span>
            <span>{{ label('操作', 'Actions') }}</span>
          </div>
          <div v-for="record in alistAuthorizations" :key="record.id" class="target-row">
            <div class="device-cell">
              <strong>{{ record.name }}</strong>
              <small>auth_ref: alist:{{ record.id }} · authorization_id: {{ record.id }}</small>
            </div>

            <div class="endpoint-cell">
              <code>{{ record.driver === 'local' ? alistAuthRoot(record) : record.endpoint }}</code>
              <small>
                {{ record.driver }} · {{ record.username || label('无用户名', 'No username') }} ·
                {{ record.has_secret ? label('已保存密钥', 'Secret saved') : label('无密钥', 'No secret') }}
              </small>
            </div>

            <div class="row-actions">
              <button class="plain-btn compact" :disabled="isBusy(`alist-auth-edit-${record.id}`)" @click="openEditAlistAuth(record)">
                {{ label('编辑', 'Edit') }}
              </button>
              <button class="danger-btn compact" :disabled="isBusy(`alist-auth-delete-${record.id}`)" @click="deleteAlistAuth(record)">
                {{ label('删除', 'Delete') }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="selectedLocal === 'ssh'" class="detail-surface">
        <div class="detail-head">
          <div>
            <span class="eyebrow">{{ label('局域网账号', 'Local Network') }}</span>
            <h2>SSH</h2>
          </div>
          <span class="pill" :class="sshTargetCount > 0 ? 'ok' : 'muted'">
            {{ sshTargetCount > 0 ? label('已配置', 'Configured') : label('待接入', 'Pending') }}
          </span>
        </div>

        <div class="ssh-grid">
          <div class="ssh-form">
            <h3 class="form-title">
              {{ sshEditingId ? label('编辑接入', 'Edit target') : label('新增接入', 'Add target') }}
            </h3>
            <label class="form-row">
              <span>{{ label('名称', 'Name') }}</span>
              <input v-model="sshForm.name" :placeholder="label('客厅 Linux', 'Living-room Linux')" />
            </label>
            <div class="form-row form-row--split">
              <label class="form-col">
                <span>{{ label('主机', 'Host') }}</span>
                <input v-model="sshForm.host" placeholder="192.168.1.10" />
              </label>
              <label class="form-col form-col--port">
                <span>{{ label('端口', 'Port') }}</span>
                <input v-model.number="sshForm.port" type="number" min="1" max="65535" />
              </label>
            </div>
            <label class="form-row">
              <span>{{ label('用户', 'User') }}</span>
              <input v-model="sshForm.user" placeholder="root" />
            </label>
            <div class="form-row form-row--split">
              <label class="form-col">
                <span>{{ label('认证', 'Auth') }}</span>
                <select v-model="sshForm.auth">
                  <option value="key">SSH Key</option>
                  <option value="password">Password</option>
                </select>
              </label>
              <label v-if="sshForm.auth === 'key'" class="form-col">
                <span>{{ label('私钥文件', 'Key file') }}</span>
                <input v-model="sshForm.keyName" placeholder="n8n_watchdog" />
              </label>
              <label v-else class="form-col">
                <span>{{ label('密码', 'Password') }}</span>
                <input v-model="sshForm.password" type="password" />
              </label>
            </div>
            <div class="form-actions">
              <button class="btn-primary" :disabled="isBusy('ssh-save')" @click="saveSshTarget">
                {{ sshEditingId ? label('保存', 'Save') : label('新增', 'Add') }}
              </button>
              <button v-if="sshEditingId" class="btn-secondary" @click="resetSshForm">
                {{ label('取消', 'Cancel') }}
              </button>
            </div>
            <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
          </div>

          <div class="ssh-list">
            <h3 class="form-title">
              {{ label('已配置', 'Configured') }} · {{ sshTargets.length }}
            </h3>
            <div v-if="sshTargets.length === 0" class="empty-line">
              {{ label('还没有接入项', 'No targets yet') }}
            </div>
            <div v-for="t in sshTargets" :key="t.id" class="ssh-row" :class="{ active: sshEditingId === t.id }">
              <div class="ssh-row__main">
                <div class="ssh-row__name">{{ t.name }}</div>
                <div class="ssh-row__detail monospace">
                  {{ (t.target as any).user }}@{{ (t.target as any).host }}:{{ (t.target as any).port ?? 22 }}
                </div>
                <div class="ssh-row__auth">
                  {{ (t.target as any).auth === 'key' ? `key: ${(t.target as any).keyName}` : 'password' }}
                </div>
                <div v-if="sshTestResult?.id === t.id" class="ssh-row__test" :class="sshTestResult.ok ? 'ok' : 'bad'">
                  {{ sshTestResult.message }}
                </div>
              </div>
              <div class="ssh-row__actions">
                <button class="btn-ghost" :disabled="sshTestingId === t.id" @click="testSshTarget(t.id)">
                  {{ sshTestingId === t.id ? label('测试中…', 'Testing…') : label('测试', 'Test') }}
                </button>
                <button class="btn-ghost" @click="editSshTarget(t)">{{ label('编辑', 'Edit') }}</button>
                <button class="btn-ghost danger" @click="removeSshTarget(t.id)">{{ label('删除', 'Delete') }}</button>
              </div>
            </div>
          </div>
        </div>
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

      <div v-if="alistAuthFormOpen" class="dialog-overlay" @click.self="closeAlistAuthForm">
        <form class="dialog-panel" @submit.prevent="submitAlistAuth">
          <div class="dialog-head">
            <div>
              <span class="eyebrow">AList Driver</span>
              <h2>{{ editingAlistAuthId ? label('编辑授权', 'Edit Authorization') : label('新增授权', 'Add Authorization') }}</h2>
            </div>
            <button type="button" class="plain-btn compact" @click="closeAlistAuthForm">{{ label('关闭', 'Close') }}</button>
          </div>

          <div class="form-grid">
            <label class="form-field">
              <span>{{ label('名称', 'Name') }}</span>
              <input v-model="alistAuthName" class="form-input" :placeholder="label('家庭 WebDAV', 'Home WebDAV')" />
            </label>

            <label class="form-field">
              <span>Driver</span>
              <select v-model="alistAuthDriver" class="form-input">
                <option value="webdav">WebDAV</option>
                <option value="local">{{ label('本地目录', 'Local Folder') }}</option>
              </select>
            </label>

            <label v-if="alistAuthDriver === 'webdav'" class="form-field full">
              <span>Endpoint</span>
              <input v-model="alistAuthEndpoint" class="form-input" placeholder="https://example.test/dav" />
            </label>

            <label class="form-field full">
              <span>{{ alistAuthDriver === 'local' ? label('本地根路径', 'Local Root Path') : label('远端根路径', 'Remote Root Path') }}</span>
              <input v-model="alistAuthRootPath" class="form-input" :placeholder="alistAuthDriver === 'local' ? 'D:/files' : '/'" />
            </label>

            <label v-if="alistAuthDriver === 'webdav'" class="form-field">
              <span>{{ label('用户名', 'Username') }}</span>
              <input v-model="alistAuthUsername" class="form-input" autocomplete="username" />
            </label>

            <label v-if="alistAuthDriver === 'webdav'" class="form-field">
              <span>{{ editingAlistAuthId ? label('新密码', 'New Password') : label('密码', 'Password') }}</span>
              <input v-model="alistAuthPassword" class="form-input" type="password" autocomplete="new-password" :placeholder="editingAlistAuthId ? label('留空则不变', 'Leave blank to keep') : ''" />
            </label>
          </div>

          <div class="empty-line left">
            {{ label('保存后到文件工作台创建系统挂载；密码不会出现在设备或前端 props 中。', 'After saving, create a system mount in the storage workbench; secrets will not be written to device or frontend props.') }}
          </div>

          <div class="dialog-actions">
            <button type="button" class="plain-btn" @click="closeAlistAuthForm">{{ label('取消', 'Cancel') }}</button>
            <button
              type="submit"
              class="primary-btn"
              :disabled="!alistAuthName.trim() || (alistAuthDriver === 'webdav' && !alistAuthEndpoint.trim()) || (alistAuthDriver === 'local' && !alistAuthRootPath.trim()) || isBusy('alist-auth-create') || (editingAlistAuthId ? isBusy(`alist-auth-edit-${editingAlistAuthId}`) : false)"
            >
              {{ editingAlistAuthId ? label('保存', 'Save') : label('创建', 'Create') }}
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

.ssh-grid {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(0, 1.4fr);
  gap: 24px;
  align-items: start;
}
@media (max-width: 720px) {
  .ssh-grid { grid-template-columns: 1fr; }
}
.ssh-form, .ssh-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.form-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  margin: 0 0 4px;
}
.form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-row > span {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.form-row input, .form-row select {
  padding: 8px 10px;
  border: 1px solid var(--border-soft, #d4d4d8);
  border-radius: 6px;
  background: #fff;
  font-family: inherit;
  font-size: 13px;
  color: var(--text-primary, #18181b);
}
.form-row--split {
  display: grid;
  grid-template-columns: 1fr 110px;
  gap: 10px;
}
.form-row--split:has(.form-col:nth-child(3)) {
  grid-template-columns: 1fr 1fr;
}
.form-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-col > span {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.form-col input, .form-col select {
  padding: 8px 10px;
  border: 1px solid var(--border-soft, #d4d4d8);
  border-radius: 6px;
  background: #fff;
  font-family: inherit;
  font-size: 13px;
}
.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.btn-primary, .btn-secondary, .btn-ghost {
  border-radius: 6px;
  padding: 6px 14px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}
.btn-primary {
  background: #10b981;
  color: #fff;
}
.btn-primary:hover:not(:disabled) { background: #059669; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  background: transparent;
  color: var(--text-secondary, #52525b);
  border-color: var(--border-soft, #d4d4d8);
}
.btn-secondary:hover { background: #f4f4f5; }
.btn-ghost {
  background: transparent;
  color: var(--text-secondary, #52525b);
  border-color: transparent;
  padding: 4px 8px;
}
.btn-ghost:hover { background: #f4f4f5; }
.btn-ghost.danger { color: #b91c1c; }
.btn-ghost.danger:hover { background: #fef2f2; }
.form-error {
  color: #b91c1c;
  font-size: 12px;
  margin: 4px 0 0;
}
.ssh-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-soft, #e4e4e7);
  border-radius: 8px;
  background: #fff;
}
.ssh-row.active {
  border-color: #10b981;
  background: #ecfdf5;
}
.ssh-row__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.ssh-row__name { font-weight: 700; font-size: 13px; color: var(--text-primary, #18181b); }
.ssh-row__detail { font-size: 12px; color: var(--text-tertiary, #71717a); }
.ssh-row__auth { font-size: 11px; color: var(--text-tertiary, #71717a); }
.ssh-row__test { font-size: 11px; margin-top: 2px; }
.ssh-row__test.ok { color: #047857; }
.ssh-row__test.bad { color: #b91c1c; }
.ssh-row__actions { display: flex; gap: 4px; flex-shrink: 0; }

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
.adb-row,
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
.adb-table,
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
.adb-row.header,
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

.adb-row {
  min-height: 52px;
  padding: 11px;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(220px, 1fr) minmax(150px, auto);
  gap: 10px;
  align-items: center;
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

  .adb-row,
  .adb-row.header,
  .target-row,
  .target-row.header {
    grid-template-columns: 1fr;
  }

  .adb-row.header,
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
