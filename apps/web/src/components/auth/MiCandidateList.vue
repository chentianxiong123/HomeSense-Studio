<script setup lang="ts">
import type { MiDeviceCandidate } from '@/api'

type LabelFn = (zh: string, en: string) => string

defineProps<{
  candidates: MiDeviceCandidate[]
  loaded: boolean
  loading: boolean
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'load'): void
}>()
</script>

<template>
  <section class="subsection">
    <div class="subsection-head">
      <div>
        <strong>{{ label('Mi 候选设备', 'Mi Candidates') }}</strong>
        <small>{{ loaded ? `${candidates.length}` : label('按需读取', 'Load on demand') }}</small>
      </div>
      <button class="plain-btn" :disabled="loading" @click="emit('load')">
        {{ loading ? label('读取中', 'Loading') : label('读取候选', 'Load') }}
      </button>
    </div>
    <div v-if="!loaded" class="empty-line">{{ label('尚未读取。', 'Not loaded yet.') }}</div>
    <div v-else-if="candidates.length === 0" class="empty-line">{{ label('没有候选设备。', 'No candidates.') }}</div>
    <div v-else class="candidate-table">
      <div class="candidate-row header">
        <span>{{ label('名称', 'Name') }}</span>
        <span>{{ label('型号', 'Model') }}</span>
        <span>DID</span>
        <span>{{ label('房间', 'Room') }}</span>
      </div>
      <div v-for="candidate in candidates.slice(0, 12)" :key="candidate.did" class="candidate-row">
        <strong>{{ candidate.name || candidate.did }}</strong>
        <code>{{ candidate.model || '-' }}</code>
        <code>{{ candidate.did }}</code>
        <span>{{ candidate.room_name || '-' }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.subsection,
.candidate-table {
  display: grid;
  gap: 8px;
}

.subsection-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.subsection-head strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
}

.subsection-head small,
.empty-line {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.empty-line {
  padding: 18px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  text-align: center;
}

.candidate-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(150px, 1fr) minmax(130px, 0.8fr) minmax(80px, 0.5fr);
  gap: 10px;
  align-items: center;
  min-height: 42px;
  padding: 9px 11px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.candidate-row.header {
  min-height: 30px;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.candidate-row strong,
.candidate-row span,
code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

code {
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  font-weight: 800;
}

.plain-btn {
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

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 760px) {
  .candidate-row {
    grid-template-columns: 1fr;
  }
}
</style>
