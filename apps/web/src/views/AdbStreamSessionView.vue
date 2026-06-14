<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api'
import { cliApi } from '@/api/cli'
import { streamingGatewayApi, type AdbScrcpySession } from '@/api/streamingGateway'
import AdbRawH264Player from '@/components/stream/AdbRawH264Player.vue'
import { useLocale } from '@/composables/useLocale'

const route = useRoute()
const router = useRouter()
const { locale } = useLocale()

const isZh = computed(() => locale.value === 'zh')
function label(zh: string, en: string) { return isZh.value ? zh : en }

const loading = ref(false)
const stopping = ref(false)
const errorMessage = ref('')
const statusMessage = ref('')
const session = ref<AdbScrcpySession | null>(null)
const wsPath = ref('')
const playerKey = ref(0)
const playerState = ref('')
let startupTimer = 0
let inspectTimer = 0

const adbDevice = computed(() => {
  const value = route.query.device
  return typeof value === 'string' ? value.trim() : ''
})

const deviceName = computed(() => {
  const value = route.query.name
  return typeof value === 'string' && value.trim() ? value.trim() : adbDevice.value || label('ADB 串流', 'ADB Stream')
})

function returnPath() {
  const from = route.query.from
  return typeof from === 'string' && from.startsWith('/') ? from : '/devices'
}

async function resolveAdbDevice(): Promise<string> {
  if (adbDevice.value) return adbDevice.value
  const id = Number(route.query.target_device_id)
  if (!Number.isFinite(id)) return ''
  const result = await api.userDevices.get(id)
  const props = result.device?.props ?? {}
  const value = props.adb_ip || props.adb_serial
  return typeof value === 'string' ? value.trim() : ''
}

async function startStream() {
  if (loading.value) return
  loading.value = true
  errorMessage.value = ''
  statusMessage.value = label('正在启动串流...', 'Starting stream...')
  wsPath.value = ''
  if (startupTimer) window.clearTimeout(startupTimer)
  try {
    const device = await resolveAdbDevice()
    if (!device) throw new Error(label('这个设备没有 ADB 来源。', 'This device has no ADB source.'))
    const result = await streamingGatewayApi.createAdbScrcpySession({
      device,
      profile: 'browser_bridge',
      max_size: 1024,
      bit_rate: '2M',
      max_fps: 30,
      video_buffer: 0,
      audio: false,
      window: false,
      playback: false,
      control: false,
      label: `${deviceName.value} stream`,
    })
    if (result.status !== 'success' || !result.data.stream?.ws_path) {
      throw new Error(label('后端没有返回可播放的串流。', 'The backend did not return a playable stream.'))
    }
    session.value = result.data
    statusMessage.value = label('串流已启动，正在连接画面...', 'Stream started, connecting video...')
    startInspectLoop(result.data.id)
    startupTimer = window.setTimeout(() => {
      wsPath.value = result.data.stream?.ws_path || ''
    }, 250)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
    statusMessage.value = ''
  } finally {
    loading.value = false
  }
}

function startInspectLoop(id: string) {
  if (inspectTimer) window.clearInterval(inspectTimer)
  inspectTimer = window.setInterval(async () => {
    try {
      const result = await streamingGatewayApi.adbScrcpySession(id)
      if (result.status === 'success') {
        session.value = result.data
        if (result.data.error) errorMessage.value = result.data.error
        if (['failed', 'exited', 'stopped'].includes(result.data.state)) {
          window.clearInterval(inspectTimer)
          inspectTimer = 0
        }
      }
    } catch {
      // Keep the stream page alive; the websocket/player error is more useful here.
    }
  }, 1000)
}

async function stopStream() {
  if (stopping.value) return
  const id = session.value?.id
  wsPath.value = ''
  if (startupTimer) {
    window.clearTimeout(startupTimer)
    startupTimer = 0
  }
  if (inspectTimer) {
    window.clearInterval(inspectTimer)
    inspectTimer = 0
  }
  if (!id) return
  stopping.value = true
  try {
    await streamingGatewayApi.stopAdbScrcpySession(id)
    statusMessage.value = label('串流已停止。', 'Stream stopped.')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    stopping.value = false
  }
}

async function restartStream() {
  if (session.value?.stream?.ws_path) {
    wsPath.value = ''
    playerState.value = ''
    playerKey.value += 1
    await new Promise((resolve) => window.setTimeout(resolve, 180))
    wsPath.value = session.value.stream.ws_path
    statusMessage.value = label('正在重连画面...', 'Reconnecting video...')
    return
  }
  await startStream()
}

