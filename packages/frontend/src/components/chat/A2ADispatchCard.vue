<script setup lang="ts">
import { computed } from 'vue'
import type { A2ADispatch } from '../../types/chat'
import { useLocale } from '../../composables/useLocale'

const props = defineProps<{ dispatch: A2ADispatch }>()
const { t } = useLocale()

const statusLabel = computed(() => {
  if (props.dispatch.status === 'running') return t('tool.running')
  if (props.dispatch.status === 'success') return t('tool.ok')
  return t('tool.error')
})

function stringify(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
</script>

<template>
  <div :class="['a2a-card', props.dispatch.status]">
    <div class="a2a-head">
      <span class="a2a-kind">A2A</span>
      <span class="a2a-adapter">@{{ props.dispatch.adapter }}</span>
      <span :class="['a2a-status', props.dispatch.status]">{{ statusLabel }}</span>
    </div>
    <div class="a2a-task">{{ props.dispatch.task }}</div>
    <pre v-if="props.dispatch.result !== undefined" class="a2a-result">{{ stringify(props.dispatch.result) }}</pre>
    <div v-if="props.dispatch.error" class="a2a-error">{{ props.dispatch.error }}</div>
  </div>
</template>

<style scoped>
.a2a-card {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(12px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
  transition: all 0.3s ease;
}
.a2a-card:hover { transform: translateY(-1px); box-shadow: 0 8px 16px rgba(0, 0, 0, 0.06); background: rgba(255, 255, 255, 0.8); }

.a2a-card.running { border-color: rgba(37, 99, 235, 0.2); background: rgba(240, 249, 255, 0.6); }
.a2a-card.success { border-color: rgba(16, 185, 129, 0.2); background: rgba(240, 253, 244, 0.6); }
.a2a-card.error { border-color: rgba(220, 38, 38, 0.2); background: rgba(254, 242, 242, 0.6); }

.a2a-head { display: flex; align-items: center; gap: 10px; font-size: 15px; }
.a2a-kind {
  font-weight: 800;
  font-size: 13px;
  color: var(--text-tertiary);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: rgba(0,0,0,0.05);
  padding: 2px 6px;
  border-radius: 4px;
}
.a2a-adapter {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-weight: 700;
  color: #0d9488;
}
.a2a-status {
  font-size: 13px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-left: auto;
}
.a2a-status.running { background: rgba(37, 99, 235, 0.1); color: #2563eb; }
.a2a-status.success { background: rgba(16, 185, 129, 0.1); color: #059669; }
.a2a-status.error { background: rgba(220, 38, 38, 0.1); color: #dc2626; }

.a2a-task { font-size: 15px; font-weight: 700; color: var(--text-primary); overflow-wrap: anywhere; letter-spacing: -0.01em; line-height: 1.5; }
.a2a-result {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(241, 245, 249, 0.5);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 15px;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border: 1px solid rgba(229, 231, 235, 0.5);
  color: var(--text-primary);
}
.a2a-error { font-size: 15px; font-weight: 500; color: #dc2626; background: rgba(254, 242, 242, 0.8); padding: 8px 12px; border-radius: 8px; }
</style>
