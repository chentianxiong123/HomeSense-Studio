<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type UserDevice } from '@/api'
import { cliApi } from '@/api/cli'
import { useLocale } from '@/composables/useLocale'
import AppBrowserModal from '@/components/AppBrowserModal.vue'
import { formatChinaTime } from '@/utils/chinaTime'

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
function label(zh: string, en: string) { return isZh.value ? zh : en }

interface DeviceCapability {
  capability_id?: string
  name: string
  kind: string
  type?: string
  source?: string
  input_schema?: Record<string, unknown>
  output_schema?: Record<string, unknown> | null
  output?: Record<string, { type: string; description: string }> | null
  risk?: string
  metadata?: Record<string, unknown>
}

const route = useRoute()
const router = useRouter()
const deviceId = Number(route.params.id)

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
const execHistory = ref<Array<{ capability: string; params: string; result: string; time: string }>>([])

const irKeys = ref<Array<{ key_id: string; name: string; type?: string }>>([])
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
</script>

<template>
  <div class="detail-page">
    <header class="page-head glass-panel">
      <button class="back-btn" @click="router.push('/devices')">
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
      <section class="capabilities-section glass-panel">
        <div class="section-head">
          <h2>{{ label('设备能力', 'Capabilities') }}</h2>
          <button v-if="propString(device, 'mi_did') || propString(device, 'adb_ip')" class="refresh-caps-btn" :disabled="capsLoading" @click="refreshCapabilities()">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            {{ label('刷新', 'Refresh') }}
          </button>
        </div>

        <div v-if="!propString(device, 'mi_did') && !propString(device, 'adb_ip')" class="no-mi">
          {{ label('该设备未绑定 Mi 或 ADB 能力来源，无法获取能力列表。', 'This device has no Mi or ADB capability binding, capabilities are unavailable.') }}
        </div>

        <div v-else-if="capsLoading" class="caps-loading">{{ label('正在加载能力…', 'Loading capabilities…') }}</div>

        <div v-else-if="capsError" class="caps-error">
          <p>{{ capsError }}</p>
        </div>

        <div v-else-if="capabilities.length === 0" class="no-caps">
          {{ label('未检测到该设备的能力。', 'No capabilities detected for this device.') }}
        </div>

        <div v-else class="caps-grid">
          <div v-if="execResult" class="exec-feedback exec-success">{{ execResult }}</div>
          <div v-if="execError" class="exec-feedback exec-error">{{ execError }}</div>

          <div v-if="isIrDevice" class="cap-group">
            <h3 class="cap-group-title">{{ label('遥控按键', 'Remote Keys') }} · {{ irKeys.length }}</h3>
            <div v-if="irKeysLoading" class="caps-loading">{{ label('加载按键…', 'Loading keys…') }}</div>
            <div v-else-if="irKeys.length === 0" class="caps-loading" style="cursor:pointer" @click="loadIrKeys">
              {{ label('点击加载按键码表', 'Click to load key map') }}
            </div>
            <div v-else class="ir-keypad">
              <button
                v-for="key in irKeys"
                :key="key.key_id"
                class="ir-key-btn"
                :disabled="executingCap === 'ir_press'"
                @click="executeIrKey(key.key_id)"
              >{{ key.name }}</button>
            </div>
          </div>

          <div v-if="isAdbDevice" class="cap-group">
            <h3 class="cap-group-title">{{ label('应用', 'Apps') }}</h3>
            <button class="app-browser-btn" @click="showAppBrowser = true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
              {{ label('浏览已安装应用', 'Browse Installed Apps') }}
            </button>
          </div>

          <div v-if="miActionCaps.length > 0" class="cap-group">
            <h3 class="cap-group-title">Mi · {{ miActionCaps.length }}</h3>
            <div class="cap-cards">
              <div v-for="cap in miActionCaps" :key="cap.name" class="cap-card-wrapper">
                <div class="cap-card card-action" :class="{ 'cap-executing': executingCap === cap.name }" @click="cap.type !== 'string' && executeCapability(cap)">
                  <div class="cap-card-icon">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                  </div>
                  <div class="cap-card-body">
                    <span class="cap-card-name">{{ executingCap === cap.name ? label('发送中…', 'Sending…') : cap.name }}</span>
                    <span v-if="cap.type" class="cap-card-type">{{ cap.type }}</span>
                  </div>
                </div>
                <div v-if="cap.type === 'string'" class="cap-text-input-row">
                  <input
                    v-model="textInputs[cap.name]"
                    type="text"
                    class="cap-text-input"
                    :placeholder="label('输入文本…', 'Enter text…')"
                    @click.stop
                    @keydown.enter.stop="executeCapability(cap)"
                  />
                  <button class="cap-send-btn" :disabled="executingCap === cap.name || !textInputs[cap.name]" @click.stop="executeCapability(cap)">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="miPropertyCaps.length > 0" class="cap-group">
            <h3 class="cap-group-title">Mi · {{ miPropertyCaps.length }}</h3>
            <div class="cap-cards">
              <div v-for="cap in miPropertyCaps" :key="cap.name" class="cap-card card-property">
                <div class="cap-card-icon">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                </div>
                <div class="cap-card-body">
                  <span class="cap-card-name">{{ cap.name }}</span>
                  <span v-if="cap.type" class="cap-card-type">{{ cap.type }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="adbCaps.length > 0" class="cap-group">
            <h3 class="cap-group-title">ADB · {{ adbCaps.length }}</h3>
            <div class="cap-cards">
              <div v-for="cap in adbCaps" :key="cap.name" class="cap-card-wrapper">
                <div class="cap-card card-action" :class="{ 'cap-executing': executingCap === cap.name, 'card-cap-disabled': cap.type === 'string' }" @click="cap.type !== 'string' && executeCapability(cap)">
                  <div class="cap-card-icon">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                  </div>
                  <div class="cap-card-body">
                    <span class="cap-card-name">{{ executingCap === cap.name ? label('发送中…', 'Sending…') : cap.name }}</span>
                    <span v-if="cap.type" class="cap-card-type">{{ cap.type }}</span>
                  </div>
                </div>
                <div v-if="cap.type === 'string'" class="cap-text-input-row">
                  <input
                    v-model="textInputs[cap.name]"
                    type="text"
                    class="cap-text-input"
                    :placeholder="label('输入文本…', 'Enter text…')"
                    @click.stop
                    @keydown.enter.stop="executeCapability(cap)"
                  />
                  <button class="cap-send-btn" :disabled="executingCap === cap.name || !textInputs[cap.name]" @click.stop="executeCapability(cap)">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="execHistory.length > 0" class="cap-group">
            <h3 class="cap-group-title">{{ label('执行历史', 'History') }} · {{ execHistory.length }}</h3>
            <div class="exec-history">
              <div v-for="(entry, i) in execHistory" :key="i" class="history-item" :class="entry.result.startsWith('失败') || entry.result.startsWith('Failed') ? 'history-fail' : 'history-ok'">
                <div class="history-head">
                  <span class="history-cap">{{ entry.capability }}</span>
                  <span class="history-time">{{ entry.time }}</span>
                </div>
                <div class="history-detail">
                  <span v-if="entry.params" class="history-params">{{ label('参数: ', 'Params: ') }}<code>{{ entry.params }}</code></span>
                  <span class="history-result">{{ entry.result }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

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

.capabilities-section {
  padding: 36px 44px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
}

.section-head h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: var(--text-primary);
}

.refresh-caps-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
  font-size: 16px;
  font-weight: 800;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.refresh-caps-btn:hover:not(:disabled) {
  border-color: #10b981;
  color: #10b981;
  background: #fff;
  box-shadow: 0 6px 16px rgba(16, 185, 129, 0.12);
}

.no-mi, .no-caps, .caps-loading, .caps-error {
  text-align: center;
  padding: 48px 0;
  color: var(--text-tertiary);
  font-weight: 700;
  font-size: 16px;
  opacity: 0.6;
}

.caps-error {
  color: #ef4444;
  opacity: 1;
}

.caps-loading {
  opacity: 0.4;
}

.caps-grid {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.cap-group-title {
  margin: 0 0 16px;
  font-size: 15px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  opacity: 0.6;
}

.cap-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.cap-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-radius: 16px;
  border: 1px solid rgba(229, 231, 235, 0.6);
  background: rgba(255, 255, 255, 0.7);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  min-width: 140px;
  cursor: pointer;
}

.card-action.cap-executing {
  opacity: 0.5;
  pointer-events: none;
}

.cap-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
}

