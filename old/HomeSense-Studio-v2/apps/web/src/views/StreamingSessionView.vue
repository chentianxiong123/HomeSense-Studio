<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  streamingGatewayApi,
  type StreamingHostProbe,
  type StreamingRuntimeApp,
  type StreamingSessionEntry,
} from '@/api/streamingGateway'
import { useLocale } from '@/composables/useLocale'

const route = useRoute()
const router = useRouter()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

const hostId = computed(() => (typeof route.query.host_id === 'string' ? route.query.host_id : ''))
const shouldAutostart = computed(() => route.query.autostart === '1')
const deviceName = computed(() => (typeof route.query.name === 'string' && route.query.name ? route.query.name : entry.value?.host.label || label('串流设备', 'Streaming Device')))
const returnTo = computed(() => (typeof route.query.from === 'string' && route.query.from.startsWith('/') ? route.query.from : '/devices'))

const entry = ref<StreamingSessionEntry | null>(null)
const apps = ref<StreamingRuntimeApp[]>([])
const activeApp = ref<StreamingRuntimeApp | null>(null)
const activeStreamUrl = ref('')
const probe = ref<StreamingHostProbe | null>(null)
const loading = ref(false)
const acting = ref(false)
const error = ref('')
const message = ref('')

const visibleApps = computed(() => apps.value.filter((app) => !app.hidden))
const paired = computed(() => entry.value?.host.pairing?.status === 'paired' && !entry.value.host.pairing.mock_pairing)
const ready = computed(() => Boolean(entry.value?.runtime.reachable && paired.value))

onMounted(async () => {
  await loadDeviceStream()
})

async function loadDeviceStream() {
  if (!hostId.value) {
    error.value = label('这个设备还没有绑定串流来源。', 'This device has no streaming source bound.')
    return
  }
  loading.value = true
  error.value = ''
  message.value = ''
  probe.value = null
  try {
    const [sessionResult, appsResult] = await Promise.all([
      streamingGatewayApi.sessionEntry(hostId.value),
      streamingGatewayApi.hostApps(hostId.value),
    ])
    entry.value = sessionResult.data
    apps.value = appsResult.data ?? []
    activeApp.value = null
    activeStreamUrl.value = ''
    if (shouldAutostart.value) startDefaultApp()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    entry.value = null
    apps.value = []
  } finally {
    loading.value = false
  }
}

function startDefaultApp() {
  const candidates = visibleApps.value
  const desktop = candidates.find((app) => app.name.trim().toLowerCase() === 'desktop')
  const target = desktop ?? candidates[0]
  if (target) startApp(target)
}

function startApp(app: StreamingRuntimeApp) {
  if (!app.stream_url) return
  activeApp.value = app
  activeStreamUrl.value = app.stream_url
  message.value = ''
}

function closeStream() {
  activeApp.value = null
  activeStreamUrl.value = ''
}

async function probeHost() {
  if (!entry.value) return
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await streamingGatewayApi.probeHost(entry.value.host.id)
    probe.value = result.data
    message.value = result.data.reachable ? label('主机可达', 'Host reachable') : label('主机不可达', 'Host offline')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    acting.value = false
  }
}

async function wakeHost() {
  if (!entry.value) return
  acting.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await streamingGatewayApi.wakeHost(entry.value.host.id)
    message.value = `${label('已发送唤醒', 'Wake sent')} ${result.data.broadcast_address}:${result.data.port}`
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    acting.value = false
  }
}

function openPairing() {
  router.push({ path: '/authorizations', query: { local: 'streaming' } })
}

function back() {
  router.push(returnTo.value)
}
</script>