async function tapRawPoint(point: { x: number; y: number }) {
  const device = await resolveAdbDevice()
  if (!device) return
  try {
    await cliApi.run('adb-cli', {
      action: 'tap',
      params: { device, x: point.x, y: point.y },
      ttl_ms: 0,
      bypass_cache: true,
    })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

async function swipeRawGesture(gesture: { start_x: number; start_y: number; end_x: number; end_y: number; duration: number }) {
  const device = await resolveAdbDevice()
  if (!device) return
  try {
    await cliApi.run('adb-cli', {
      action: 'swipe',
      params: { device, ...gesture },
      ttl_ms: 0,
      bypass_cache: true,
    })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

async function back() {
  await stopStream()
  router.push(returnPath())
}

onMounted(() => {
  void startStream()
})

onBeforeUnmount(() => {
  if (startupTimer) window.clearTimeout(startupTimer)
  if (inspectTimer) window.clearInterval(inspectTimer)
  void stopStream()
})
</script>

<template>
  <div class="adb-stream-view">
    <header class="stream-bar">
      <button class="bar-btn" @click="back">← {{ label('返回', 'Back') }}</button>
      <div class="stream-title">
        <strong>{{ deviceName }}</strong>
        <span>{{ adbDevice || route.query.target_device_id || '-' }}</span>
      </div>
      <span v-if="statusMessage" class="status-text">{{ statusMessage }}</span>
      <span v-if="errorMessage" class="status-text error">{{ errorMessage }}</span>
      <button class="bar-btn" :disabled="loading" @click="restartStream">{{ label('重连', 'Reconnect') }}</button>
      <button class="bar-btn danger" :disabled="stopping" @click="stopStream">{{ label('停止', 'Stop') }}</button>
    </header>

    <main class="stream-stage">
      <AdbRawH264Player
        v-if="wsPath"
        :key="playerKey"
        class="stream-player"
        :ws-path="wsPath"
        :label="label"
        autoplay
        interactive
        :show-toolbar="false"
        @tap="tapRawPoint"
        @swipe="swipeRawGesture"
        @state-change="playerState = $event"
      />
      <div v-else class="stream-placeholder">
        <strong>{{ errorMessage || statusMessage || label('准备串流...', 'Preparing stream...') }}</strong>
        <button v-if="errorMessage" class="bar-btn" @click="startStream">{{ label('重新开始', 'Start Again') }}</button>
      </div>
    </main>

    <footer class="stream-footer">
      <span>{{ label('状态', 'State') }}: {{ playerState || session?.state || '-' }}</span>
      <span v-if="session?.id">{{ session.id }}</span>
    </footer>
    <pre v-if="session?.stderr_tail?.length || session?.error" class="stream-debug">{{ [session?.error, ...(session?.stderr_tail || [])].filter(Boolean).slice(-8).join('\n') }}</pre>
  </div>
</template>

<style scoped>
.adb-stream-view {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #05070b;
  color: #e5e7eb;
}

.stream-bar,
.stream-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-color: #1f2937;
  background: #0b1020;
  font-size: 13px;
}

.stream-bar {
  border-bottom: 1px solid #1f2937;
}

.stream-footer {
  justify-content: space-between;
  border-top: 1px solid #1f2937;
  color: #94a3b8;
}

.stream-title {
  display: flex;
  min-width: 0;
  flex-direction: column;
  flex: 1;
}

.stream-title strong,
.stream-title span,
.status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stream-title strong {
  color: #f8fafc;
  font-size: 14px;
}

.stream-title span {
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
}

.status-text {
  max-width: 36vw;
  color: #93c5fd;
  font-weight: 800;
}

.status-text.error {
  color: #fca5a5;
}

.bar-btn {
  flex: 0 0 auto;
  min-height: 30px;
  border: 1px solid #334155;
  border-radius: 6px;
  background: #111827;
  color: #e5e7eb;
  padding: 5px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.bar-btn:hover:not(:disabled) {
  border-color: #60a5fa;
  color: #bfdbfe;
}

.bar-btn.danger {
  border-color: #7f1d1d;
  color: #fecaca;
}

.bar-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.stream-stage {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: #020617;
}

.stream-player {
  width: 100%;
  height: 100%;
}

.stream-player :deep(.raw-player) {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: #020617;
}

.stream-player :deep(.canvas-shell) {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
}

.stream-player :deep(.video-canvas) {
  max-width: 100%;
  max-height: 100%;
  min-height: 0;
}

.stream-player :deep(.player-stats) {
  position: fixed;
  right: 12px;
  bottom: 36px;
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.72);
  color: #cbd5e1;
}

.stream-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: #94a3b8;
  font-size: 15px;
}

.stream-debug {
  position: fixed;
  left: 12px;
  bottom: 38px;
  z-index: 4;
  max-width: min(760px, calc(100vw - 24px));
  max-height: 180px;
  overflow: auto;
  margin: 0;
  padding: 10px;
  border: 1px solid rgba(248, 113, 113, 0.45);
  border-radius: 8px;
  background: rgba(69, 10, 10, 0.84);
  color: #fecaca;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  white-space: pre-wrap;
}

@media (max-width: 700px) {
  .stream-bar {
    flex-wrap: wrap;
  }

  .status-text {
    order: 3;
    max-width: 100%;
    width: 100%;
  }
}
</style>
