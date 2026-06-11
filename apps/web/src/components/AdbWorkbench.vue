<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { cliApi } from '@/api/cli'
import type { RemoteWorkspaceFileEntry, RemoteWorkspaceFileList, RemoteWorkspaceFilePreview } from '@/api/remoteWorkspace'
import { streamingGatewayApi, type AdbScrcpySession } from '@/api/streamingGateway'
import AdbFilesPanel from '@/components/adb/AdbFilesPanel.vue'
import AdbScrcpyPanel from '@/components/adb/AdbScrcpyPanel.vue'
import TerminalPanel from '@/components/TerminalPanel.vue'

const props = defineProps<{
  deviceId: number
  deviceName: string
  adbIp: string
  deviceType: string
  canOpenConsole: boolean
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{ openConsole: [] }>()

type PanelKey = 'control' | 'screen' | 'apps' | 'inspect' | 'shell' | 'files' | 'logs' | 'metrics'

const activePanel = ref<PanelKey>('control')
const busy = ref('')
const statusMessage = ref('')
const errorMessage = ref('')
const apps = ref<Array<{ package: string; name: string }>>([])
const appsLoaded = ref(false)
const appSearch = ref('')
const textInput = ref('')
const tapInput = ref('')
const screenshotLoading = ref(false)
const screenshot = ref<{ base64?: string; mime?: string; width?: number; height?: number; size_bytes?: number } | null>(null)
const scrcpyLoading = ref(false)
const scrcpySessions = ref<AdbScrcpySession[]>([])
const scrcpyMaxSize = ref('1280')
const scrcpyBitRate = ref('4M')
const scrcpyMaxFps = ref('30')
const scrcpyRecordPath = ref('')
const scrcpyV4l2Sink = ref('')
const rawStreamSessionId = ref('')
const rawStreamStatus = ref('')
const rawStreamBytes = ref(0)
let rawStreamSocket: WebSocket | null = null
const uiTree = ref<Array<{ index: number; text: string; bounds?: number[]; center?: number[]; clickable?: boolean; resource_id?: string; class_name?: string }>>([])
const currentApp = ref<{ current_app?: string; activity?: string; raw_line?: string } | null>(null)
const overviewLoading = ref(false)
const overview = ref<{
  name?: string
  manufacturer?: string
  brand?: string
  model?: string
  android_version?: string
  sdk_version?: string
  serialno?: string
  abi?: string
  screen?: { resolution?: string; density?: string }
  memory?: { total?: number; used?: number; available?: number }
  storage?: { total?: number; used?: number; available?: number }
  battery?: { level?: number; temperature_c?: number; voltage_mv?: number; status?: string }
  network?: { ip?: string; mac?: string }
  current_app?: { current_app?: string; activity?: string; raw_line?: string } | null
} | null>(null)
const fileLoading = ref(false)
const filePath = ref('/sdcard/')
const fileInputPath = ref('/sdcard/')
const fileParent = ref('/')
type AdbFileEntry = {
  name: string
  path: string
  directory: boolean
  symlink?: boolean
  link_target?: string
  mode?: string
  owner?: string
  group?: string
  size?: number
  mtime?: string
}

const files = ref<AdbFileEntry[]>([])
const filePreview = ref<RemoteWorkspaceFilePreview | null>(null)

const panels = computed<Array<{ key: PanelKey; title: string; ready: boolean }>>(() => [
  { key: 'control', title: props.label('控制', 'Control'), ready: true },
  { key: 'screen', title: props.label('屏幕', 'Screen'), ready: true },
  { key: 'apps', title: props.label('应用', 'Apps'), ready: true },
  { key: 'inspect', title: props.label('检查', 'Inspect'), ready: true },
  { key: 'shell', title: props.label('终端', 'Shell'), ready: props.canOpenConsole },
  { key: 'files', title: props.label('文件', 'Files'), ready: true },
  { key: 'logs', title: 'Logcat', ready: false },
  { key: 'metrics', title: props.label('性能', 'Metrics'), ready: false },
])

const filteredApps = computed(() => {
  const q = appSearch.value.trim().toLowerCase()
  if (!q) return apps.value
  return apps.value.filter((app) => app.name.toLowerCase().includes(q) || app.package.toLowerCase().includes(q))
})

const screenshotSrc = computed(() => {
  if (!screenshot.value?.base64) return ''
  return `data:${screenshot.value.mime || 'image/jpeg'};base64,${screenshot.value.base64}`
})

const adbFileList = computed<RemoteWorkspaceFileList | null>(() => ({
  target_id: `adb:${props.adbIp}`,
  label: props.deviceName,
  kind: 'adb',
  root: '/sdcard/',
  path: filePath.value,
  absolute_path: filePath.value,
  entries: files.value.map((file) => ({
    name: file.name,
    path: file.path,
    type: file.directory ? 'directory' : file.symlink ? 'symlink' : 'file',
    size: file.size ?? null,
    modified_at: file.mtime ?? null,
  })),
  truncated: false,
}))

function setBusy(key: string, value: boolean) {
  busy.value = value ? key : ''
}

function params(extra: Record<string, unknown> = {}) {
  return { device: props.adbIp, ...extra }
}

async function runAdb<T>(key: string, action: string, extra: Record<string, unknown> = {}, success?: string): Promise<T | null> {
  if (busy.value) return null
  setBusy(key, true)
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    const result = await cliApi.run<T>('adb-cli', {
      action,
      params: params(extra),
      ttl_ms: 0,
      bypass_cache: true,
    })
    if (result.status === 'success') {
      statusMessage.value = success || props.label('命令已执行', 'Command executed')
      return result.data ?? null
    }
    errorMessage.value = result.message || result.error || props.label('执行失败', 'Execution failed')
    return null
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
    return null
  } finally {
    setBusy(key, false)
  }
}

