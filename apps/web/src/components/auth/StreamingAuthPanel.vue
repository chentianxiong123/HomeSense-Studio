<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  streamingGatewayApi,
  type MoonlightWebRuntimeStatus,
  type StreamingHost,
  type StreamingHostPairTask,
  type StreamingHostProbe,
  type StreamingScanCandidate,
} from '@/api/streamingGateway'

type LabelFn = (zh: string, en: string) => string

const props = defineProps<{
  hosts: StreamingHost[]
  probes: Record<string, StreamingHostProbe>
  runtimeStatus: MoonlightWebRuntimeStatus | null
  pairingHost: StreamingHost | null
  pairingTask: StreamingHostPairTask | null
  hostCount: number
  loading: boolean
  actionLoading: boolean
  error: string
  message: string
  showForm: boolean
  hostLabel: string
  hostEndpoint: string
  hostBasePort: string
  hostMac: string
  hostRoom: string
  hostNetworkPath: string
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'refresh-hosts'): void
  (event: 'refresh-runtime'): void
  (event: 'toggle-form'): void
  (event: 'register-host'): void
  (event: 'probe-host', value: StreamingHost): void
  (event: 'pair-host', value: StreamingHost): void
  (event: 'check-pairing'): void
  (event: 'wake-host', value: StreamingHost): void
  (event: 'remove-host', value: StreamingHost): void
  (event: 'close-pairing'): void
  (event: 'update:hostLabel', value: string): void
  (event: 'update:hostEndpoint', value: string): void
  (event: 'update:hostBasePort', value: string): void
  (event: 'update:hostMac', value: string): void
  (event: 'update:hostRoom', value: string): void
  (event: 'update:hostNetworkPath', value: string): void
}>()

const scanSubnet = ref('')
const scanOpen = ref(false)
const scanLoaded = ref(false)
const scanSummary = ref('')
const scanResults = ref<StreamingScanCandidate[]>([])
const localError = ref('')
const localMessage = ref('')
const busy = ref<Record<string, boolean>>({})

const sortedHosts = computed(() => [...props.hosts].sort((left, right) => left.label.localeCompare(right.label)))
const pairedCount = computed(() => props.hosts.filter((host) => host.pairing?.status === 'paired' && !host.pairing.mock_pairing).length)

function label(zh: string, en: string) {
  return props.label(zh, en)
}

function setBusy(key: string, value: boolean) {
  const next = { ...busy.value }
  if (value) next[key] = true
  else delete next[key]
  busy.value = next
}

function isBusy(key: string) {
  return Boolean(busy.value[key])
}

function probeText(host: StreamingHost) {
  const probe = props.probes[host.id]
  if (host.pairing?.status === 'paired' && !host.pairing.mock_pairing) return label('已配对', 'Paired')
  if (!probe) return host.source === 'legacy_device' ? label('旧设备来源', 'Legacy device') : label('已保存', 'Saved')
  return probe.reachable ? label('可达', 'Reachable') : label('不可达', 'Unreachable')
}

function isSaved(endpoint: string) {
  return props.hosts.some((host) => normalizeEndpoint(host.endpoint) === normalizeEndpoint(endpoint))
}

function normalizeEndpoint(value: string) {
  return value.trim().replace(/\/+$/, '').toLowerCase()
}

async function scanHosts() {
  setBusy('scan', true)
  localError.value = ''
  localMessage.value = ''
  scanLoaded.value = false
  try {
    const result = await streamingGatewayApi.scanHosts({
      subnet: scanSubnet.value.trim() || undefined,
      ports: [47989],
      timeout_ms: 350,
    })
    scanResults.value = result.data.candidates ?? []
    scanSummary.value = label(
      `已扫描 ${result.data.scanned} 个端口，发现 ${result.data.count} 个候选，网段：${result.data.subnets.join('、') || result.data.subnet}`,
      `Scanned ${result.data.scanned} ports, found ${result.data.count} candidates across ${result.data.subnets.join(', ') || result.data.subnet}`,
    )
    scanLoaded.value = true
  } catch (error) {
    localError.value = (error as Error).message || String(error)
  } finally {
    setBusy('scan', false)
  }
}

