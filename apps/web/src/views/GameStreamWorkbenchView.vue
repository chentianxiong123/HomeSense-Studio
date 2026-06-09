<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import StreamingGatewayPanel from '@/components/remote-workspace/StreamingGatewayPanel.vue'
import StreamingMobileAccessPanel from '@/components/stream/StreamingMobileAccessPanel.vue'
import { streamingGatewayApi, type MoonlightWebRuntimeStatus, type StreamingHost, type StreamingHostProbe } from '@/api/streamingGateway'
import { useLocale } from '@/composables/useLocale'

type StreamingGatewaySpec = {
  key: string
  title: string
  subtitle: string
  status: string
  detail: string
  capabilities: string[]
}

const router = useRouter()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
const hosts = ref<StreamingHost[]>([])
const probes = ref<Record<string, StreamingHostProbe>>({})
const runtimeStatus = ref<MoonlightWebRuntimeStatus | null>(null)
const loading = ref(false)
const actionLoading = ref(false)
const error = ref('')
const message = ref('')
const showForm = ref(false)
const hostLabel = ref('')
const hostEndpoint = ref('')
const hostBasePort = ref('47989')
const hostMac = ref('')
const hostRoom = ref('')
const hostNetworkPath = ref('lan')

const specs = computed<StreamingGatewaySpec[]>(() => [
  {
    key: 'sunshine-hosts',
    title: label('Sunshine 主机', 'Sunshine Hosts'),
    subtitle: label('保存高性能电脑、工作站或游戏主机。', 'Save gaming PCs, workstations, or high-performance hosts.'),
    status: hosts.value.length > 0 ? label('已有主机', 'Hosts Ready') : label('待登记', 'Pending'),
    detail: label('主机保存、探测、唤醒统一走授权中心；这里负责使用这些目标。', 'Host save, probe, and wake are owned by Authorization Center; this workbench uses those targets.'),
    capabilities: ['streaming.host.sunshine', 'device.wake_on_lan', 'service.status.probe'],
  },
  {
    key: 'game-library',
    title: label('应用库', 'App Library'),
    subtitle: label('后续从 Sunshine 读取可启动应用。', 'Later read launchable apps from Sunshine.'),
    status: label('下一步', 'Next'),
    detail: label('参考 moonlight-web-stream 的 host app list，不在浏览器手写 Sunshine 协议。', 'Follow moonlight-web-stream host app listing; do not hand-code Sunshine protocol in the browser.'),
    capabilities: ['streaming.apps.list', 'streaming.app.image', 'streaming.session.launch'],
  },
  {
    key: 'web-runtime',
    title: label('Web 串流视图', 'Web Stream Viewer'),
    subtitle: label('独立全屏视图承载视频、音频和输入。', 'A separate fullscreen view owns video, audio, and input.'),
    status: runtimeStatus.value?.registered ? label('已配置', 'Configured') : label('预留', 'Reserved'),
    detail: label('后续接 Moonlight Web runtime / WebRTC 桥。', 'Later wire Moonlight Web runtime / WebRTC bridge.'),
    capabilities: ['streaming.web_player.open', 'streaming.input.keyboard', 'streaming.input.gamepad'],
  },
])

onMounted(() => {
  void refreshHosts()
  void refreshRuntime()
})

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

async function refreshHosts() {
  loading.value = true
  error.value = ''
  try {
    const result = await streamingGatewayApi.hosts()
    hosts.value = result.data ?? []
  } catch (e) {
    error.value = e instanceof Error ? e.message : label('无法读取串流主机。', 'Failed to load streaming hosts.')
  } finally {
    loading.value = false
  }
}

async function refreshRuntime() {
  try {
    const result = await streamingGatewayApi.runtimeStatus()
    runtimeStatus.value = result.data ?? null
  } catch {
    runtimeStatus.value = null
  }
}

async function registerHost() {
  if (!hostLabel.value.trim() || !hostEndpoint.value.trim()) return
  actionLoading.value = true
  error.value = ''
  message.value = ''
  try {
    await streamingGatewayApi.registerHost({
      label: hostLabel.value.trim(),
      endpoint: hostEndpoint.value.trim(),
      base_port: hostBasePort.value.trim(),
      mac_address: hostMac.value.trim(),
      room: hostRoom.value.trim(),
      network_path: hostNetworkPath.value,
    })
    hostLabel.value = ''
    hostEndpoint.value = ''
    hostBasePort.value = '47989'
    hostMac.value = ''
    hostRoom.value = ''
    hostNetworkPath.value = 'lan'
    showForm.value = false
    message.value = label('Sunshine 主机已保存。', 'Sunshine host saved.')
    await refreshHosts()
  } catch (e) {
    error.value = e instanceof Error ? e.message : label('保存 Sunshine 主机失败。', 'Failed to save Sunshine host.')
  } finally {
    actionLoading.value = false
  }
}

async function probeHost(host: StreamingHost) {
  actionLoading.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await streamingGatewayApi.probeHost(host.id)
    probes.value = { ...probes.value, [host.id]: result.data }
    message.value = result.data.reachable
      ? label('Sunshine 主机探测通过。', 'Sunshine host probe passed.')
      : label('Sunshine 主机不可达。', 'Sunshine host is not reachable.')
  } catch (e) {
    error.value = e instanceof Error ? e.message : label('探测 Sunshine 主机失败。', 'Failed to probe Sunshine host.')
  } finally {
    actionLoading.value = false
  }
}