async function ensureConnected() {
  await runAdb('connect', 'ensure_connected', {}, props.label('ADB 连接可用', 'ADB connection is ready'))
}

async function loadOverview(refresh = false) {
  if (overviewLoading.value) return
  overviewLoading.value = true
  if (refresh) {
    statusMessage.value = ''
    errorMessage.value = ''
  }
  try {
    const result = await cliApi.run<typeof overview.value>('adb-cli', {
      action: 'overview',
      params: params(),
      ttl_ms: refresh ? 0 : 30_000,
      bypass_cache: refresh,
    })
    if (result.status !== 'success') {
      if (refresh) errorMessage.value = result.message || result.error || props.label('设备概览读取失败', 'Failed to load device overview')
      return
    }
    overview.value = result.data ?? null
    currentApp.value = overview.value?.current_app ?? null
    if (refresh) statusMessage.value = props.label('设备概览已刷新', 'Device overview refreshed')
  } catch (e) {
    if (refresh) errorMessage.value = (e as Error).message || String(e)
  } finally {
    overviewLoading.value = false
  }
}

async function quickKey(action: string, label: string) {
  await runAdb(`key-${action}`, action, {}, label)
}

async function sendText() {
  const text = textInput.value.trim()
  if (!text) return
  const ok = await runAdb('input-text', 'input_text', { text }, props.label('文本已输入', 'Text sent'))
  if (ok !== null) textInput.value = ''
}

async function tapPoint() {
  const [x, y] = tapInput.value.split(',').map((item) => Number(item.trim()))
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    errorMessage.value = props.label('请输入坐标，例如 540,960', 'Enter coordinates like 540,960')
    return
  }
  const ok = await runAdb('tap', 'tap', { x, y }, props.label('点击已发送', 'Tap sent'))
  if (ok !== null) tapInput.value = ''
}

async function refreshScreenshot() {
  if (screenshotLoading.value) return
  screenshotLoading.value = true
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    const result = await cliApi.run<typeof screenshot.value>('adb-cli', {
      action: 'screenshot',
      params: params({ include_base64: true }),
      ttl_ms: 0,
      bypass_cache: true,
    })
    if (result.status !== 'success') {
      errorMessage.value = result.message || result.error || props.label('截图失败', 'Screenshot failed')
      return
    }
    screenshot.value = result.data ?? null
    statusMessage.value = props.label('截图已刷新', 'Screenshot refreshed')
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    screenshotLoading.value = false
  }
}

