<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type UserDevice } from '@/api'
import { cliApi } from '@/api/cli'
import { useLocale } from '@/composables/useLocale'
import AppBrowserModal from '@/components/AppBrowserModal.vue'
import AdbWorkbench from '@/components/AdbWorkbench.vue'
import DeviceCapabilitiesPanel from '@/components/devices/DeviceCapabilitiesPanel.vue'
import type { DeviceCapability, DeviceExecutionHistoryEntry, DeviceIrKey } from '@/types/deviceCapabilities'
import { formatChinaTime } from '@/utils/chinaTime'

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
function label(zh: string, en: string) { return isZh.value ? zh : en }

const route = useRoute()
const router = useRouter()
const deviceId = Number(route.params.id)
const returnTo = computed(() => {
  const from = route.query.from
  if (typeof from === 'string' && from.startsWith('/')) return from
  return '/devices'
})

function goBack() {
  router.push(returnTo.value)
}

const loading = ref(true)
const device = ref<UserDevice | null>(null)
const capabilities = ref<DeviceCapability[]>([])
const capsLoading = ref(false)
const capsError = ref('')
const errorMessage = ref('')
const executingCap = ref('')
const execResult = ref('')
const execError = ref('')
const textInputs = ref<Record<string, string>>({})
const execHistory = ref<DeviceExecutionHistoryEntry[]>([])

const irKeys = ref<DeviceIrKey[]>([])
const irKeysLoading = ref(false)
const irControllerName = ref('')
const showAppBrowser = ref(false)
const miNameMap = ref<Record<string, string>>({})

