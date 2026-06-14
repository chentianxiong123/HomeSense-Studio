<script setup lang="ts">
type LabelFn = (zh: string, en: string) => string

export type AdbScanCandidate = {
  ip: string
  port: number
  address: string
  open?: boolean
  latency_ms?: number
  adb_status?: string
  source?: string
}

const props = defineProps<{
  loaded: boolean
  candidates: AdbScanCandidate[]
  summary: string
  connectionResults: Record<string, { ok: boolean; message: string }>
  label: LabelFn
  isBusy: (key: string) => boolean
  isSaved: (address: string) => boolean
}>()

const emit = defineEmits<{
  (event: 'connect', address: string): void
  (event: 'save', candidate: AdbScanCandidate): void
}>()

function label(zh: string, en: string) {
  return props.label(zh, en)
}

function formatStatus(status?: string) {
  if (status === 'device') return label('已连接', 'Connected')
  if (status === 'unauthorized') return label('待授权', 'Unauthorized')
  if (status === 'offline') return label('离线', 'Offline')
  if (status === 'mdns') return 'mDNS'
  return label('候选', 'Candidate')
}
</script>

<template>
  <section class="subsection">
    <div class="subsection-head">
      <div>
        <strong>{{ label('扫描候选', 'Scan Candidates') }}</strong>
        <small>{{ loaded ? `${candidates.length}` : label('按需扫描', 'Scan on demand') }}</small>
      </div>
    </div>
    <div v-if="!loaded" class="empty-line left">
      {{ label('输入网段或留空自动推断本机 /24 网段。', 'Enter a subnet or leave blank to infer the local /24 subnet.') }}
    </div>
    <div v-if="loaded && summary" class="scan-summary">{{ summary }}</div>
    <div v-if="loaded && candidates.length === 0" class="empty-line">
      {{ label('没有发现可连接或待授权的 ADB 设备。', 'No connectable or unauthorized ADB devices found.') }}
    </div>
    <div v-else-if="loaded" class="target-table">
      <div class="target-row header">
        <span>{{ label('地址', 'Address') }}</span>
        <span>{{ label('状态', 'Status') }}</span>
        <span>{{ label('操作', 'Actions') }}</span>
      </div>
      <div v-for="candidate in candidates" :key="candidate.address" class="target-row">
        <div class="endpoint-cell">
          <code>{{ candidate.address }}</code>
          <small v-if="candidate.latency_ms != null">{{ candidate.latency_ms }}ms</small>
          <small v-if="candidate.source">{{ candidate.source }}</small>
        </div>
        <div class="endpoint-cell">
          <span class="pill" :class="isSaved(candidate.address) ? 'ok' : 'muted'">
            {{ isSaved(candidate.address) ? label('已保存', 'Saved') : formatStatus(candidate.adb_status) }}
          </span>
          <small v-if="connectionResults[candidate.address]" :class="['probe-result', connectionResults[candidate.address].ok ? 'ok-text' : 'bad-text']">
            {{ connectionResults[candidate.address].message }}
          </small>
        </div>
        <div class="row-actions">
          <button class="plain-btn compact" :disabled="isBusy(`adb-connect-${candidate.address}`)" @click="emit('connect', candidate.address)">
            {{ isBusy(`adb-connect-${candidate.address}`) ? label('连接中', 'Connecting') : label('连接', 'Connect') }}
          </button>
          <button class="primary-btn compact" :disabled="isSaved(candidate.address) || isBusy(`adb-save-candidate-${candidate.address}`)" @click="emit('save', candidate)">
            {{ label('保存', 'Save') }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.subsection,
.target-table,
.endpoint-cell {
  display: grid;
  gap: 8px;
}

.subsection {
  margin-bottom: 18px;
}

.subsection-head,
.row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.subsection-head {
  justify-content: space-between;
}

.subsection-head strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
}

.subsection-head small,
.endpoint-cell small,
.scan-summary,
.empty-line {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.scan-summary {
  padding: 10px 12px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
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

code {
  overflow-wrap: anywhere;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
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

.pill.ok { background: #dcfce7; color: #047857; }
.pill.muted { background: #f4f4f5; color: #71717a; }
.ok-text { color: #047857; }
.bad-text { color: #b91c1c; }
.probe-result { display: block; }

.plain-btn,
.primary-btn {
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
  .target-row,
  .target-row.header {
    grid-template-columns: 1fr;
  }

  .target-row.header {
    display: none;
  }
}
</style>