async function tapScreenshot(event: MouseEvent) {
  if (!screenshot.value?.width || !screenshot.value?.height) return
  const target = event.currentTarget as HTMLImageElement
  const rect = target.getBoundingClientRect()
  const x = Math.round(((event.clientX - rect.left) / rect.width) * screenshot.value.width)
  const y = Math.round(((event.clientY - rect.top) / rect.height) * screenshot.value.height)
  await runAdb('tap-screenshot', 'tap', { x, y }, props.label('截图点击已发送', 'Screenshot tap sent'))
}

async function loadScrcpySessions() {
  if (scrcpyLoading.value) return
  scrcpyLoading.value = true
  try {
    const result = await streamingGatewayApi.adbScrcpySessions()
    if (result.status === 'success') scrcpySessions.value = result.data
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    scrcpyLoading.value = false
  }
}

function scrcpyBasePayload(profile: string) {
  return {
    device: props.adbIp,
    profile,
    max_size: scrcpyMaxSize.value.trim() || undefined,
    bit_rate: scrcpyBitRate.value.trim() || undefined,
    max_fps: scrcpyMaxFps.value.trim() || undefined,
    label: `${props.deviceName} scrcpy`,
  }
}

async function createScrcpyBridgeSession() {
  if (scrcpyLoading.value) return
  scrcpyLoading.value = true
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    const result = await streamingGatewayApi.createAdbScrcpySession({
      ...scrcpyBasePayload('browser_bridge'),
      audio: false,
      window: false,
      playback: false,
      v4l2_sink: scrcpyV4l2Sink.value.trim() || undefined,
    })
    if (result.status !== 'success') {
      errorMessage.value = props.label('scrcpy 会话创建失败', 'Failed to create scrcpy session')
      return
    }
    await loadScrcpySessions()
    statusMessage.value = result.data.state === 'prepared'
      ? props.label('scrcpy 桥接规格已准备', 'scrcpy bridge spec prepared')
      : props.label('scrcpy 会话已启动', 'scrcpy session started')
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    scrcpyLoading.value = false
  }
}

async function createScrcpyDesktopSession() {
  if (scrcpyLoading.value) return
  scrcpyLoading.value = true
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    const result = await streamingGatewayApi.createAdbScrcpySession({
      ...scrcpyBasePayload('desktop'),
      audio: true,
      window: true,
      playback: true,
    })
    if (result.status !== 'success') {
      errorMessage.value = props.label('scrcpy 启动失败', 'Failed to start scrcpy')
      return
    }
    await loadScrcpySessions()
    statusMessage.value = props.label('scrcpy 桌面会话已启动', 'scrcpy desktop session started')
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    scrcpyLoading.value = false
  }
}

async function createScrcpyRecordSession() {
  const record = scrcpyRecordPath.value.trim()
  if (!record) {
    errorMessage.value = props.label('请输入录制文件路径', 'Enter a recording path')
    return
  }
  if (scrcpyLoading.value) return
  scrcpyLoading.value = true
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    const result = await streamingGatewayApi.createAdbScrcpySession({
      ...scrcpyBasePayload('record'),
      audio: false,
      window: false,
      playback: false,
      record,
    })
    if (result.status !== 'success') {
      errorMessage.value = props.label('scrcpy 录制启动失败', 'Failed to start scrcpy recording')
      return
    }
    await loadScrcpySessions()
    statusMessage.value = props.label('scrcpy 录制会话已启动', 'scrcpy recording session started')
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    scrcpyLoading.value = false
  }
}

async function stopScrcpySession(id: string) {
  if (scrcpyLoading.value) return
  scrcpyLoading.value = true
  try {
    await streamingGatewayApi.stopAdbScrcpySession(id)
    await loadScrcpySessions()
    statusMessage.value = props.label('scrcpy 会话已停止', 'scrcpy session stopped')
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    scrcpyLoading.value = false
  }
}

async function removeScrcpySession(id: string) {
  if (scrcpyLoading.value) return
  scrcpyLoading.value = true
  try {
    await streamingGatewayApi.removeAdbScrcpySession(id)
    await loadScrcpySessions()
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    scrcpyLoading.value = false
  }
}