function propString(d: UserDevice | null, key: string): string {
  if (!d) return ''
  const v = d.props?.[key]
  return typeof v === 'string' ? v : ''
}
function propNumber(d: UserDevice | null, key: string): number | null {
  if (!d) return null
  const v = d.props?.[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

async function persistCapabilities(newCaps: unknown[]): Promise<void> {
  if (!device.value) return
  const newProps = { ...device.value.props, capabilities: newCaps }
  try {
    await api.userDevices.update(device.value.id, { props: newProps })
    device.value = { ...device.value, props: newProps }
  } catch (e) {
    console.error('Failed to persist capabilities snapshot', e)
  }
}

function miDidOf(d: UserDevice | null): string {
  return propString(d, 'mi_did')
}
function adbIpOf(d: UserDevice | null): string {
  return propString(d, 'adb_ip')
}
function deviceTypeOf(d: UserDevice | null): string {
  return propString(d, 'device_type') || 'other'
}
function miNameFor(did: string): string {
  if (!did) return ''
  return miNameMap.value[did] || did
}

onMounted(async () => {
  loading.value = true
  try {
    const result = await api.userDevices.get(deviceId)
    device.value = result.device ?? null
    const snapshot = Array.isArray(device.value?.props?.capabilities)
      ? (device.value!.props.capabilities as DeviceCapability[])
      : []
    capabilities.value = snapshot
    loadHistory()
    void ensureMiNames()
    if (miDidOf(device.value) || adbIpOf(device.value)) {
      void refreshCapabilities()
    }
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    loading.value = false
  }
})

async function ensureMiNames(): Promise<void> {
  if (Object.keys(miNameMap.value).length > 0) return
  try {
    const r = await cliApi.run<{ summary: Array<{ did: string; name?: string; model?: string }> }>('mi-cli', {
      action: 'discover',
      params: { summary_only: true },
      ttl_ms: 60_000,
    })
    if (r.status === 'success' && r.data?.summary) {
      const next: Record<string, string> = {}
      for (const d of r.data.summary) {
        if (d.did) next[d.did] = d.name || d.model || d.did
      }
      miNameMap.value = next
    }
  } catch {}
}

async function refreshCapabilities(): Promise<void> {
  if (!device.value) return
  const collected: DeviceCapability[] = []
  const miDid = miDidOf(device.value)
  if (miDid) {
    const resp = await cliApi.run<{ capabilities: DeviceCapability[] }>('mi-cli', {
      action: 'device_capabilities',
      params: { did: miDid },
      ttl_ms: 60_000,
    })
    if (resp.status === 'success' && resp.data?.capabilities) {
      for (const c of resp.data.capabilities) collected.push({ ...c, source: 'mi' })
    }
  }
  const adbIp = adbIpOf(device.value)
  if (adbIp) {
    const resp = await cliApi.run<{ capabilities: DeviceCapability[] }>('adb-cli', {
      action: 'capabilities',
      params: { device_type: deviceTypeOf(device.value) },
      ttl_ms: 60_000,
    })
    if (resp.status === 'success' && resp.data?.capabilities) {
      for (const c of resp.data.capabilities) collected.push(c)
    }
  }
  if (collected.length === 0) return
  capabilities.value = collected
  await persistCapabilities(collected)
}

async function loadHistory() {
  try {
    const result = await api.userDevices.capabilityHistory(deviceId)
    if (result.history) {
      execHistory.value = result.history.map((e: { time: string; deviceId: string; capability: string; params: string; status: string; result?: string }) => ({
        capability: e.capability,
        params: e.params,
        result: e.status === 'ok' ? (e.result || label('成功', 'Success')) : label('失败: ', 'Failed: ') + e.status,
        time: formatChinaTime(e.time),
      })).reverse()
    }
  } catch {
    // silent
  }
}

async function loadIrKeys() {
  irKeysLoading.value = true
  try {
    const miDid = miDidOf(device.value)
    if (!miDid) {
      irKeys.value = []
      return
    }
    const resp = await cliApi.run<{ keys: Array<{ key_id: string | number; name: string; type?: string }>; name: string }>('mi-cli', {
      action: 'device_ir_keys',
      params: { did: miDid },
      ttl_ms: 60_000,
    })
    if (resp.status === 'success' && resp.data) {
      irKeys.value = (resp.data.keys ?? []).map((k) => ({
        key_id: String(k.key_id),
        name: k.name,
        type: k.type,
      }))
      irControllerName.value = resp.data.name
    } else {
      irKeys.value = []
    }
  } catch {
    irKeys.value = []
  } finally {
    irKeysLoading.value = false
  }
}

async function executeIrKey(keyId: string) {
  if (executingCap.value) return
  executingCap.value = 'ir_press'
  execResult.value = ''
  execError.value = ''
  try {
    const miDid = miDidOf(device.value)
    const resp = await cliApi.run('mi-cli', {
      action: 'device_ir_press',
      params: { did: miDid, key_id: keyId },
      ttl_ms: 0,
      bypass_cache: true,
    })
    if (resp.status === 'success') {
      execResult.value = label('按键已发送', 'Key sent')
      logUsage('mi', 'ir_press', keyId, 'ok')
    } else {
      execError.value = resp.message || resp.error || label('发送失败', 'Failed')
    }
  } catch (e) {
    execError.value = (e as Error).message || String(e)
  } finally {
    executingCap.value = ''
  }
}

async function executeCapability(cap: DeviceCapability) {
  if (executingCap.value) return
  const params = textInputs.value[cap.name]
  if (cap.type === 'string' && !params && cap.name !== '播放音乐' && cap.name !== 'Play Music') {
    execError.value = label('请输入文本', 'Please enter text')
    return
  }
  executingCap.value = cap.name
  execResult.value = ''
  execError.value = ''
  try {
    const source = cap.source ?? 'mi'
    const cli = source === 'adb' ? 'adb-cli' : 'mi-cli'
    const action = resolveAdbAction(cap) ?? resolveMiAction(cap) ?? ''
    if (!action) {
      execError.value = label('无法识别的能力', 'Unrecognized capability')
      return
    }
    const cliParams = buildCliParams(cap, params)
    const resp = await cliApi.run(cli, {
      action,
      params: cliParams,
      ttl_ms: 0,
      bypass_cache: true,
    })
    if (resp.status === 'success') {
      execResult.value = label('已发送: ', 'Sent: ') + cap.name
      textInputs.value[cap.name] = ''
    } else {
      execError.value = resp.message || resp.error || label('执行失败', 'Execution failed')
    }
    loadHistory()
  } catch (e) {
    execError.value = (e as Error).message || String(e)
    loadHistory()
  } finally {
    executingCap.value = ''
  }
}

function resolveAdbAction(cap: DeviceCapability): string | null {
  return typeof cap.capability_id === 'string' && cap.capability_id.startsWith('adb.')
    ? cap.capability_id.slice(4)
    : null
}

function resolveMiAction(cap: DeviceCapability): string | null {
  if (typeof cap.capability_id === 'string' && cap.capability_id.startsWith('mi.')) {
    return cap.capability_id.slice(3)
  }
  return null
}

function buildCliParams(cap: DeviceCapability, rawValue?: string): Record<string, unknown> {
  const text = rawValue?.trim()
  if (!text) return {}
  const properties = readSchemaProperties(cap.input_schema)
  if (properties.package) return { package: text }
  if (properties.index || (properties.index && properties.text)) {
    if (text.startsWith('index:')) return { index: Number(text.slice(6).trim()) }
    const index = Number(text)
    return Number.isFinite(index) ? { index } : { text }
  }
  if (properties.x && properties.y) {
    const [x, y] = text.split(',').map((item) => Number(item.trim()))
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { value: text }
  }
  if (properties.start_x && properties.start_y && properties.end_x && properties.end_y) {
    const [start_x, start_y, end_x, end_y, duration] = text.split(',').map((item) => Number(item.trim()))
    if ([start_x, start_y, end_x, end_y].every(Number.isFinite)) {
      return {
        start_x,
        start_y,
        end_x,
        end_y,
        ...(Number.isFinite(duration) ? { duration } : {}),
      }
    }
    return { value: text }
  }
  if (properties.text) return { text }
  if (properties.value) return { value: coerceCapabilityValue(text) }
  if (cap.capability_id === 'mi.ir_key' || cap.name === '遥控按键') return { key_id: text }
  return { value: coerceCapabilityValue(text) }
}

function logUsage(source: string, capability: string, params: string, status: string): void {
  fetch('/api/command/usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, source, capability, params, status }),
  }).catch(() => {})
}

function readSchemaProperties(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  const properties = schema?.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {}
  return properties as Record<string, unknown>
}

function coerceCapabilityValue(value: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

const miActionCaps = computed(() => capabilities.value.filter(c => c.source === 'mi' && c.kind === 'action' && c.name !== '遥控按键' && c.name !== 'Remote Keys'))
const miPropertyCaps = computed(() => capabilities.value.filter(c => c.source === 'mi' && c.kind === 'property'))
const adbCaps = computed(() => capabilities.value.filter(c => c.source === 'adb'))
const isIrDevice = computed(() => capabilities.value.some(c => c.name === '遥控按键' || c.name === 'Remote Keys'))
const isAdbDevice = computed(() => capabilities.value.some(c => c.source === 'adb'))

const deviceTypeOptions: Record<string, { zh: string; en: string }> = {
  television: { zh: '电视', en: 'TV' },
  stb: { zh: '机顶盒', en: 'STB' },
  speaker: { zh: '音箱', en: 'Speaker' },
  router: { zh: '路由器', en: 'Router' },
  outlet: { zh: '插座', en: 'Outlet' },
  phone: { zh: '手机', en: 'Phone' },
  tv_box: { zh: '电视盒', en: 'TV Box' },
  tablet: { zh: '平板', en: 'Tablet' },
  computer: { zh: '电脑', en: 'Computer' },
  other: { zh: '其他', en: 'Other' },
}

function typeLabel(t: string) {
  return deviceTypeOptions[t]?.[isZh.value ? 'zh' : 'en'] ?? t
}

function sourceTags(d: UserDevice): string[] {
  const tags: string[] = []
  if (propString(d, 'mi_did')) tags.push('Mi')
  if (propString(d, 'adb_ip')) tags.push('ADB')
  return tags
}

function setTextInput(capabilityName: string, value: string): void {
  textInputs.value = { ...textInputs.value, [capabilityName]: value }
}

const canOpenConsole = computed(() => {
  if (!device.value) return false
  if (propString(device.value, 'ssh_host') && propString(device.value, 'ssh_user')) return true
  if (propString(device.value, 'adb_serial') || propString(device.value, 'adb_ip')) return true
  return propString(device.value, 'device_type') === 'windows_pc'
})

function openConsole() {
  router.push({ path: '/sessions/terminal', query: { target_device_id: deviceId, from: route.fullPath } })
}
</script>

<template>
  <div class="detail-page">
    <header class="page-head glass-panel">
      <button class="back-btn" @click="goBack">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        {{ label('返回', 'Back') }}
      </button>

      <div v-if="!loading && device" class="head-content">
        <div class="head-top">
          <span class="eyebrow">{{ typeLabel(propString(device, 'device_type') || 'other') }}</span>
          <h1>{{ device.name }}</h1>
          <div class="source-tags">
            <span v-for="tag in sourceTags(device)" :key="tag" class="source-tag" :class="tag === 'ADB' ? 'tag-adb' : 'tag-mi'">{{ tag }}</span>
          </div>
          <button v-if="canOpenConsole" class="console-btn" @click="openConsole">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
            {{ label('控制台', 'Console') }}
          </button>
        </div>
        <div class="head-meta">
          <span v-if="propString(device, 'mi_did')" class="meta-chip monospace">Mi: {{ miNameFor(propString(device, 'mi_did')) }}</span>
          <span v-if="propString(device, 'adb_ip')" class="meta-chip monospace">ADB: {{ propString(device, 'adb_ip') }}</span>
          <span v-if="propString(device, 'ip_address')" class="meta-chip monospace">IP: {{ propString(device, 'ip_address') }}</span>
        </div>
      </div>
    </header>

    <div v-if="errorMessage" class="error-line glass-panel">
      {{ errorMessage }}
    </div>

    <div v-if="loading" class="empty-state">{{ label('加载中…', 'Loading…') }}</div>

    <div v-else-if="!device" class="empty-state">{{ label('设备不存在', 'Device not found') }}</div>

    <template v-else>
      <DeviceCapabilitiesPanel
        class="glass-panel"
        :label="label"
        :has-capability-source="!!(propString(device, 'mi_did') || propString(device, 'adb_ip'))"
        :caps-loading="capsLoading"
        :caps-error="capsError"
        :capabilities-count="capabilities.length"
        :exec-result="execResult"
        :exec-error="execError"
        :is-ir-device="isIrDevice"
        :ir-keys="irKeys"
        :ir-keys-loading="irKeysLoading"
        :is-adb-device="isAdbDevice"
        :mi-action-caps="miActionCaps"
        :mi-property-caps="miPropertyCaps"
        :adb-caps="adbCaps"
        :executing-cap="executingCap"
        :text-inputs="textInputs"
        :exec-history="execHistory"
        @refresh="refreshCapabilities"
        @load-ir-keys="loadIrKeys"
        @execute-ir-key="executeIrKey"
        @execute-capability="executeCapability"
        @open-app-browser="showAppBrowser = true"
        @update-text-input="setTextInput"
      />

      <AdbWorkbench
        v-if="propString(device, 'adb_ip')"
        class="glass-panel adb-workbench-section"
        :device-id="deviceId"
        :device-name="device.name"
        :adb-ip="propString(device, 'adb_ip')"
        :device-type="typeLabel(propString(device, 'device_type') || 'other')"
        :can-open-console="canOpenConsole"
        :label="label"
        @open-console="openConsole"
      />

      <AppBrowserModal v-if="showAppBrowser" :device-id="deviceId" :adb-ip="propString(device, 'adb_ip')" @close="showAppBrowser = false" />
    </template>
  </div>
</template>

<style scoped>
.detail-page {
  height: 100%;
  overflow-y: auto;
  padding: 48px;
  background: #f7f9fa;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.glass-panel {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 40px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.page-head {
  padding: 40px 48px;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-secondary);
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  margin-bottom: 24px;
  transition: all 0.2s;
}

.back-btn:hover {
  border-color: #6366f1;
  color: #6366f1;
  background: #fff;
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.12);
  transform: translateY(-1px);
}

