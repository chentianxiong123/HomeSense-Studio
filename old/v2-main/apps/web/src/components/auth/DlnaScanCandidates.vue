<script setup lang="ts">
type LabelFn = (zh: string, en: string) => string

export type DlnaCandidate = {
  id: string
  name: string
  endpoint?: string
  meta?: Record<string, unknown>
}

defineProps<{
  loaded: boolean
  candidates: DlnaCandidate[]
  testResults: Record<string, { ok: boolean; message: string }>
  label: LabelFn
  isBusy: (key: string) => boolean
  isSaved: (location: string) => boolean
}>()

const emit = defineEmits<{
  (event: 'test', location: string): void
  (event: 'save', candidate: DlnaCandidate): void
}>()

function endpoint(candidate: DlnaCandidate): string {
  return candidate.endpoint || ''
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
      {{ label('DLNA 通过 SSDP 在局域网发现渲染器。', 'DLNA discovers renderers through SSDP on the LAN.') }}
    </div>
    <div v-else-if="candidates.length === 0" class="empty-line">
      {{ label('没有发现 DLNA 渲染器。', 'No DLNA renderers found.') }}
    </div>
    <div v-else class="target-table">
      <div class="target-row header">
        <span>{{ label('名称', 'Name') }}</span>
        <span>{{ label('地址', 'Endpoint') }}</span>
        <span>{{ label('操作', 'Actions') }}</span>
      </div>
      <div v-for="candidate in candidates" :key="candidate.id" class="target-row">
        <div class="device-cell">
          <strong>{{ candidate.name }}</strong>
          <small>{{ candidate.meta?.virtual ? label('HomeSense 虚拟 DLNA', 'HomeSense virtual DLNA') : (candidate.meta?.manufacturer || 'DLNA') }}</small>
        </div>
        <div class="endpoint-cell">
          <code>{{ endpoint(candidate) }}</code>
          <small v-if="testResults[endpoint(candidate)]" :class="['probe-result', testResults[endpoint(candidate)].ok ? 'ok-text' : 'bad-text']">
            {{ testResults[endpoint(candidate)].message }}
          </small>
        </div>
        <div class="row-actions">
          <button class="plain-btn compact" :disabled="!endpoint(candidate) || isBusy(`dlna-test-${endpoint(candidate)}`)" @click="emit('test', endpoint(candidate))">
            {{ label('测试', 'Test') }}
          </button>
          <button class="primary-btn compact" :disabled="!endpoint(candidate) || isSaved(endpoint(candidate)) || isBusy(`dlna-save-candidate-${candidate.id}`)" @click="emit('save', candidate)">
            {{ isSaved(endpoint(candidate)) ? label('已保存', 'Saved') : label('保存', 'Save') }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.subsection,
.target-table,
.device-cell,
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

.subsection-head strong,
.device-cell strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
}

.subsection-head small,
.device-cell small,
.endpoint-cell small,
.empty-line {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
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

.device-cell,
.endpoint-cell {
  min-width: 0;
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