function buildWsUrl(path: string): string {
  const base = import.meta.env.VITE_API_BASE || window.location.origin
  const url = new URL(path, base || window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function disconnectRawStream() {
  rawStreamSocket?.close()
  rawStreamSocket = null
  rawStreamSessionId.value = ''
  rawStreamStatus.value = ''
}

function connectRawStream(session: AdbScrcpySession) {
  if (!session.stream?.ws_path) return
  disconnectRawStream()
  rawStreamSessionId.value = session.id
  rawStreamBytes.value = 0
  rawStreamStatus.value = props.label('连接中', 'Connecting')
  const socket = new WebSocket(buildWsUrl(session.stream.ws_path))
  socket.binaryType = 'arraybuffer'
  rawStreamSocket = socket
  socket.onopen = () => {
    rawStreamStatus.value = props.label('已连接，等待 H264 数据', 'Connected, waiting for H264 data')
  }
  socket.onmessage = (event) => {
    const data = event.data
    if (data instanceof ArrayBuffer) rawStreamBytes.value += data.byteLength
    else if (data instanceof Blob) rawStreamBytes.value += data.size
  }
  socket.onerror = () => {
    rawStreamStatus.value = props.label('流连接错误', 'Stream connection error')
  }
  socket.onclose = (event) => {
    rawStreamStatus.value = event.reason || props.label('流已断开', 'Stream disconnected')
    if (rawStreamSocket === socket) rawStreamSocket = null
  }
}

async function loadApps(refresh = false) {
  if (busy.value) return
  setBusy('apps', true)
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    const result = await cliApi.run<{ packages?: string[]; apps?: Array<string | { package: string; name?: string }> }>('adb-cli', {
      action: 'list_packages',
      params: params(),
      ttl_ms: refresh ? 0 : 60_000,
      bypass_cache: refresh,
    })
    if (result.status !== 'success' || !result.data) {
      errorMessage.value = result.message || result.error || props.label('应用列表加载失败', 'Failed to load apps')
      return
    }
    const raw = result.data.apps ?? result.data.packages ?? []
    apps.value = raw.map((item) => {
      if (typeof item === 'string') return { package: item, name: item.split('.').pop() || item }
      return { package: item.package, name: item.name || item.package.split('.').pop() || item.package }
    })
    appsLoaded.value = true
    statusMessage.value = props.label('应用列表已更新', 'Apps updated')
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    setBusy('apps', false)
  }
}

async function launchApp(packageName: string) {
  await runAdb(`launch-${packageName}`, 'launch_app', { package: packageName }, props.label('应用已启动', 'App launched'))
}

async function refreshCurrentApp() {
  const data = await runAdb<{ current_app?: string; activity?: string; raw_line?: string }>('current-app', 'current_app', {}, props.label('当前应用已刷新', 'Current app refreshed'))
  if (data) currentApp.value = data
}

async function refreshUiTree() {
  const data = await runAdb<{ elements?: typeof uiTree.value }>('ui-tree', 'ui_tree', {}, props.label('界面元素已刷新', 'UI elements refreshed'))
  uiTree.value = data?.elements ?? []
}

async function tapElement(index: number) {
  await runAdb(`tap-element-${index}`, 'tap_element', { index }, props.label('元素点击已发送', 'Element tap sent'))
}

async function loadFiles(path = fileInputPath.value) {
  if (fileLoading.value) return
  fileLoading.value = true
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    const result = await cliApi.run<{ path: string; parent: string; files: typeof files.value; count: number }>('adb-cli', {
      action: 'list_files',
      params: params({ path }),
      ttl_ms: 0,
      bypass_cache: true,
    })
    if (result.status !== 'success' || !result.data) {
      errorMessage.value = result.message || result.error || props.label('目录读取失败', 'Failed to read directory')
      return
    }
    filePath.value = result.data.path
    fileInputPath.value = result.data.path
    fileParent.value = result.data.parent || '/'
    files.value = result.data.files
    filePreview.value = null
    statusMessage.value = props.label('目录已读取', 'Directory loaded')
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    fileLoading.value = false
  }
}

