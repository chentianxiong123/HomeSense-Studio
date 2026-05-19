<script setup lang="ts">
import { computed } from 'vue'
import { Background } from '@vue-flow/background'
import { VueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import type { WorkflowGraphSnapshot } from '@/features/studio/assets'

const props = defineProps<{
  graph: WorkflowGraphSnapshot
  compact?: boolean
}>()

const flowNodes = computed(() =>
  props.graph.nodes.map((node, index) => ({
    id: String(node.id ?? index),
    position: node.position ?? inferPosition(index),
    draggable: false,
    selectable: false,
    connectable: false,
    data: { label: node.label || node.type },
    label: node.label || node.type,
  })),
)

const flowEdges = computed(() =>
  props.graph.edges.map((edge, index) => ({
    id: `edge_${index}`,
    source: String(edge.source_node_id),
    target: String(edge.target_node_id),
    sourceHandle: edge.source_port ?? 'out',
    targetHandle: edge.target_port ?? 'in',
    animated: false,
  })),
)

function inferPosition(index: number) {
  const column = index % 2
  const row = Math.floor(index / 2)
  return { x: column * 180, y: row * 110 }
}
</script>

<template>
  <div :class="['workflow-graph-preview', { compact: props.compact }]">
    <VueFlow
      :nodes="flowNodes"
      :edges="flowEdges"
      :nodes-draggable="false"
      :elements-selectable="false"
      :fit-view-on-init="true"
      :zoom-on-scroll="false"
      :pan-on-drag="false"
      :prevent-scrolling="true"
      class="preview-flow"
    >
      <Background :gap="20" :size="1" pattern-color="#d7dee7" />
    </VueFlow>
  </div>
</template>

<style scoped>
.workflow-graph-preview {
  height: 280px;
  border: 1px solid rgba(228, 234, 240, 0.5);
  border-radius: 28px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.03);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.workflow-graph-preview:hover {
  background: rgba(255, 255, 255, 0.75);
  box-shadow: 0 20px 56px rgba(0, 0, 0, 0.08);
  transform: translateY(-4px);
  border-color: rgba(16, 185, 129, 0.25);
}

.workflow-graph-preview.compact {
  height: 220px;
}

.preview-flow {
  width: 100%;
  height: 100%;
}
</style>