function saveCandidate(candidate: StreamingScanCandidate) {
  emit('update:hostLabel', `Sunshine ${candidate.ip}`)
  emit('update:hostEndpoint', candidate.endpoint)
  emit('update:hostBasePort', String(candidate.port))
  emit('update:hostMac', '')
  emit('update:hostRoom', '')
  emit('update:hostNetworkPath', 'lan')
  emit('register-host')
}
</script>

<template>
  <section class="detail-surface">
    <div class="detail-head">
      <div>
        <span class="eyebrow">{{ label('局域网账号', 'Local Network') }}</span>
        <h2>{{ label('串流认证', 'Streaming Auth') }}</h2>
      </div>
      <span :class="['pill', pairedCount > 0 ? 'ok' : 'muted']">
        {{ pairedCount }} / {{ hostCount }} {{ label('已配对', 'paired') }}
      </span>
    </div>

    <div class="streaming-account compact">
      <div class="account-main">
        <span class="field-label">{{ label('认证方式', 'Auth method') }}</span>
        <strong>Sunshine PIN</strong>
        <span class="compact-line">{{ label('添加主机后在本页生成 PIN，去 Sunshine 输入确认。', 'Generate a PIN here, then enter it in Sunshine.') }}</span>
      </div>
      <div class="account-actions">
        <button class="primary-btn" type="button" @click="emit('toggle-form')">
          {{ showForm ? label('收起', 'Collapse') : label('添加主机', 'Add Host') }}
        </button>
        <button class="plain-btn" type="button" @click="scanOpen = !scanOpen">{{ scanOpen ? label('收起发现', 'Hide Discovery') : label('发现主机', 'Discover') }}</button>
        <button class="plain-btn" :disabled="loading" type="button" @click="emit('refresh-hosts')">{{ label('刷新', 'Refresh') }}</button>
      </div>
    </div>

    <section v-if="runtimeStatus && !runtimeStatus.reachable" class="inline-alert">
      <span>{{ label('配对组件未就绪。', 'Pairing is not ready.') }}</span>
      <button class="plain-btn compact" type="button" @click="emit('refresh-runtime')">{{ label('重试', 'Retry') }}</button>
    </section>

    <section v-if="pairingHost && pairingTask" class="pairing-workspace">
      <div class="pairing-head">
        <div>
          <strong>{{ label('配对', 'Pair') }} {{ pairingHost.label }}</strong>
          <small>{{ label('把这个 PIN 输入到 Sunshine 的配对确认里。', 'Enter this PIN in Sunshine pairing confirmation.') }}</small>
        </div>
        <div class="row-actions">
          <button v-if="pairingTask.status === 'pin'" class="plain-btn compact" type="button" @click="emit('check-pairing')">
            {{ label('检查结果', 'Check') }}
          </button>
          <button class="primary-btn compact" type="button" @click="emit('refresh-hosts'); emit('close-pairing')">
            {{ pairingTask.status === 'paired' ? label('完成', 'Done') : label('关闭', 'Close') }}
          </button>
        </div>
      </div>
      <div :class="['pin-panel', pairingTask.status]">
        <span>{{ pairingTask.status === 'failed' ? label('配对失败', 'Pairing failed') : pairingTask.status === 'paired' ? label('配对完成', 'Paired') : label('PIN', 'PIN') }}</span>
        <strong>{{ pairingTask.pin || '----' }}</strong>
        <small v-if="pairingTask.status === 'pin'">
          {{ label('确认后点“检查结果”。', 'Click Check after confirming in Sunshine.') }}
        </small>
        <small v-else-if="pairingTask.status === 'paired'">
          {{ label('认证已保存。到设备里绑定后再开始串流。', 'Auth saved. Bind it to a device before streaming.') }}
        </small>
        <small v-else>{{ pairingTask.error }}</small>
      </div>
    </section>

    <div v-if="showForm" class="manual-form">
      <input :value="hostLabel" class="field" :placeholder="label('名称', 'Name')" @input="emit('update:hostLabel', ($event.target as HTMLInputElement).value)" />
      <input :value="hostEndpoint" class="field wide" placeholder="http://192.168.31.10:47989" @input="emit('update:hostEndpoint', ($event.target as HTMLInputElement).value)" />
      <input :value="hostBasePort" class="field small" placeholder="47989" @input="emit('update:hostBasePort', ($event.target as HTMLInputElement).value)" />
      <input :value="hostMac" class="field" :placeholder="label('MAC 可选', 'MAC optional')" @input="emit('update:hostMac', ($event.target as HTMLInputElement).value)" />
      <button class="primary-btn" :disabled="actionLoading" type="button" @click="emit('register-host')">{{ label('保存', 'Save') }}</button>
    </div>

    <p v-if="error || localError" class="notice bad">{{ error || localError }}</p>
    <p v-if="message || localMessage" class="notice ok">{{ message || localMessage }}</p>

    <section v-if="scanOpen" class="subsection scan-panel">
      <div class="subsection-head">
        <div>
          <strong>{{ label('扫描候选', 'Scan Candidates') }}</strong>
          <small>{{ scanLoaded ? `${scanResults.length}` : label('按需扫描', 'Scan on demand') }}</small>
        </div>
        <div class="toolbar-actions">
          <input v-model="scanSubnet" class="toolbar-input" placeholder="192.168.31.0/24" />
          <button class="plain-btn" :disabled="isBusy('scan')" type="button" @click="scanHosts">
            {{ isBusy('scan') ? label('扫描中', 'Scanning') : label('扫描', 'Scan') }}
          </button>
        </div>
      </div>
      <div v-if="!scanLoaded" class="empty-line left">
        {{ label('输入网段或留空扫描本机附近地址。', 'Enter a subnet or leave blank to scan nearby hosts.') }}
      </div>
      <div v-if="scanLoaded && scanSummary" class="scan-summary">{{ scanSummary }}</div>
      <div v-if="scanLoaded && scanResults.length === 0" class="empty-line">
        {{ label('没有发现 Sunshine 端口。', 'No Sunshine ports found.') }}
      </div>
      <div v-else-if="scanLoaded" class="target-table">
        <div class="target-row header">
          <span>{{ label('地址', 'Address') }}</span>
          <span>{{ label('状态', 'Status') }}</span>
          <span>{{ label('操作', 'Actions') }}</span>
        </div>
        <div v-for="candidate in scanResults" :key="candidate.endpoint" class="target-row">
          <div class="endpoint-cell">
            <code>{{ candidate.endpoint }}</code>
            <small v-if="candidate.latency_ms != null">{{ candidate.latency_ms }}ms</small>
          </div>
          <span :class="['pill', isSaved(candidate.endpoint) ? 'ok' : 'muted']">
            {{ isSaved(candidate.endpoint) ? label('已保存', 'Saved') : label('候选', 'Candidate') }}
          </span>
          <div class="row-actions">
            <button class="primary-btn compact" :disabled="isSaved(candidate.endpoint) || actionLoading" type="button" @click="saveCandidate(candidate)">
              {{ label('保存', 'Save') }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="subsection">
      <div class="subsection-head">
        <div>
          <strong>{{ label('主机列表', 'Hosts') }}</strong>
          <small>{{ hostCount }}</small>
        </div>
      </div>

      <div v-if="sortedHosts.length === 0" class="empty-line">
        {{ label('还没有主机，先点“添加主机”或“发现主机”。', 'No hosts yet. Add or discover one first.') }}
      </div>
      <div v-else class="target-table">
        <div class="target-row header">
          <span>{{ label('名称', 'Name') }}</span>
          <span>{{ label('地址', 'Endpoint') }}</span>
          <span>{{ label('操作', 'Actions') }}</span>
        </div>
        <div v-for="host in sortedHosts" :key="host.id" class="target-row">
          <div class="device-cell">
            <strong>{{ host.label }}</strong>
            <small>{{ probeText(host) }}</small>
          </div>
          <div class="endpoint-cell">
            <code>{{ host.endpoint }}</code>
            <small v-if="host.mac_address">MAC {{ host.mac_address }}</small>
          </div>
          <div class="row-actions">
            <button class="plain-btn compact" type="button" @click="emit('probe-host', host)">{{ label('探测', 'Probe') }}</button>
            <button class="primary-btn compact" type="button" @click="emit('pair-host', host)">{{ label('配对', 'Pair') }}</button>
            <button class="plain-btn compact" :disabled="!host.mac_address" type="button" @click="emit('wake-host', host)">{{ label('唤醒', 'Wake') }}</button>
            <button class="danger-btn compact" type="button" @click="emit('remove-host', host)">{{ label('删除', 'Delete') }}</button>
          </div>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.detail-surface {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 22px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.detail-head,
.streaming-account,
.account-actions,
.toolbar-actions,
.row-actions,
.manual-form,
.subsection-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-head,
.streaming-account,
.subsection-head {
  justify-content: space-between;
}

.detail-head,
.streaming-account,
.subsection {
  margin-bottom: 18px;
}

.eyebrow {
  display: inline-flex;
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
}

h2 {
  margin: 5px 0 0;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 900;
  letter-spacing: 0;
}

.streaming-account,
.manual-form {
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.account-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.pairing-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pairing-workspace {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 18px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  padding: 12px;
  background: #eff6ff;
}

.scan-panel {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  background: #f8fafc;
}

.pairing-head {
  justify-content: space-between;
}

.pin-panel {
  display: grid;
  gap: 8px;
  justify-items: start;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  padding: 18px;
  background: #fff;
}

.pin-panel span {
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 900;
}

.pin-panel strong {
  color: #0f172a;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 40px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0;
}

.pin-panel.paired {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.pin-panel.failed {
  border-color: #fecaca;
  background: #fef2f2;
}

.account-main strong,
.pairing-head strong,
.subsection-head strong,
.device-cell strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
}

.field-label,
.compact-line,
.pairing-head small,
.subsection-head small,
.device-cell small,
.endpoint-cell small,
.empty-line {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.toolbar-input,
.field {
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0 10px;
  font: inherit;
}

.toolbar-input { width: 180px; }
.field { width: 160px; }
.field.wide { width: 260px; }
.field.small { width: 90px; }

.target-table,
.device-cell,
.endpoint-cell {
  display: grid;
  gap: 8px;
}

.target-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(160px, 1.4fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.target-row.header {
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.row-actions {
  justify-content: flex-end;
}

.pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  min-height: 26px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 900;
}

.pill.ok,
.notice.ok { background: #dcfce7; color: #047857; }
.pill.muted { background: #f4f4f5; color: #71717a; }
.notice.bad { background: #fef2f2; color: #b91c1c; }

.notice,
.scan-summary {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 800;
}

.scan-summary {
  border: 1px solid #dbeafe;
  background: #eff6ff;
  color: #1d4ed8;
}

.empty-line {
  padding: 18px;
  text-align: center;
}

.empty-line.left {
  text-align: left;
}

code {
  overflow-wrap: anywhere;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
}

.plain-btn,
.primary-btn,
.danger-btn {
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 0 12px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.primary-btn {
  border-color: #0f766e;
  background: #0f766e;
  color: #fff;
}

.danger-btn {
  border-color: #fecaca;
  color: #b91c1c;
}

.compact {
  min-height: 30px;
  padding: 0 10px;
  font-size: 12px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 760px) {
  .detail-head,
  .streaming-account {
    align-items: flex-start;
    flex-direction: column;
  }

  .account-actions {
    width: 100%;
  }

  .account-actions button {
    flex: 1 1 120px;
  }

  .toolbar-input,
  .field,
  .field.wide,
  .field.small {
    width: 100%;
  }

  .target-row,
  .target-row.header {
    grid-template-columns: 1fr;
  }

  .target-row.header {
    display: none;
  }
}
</style>
