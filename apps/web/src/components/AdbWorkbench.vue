<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AdbAppsPanel from '@/components/adb/AdbAppsPanel.vue'
import AdbControlPanel from '@/components/adb/AdbControlPanel.vue'
import AdbFilesPanel from '@/components/adb/AdbFilesPanel.vue'
import AdbInspectPanel from '@/components/adb/AdbInspectPanel.vue'
import AdbScreenCapturePanel from '@/components/adb/AdbScreenCapturePanel.vue'
import AdbScrcpyPanel from '@/components/adb/AdbScrcpyPanel.vue'
import AdbShellPanel from '@/components/adb/AdbShellPanel.vue'
import { useAdbDeviceActions } from '@/composables/useAdbDeviceActions'
import { useAdbFiles } from '@/composables/useAdbFiles'
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
const statusMessage = ref('')
const errorMessage = ref('')

const {
  busy,
  appsLoaded,
  appSearch,
  textInput,
  tapInput,
  screenshotLoading,
  screenshot,
  screenshotSrc,
  uiTree,
  currentApp,
  overviewLoading,
  overview,
  filteredApps,
  ensureConnected,
  loadOverview,
  quickKey,
  sendText,
  tapPoint,
  refreshScreenshot,
  tapScreenshot,
  loadApps,
  launchApp,
  refreshUiTree,
  tapElement,
} = useAdbDeviceActions({
  adbIp: () => props.adbIp,
  label: props.label,
  statusMessage,
  errorMessage,
})

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

const {
  fileLoading,
  filePath,
  fileInputPath,
  fileParent,
  files,
  filePreview,
  adbFileList,
  loadFiles,
  openFile,
} = useAdbFiles({
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
