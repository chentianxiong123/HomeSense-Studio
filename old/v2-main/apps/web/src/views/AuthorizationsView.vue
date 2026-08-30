<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api'
import { streamingGatewayApi, type MoonlightWebRuntimeStatus, type StreamingHost, type StreamingHostPairTask, type StreamingHostProbe } from '@/api/streamingGateway'
import AdbAuthPanel from '@/components/auth/AdbAuthPanel.vue'
import AuthPageHeader from '@/components/auth/AuthPageHeader.vue'
import AuthPendingPanel from '@/components/auth/AuthPendingPanel.vue'
import AuthProviderRail, { type AuthProviderItem } from '@/components/auth/AuthProviderRail.vue'
import AuthScopeTabs from '@/components/auth/AuthScopeTabs.vue'
import BilibiliAuthPanel from '@/components/auth/BilibiliAuthPanel.vue'
import DlnaAuthPanel from '@/components/auth/DlnaAuthPanel.vue'
import MiAuthPanel from '@/components/auth/MiAuthPanel.vue'
import SshAuthPanel from '@/components/auth/SshAuthPanel.vue'
import StreamingAuthPanel from '@/components/auth/StreamingAuthPanel.vue'
import CloudAuthPanel from '@/components/auth/CloudAuthPanel.vue'
import { useLocale } from '@/composables/useLocale'

type AuthTab = 'external' | 'local'
type ExternalProviderId = 'mi' | 'bilibili' | 'cloud'
type LocalProviderId = 'adb' | 'dlna' | 'streaming' | 'ssh' | 'frp'

type MiStatusSummary = { loggedIn: boolean; boundCount: number }
type BilibiliStatusSummary = { loggedIn: boolean; userName: string }

const router = useRouter()
const route = useRoute()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

const activeTab = ref<AuthTab>('external')
const selectedExternal = ref<ExternalProviderId>('mi')
const selectedLocal = ref<LocalProviderId>('adb')

const streamingHosts = ref<StreamingHost[]>([])
const streamingHostProbes = ref<Record<string, StreamingHostProbe>>({})
const streamingRuntimeStatus = ref<MoonlightWebRuntimeStatus | null>(null)
const streamingPairingHost = ref<StreamingHost | null>(null)
const streamingPairingTask = ref<StreamingHostPairTask | null>(null)
const streamingError = ref('')
const streamingMessage = ref('')
const streamingHostFormOpen = ref(false)
const streamingHostLabel = ref('')
const streamingHostEndpoint = ref('')
const streamingHostBasePort = ref('47989')
const streamingHostMac = ref('')
const streamingHostRoom = ref('')
const streamingHostNetworkPath = ref('lan')
const miAuthPanel = ref<InstanceType<typeof MiAuthPanel> | null>(null)
const miLoggedIn = ref(false)
const miBoundCount = ref(0)
const bilibiliAuthPanel = ref<InstanceType<typeof BilibiliAuthPanel> | null>(null)
const bilibiliLoggedIn = ref(false)
const bilibiliUserName = ref('')
const adbAuthPanel = ref<InstanceType<typeof AdbAuthPanel> | null>(null)
const adbBoundCount = ref(0)
const dlnaAuthPanel = ref<InstanceType<typeof DlnaAuthPanel> | null>(null)
const dlnaBoundCount = ref(0)
const sshAuthPanel = ref<InstanceType<typeof SshAuthPanel> | null>(null)
const sshTargetCount = ref(0)
const cloudAuthPanel = ref<InstanceType<typeof CloudAuthPanel> | null>(null)
const cloudDriveCount = ref(0)

const busy = ref<Record<string, boolean>>({})
const errorMessage = ref('')
const successMessage = ref('')
let successTimer: ReturnType<typeof setTimeout> | null = null
let streamingPairPollTimer: ReturnType<typeof setTimeout> | null = null

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

function updateBilibiliStatus(summary: BilibiliStatusSummary) {
  bilibiliLoggedIn.value = summary.loggedIn
  bilibiliUserName.value = summary.userName
}

const anyBusy = computed(() => Object.keys(busy.value).length > 0)
const streamingHostCount = computed(() => streamingHosts.value.length)

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
    status: bilibiliLoggedIn.value ? label('已登录', 'Logged in') : label('未登录', 'Logged out'),
    tone: bilibiliLoggedIn.value ? 'ok' as const : 'muted' as const,
    meta: bilibiliUserName.value || label('收藏夹', 'Favorites'),
  },
  {
    id: 'cloud' as const,
    name: label('网盘', 'Cloud Drives'),
    subtitle: label('百度网盘 / WebDAV', 'Baidu Netdisk / WebDAV'),
    status: cloudDriveCount.value > 0 ? label('已配置', 'Configured') : label('未配置', 'Not configured'),
    tone: cloudDriveCount.value > 0 ? 'ok' as const : 'muted' as const,
    meta: `${cloudDriveCount.value} ${label('个网盘', 'drives')}`,
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
])

onMounted(() => {
  if (route.query.local === 'streaming') {
    activeTab.value = 'local'
    selectedLocal.value = 'streaming'
  } else if (route.query.external === 'cloud') {
    activeTab.value = 'external'
    selectedExternal.value = 'cloud'
  }
  void loadAll()
})

