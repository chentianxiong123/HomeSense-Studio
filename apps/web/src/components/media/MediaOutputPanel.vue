<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, type UserDevice } from '@/api'
import { mediaApi } from '@/api/media'
import { useLocale } from '@/composables/useLocale'
import type { MediaItem, MediaOutput } from '@/features/media/types'

const props = defineProps<{
  activeItem: MediaItem | null
  sessionOutputId?: string
}>()

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
const outputLoading = ref(false)
const discoveringOutputs = ref(false)
const outputError = ref('')
const dynamicOutputs = ref<MediaOutput[]>([])
const outputStatus = ref<Record<string, string>>({})
const pushingOutputId = ref('')
const controllingOutputId = ref('')

const browserOutput = computed<MediaOutput>(() => ({
  id: 'browser:local',
  kind: 'browser',
  name: label('浏览器', 'Browser'),
  online: true,
}))
const pendingOutputs = computed<MediaOutput[]>(() => [
  { id: 'adb:pending', kind: 'adb', name: 'ADB Media', online: false, meta: { status: label('待接入控制', 'Control pending') } },
])
const outputs = computed<MediaOutput[]>(() => [browserOutput.value, ...dynamicOutputs.value, ...pendingOutputs.value])

onMounted(() => {
  void loadOutputs()
})

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

async function loadOutputs() {
  outputLoading.value = true
  outputError.value = ''
  try {
    dynamicOutputs.value = await listSavedOutputs()
  } catch (error) {
    dynamicOutputs.value = []
    outputError.value = error instanceof Error ? error.message : String(error)
  } finally {
    outputLoading.value = false
  }
}

async function discoverOutputs() {
  discoveringOutputs.value = true
  outputError.value = ''
  try {
    const savedOutputs = await listSavedOutputs()
    const [xiaoaiResult, dlnaResult] = await Promise.allSettled([
      mediaApi.listXiaoAiOutputs(),
      mediaApi.listDlnaOutputs(),
    ])
    const nextOutputs: MediaOutput[] = [...savedOutputs]
    const errors: string[] = []
    if (xiaoaiResult.status === 'fulfilled') mergeOutputs(nextOutputs, xiaoaiResult.value)
    else errors.push(`${label('小爱', 'XiaoAi')}: ${errorText(xiaoaiResult.reason)}`)
    if (dlnaResult.status === 'fulfilled') mergeOutputs(nextOutputs, dlnaResult.value)
    else errors.push(`DLNA: ${errorText(dlnaResult.reason)}`)
    dynamicOutputs.value = nextOutputs
    outputError.value = errors.join(' | ')
  } catch (error) {
    dynamicOutputs.value = []
    outputError.value = error instanceof Error ? error.message : String(error)
  } finally {
    discoveringOutputs.value = false
  }
}

async function listSavedOutputs(): Promise<MediaOutput[]> {
  const result = await api.userDevices.list()
  return (result.devices ?? []).flatMap(savedDeviceToOutput)
}

function savedDeviceToOutput(device: UserDevice): MediaOutput[] {
  const outputs: MediaOutput[] = []
  const dlnaLocation = getString(device.props?.dlna_location)
  if (dlnaLocation) {
    outputs.push({
      id: `dlna:saved:${device.id}`,
      kind: 'dlna',
      name: device.name,
      device_id: device.id,
      endpoint: dlnaLocation,
      online: true,
      meta: {
        saved: true,
        udn: getString(device.props?.dlna_udn),
        ip: getString(device.props?.ip_address),
        port: typeof device.props?.port === 'number' ? device.props.port : undefined,
        model: getString(device.props?.model),
        manufacturer: getString(device.props?.manufacturer),
        virtual: device.props?.dlna_kind === 'virtual',
      },
    })
  }

  const miDid = getString(device.props?.mi_did)
  if (miDid && looksLikeXiaoAiSpeaker(device)) {
    outputs.push({
      id: `xiaoai:saved:${device.id}`,
      kind: 'xiaoai',
      name: device.name,
      device_id: device.id,
      endpoint: miDid,
      online: true,
      meta: {
        saved: true,
        model: getString(device.props?.model),
        room_name: getString(device.props?.room_name),
        home_name: getString(device.props?.home_name),
      },
    })
  }
  return outputs
}

