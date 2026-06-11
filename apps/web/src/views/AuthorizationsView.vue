<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/api'
import { streamingGatewayApi, type MoonlightWebRuntimeStatus, type StreamingHost, type StreamingHostProbe } from '@/api/streamingGateway'
import AdbAuthPanel from '@/components/auth/AdbAuthPanel.vue'
import AuthPageHeader from '@/components/auth/AuthPageHeader.vue'
import AuthProviderRail, { type AuthProviderItem } from '@/components/auth/AuthProviderRail.vue'
import AuthScopeTabs from '@/components/auth/AuthScopeTabs.vue'
import DlnaAuthPanel from '@/components/auth/DlnaAuthPanel.vue'
import MiAuthPanel from '@/components/auth/MiAuthPanel.vue'
import SshAuthPanel from '@/components/auth/SshAuthPanel.vue'
import StreamingGatewayPanel from '@/components/remote-workspace/StreamingGatewayPanel.vue'
import StorageCredentialsPanel from '@/components/storage/StorageCredentialsPanel.vue'
import { useLocale } from '@/composables/useLocale'

type AuthTab = 'external' | 'local'
type ExternalProviderId = 'mi' | 'bilibili'
type LocalProviderId = 'adb' | 'dlna' | 'streaming' | 'alist' | 'ssh' | 'frp' | 'smb'

type MiStatusSummary = { loggedIn: boolean; boundCount: number }

const router = useRouter()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

const activeTab = ref<AuthTab>('external')
const selectedExternal = ref<ExternalProviderId>('mi')
const selectedLocal = ref<LocalProviderId>('adb')

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
const miAuthPanel = ref<InstanceType<typeof MiAuthPanel> | null>(null)
const miLoggedIn = ref(false)
const miBoundCount = ref(0)
const adbAuthPanel = ref<InstanceType<typeof AdbAuthPanel> | null>(null)
const adbBoundCount = ref(0)
const dlnaAuthPanel = ref<InstanceType<typeof DlnaAuthPanel> | null>(null)
const dlnaBoundCount = ref(0)
const sshAuthPanel = ref<InstanceType<typeof SshAuthPanel> | null>(null)
const sshTargetCount = ref(0)

const busy = ref<Record<string, boolean>>({})
const errorMessage = ref('')
const successMessage = ref('')
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

function updateMiStatus(summary: MiStatusSummary) {
  miLoggedIn.value = summary.loggedIn
  miBoundCount.value = summary.boundCount
}

const anyBusy = computed(() => Object.keys(busy.value).length > 0)
const streamingHostCount = computed(() => streamingHosts.value.length)

type StreamingGatewaySpec = {
  key: string
  title: string
  subtitle: string
  status: string
  detail: string
  capabilities: string[]
}

const externalProviders = computed<AuthProviderItem<ExternalProviderId>[]>(() => [
  {
    id: 'mi' as const,
    name: 'Mi',
    subtitle: label('米家账号', 'Mi account'),
    status: miLoggedIn.value ? label('已登录', 'Logged in') : label('未登录', 'Logged out'),
    tone: miLoggedIn.value ? 'ok' as const : 'muted' as const,
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

const localProviders = computed<AuthProviderItem<LocalProviderId>[]>(() => [
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
  if (successTimer) clearTimeout(successTimer)
})

async function loadAll() {
  await Promise.allSettled([
    miAuthPanel.value?.refresh(),
    adbAuthPanel.value?.refresh(),
    dlnaAuthPanel.value?.refresh(),
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

</script>

<template>
  <div class="auth-page">
    <AuthPageHeader :busy="anyBusy" :label="label" @refresh="loadAll" />

    <div v-if="errorMessage" class="notice error">{{ errorMessage }}</div>
    <div v-if="successMessage" class="notice success">{{ successMessage }}</div>

    <AuthScopeTabs v-model:active-tab="activeTab" :label="label" />

    <section v-if="activeTab === 'external'" class="workspace">
      <AuthProviderRail :providers="externalProviders" :selected="selectedExternal" @select="selectedExternal = $event" />

      <MiAuthPanel
        v-if="selectedExternal === 'mi'"
        ref="miAuthPanel"
        :label="label"
        @status-change="updateMiStatus"
        @error="errorMessage = $event"
        @success="showSuccess"
      />

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
      <AuthProviderRail :providers="localProviders" :selected="selectedLocal" @select="selectedLocal = $event" />

      <AdbAuthPanel
        v-if="selectedLocal === 'adb'"
        ref="adbAuthPanel"
        :label="label"
        @count-change="adbBoundCount = $event"
        @error="errorMessage = $event"
        @success="showSuccess"
      />

      <DlnaAuthPanel
        v-else-if="selectedLocal === 'dlna'"
        ref="dlnaAuthPanel"
        :label="label"
        @count-change="dlnaBoundCount = $event"
        @error="errorMessage = $event"
        @success="showSuccess"
      />

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

.detail-surface,
.notice {
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.eyebrow {
  display: inline-flex;
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
}

h2 {
  margin: 5px 0 0;
  color: var(--text-primary);
  font-weight: 900;
  letter-spacing: 0;
}

h2 {
  font-size: 24px;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.empty-line {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.workspace {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.ok,
.pill.ok {
  background: #10b981;
}

.detail-surface {
  min-height: 470px;
  border-radius: 8px;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.empty-line {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
}

.empty-line {
  padding: 18px;
  text-align: center;
}

.empty-line.left {
  text-align: left;
}

.row-actions {
  justify-content: flex-end;
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
}

@media (max-width: 760px) {
  .auth-page {
    padding: 16px;
  }

  .detail-head {
    align-items: flex-start;
    flex-direction: column;
  }

}
</style>
