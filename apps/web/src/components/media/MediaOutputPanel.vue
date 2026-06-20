<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, type UserDevice } from '@/api'
import { useLocale } from '@/composables/useLocale'
import { useMediaPlayer } from '@/features/media/player'
import type { MediaOutput } from '@/features/media/types'

defineProps<{
  sessionOutputId?: string
}>()

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
const outputLoading = ref(false)
const outputError = ref('')
const dynamicOutputs = ref<MediaOutput[]>([])
const outputStatus = ref<Record<string, string>>({})
const selectingOutputId = ref('')
const player = useMediaPlayer()

const browserOutput = computed<MediaOutput>(() => ({
  id: 'browser:local',
  kind: 'browser',
  name: label('浏览器', 'Browser'),
  online: true,
}))
const outputs = computed<MediaOutput[]>(() => [browserOutput.value, ...dynamicOutputs.value])

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
  if (miDid && looksLikeXiaoAiSpeaker(device) && !isBlockedXiaoAiOutput(device)) {
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

function isBlockedXiaoAiOutput(device: UserDevice): boolean {
  const explicitDlan = device.props?.dlan
  if (explicitDlan === false) return true
  const haystack = [
    device.name,
    getString(device.props?.name),
    getString(device.props?.model),
  ].join(' ').toLowerCase()
  return /红米|redmi/.test(haystack)
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function selectOutput(output: MediaOutput) {
  selectingOutputId.value = output.id
  outputError.value = ''
  try {
    player.selectOutput(output)
    outputStatus.value = { ...outputStatus.value, [output.id]: label('已设为输出', 'Selected output') }
  } catch (error) {
    outputError.value = error instanceof Error ? error.message : String(error)
  } finally {
    selectingOutputId.value = ''
  }
}

function canSelectOutput(output: MediaOutput): boolean {
  if (output.kind === 'browser') return true
  if (output.kind === 'xiaoai') return Boolean(output.endpoint)
  if (output.kind === 'dlna') return Boolean(output.endpoint)
  return false
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

function kindDisplay(output: MediaOutput): string {
  if (output.kind === 'browser') return label('本机', 'Local')
  if (output.kind === 'xiaoai') return label('小爱', 'XiaoAi')
  if (output.kind === 'dlna') return 'DLNA'
  if (output.kind === 'adb') return 'ADB'
  return output.kind
}

function outputSourceLabel(output: MediaOutput): string {
  if (output.kind === 'browser') return label('内置输出', 'Built-in')
  if (output.meta?.saved || output.device_id) return label('绑定设备', 'Bound device')
  return label('临时目标', 'Temporary')
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
    </div>

    <p v-if="outputError" class="notice warn">{{ outputError }}</p>

    <div class="output-list">
      <div v-for="output in outputs" :key="output.id" class="output-row" :class="{ active: output.id === sessionOutputId, pending: !output.online }">
        <div class="output-tags">
          <span class="output-kind">{{ kindDisplay(output) }}</span>
          <span class="output-source">{{ outputSourceLabel(output) }}</span>
        </div>
        <div class="output-main">
          <strong>{{ output.name }}</strong>
          <small>{{ outputSubtitle(output) }}</small>
        </div>
        <div class="row-actions">
          <button class="select-btn" type="button" :disabled="!canSelectOutput(output) || selectingOutputId === output.id" @click="selectOutput(output)">
            {{ output.id === sessionOutputId ? label('当前输出', 'Current') : label('设为输出', 'Use') }}
          </button>
        </div>
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
.select-btn {
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
  grid-template-columns: 86px minmax(0, 1fr) max-content;
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

.output-tags {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.output-kind,
.output-source {
  width: fit-content;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.output-kind {
  min-height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  background: #ecfeff;
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  display: inline-flex;
  align-items: center;
}

.output-source {
  color: #64748b;
  font-size: 11px;
  font-weight: 850;
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

.select-btn {
  min-width: 74px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #0f766e;
  background: #0f766e;
  color: #fff;
  font-size: 12px;
}

.output-row.active .select-btn {
  border-color: #14b8a6;
  background: #ccfbf1;
  color: #0f766e;
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