function looksLikeXiaoAiSpeaker(device: UserDevice): boolean {
  const haystack = [
    device.name,
    getString(device.props?.name),
    getString(device.props?.model),
    getString(device.props?.device_type),
    getString(device.props?.control_path),
  ].join(' ').toLowerCase()
  return /小爱|音箱|speaker|xiaoai|xiaomi\.wifispeaker|miot\.speaker/.test(haystack)
}

function mergeOutputs(target: MediaOutput[], incoming: MediaOutput[]) {
  for (const output of incoming) {
    const endpoint = output.endpoint || ''
    const exists = target.some((item) => item.kind === output.kind && item.endpoint === endpoint)
    if (!exists) target.push(output)
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function refreshOutputStatus(output: MediaOutput) {
  if (!output.endpoint) return
  outputStatus.value = { ...outputStatus.value, [output.id]: label('读取中', 'Loading') }
  if (output.kind === 'dlna') {
    const result = await mediaApi.getDlnaStatus(output.endpoint)
    if (result.status === 'success' && result.data) {
      const state = result.data.state ? stateText(result.data.state) : label('未知状态', 'Unknown')
      const position = result.data.position && result.data.position !== '00:00:00' ? ` · ${result.data.position}` : ''
      const volume = result.data.volume != null ? ` · ${label('音量', 'Vol')} ${result.data.volume}` : ''
      outputStatus.value = { ...outputStatus.value, [output.id]: `${state}${position}${volume}` }
      return
    }
    outputStatus.value = { ...outputStatus.value, [output.id]: result.message || result.error || label('状态读取失败', 'Status failed') }
    return
  }
  if (output.kind !== 'xiaoai') return
  const result = await mediaApi.getXiaoAiStatus(output.endpoint)
  if (result.status === 'success' && result.data) {
    const title = result.data.media_title || stateText(result.data.state)
    const volume = typeof result.data.volume === 'number' ? ` · ${label('音量', 'Vol')} ${result.data.volume}` : ''
    outputStatus.value = { ...outputStatus.value, [output.id]: `${title}${volume}` }
    return
  }
  outputStatus.value = { ...outputStatus.value, [output.id]: result.message || result.error || label('状态读取失败', 'Status failed') }
}

async function pushCurrentToDlna(output: MediaOutput) {
  const item = props.activeItem
  const location = output.endpoint || ''
  const bvid = item?.upstream_id || ''
  const title = item?.title || 'HomeSense Media'
  if (!location || !bvid) return
  pushingOutputId.value = output.id
  outputError.value = ''
  try {
    const result = await mediaApi.playBilibiliOnDlna({ location, bvid, title })
    if (result.status !== 'success') {
      outputError.value = result.message || result.error || label('推送失败', 'Push failed')
      return
    }
    outputStatus.value = { ...outputStatus.value, [output.id]: label('已推送当前媒体', 'Pushed current media') }
  } catch (error) {
    outputError.value = error instanceof Error ? error.message : String(error)
  } finally {
    pushingOutputId.value = ''
  }
}

async function pushCurrentToXiaoAi(output: MediaOutput) {
  const item = props.activeItem
  const did = output.endpoint || ''
  const bvid = item?.upstream_id || ''
  const title = item?.title || 'HomeSense Media'
  if (!did || !bvid) return
  pushingOutputId.value = output.id
  outputError.value = ''
  try {
    const result = await mediaApi.playBilibiliOnXiaoAi({ did, bvid, title })
    if (result.status !== 'success') {
      outputError.value = result.message || result.error || label('推送失败', 'Push failed')
      return
    }
    outputStatus.value = { ...outputStatus.value, [output.id]: label('已推送当前媒体', 'Pushed current media') }
  } catch (error) {
    outputError.value = error instanceof Error ? error.message : String(error)
  } finally {
    pushingOutputId.value = ''
  }
}

async function controlDlna(output: MediaOutput, control: 'pause' | 'resume' | 'stop') {
  const location = output.endpoint || ''
  if (!location) return
  controllingOutputId.value = `${output.id}:${control}`
  outputError.value = ''
  try {
    const result = await mediaApi.controlDlna(location, control)
    if (result.status !== 'success') {
      outputError.value = result.message || result.error || label('控制失败', 'Control failed')
      return
    }
    outputStatus.value = { ...outputStatus.value, [output.id]: controlText(control) }
  } catch (error) {
    outputError.value = error instanceof Error ? error.message : String(error)
  } finally {
    controllingOutputId.value = ''
  }
}

async function controlXiaoAi(output: MediaOutput, control: 'pause' | 'resume' | 'stop') {
  const did = output.endpoint || ''
  if (!did) return
  controllingOutputId.value = `${output.id}:${control}`
  outputError.value = ''
  try {
    const result = await mediaApi.controlXiaoAi(did, control)
    if (result.status !== 'success') {
      outputError.value = result.message || result.error || label('控制失败', 'Control failed')
      return
    }
    outputStatus.value = { ...outputStatus.value, [output.id]: controlText(control) }
  } catch (error) {
    outputError.value = error instanceof Error ? error.message : String(error)
  } finally {
    controllingOutputId.value = ''
  }
}

function controlText(control: 'pause' | 'resume' | 'stop'): string {
  const map: Record<typeof control, string> = {
    pause: label('已暂停', 'Paused'),
    resume: label('已继续', 'Resumed'),
    stop: label('已停止', 'Stopped'),
  }
  return map[control]
}

function canPushToXiaoAi(output: MediaOutput): boolean {
  return output.kind === 'xiaoai' && Boolean(output.endpoint && props.activeItem?.upstream_id)
}

function canPushToDlna(output: MediaOutput): boolean {
  return output.kind === 'dlna' && Boolean(output.endpoint && props.activeItem?.upstream_id)
}

function outputSubtitle(output: MediaOutput): string {
  const explicitStatus = outputStatus.value[output.id]
  if (explicitStatus) return explicitStatus
  if (output.kind === 'browser') return label('本机浏览器播放', 'Local browser playback')
  if (output.kind === 'dlna') {
    const ip = typeof output.meta?.ip === 'string' ? output.meta.ip : ''
    const model = typeof output.meta?.model === 'string' ? output.meta.model : ''
    const manufacturer = typeof output.meta?.manufacturer === 'string' ? output.meta.manufacturer : ''
    return [ip, manufacturer, model].filter(Boolean).join(' · ') || label('局域网投屏目标', 'LAN renderer')
  }
  const room = typeof output.meta?.room_name === 'string' ? output.meta.room_name : ''
  const home = typeof output.meta?.home_name === 'string' ? output.meta.home_name : ''
  const model = typeof output.meta?.model === 'string' ? output.meta.model : ''
  const status = typeof output.meta?.status === 'string' ? output.meta.status : ''
  return [room || home, model, status || (output.online ? label('可用', 'Ready') : label('待接入', 'Pending'))]
    .filter(Boolean)
    .join(' · ')
}

function stateText(state: string): string {
  const normalized = state.toLowerCase()
  const map: Record<string, string> = {
    idle: label('待机', 'Idle'),
    loading: label('载入中', 'Loading'),
    playing: label('播放中', 'Playing'),
    paused: label('已暂停', 'Paused'),
    stopped: label('已停止', 'Stopped'),
    stopped_pending: label('已停止', 'Stopped'),
    no_media_present: label('无媒体', 'No media'),
    transitioning: label('切换中', 'Transitioning'),
    error: label('失败', 'Error'),
  }
  return map[normalized] ?? state
}
</script>

<template>
  <section class="panel output-panel">
    <div class="panel-head">
      <div>
        <span class="eyebrow inline">{{ label('输出', 'Output') }}</span>
        <h2>{{ label('目标设备', 'Targets') }}</h2>
      </div>
      <button class="plain-btn" type="button" :disabled="outputLoading" @click="loadOutputs()">
        {{ outputLoading ? label('刷新中', 'Loading') : label('刷新', 'Refresh') }}
      </button>
      <button class="plain-btn" type="button" :disabled="discoveringOutputs" @click="discoverOutputs()">
        {{ discoveringOutputs ? label('发现中', 'Discovering') : label('发现', 'Discover') }}
      </button>
    </div>

    <p v-if="outputError" class="notice warn">{{ outputError }}</p>

    <div class="output-list">
      <div v-for="output in outputs" :key="output.id" class="output-row" :class="{ active: output.id === sessionOutputId, pending: !output.online }">
        <span class="output-kind">{{ output.kind }}</span>
        <div class="output-main">
          <strong>{{ output.name }}</strong>
          <small>{{ outputSubtitle(output) }}</small>
        </div>
        <div v-if="output.kind === 'xiaoai'" class="row-actions">
          <button class="row-icon" type="button" :disabled="controllingOutputId === `${output.id}:pause`" :title="label('暂停', 'Pause')" @click="controlXiaoAi(output, 'pause')">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
              <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
            </svg>
          </button>
          <button class="row-icon" type="button" :disabled="controllingOutputId === `${output.id}:resume`" :title="label('继续', 'Resume')" @click="controlXiaoAi(output, 'resume')">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
          <button class="row-icon" type="button" :disabled="controllingOutputId === `${output.id}:stop`" :title="label('停止', 'Stop')" @click="controlXiaoAi(output, 'stop')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M7 7h10v10H7z" />
            </svg>
          </button>
          <button class="row-icon" type="button" :disabled="!canPushToXiaoAi(output) || pushingOutputId === output.id" :title="label('推送当前媒体', 'Push current media')" @click="pushCurrentToXiaoAi(output)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 12h12" />
              <path d="m13 6 6 6-6 6" />
              <path d="M3 5v14" />
            </svg>
          </button>
          <button class="row-icon" type="button" :title="label('读取状态', 'Read status')" @click="refreshOutputStatus(output)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
        <div v-else-if="output.kind === 'dlna'" class="row-actions">
          <button class="row-icon" type="button" :disabled="controllingOutputId === `${output.id}:pause`" :title="label('暂停', 'Pause')" @click="controlDlna(output, 'pause')">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
              <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
            </svg>
          </button>
          <button class="row-icon" type="button" :disabled="controllingOutputId === `${output.id}:resume`" :title="label('继续', 'Resume')" @click="controlDlna(output, 'resume')">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
          <button class="row-icon" type="button" :disabled="controllingOutputId === `${output.id}:stop`" :title="label('停止', 'Stop')" @click="controlDlna(output, 'stop')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M7 7h10v10H7z" />
            </svg>
          </button>
          <button class="row-icon" type="button" :disabled="!canPushToDlna(output) || pushingOutputId === output.id" :title="label('推送当前媒体', 'Push current media')" @click="pushCurrentToDlna(output)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 12h12" />
              <path d="m13 6 6 6-6 6" />
              <path d="M3 5v14" />
            </svg>
          </button>
          <button class="row-icon" type="button" :title="label('读取状态', 'Read status')" @click="refreshOutputStatus(output)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
        <small v-else>{{ output.online ? label('可用', 'Ready') : label('待接入', 'Pending') }}</small>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.output-panel {
  min-height: 260px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.eyebrow {
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
}

.eyebrow.inline {
  display: inline-flex;
  margin-bottom: 5px;
}

h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0;
}

.plain-btn,
.row-icon {
  border-radius: 8px;
  font-family: inherit;
  font-weight: 900;
  cursor: pointer;
}

.plain-btn {
  min-height: 38px;
  padding: 0 13px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.plain-btn:hover:not(:disabled) {
  border-color: #0f766e;
  color: #0f766e;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.notice {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 800;
}

.notice.warn {
  border: 1px solid #fde68a;
  background: #fffbeb;
  color: #92400e;
}

.output-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.output-row {
  min-height: 58px;
  padding: 11px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr) max-content;
  align-items: center;
  gap: 10px;
}

.output-row.active {
  border-color: #99f6e4;
  background: #f0fdfa;
}

.output-row.pending {
  background: #f8fafc;
}

.output-kind {
  color: #0f766e;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.output-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.output-main strong,
.output-main small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.output-main strong {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 900;
}

.output-main small,
.output-row > small {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 850;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.row-icon {
  width: 32px;
  height: 32px;
  border: 1px solid #dbe3ec;
  background: #fff;
  color: #334155;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 700px) {
  .panel-head {
    align-items: stretch;
    flex-direction: column;
  }

  .output-row {
    grid-template-columns: 1fr;
  }

  .output-row .row-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .output-row small {
    justify-self: start;
  }
}
</style>
