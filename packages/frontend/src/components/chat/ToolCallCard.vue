<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolCallCard } from '../../types/chat'
import { useLocale } from '../../composables/useLocale'

const props = defineProps<{ card: ToolCallCard }>()
const expanded = ref(false)
const { t } = useLocale()

const statusLabel = computed(() => {
  if (props.card.status === 'running') return t('tool.running')
  if (props.card.status === 'success') return t('tool.ok')
  return t('tool.error')
})

const kindLabel = computed(() => {
  const map: Record<string, string> = { cli: 'CLI', service: 'Service', a2a: 'A2A', plan_step: 'Plan' }
  return map[props.card.kind] ?? props.card.kind
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
  <div :class="['tool-card', card.status]">
    <button type="button" class="tool-head" @click="expanded = !expanded">
      <span class="tool-kind">{{ kindLabel }}</span>
      <span class="tool-name">{{ card.name }}</span>
      <span :class="['tool-status', card.status]">{{ statusLabel }}</span>
      <span v-if="card.duration_ms != null" class="tool-duration">{{ card.duration_ms }}ms</span>
      <span class="tool-toggle">{{ expanded ? '▾' : '▸' }}</span>
    </button>
    <div v-if="expanded" class="tool-body">
      <div v-if="card.args" class="tool-section">
        <div class="tool-section-label">{{ t('tool.args') }}</div>
        <pre class="tool-pre">{{ stringify(card.args) }}</pre>
      </div>
      <div v-if="card.result !== undefined" class="tool-section">
        <div class="tool-section-label">{{ t('tool.result') }}</div>
        <pre class="tool-pre">{{ stringify(card.result) }}</pre>
      </div>
      <div v-if="card.error" class="tool-section">
        <div class="tool-section-label error">{{ t('tool.error') }}</div>
        <pre class="tool-pre error">{{ card.error }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-card {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
  font-size: 16px;
  overflow: hidden;
  transition: all 0.3s ease;
}
.tool-card:hover { transform: translateY(-1px); box-shadow: 0 8px 16px rgba(0, 0, 0, 0.06); background: rgba(255, 255, 255, 0.8); }

.tool-card.running { border-color: rgba(37, 99, 235, 0.2); background: rgba(240, 249, 255, 0.6); }
.tool-card.success { border-color: rgba(16, 185, 129, 0.2); background: rgba(240, 253, 244, 0.6); }
.tool-card.error { border-color: rgba(220, 38, 38, 0.2); background: rgba(254, 242, 242, 0.6); }

.tool-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}
.tool-kind {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  background: rgba(0,0,0,0.05);
  padding: 2px 6px;
  border-radius: 4px;
}
.tool-name {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-weight: 700;
  color: var(--text-primary);
  flex: 1 1 auto;
  overflow-wrap: anywhere;
  letter-spacing: -0.01em;
}
.tool-status {
  font-size: 13px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.tool-status.running { background: rgba(37, 99, 235, 0.1); color: #2563eb; }
.tool-status.success { background: rgba(16, 185, 129, 0.1); color: #059669; }
.tool-status.error { background: rgba(220, 38, 38, 0.1); color: #dc2626; }

.tool-duration { font-size: 14px; font-weight: 600; color: var(--text-tertiary); }
.tool-toggle { font-size: 14px; color: var(--text-tertiary); font-weight: 800; }

.tool-body { padding: 4px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.tool-section-label {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 4px;
}
.tool-section-label.error { color: #dc2626; }
.tool-pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(241, 245, 249, 0.5);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 15px;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border: 1px solid rgba(229, 231, 235, 0.5);
}
.tool-pre.error { background: rgba(254, 242, 242, 0.8); color: #7f1d1d; border-color: rgba(220, 38, 38, 0.1); }
</style>
