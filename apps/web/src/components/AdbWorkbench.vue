<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { cliApi } from '@/api/cli'
import type { RemoteWorkspaceFileEntry, RemoteWorkspaceFileList, RemoteWorkspaceFilePreview } from '@/api/remoteWorkspace'
import AdbAppsPanel from '@/components/adb/AdbAppsPanel.vue'
import AdbControlPanel from '@/components/adb/AdbControlPanel.vue'
import AdbFilesPanel from '@/components/adb/AdbFilesPanel.vue'
import AdbInspectPanel from '@/components/adb/AdbInspectPanel.vue'
import AdbScreenCapturePanel from '@/components/adb/AdbScreenCapturePanel.vue'
import AdbScrcpyPanel from '@/components/adb/AdbScrcpyPanel.vue'
import AdbShellPanel from '@/components/adb/AdbShellPanel.vue'
import { useAdbScrcpy } from '@/composables/useAdbScrcpy'

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

const {
  scrcpyLoading,
  scrcpySessions,
  scrcpyMaxSize,
  scrcpyBitRate,
  scrcpyMaxFps,
  scrcpyRecordPath,
  scrcpyV4l2Sink,
  rawStreamSessionId,
  rawStreamStatus,
  rawStreamBytes,
  loadScrcpySessions,
  createScrcpyBridgeSession,
  createScrcpyDesktopSession,
  createScrcpyRecordSession,
  stopScrcpySession,
  removeScrcpySession,
  connectRawStream,
  disconnectRawStream,
} = useAdbScrcpy({
  adbIp: () => props.adbIp,
  deviceName: () => props.deviceName,
  label: props.label,
  statusMessage,
  errorMessage,
})

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

    <AdbControlPanel
      v-if="activePanel === 'control'"
      v-model:text-input="textInput"
      v-model:tap-input="tapInput"
      :adb-ip="adbIp"
      :busy="!!busy"
      :overview-loading="overviewLoading"
      :overview="overview"
      :current-app="currentApp"
      :label="label"
      :usage-text="usageText"
      @check="ensureConnected"
      @quick-key="quickKey"
      @send-text="sendText"
      @tap-point="tapPoint"
      @refresh-overview="loadOverview(true)"
    />

    <div v-else-if="activePanel === 'screen'" class="screen-grid">
      <AdbScreenCapturePanel
        :screenshot="screenshot"
        :screenshot-src="screenshotSrc"
        :loading="screenshotLoading"
        :label="label"
        :format-bytes="formatBytes"
        @refresh="refreshScreenshot"
        @tap="tapScreenshot"
      />

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

    <AdbAppsPanel
      v-else-if="activePanel === 'apps'"
      v-model:search="appSearch"
      :apps="filteredApps"
      :busy="!!busy"
      :loading="busy === 'apps'"
      :label="label"
      @refresh="loadApps(true)"
      @launch="launchApp"
    />

    <AdbInspectPanel
      v-else-if="activePanel === 'inspect'"
      :nodes="uiTree"
      :busy="!!busy"
      :label="label"
      @refresh="refreshUiTree"
      @tap="tapElement"
    />

    <AdbShellPanel
      v-else-if="activePanel === 'shell'"
      :device-id="deviceId"
      :can-open-console="canOpenConsole"
      :label="label"
      @open-console="emit('openConsole')"
    />

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
.feedback-row {
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
.surface button {
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

.surface {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 16px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.full-surface { min-height: 320px; }

.screen-grid {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(320px, 0.95fr);
  gap: 14px;
  align-items: start;
}

.empty-line.compact {
  padding: 18px 0;
}

.empty-line {
  padding: 36px 0;
  text-align: center;
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
}

.pending-surface p,
.pending-surface li {
  color: #475569;
  font-size: 14px;
  line-height: 1.7;
}

@media (max-width: 900px) {
  .workbench-head {
    align-items: stretch;
    flex-direction: column;
  }
  .endpoint-box { align-items: flex-start; }
  .screen-grid { grid-template-columns: 1fr; }
}
</style>