<template>
  <main class="stream-session">
    <header class="session-bar">
      <button class="bar-btn" @click="back">{{ label('返回', 'Back') }}</button>
      <div class="title">
        <strong>{{ deviceName }}</strong>
        <small>{{ entry?.host.endpoint || label('设备串流入口', 'Device streaming entry') }}</small>
      </div>
      <span :class="['status-pill', ready ? 'ok' : 'warn']">
        {{ ready ? label('可串流', 'Ready') : label('需检查', 'Check') }}
      </span>
      <button class="bar-btn" :disabled="loading" @click="loadDeviceStream">{{ label('刷新', 'Refresh') }}</button>
    </header>

    <section v-if="!activeStreamUrl" class="device-panel">
      <div class="device-main">
        <span>{{ label('Sunshine 主机', 'Sunshine Host') }}</span>
        <strong>{{ entry?.host.label || '-' }}</strong>
        <small>{{ paired ? label('已配对，可以从下面选择应用开始。', 'Paired. Choose an app below to start.') : label('还未完成配对，请回认证中心处理。', 'Pairing is not complete. Use Auth Center first.') }}</small>
      </div>
      <div class="device-actions">
        <button class="secondary-btn" :disabled="acting || !entry" @click="probeHost">{{ label('探测', 'Probe') }}</button>
        <button class="secondary-btn" :disabled="acting || !entry?.host.mac_address" @click="wakeHost">{{ label('唤醒', 'Wake') }}</button>
        <button class="secondary-btn" @click="openPairing">{{ label('认证中心', 'Auth Center') }}</button>
      </div>
    </section>

    <p v-if="error" class="error-line">{{ error }}</p>
    <p v-if="message" class="info-line">{{ message }}</p>

    <section v-if="activeStreamUrl" class="viewer-shell">
      <div class="viewer-toolbar">
        <div>
          <strong>{{ activeApp?.name || label('串流中', 'Streaming') }}</strong>
          <small>{{ entry?.host.label }}</small>
        </div>
        <button class="bar-btn" @click="closeStream">{{ label('退出串流', 'Exit Stream') }}</button>
      </div>
      <iframe
        class="viewer-frame"
        :src="activeStreamUrl"
        allow="fullscreen; autoplay; clipboard-read; clipboard-write; gamepad"
      />
    </section>

    <section v-else class="app-section">
      <div class="section-head">
        <div>
          <strong>{{ label('选择要启动的应用', 'Choose App') }}</strong>
          <small>{{ loading ? label('读取中', 'Loading') : `${visibleApps.length}` }}</small>
        </div>
      </div>

      <div v-if="loading" class="empty-state">{{ label('正在读取设备应用…', 'Loading apps…') }}</div>
      <div v-else-if="!ready" class="empty-state">
        <strong>{{ label('串流还不能启动', 'Streaming is not ready') }}</strong>
        <small>{{ label('完成配对后，这里会只显示这个设备的应用。', 'After pairing, only this device apps appear here.') }}</small>
      </div>
      <div v-else-if="visibleApps.length === 0" class="empty-state">
        <strong>{{ label('没有应用', 'No apps') }}</strong>
        <small>{{ label('Sunshine 没有返回可启动应用。', 'Sunshine did not return launchable apps.') }}</small>
      </div>
      <div v-else class="app-grid">
        <button v-for="app in visibleApps" :key="String(app.app_id)" class="app-tile" type="button" @click="startApp(app)">
          <span>{{ app.name.slice(0, 1).toUpperCase() }}</span>
          <strong>{{ app.name }}</strong>
          <small>{{ app.running ? label('运行中', 'Running') : label('启动', 'Start') }}</small>
        </button>
      </div>
    </section>

    <section v-if="probe && !activeStreamUrl" class="probe-panel">
      <header>
        <strong>{{ probe.reachable ? label('探测通过', 'Probe passed') : label('探测失败', 'Probe failed') }}</strong>
        <small>{{ probe.checked_at }}</small>
      </header>
      <div class="port-grid">
        <span v-for="port in probe.ports" :key="`${port.protocol}-${port.port}`">
          {{ port.protocol }}/{{ port.port }} · {{ port.role }}
        </span>
      </div>
    </section>
  </main>
</template>

<style scoped>
.stream-session {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: #0b1220;
  color: #e5e7eb;
}

.session-bar,
.device-panel,
.app-section,
.probe-panel,
.viewer-shell {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: #111827;
}

.session-bar {
  min-height: 58px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
}

.title,
.device-main,
.viewer-toolbar > div {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.title strong,
.device-main strong,
.section-head strong,
.viewer-toolbar strong,
.probe-panel strong {
  color: #f9fafb;
  font-size: 15px;
  font-weight: 900;
}

.title small,
.device-main small,
.section-head small,
.viewer-toolbar small,
.probe-panel small,
.empty-state small,
.app-tile small {
  color: #9ca3af;
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.device-main span {
  color: #5eead4;
  font-size: 11px;
  font-weight: 900;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 900;
}

.status-pill.ok {
  background: #064e3b;
  color: #a7f3d0;
}

.status-pill.warn {
  background: #451a03;
  color: #fed7aa;
}

.bar-btn,
.secondary-btn {
  min-height: 34px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 6px;
  background: #1f2937;
  color: #e5e7eb;
  font: inherit;
  font-size: 12px;
  font-weight: 900;
  padding: 0 12px;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.device-panel {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
}

.device-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.error-line,
.info-line {
  margin: 0;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 900;
}

.error-line {
  border: 1px solid #7f1d1d;
  background: #450a0a;
  color: #fecaca;
}

.info-line {
  border: 1px solid #134e4a;
  background: #042f2e;
  color: #99f6e4;
}

.app-section {
  padding: 14px;
}

.section-head,
.probe-panel header,
.viewer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-head {
  margin-bottom: 12px;
}

.app-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.app-tile {
  min-height: 126px;
  display: grid;
  justify-items: start;
  align-content: space-between;
  gap: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  background: #172033;
  color: #f9fafb;
  padding: 14px;
  text-align: left;
  cursor: pointer;
}

.app-tile:hover {
  border-color: #14b8a6;
  background: #1e293b;
}

.app-tile span {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: #0f766e;
  color: #fff;
  font-size: 18px;
  font-weight: 900;
}

.app-tile strong {
  width: 100%;
  color: #f9fafb;
  font-size: 14px;
  font-weight: 900;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.empty-state {
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  color: #9ca3af;
  text-align: center;
}

.empty-state strong {
  color: #f9fafb;
  font-size: 16px;
}

.viewer-shell {
  flex: 1;
  min-height: 520px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.viewer-toolbar {
  padding: 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.24);
}

.viewer-frame {
  flex: 1;
  width: 100%;
  min-height: 470px;
  border: 0;
  background: #020617;
}

.probe-panel {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.port-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.port-grid span {
  border-radius: 999px;
  padding: 5px 8px;
  background: #1f2937;
  color: #cbd5e1;
  font-size: 11px;
  font-weight: 900;
}

@media (max-width: 760px) {
  .session-bar,
  .device-panel,
  .section-head,
  .viewer-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .device-actions {
    justify-content: stretch;
  }

  .device-actions button,
  .bar-btn {
    width: 100%;
  }
}
</style>