.head-content {
  margin-left: 0;
}

.head-top {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.eyebrow {
  display: inline-block;
  color: #10b981;
  font-size: 14px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  background: rgba(16, 185, 129, 0.1);
  padding: 6px 16px;
  border-radius: 10px;
}

h1 {
  margin: 0;
  font-size: 36px;
  font-weight: 900;
  letter-spacing: -0.06em;
  color: var(--text-primary);
  line-height: 1;
}

.source-tags {
  display: flex;
  gap: 6px;
}

.source-tag {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 99px;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.tag-mi { background: rgba(16, 185, 129, 0.1); color: #10b981; }
.tag-adb { background: rgba(99, 102, 241, 0.1); color: #6366f1; }

.head-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.meta-chip {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 10px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-tertiary);
}

.meta-chip.monospace {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 16px;
}

.error-line {
  padding: 20px 32px;
  border-color: rgba(239, 68, 68, 0.15);
  background: rgba(254, 242, 242, 0.8);
  color: #ef4444;
  font-size: 16px;
  font-weight: 900;
  box-shadow: 0 8px 24px rgba(239, 68, 68, 0.08);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--text-tertiary);
  font-size: 16px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.25em;
  opacity: 0.4;
}

.console-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  margin-left: 12px;
  border-radius: 6px;
  border: 1px solid #10b981;
  background: transparent;
  color: #10b981;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.console-btn:hover {
  background: #10b981;
  color: #fff;
}
</style>