async function wakeHost(host: StreamingHost) {
  actionLoading.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await streamingGatewayApi.wakeHost(host.id)
    message.value = `${label('已发送 Wake-on-LAN。', 'Wake-on-LAN sent.')} ${result.data.broadcast_address}:${result.data.port}`
  } catch (e) {
    error.value = e instanceof Error ? e.message : label('发送 Wake-on-LAN 失败。', 'Failed to send Wake-on-LAN.')
  } finally {
    actionLoading.value = false
  }
}

async function removeHost(host: StreamingHost) {
  actionLoading.value = true
  error.value = ''
  message.value = ''
  try {
    await streamingGatewayApi.removeHost(host.id)
    message.value = label('Sunshine 主机已移除。', 'Sunshine host removed.')
    await refreshHosts()
  } catch (e) {
    error.value = e instanceof Error ? e.message : label('移除 Sunshine 主机失败。', 'Failed to remove Sunshine host.')
  } finally {
    actionLoading.value = false
  }
}

function openRuntime() {
  const endpoint = runtimeStatus.value?.endpoint || ''
  if (!endpoint.startsWith('http')) return
  window.open(endpoint, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div class="streaming-page">
    <header class="streaming-head">
      <div>
        <span class="eyebrow">Streaming</span>
        <h1>{{ label('串流工作台', 'Streaming Workbench') }}</h1>
      </div>
      <div class="head-actions">
        <button class="secondary-btn" type="button" @click="router.push('/authorizations')">
          {{ label('授权中心', 'Authorization Center') }}
        </button>
        <button class="primary-btn" type="button" @click="showForm = true">
          {{ label('登记主机', 'Register Host') }}
        </button>
      </div>
    </header>

    <section class="streaming-summary">
      <article>
        <span>{{ label('已保存主机', 'Saved Hosts') }}</span>
        <strong>{{ hosts.length }}</strong>
      </article>
      <article>
        <span>{{ label('运行时', 'Runtime') }}</span>
        <strong>{{ runtimeStatus?.reachable ? label('可达', 'Reachable') : label('未连接', 'Offline') }}</strong>
      </article>
      <article>
        <span>{{ label('下一阶段', 'Next Stage') }}</span>
        <strong>{{ label('应用库', 'App List') }}</strong>
      </article>
    </section>

    <StreamingMobileAccessPanel
      :hosts="hosts"
      :runtime-status="runtimeStatus"
      :label="label"
      @register-host="showForm = true"
    />

    <StreamingGatewayPanel
      :specs="specs"
      :hosts="hosts"
      :probes="probes"
      :runtime-status="runtimeStatus"
      :registered="hosts.length > 0"
      :loading="loading"
      :action-loading="actionLoading"
      :error="error"
      :message="message"
      :show-form="showForm"
      :host-label="hostLabel"
      :host-endpoint="hostEndpoint"
      :host-base-port="hostBasePort"
      :host-mac="hostMac"
      :host-room="hostRoom"
      :host-network-path="hostNetworkPath"
      :label="label"
      @refresh-hosts="refreshHosts"
      @refresh-runtime="refreshRuntime"
      @toggle-form="showForm = !showForm"
      @register-host="registerHost"
      @probe-host="probeHost"
      @wake-host="wakeHost"
      @remove-host="removeHost"
      @open-runtime="openRuntime"
      @update:host-label="hostLabel = $event"
      @update:host-endpoint="hostEndpoint = $event"
      @update:host-base-port="hostBasePort = $event"
      @update:host-mac="hostMac = $event"
      @update:host-room="hostRoom = $event"
      @update:host-network-path="hostNetworkPath = $event"
    />
  </div>
</template>

<style scoped>
.streaming-page {
  min-height: 100%;
  overflow-y: auto;
  padding: 32px 40px 128px;
  background: #f7f9fa;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.streaming-head,
.streaming-summary {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.streaming-head {
  min-height: 94px;
  padding: 22px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow {
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
}

h1 {
  margin: 5px 0 0;
  color: var(--text-primary, #1e293b);
  font-size: 30px;
  font-weight: 900;
  letter-spacing: 0;
}

.head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.primary-btn,
.secondary-btn {
  min-height: 38px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 14px;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
  background: #fff;
  color: #334155;
}

.primary-btn {
  border-color: #0f766e;
  background: #0f766e;
  color: #fff;
}

.streaming-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
}

.streaming-summary article {
  min-height: 78px;
  padding: 16px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
}

.streaming-summary span {
  color: #64748b;
  font-size: 12px;
  font-weight: 900;
}

.streaming-summary strong {
  color: #0f172a;
  font-size: 20px;
  font-weight: 900;
}

@media (max-width: 760px) {
  .streaming-page {
    padding: 20px 16px 120px;
  }

  .streaming-head {
    flex-direction: column;
    align-items: stretch;
  }

  .streaming-summary {
    grid-template-columns: 1fr;
  }
}
</style>
