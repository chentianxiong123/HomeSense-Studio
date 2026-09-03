<script setup lang="ts">
export interface AdbUiNode {
  index: number
  text: string
  bounds?: number[]
  center?: number[]
  clickable?: boolean
  resource_id?: string
  class_name?: string
}

defineProps<{
  nodes: AdbUiNode[]
  busy: boolean
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  refresh: []
  tap: [index: number]
}>()
</script>

<template>
  <div class="surface full-surface">
    <div class="surface-head">
      <h3>{{ label('界面检查', 'UI Inspector') }}</h3>
      <button class="ghost-btn" :disabled="busy" @click="emit('refresh')">{{ label('读取元素', 'Read Tree') }}</button>
    </div>
    <div v-if="nodes.length === 0" class="empty-line">{{ label('读取 UI 树后，可按元素索引点击。', 'Read the UI tree, then tap elements by index.') }}</div>
    <div v-else class="ui-list">
      <button v-for="node in nodes.slice(0, 120)" :key="node.index" class="ui-node" :disabled="busy" @click="emit('tap', node.index)">
        <span>#{{ node.index }}</span>
        <strong>{{ node.text || node.resource_id || node.class_name || label('无文本元素', 'Untitled element') }}</strong>
        <code>{{ node.center ? node.center.join(',') : '' }}</code>
      </button>
    </div>
  </div>
</template>

<style scoped>
.surface {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 16px;
}

.full-surface {
  min-height: 320px;
}

.surface-head {
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h3 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  letter-spacing: 0;
}

.ghost-btn {
  padding: 7px 11px;
}

.ghost-btn:hover:not(:disabled) {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #eff6ff;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.empty-line {
  padding: 36px 0;
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
}

.ui-list {
  display: flex;
  max-height: 420px;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
}

.ui-node {
  display: grid;
  width: 100%;
  min-height: 38px;
  padding: 8px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  grid-template-columns: 56px minmax(0, 1fr) 90px;
  align-items: center;
  gap: 10px;
  text-align: left;
  cursor: pointer;
}

.ui-node span {
  color: #2563eb;
  font-size: 12px;
  font-weight: 900;
}

.ui-node strong {
  min-width: 0;
  overflow: hidden;
  color: #0f172a;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .surface-head {
    align-items: stretch;
    flex-direction: column;
  }

  .ui-node {
    grid-template-columns: 48px minmax(0, 1fr);
  }

  .ui-node code {
    display: none;
  }
}
</style>