async function readFile(entry: RemoteWorkspaceFileEntry) {
  if (fileLoading.value) return
  fileLoading.value = true
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    const result = await cliApi.run<RemoteWorkspaceFilePreview>('adb-cli', {
      action: 'read_file',
      params: params({ path: entry.path, max_bytes: 65536 }),
      ttl_ms: 0,
      bypass_cache: true,
    })
    if (result.status !== 'success' || !result.data) {
      errorMessage.value = result.message || result.error || props.label('文件预览失败', 'Failed to preview file')
      return
    }
    filePreview.value = result.data
    statusMessage.value = props.label('文件已读取', 'File loaded')
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    fileLoading.value = false
  }
}

function openFile(entry: RemoteWorkspaceFileEntry) {
  if (entry.type === 'directory') {
    void loadFiles(entry.path)
    return
  }
  if (entry.type === 'file' || entry.type === 'symlink') void readFile(entry)
}

function selectPanel(panel: PanelKey) {
  activePanel.value = panel
  if (panel === 'apps' && !appsLoaded.value) void loadApps(false)
  if (panel === 'screen') {
    if (!screenshot.value) void refreshScreenshot()
    void loadScrcpySessions()
  }
  if (panel === 'files' && files.value.length === 0) void loadFiles()
}

function formatBytes(value?: number): string {
  if (!value || value <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`
}

function usageText(value?: { total?: number; used?: number }): string {
  if (!value?.total) return '-'
  return `${formatBytes(value.used)} / ${formatBytes(value.total)}`
}

onMounted(() => {
  void loadOverview(false)
})

onBeforeUnmount(() => {
  disconnectRawStream()
})
</script>

<template>
  <section class="adb-workbench">
    <header class="workbench-head">
      <div>
        <p class="eyebrow">ADB Workbench</p>
        <h2>{{ deviceName }}</h2>
      </div>
      <div class="endpoint-box">
        <span>{{ deviceType }}</span>
        <code>{{ adbIp }}</code>
      </div>
    </header>

    <nav class="panel-tabs" :aria-label="label('ADB 工作台模块', 'ADB workbench modules')">
      <button
        v-for="panel in panels"
        :key="panel.key"
        :class="['panel-tab', { active: activePanel === panel.key, muted: !panel.ready }]"
        @click="selectPanel(panel.key)"
      >
        {{ panel.title }}
        <span v-if="!panel.ready">{{ label('待接入', 'Pending') }}</span>
      </button>
    </nav>

    <div v-if="statusMessage || errorMessage" class="feedback-row">
      <span v-if="statusMessage" class="feedback ok">{{ statusMessage }}</span>
      <span v-if="errorMessage" class="feedback error">{{ errorMessage }}</span>
    </div>

    <div v-if="activePanel === 'control'" class="panel-grid">
      <div class="surface primary-control">
        <div class="surface-head">
          <h3>{{ label('遥控与输入', 'Remote And Input') }}</h3>
          <button class="ghost-btn" :disabled="!!busy" @click="ensureConnected">{{ label('检查连接', 'Check') }}</button>
        </div>
        <div class="remote-grid">
          <button :disabled="!!busy" @click="quickKey('home', label('已返回主页', 'Home sent'))">Home</button>
          <button :disabled="!!busy" @click="quickKey('back', label('已返回', 'Back sent'))">Back</button>
          <button :disabled="!!busy" @click="quickKey('enter', label('已确认', 'Enter sent'))">Enter</button>
          <button :disabled="!!busy" @click="quickKey('volume_up', label('音量已增加', 'Volume up sent'))">Vol +</button>
          <button :disabled="!!busy" @click="quickKey('volume_down', label('音量已降低', 'Volume down sent'))">Vol -</button>
          <button :disabled="!!busy" @click="quickKey('power', label('电源键已发送', 'Power sent'))">Power</button>
        </div>
        <div class="inline-form">
          <input v-model="textInput" :placeholder="label('输入文本', 'Input text')" @keydown.enter="sendText" />
          <button :disabled="!!busy || !textInput.trim()" @click="sendText">{{ label('发送', 'Send') }}</button>
        </div>
        <div class="inline-form">
          <input v-model="tapInput" placeholder="540,960" @keydown.enter="tapPoint" />
          <button :disabled="!!busy || !tapInput.trim()" @click="tapPoint">{{ label('点击坐标', 'Tap') }}</button>
        </div>
      </div>

      <div class="surface stack-surface">
        <div class="surface-head">
          <h3>{{ label('设备概览', 'Device Overview') }}</h3>
          <button class="ghost-btn" :disabled="overviewLoading" @click="loadOverview(true)">{{ overviewLoading ? label('读取中', 'Loading') : label('刷新', 'Refresh') }}</button>
        </div>
        <div class="state-list">
          <div>
            <span>{{ label('设备', 'Device') }}</span>
            <strong>{{ overview?.name || adbIp }}</strong>
          </div>
          <div>
            <span>Android</span>
            <strong>{{ overview?.android_version ? `Android ${overview.android_version} (API ${overview.sdk_version || '-'})` : '-' }}</strong>
          </div>
          <div>
            <span>{{ label('型号', 'Model') }}</span>
            <strong>{{ overview?.manufacturer || overview?.brand || '-' }} {{ overview?.model || '' }}</strong>
          </div>
          <div>
            <span>{{ label('屏幕', 'Screen') }}</span>
            <strong>{{ overview?.screen?.resolution || '-' }} <small v-if="overview?.screen?.density">{{ overview.screen.density }} dpi</small></strong>
          </div>
          <div>
            <span>{{ label('内存', 'Memory') }}</span>
            <strong>{{ usageText(overview?.memory) }}</strong>
          </div>
          <div>
            <span>{{ label('存储', 'Storage') }}</span>
            <strong>{{ usageText(overview?.storage) }}</strong>
          </div>
          <div>
            <span>{{ label('电池', 'Battery') }}</span>
            <strong>{{ overview?.battery?.level ? `${overview.battery.level}%` : '-' }} <small v-if="overview?.battery?.temperature_c">{{ overview.battery.temperature_c }} C</small></strong>
          </div>
          <div>
            <span>{{ label('网络', 'Network') }}</span>
            <code>{{ overview?.network?.ip || '-' }} {{ overview?.network?.mac || '' }}</code>
          </div>
          <div>
            <span>{{ label('当前应用', 'Current App') }}</span>
            <code>{{ currentApp?.current_app || label('未读取', 'Not loaded') }}</code>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="activePanel === 'screen'" class="screen-grid">
      <div class="surface screen-surface">
        <div class="surface-head">
          <h3>{{ label('屏幕截图', 'Screen Capture') }}</h3>
          <button class="ghost-btn" :disabled="screenshotLoading" @click="refreshScreenshot">{{ screenshotLoading ? label('截取中', 'Capturing') : label('刷新截图', 'Refresh') }}</button>
        </div>
        <div v-if="screenshotSrc" class="screen-stage">
          <img :src="screenshotSrc" :alt="label('ADB 截图', 'ADB screenshot')" @click="tapScreenshot" />
          <div class="screen-meta">
            <span>{{ screenshot?.width }} x {{ screenshot?.height }}</span>
            <span>{{ formatBytes(screenshot?.size_bytes) }}</span>
            <span>{{ label('点击图片可发送 tap', 'Click image to send tap') }}</span>
          </div>
        </div>
        <div v-else class="empty-line">{{ label('点击刷新截图读取当前屏幕。', 'Refresh to capture the current screen.') }}</div>
      </div>

      <AdbScrcpyPanel
        v-model:max-size="scrcpyMaxSize"
        v-model:bit-rate="scrcpyBitRate"
        v-model:max-fps="scrcpyMaxFps"
        v-model:v4l2-sink="scrcpyV4l2Sink"
        v-model:record-path="scrcpyRecordPath"
        :loading="scrcpyLoading"
        :sessions="scrcpySessions"
        :raw-stream-session-id="rawStreamSessionId"
        :raw-stream-status="rawStreamStatus"
        :raw-stream-bytes="rawStreamBytes"
        :label="label"
        :format-bytes="formatBytes"
        @refresh="loadScrcpySessions"
        @create-bridge="createScrcpyBridgeSession"
        @create-desktop="createScrcpyDesktopSession"
        @create-record="createScrcpyRecordSession"
        @connect="connectRawStream"
        @disconnect="disconnectRawStream"
        @stop="stopScrcpySession"
        @remove="removeScrcpySession"
      />
    </div>

    <div v-else-if="activePanel === 'apps'" class="surface full-surface">
      <div class="surface-head">
        <h3>{{ label('应用管理', 'Application Manager') }}</h3>
        <button class="ghost-btn" :disabled="!!busy" @click="loadApps(true)">{{ label('刷新', 'Refresh') }}</button>
      </div>
      <input v-model="appSearch" class="wide-input" :placeholder="label('搜索包名或应用名', 'Search package or app name')" />
      <div v-if="busy === 'apps'" class="empty-line">{{ label('正在加载应用...', 'Loading apps...') }}</div>
      <div v-else-if="filteredApps.length === 0" class="empty-line">{{ label('没有应用数据', 'No app data') }}</div>
      <div v-else class="app-table">
        <div v-for="app in filteredApps" :key="app.package" class="app-row">
          <div>
            <strong>{{ app.name }}</strong>
            <code>{{ app.package }}</code>
          </div>
          <button :disabled="!!busy" @click="launchApp(app.package)">{{ label('启动', 'Launch') }}</button>
        </div>
      </div>
    </div>

    <div v-else-if="activePanel === 'inspect'" class="surface full-surface">
      <div class="surface-head">
        <h3>{{ label('界面检查', 'UI Inspector') }}</h3>
        <button class="ghost-btn" :disabled="!!busy" @click="refreshUiTree">{{ label('读取元素', 'Read Tree') }}</button>
      </div>
      <div v-if="uiTree.length === 0" class="empty-line">{{ label('读取 UI 树后，可按元素索引点击。', 'Read the UI tree, then tap elements by index.') }}</div>
      <div v-else class="ui-list">
        <button v-for="node in uiTree.slice(0, 120)" :key="node.index" class="ui-node" :disabled="!!busy" @click="tapElement(node.index)">
          <span>#{{ node.index }}</span>
          <strong>{{ node.text || node.resource_id || node.class_name || label('无文本元素', 'Untitled element') }}</strong>
          <code>{{ node.center ? node.center.join(',') : '' }}</code>
        </button>
      </div>
    </div>

    <div v-else-if="activePanel === 'shell'" class="surface terminal-surface">
      <div class="surface-head">
        <h3>{{ label('ADB 终端', 'ADB Shell') }}</h3>
        <button class="ghost-btn" @click="emit('openConsole')">{{ label('全屏', 'Fullscreen') }}</button>
      </div>
      <TerminalPanel v-if="canOpenConsole" :target-device-id="deviceId" height="360px" :font-size="12" />
      <div v-else class="empty-line">{{ label('该设备未配置终端目标。', 'No terminal target is configured for this device.') }}</div>
    </div>

    <AdbFilesPanel
      v-else-if="activePanel === 'files'"
      v-model:path-input="fileInputPath"
      :adb-ip="adbIp"
      :current-path="filePath"
      :parent-path="fileParent"
      :list="adbFileList"
      :preview="filePreview"
      :loading="fileLoading"
      :error="errorMessage"
      :label="label"
      :format-bytes="formatBytes"
      @refresh="loadFiles"
      @parent="loadFiles"
      @open-entry="openFile"
      @open-path="loadFiles"
    />

    <div v-else class="surface full-surface pending-surface">
      <h3>{{ panels.find((panel) => panel.key === activePanel)?.title }}</h3>
      <p>{{ label('AYA 中对应的是完整高级面板；HomeSense 需要先补后端 ADB 服务接口后再启用。', 'This maps to a full advanced AYA panel; HomeSense needs backend ADB service endpoints before enabling it.') }}</p>
      <ul>
        <li>{{ label('Logcat: WebSocket 流、暂停、过滤、保存', 'Logcat: WebSocket stream, pause, filters, save') }}</li>
        <li>{{ label('性能: CPU/内存/电池/FPS 周期采样', 'Metrics: CPU, memory, battery, FPS sampling') }}</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.adb-workbench {
  padding: 22px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
}

.workbench-head,
.surface-head,
.feedback-row,
.app-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.eyebrow {
  margin: 0 0 4px;
  color: #2563eb;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

h2,
h3 {
  margin: 0;
  color: #0f172a;
  letter-spacing: 0;
}

h2 { font-size: 22px; }
h3 { font-size: 15px; }

.endpoint-box {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
}

code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: #475569;
  overflow-wrap: anywhere;
}

.panel-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 18px 0;
  padding-bottom: 10px;
  border-bottom: 1px solid #e2e8f0;
}

.panel-tab,
.ghost-btn,
.inline-form button,
.app-row button,
.remote-grid button {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.panel-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 7px 12px;
}

.panel-tab span {
  color: #94a3b8;
  font-size: 11px;
}

.panel-tab.active {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
}

.panel-tab.muted:not(.active) {
  color: #94a3b8;
}

.feedback-row {
  justify-content: flex-start;
  margin-bottom: 14px;
}

.feedback {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 800;
}

.feedback.ok { background: #ecfdf5; color: #047857; }
.feedback.error { background: #fef2f2; color: #dc2626; }

.panel-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
  gap: 14px;
}

.surface {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 16px;
}

.surface-head { margin-bottom: 14px; }
.ghost-btn { padding: 7px 11px; }
.ghost-btn:hover:not(:disabled),
.inline-form button:hover:not(:disabled),
.app-row button:hover:not(:disabled),
.remote-grid button:hover:not(:disabled) {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #eff6ff;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.remote-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.remote-grid button {
  min-height: 40px;
}

.inline-form {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.inline-form input,
.wide-input {
  flex: 1;
  min-width: 0;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  padding: 9px 11px;
  color: #0f172a;
  font: inherit;
  font-size: 14px;
}

.inline-form button { padding: 8px 12px; }

.state-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.state-list div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.state-list span {
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
}

.state-list strong {
  color: #0f172a;
  font-size: 14px;
}

.full-surface,
.screen-surface,
.terminal-surface { min-height: 320px; }

.screen-grid {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(320px, 0.95fr);
  gap: 14px;
  align-items: start;
}

.screen-stage {
  display: grid;
  grid-template-columns: minmax(220px, 360px) minmax(180px, 1fr);
  gap: 16px;
  align-items: start;
}

.screen-stage img {
  display: block;
  width: 100%;
  max-height: 560px;
  object-fit: contain;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #0f172a;
  cursor: crosshair;
}

.screen-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #475569;
  font-size: 13px;
  font-weight: 800;
}

.screen-meta span {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  padding: 7px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  overflow-wrap: anywhere;
}

.empty-line.compact {
  padding: 18px 0;
}

.wide-input { width: 100%; margin-bottom: 12px; }

.empty-line {
  padding: 36px 0;
  text-align: center;
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
}

.app-table,
.ui-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 420px;
  overflow: auto;
}

.app-row {
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
}

.app-row div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.app-row strong {
  color: #0f172a;
  font-size: 14px;
}

.app-row button { padding: 7px 12px; }

.ui-node {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) 90px;
  gap: 10px;
  align-items: center;
  width: 100%;
  min-height: 38px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
}

.ui-node span {
  color: #2563eb;
  font-size: 12px;
  font-weight: 900;
}

.ui-node strong {
  min-width: 0;
  overflow: hidden;
  color: #0f172a;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pending-surface p,
.pending-surface li {
  color: #475569;
  font-size: 14px;
  line-height: 1.7;
}

@media (max-width: 900px) {
  .workbench-head,
  .surface-head,
  .app-row {
    align-items: stretch;
    flex-direction: column;
  }
  .endpoint-box { align-items: flex-start; }
  .panel-grid { grid-template-columns: 1fr; }
  .screen-grid { grid-template-columns: 1fr; }
  .screen-stage { grid-template-columns: 1fr; }
  .remote-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ui-node { grid-template-columns: 48px minmax(0, 1fr); }
  .ui-node code { display: none; }
}
</style>
