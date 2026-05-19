<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps<{
  data: {
    type: string
    label: string
    config: Record<string, unknown>
    status?: 'idle' | 'running' | 'succeeded' | 'failed'
    previewRisk?: 'none' | 'dry_run' | 'device' | 'external'
    previewState?: 'ready' | 'skipped' | 'blocked'
  }
}>()

const typeInfo = computed(() => {
  const map: Record<string, { icon: string; color: string }> = {
    start: { icon: 'S', color: '#10a37f' },
    device_control: { icon: 'D', color: '#3b82f6' },
    xiaoai: { icon: 'X', color: '#f59e0b' },
    ir_control: { icon: 'I', color: '#64748b' },
    llm: { icon: 'L', color: '#8b5cf6' },
    if_else: { icon: '?', color: '#f59e0b' },
    delay: { icon: 'T', color: '#64748b' },
    parallel: { icon: 'P', color: '#3b82f6' },
    code: { icon: 'C', color: '#1e293b' },
    executor_call: { icon: 'E', color: '#10a37f' },
    answer: { icon: 'A', color: '#ef4444' },
  }
  return map[props.data.type] ?? { icon: 'N', color: '#94a3b8' }
})

const statusClass = computed(() => props.data.status ? `status-${props.data.status}` : '')
const riskClass = computed(() => props.data.previewRisk ? `risk-${props.data.previewRisk}` : '')
const previewStateClass = computed(() => props.data.previewState ? `preview-${props.data.previewState}` : '')
const isConditionNode = computed(() => props.data.type === 'if_else')

const visibleConfig = computed(() =>
  Object.entries(props.data.config || {}).slice(0, 3),
)
</script>

<template>
  <div :class="['workflow-node', statusClass, riskClass, previewStateClass]" :style="{ borderColor: typeInfo.color }">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node-header" :style="{ background: typeInfo.color }">
      <span class="node-icon">{{ typeInfo.icon }}</span>
      <span class="node-label">{{ data.label }}</span>
      <span v-if="data.previewRisk && data.previewRisk !== 'none'" class="risk-badge">{{ data.previewRisk }}</span>
    </div>
    <div v-if="visibleConfig.length > 0" class="node-body">
      <div v-for="[key, value] in visibleConfig" :key="key" class="config-item">
        <span class="config-key">{{ key }}</span>
        <span class="config-value">{{ typeof value === 'object' ? JSON.stringify(value) : String(value) }}</span>
      </div>
    </div>
    <template v-if="isConditionNode">
      <div class="branch-hint branch-true">true</div>
      <div class="branch-hint branch-false">false</div>
      <Handle id="true" type="source" :position="Position.Right" :style="{ top: '34%' }" />
      <Handle id="false" type="source" :position="Position.Right" :style="{ top: '72%' }" />
    </template>
    <Handle v-else id="out" type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.workflow-node {
  position: relative;
  min-width: 180px;
  max-width: 280px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(24px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.03);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.workflow-node:hover {
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.08);
  transform: translateY(-4px) scale(1.02);
  border-color: rgba(16, 163, 127, 0.2);
  background: rgba(255, 255, 255, 0.7);
  z-index: 100;
}

/* Status overlays */
.workflow-node.status-running {
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15);
  border-color: #3b82f6;
  animation: pulse-border 2s infinite cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes pulse-border {
  0% { box-shadow: 0 0 0 0px rgba(59, 130, 246, 0.4); }
  70% { box-shadow: 0 0 0 12px rgba(59, 130, 246, 0); }
  100% { box-shadow: 0 0 0 0px rgba(59, 130, 246, 0); }
}

.workflow-node.status-succeeded {
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.1);
  border-color: #10b981;
}

.workflow-node.status-failed {
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.1);
  border-color: #ef4444;
}

.workflow-node.risk-dry_run {
  border-style: dashed;
}

.workflow-node.preview-skipped {
  opacity: 0.5;
  filter: grayscale(0.5);
}

.workflow-node.preview-blocked {
  border-style: dashed;
  background: rgba(248, 250, 252, 0.4);
}

.node-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  color: #fff;
  position: relative;
  overflow: hidden;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.node-header::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.2) 0%, transparent 100%);
  pointer-events: none;
}

.node-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(8px);
  border-radius: 8px;
  font-size: 11px;
  font-weight: 800;
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.node-label {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.01em;
  text-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.risk-badge {
  padding: 3px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.15);
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
  white-space: nowrap;
  letter-spacing: 0.08em;
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.node-body {
  padding: 16px 18px;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.branch-hint {
  position: absolute;
  right: -10px;
  z-index: 2;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  color: var(--text-tertiary);
  font-size: 8px;
  font-weight: 800;
  text-transform: uppercase;
  border: 1px solid rgba(236, 239, 242, 0.8);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
  letter-spacing: 0.1em;
}

.branch-true {
  top: 31%;
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.2);
}

.branch-false {
  top: 65%;
  color: #f59e0b;
  border-color: rgba(245, 158, 11, 0.2);
}

.config-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-key {
  color: var(--text-tertiary);
  font-weight: 800;
  text-transform: uppercase;
  font-size: 8px;
  letter-spacing: 0.12em;
  opacity: 0.6;
}

.config-value {
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: rgba(241, 245, 249, 0.4);
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(226, 232, 240, 0.3);
  transition: all 0.2s ease;
}

.config-item:hover .config-value {
  background: rgba(241, 245, 249, 0.8);
  border-color: rgba(16, 163, 127, 0.1);
  color: var(--text-primary);
}

</style>