.cap-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex-shrink: 0;
}

.card-action .cap-card-icon {
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
}

.card-action {
  border-color: rgba(99, 102, 241, 0.15);
}

.card-action:hover {
  border-color: rgba(99, 102, 241, 0.3);
  background: rgba(255, 255, 255, 0.95);
}

.card-property .cap-card-icon {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
}

.card-property {
  border-color: rgba(16, 185, 129, 0.15);
}

.card-property:hover {
  border-color: rgba(16, 185, 129, 0.3);
  background: rgba(255, 255, 255, 0.95);
}

.cap-card-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cap-card-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.cap-card-type {
  font-size: 14px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  opacity: 0.6;
}

.ir-keypad {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ir-key-btn {
  padding: 12px 18px;
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.7);
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
  min-width: 48px;
  text-align: center;
}

.ir-key-btn:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.4);
  transform: translateY(-1px);
}

.ir-key-btn:active:not(:disabled) {
  transform: translateY(0);
  background: rgba(99, 102, 241, 0.2);
}

.ir-key-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.app-browser-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px;
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.7);
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.app-browser-btn:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(99, 102, 241, 0.1);
}

.exec-feedback {
  padding: 12px 20px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 700;
  animation: fadeIn 0.2s ease;
}

.exec-success {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.exec-error {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.cap-card-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cap-text-input-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.cap-text-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 10px;
  font-size: 16px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-primary);
  outline: none;
  transition: all 0.2s;
  min-width: 120px;
}

.cap-text-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.cap-text-input::placeholder {
  color: var(--text-tertiary);
  opacity: 0.4;
}

.cap-send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 10px;
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.cap-send-btn:hover:not(:disabled) {
  background: #6366f1;
  color: #fff;
  border-color: #6366f1;
}

.cap-send-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.exec-history {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}

.history-item {
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(229, 231, 235, 0.5);
  background: rgba(255, 255, 255, 0.5);
  transition: background 0.2s;
}

.history-item:hover {
  background: rgba(255, 255, 255, 0.8);
}

.history-ok {
  border-left: 3px solid #10b981;
}

.history-fail {
  border-left: 3px solid #ef4444;
}

.history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.history-cap {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.history-time {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-tertiary);
  opacity: 0.5;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.history-detail {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.history-params {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.history-params code {
  background: rgba(99, 102, 241, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 15px;
  color: #6366f1;
}

.history-result {
  font-size: 15px;
  font-weight: 700;
}

.history-ok .history-result {
  color: #10b981;
}

.history-fail .history-result {
  color: #ef4444;
}
</style>