onUnmounted(() => {
  if (successTimer) clearTimeout(successTimer)
  if (streamingPairPollTimer) clearTimeout(streamingPairPollTimer)
})

async function loadAll() {
  await Promise.allSettled([
    miAuthPanel.value?.refresh(),
    bilibiliAuthPanel.value?.refresh(),
    adbAuthPanel.value?.refresh(),
    dlnaAuthPanel.value?.refresh(),
    loadSshTargetCount(),
    sshAuthPanel.value?.refresh(),
    loadStreamingHosts(),
    loadStreamingRuntimeStatus(),
    cloudAuthPanel.value?.refresh(),
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

async function pairStreamingHost(host: StreamingHost) {
  setBusy(`streaming-pair-${host.id}`, true)
  streamingError.value = ''
  streamingMessage.value = ''
  streamingPairingHost.value = host
  streamingPairingTask.value = null
  if (streamingPairPollTimer) clearTimeout(streamingPairPollTimer)
  try {
    const res = await streamingGatewayApi.pairHost(host.id)
    streamingPairingTask.value = {
      task_id: res.data.task_id || '',
      host_id: host.id,
      status: 'pin',
      pin: res.data.pin,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      pairing: res.data.pairing,
    }
    streamingMessage.value = label('在 Sunshine 上输入下方 PIN。', 'Enter the PIN below on Sunshine.')
  } catch (error) {
    streamingError.value = (error as Error).message || String(error)
    streamingPairingTask.value = null
  } finally {
    setBusy(`streaming-pair-${host.id}`, false)
  }
}

async function pollStreamingPairTask(taskId: string) {
  try {
    const res = await streamingGatewayApi.pairTask(taskId)
    streamingPairingTask.value = res.data
    if (res.data.status === 'paired') {
      streamingMessage.value = label('配对完成。', 'Pairing complete.')
      await loadStreamingHosts()
      return
    }
    if (res.data.status === 'failed') {
      streamingError.value = res.data.error || label('配对失败', 'Pairing failed')
      return
    }
  } catch (error) {
    streamingError.value = (error as Error).message || String(error)
  }
}

async function checkStreamingPairTask() {
  const taskId = streamingPairingTask.value?.task_id
  if (!taskId) return
  setBusy(`streaming-pair-check-${taskId}`, true)
  streamingError.value = ''
  streamingMessage.value = ''
  try {
    await pollStreamingPairTask(taskId)
  } finally {
    setBusy(`streaming-pair-check-${taskId}`, false)
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

function closeStreamingPairing() {
  streamingPairingHost.value = null
  streamingPairingTask.value = null
  if (streamingPairPollTimer) clearTimeout(streamingPairPollTimer)
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

      <BilibiliAuthPanel
        v-else-if="selectedExternal === 'bilibili'"
        ref="bilibiliAuthPanel"
        :label="label"
        @status-change="updateBilibiliStatus"
        @error="errorMessage = $event"
        @success="showSuccess"
      />

      <CloudAuthPanel
        v-else-if="selectedExternal === 'cloud'"
        ref="cloudAuthPanel"
        :label="label"
        @count-change="cloudDriveCount = $event"
        @error="errorMessage = $event"
        @success="showSuccess"
      />
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

      <StreamingAuthPanel
        v-else-if="selectedLocal === 'streaming'"
        v-model:host-label="streamingHostLabel"
        v-model:host-endpoint="streamingHostEndpoint"
        v-model:host-base-port="streamingHostBasePort"
        v-model:host-mac="streamingHostMac"
        v-model:host-room="streamingHostRoom"
        v-model:host-network-path="streamingHostNetworkPath"
        :hosts="streamingHosts"
        :probes="streamingHostProbes"
        :runtime-status="streamingRuntimeStatus"
        :pairing-host="streamingPairingHost"
        :pairing-task="streamingPairingTask"
        :host-count="streamingHostCount"
        :loading="isBusy('streaming-hosts')"
        :action-loading="isBusy('streaming-register')"
        :error="streamingError"
        :message="streamingMessage"
        :show-form="streamingHostFormOpen"
        :label="label"
        @refresh-hosts="loadStreamingHosts"
        @refresh-runtime="loadStreamingRuntimeStatus"
        @toggle-form="streamingHostFormOpen = !streamingHostFormOpen"
        @register-host="registerStreamingHost"
        @probe-host="probeStreamingHost"
        @pair-host="pairStreamingHost"
        @check-pairing="checkStreamingPairTask"
        @wake-host="wakeStreamingHost"
        @remove-host="removeStreamingHost"
        @close-pairing="closeStreamingPairing"
      />

      <SshAuthPanel
        v-else-if="selectedLocal === 'ssh'"
        ref="sshAuthPanel"
        :label="label"
        @count-change="sshTargetCount = $event"
        @error="errorMessage = $event"
        @success="showSuccess"
      />

      <AuthPendingPanel
        v-else-if="selectedLocal === 'frp'"
        :scope="label('局域网账号', 'Local Network')"
        title="FRP"
        :description="label('FRP 内网穿透凭据和节点授权归这里。', 'FRP tunnel credentials and node authorization belong here.')"
        :label="label"
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

.notice {
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.workspace {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
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
}
</style>
