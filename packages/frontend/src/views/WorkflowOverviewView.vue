<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import StudioDetailLayout from '@/components/studio/StudioDetailLayout.vue'
import WorkflowGraphPreview from '@/components/studio/WorkflowGraphPreview.vue'
import type { WorkflowGraphSnapshot } from '@/features/studio/assets'
import { buildWorkflowDetailTabs } from '@/features/studio/detailNavigation'
import { useLocale } from '@/composables/useLocale'
import { workflowApi, type Workflow } from '@/api/workflow'

const route = useRoute()
const { locale } = useLocale()

const workflow = ref<Workflow | null>(null)
const graph = ref<WorkflowGraphSnapshot>({ nodes: [], edges: [] })
const loading = ref(false)

const workflowId = computed(() => Number(route.params.id))
const isZh = computed(() => locale.value === 'zh')

watch(workflowId, async (id) => {
  if (Number.isFinite(id)) await loadWorkflow(id)
}, { immediate: true })

onMounted(async () => {
  if (Number.isFinite(workflowId.value)) await loadWorkflow(workflowId.value)
})

async function loadWorkflow(id: number) {
  loading.value = true
  try {
    const result = await workflowApi.get(id)
    workflow.value = result.workflow
    graph.value = {
      nodes: (result.nodes ?? []).map((node: any) => ({
        id: node.id,
        type: node.type,
        label: node.label,
        position: typeof node.position_json === 'string' ? JSON.parse(node.position_json) : (node.position_json ?? { x: 0, y: 0 }),
      })),
      edges: (result.edges ?? []).map((edge: any) => ({
        source_node_id: edge.source_node_id,
        target_node_id: edge.target_node_id,
        source_port: edge.source_port,
        target_port: edge.target_port,
      })),
    }
  } finally {
    loading.value = false
  }
}

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

const tabs = computed(() => buildWorkflowDetailTabs(workflowId.value, label))
</script>

<template>
  <StudioDetailLayout
    :title="workflow?.name || label('工作流详情', 'Workflow Detail')"
    :description="workflow?.description || label('查看工作流编译结果、节点图和运行入口。', 'Inspect workflow graph, metadata, and execution entry.')"
    :back-label="label('返回资产中枢', 'Back to Asset Hub')"
    :tabs="tabs"
    :loading="loading"
    :loading-label="label('加载工作流中…', 'Loading workflow…')"
  >
    <div class="workflow-layout">
      <section class="panel">
        <h3>{{ label('节点图', 'Node Graph') }}</h3>
        <WorkflowGraphPreview :graph="graph" />
      </section>
      <section class="panel meta">
        <h3>{{ label('工作流元数据', 'Workflow Metadata') }}</h3>
        <div class="meta-row">
          <label>ID</label>
          <span>{{ workflow?.id }}</span>
        </div>
        <div class="meta-row">
          <label>{{ label('触发方式', 'Trigger') }}</label>
          <span>{{ workflow?.trigger_type }}</span>
        </div>
        <div class="meta-row">
          <label>{{ label('发布状态', 'Publish') }}</label>
          <span :class="['status-badge', { published: workflow?.published }]">
            {{ workflow?.published ? label('已发布', 'Published') : label('草稿', 'Draft') }}
          </span>
        </div>
        <div class="meta-row">
          <label>{{ label('节点数', 'Nodes') }}</label>
          <span>{{ graph.nodes.length }}</span>
        </div>
        <div class="meta-row">
          <label>{{ label('边数', 'Edges') }}</label>
          <span>{{ graph.edges.length }}</span>
        </div>
      </section>
    </div>
  </StudioDetailLayout>
</template>

<style scoped>
.workflow-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 32px;
  min-height: 100%;
}

.panel {
  padding: 40px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(32px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.03);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.panel:hover {
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.06);
  transform: translateY(-4px);
}

.panel h3 {
  margin: 0 0 32px;
  font-size: 10px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.6;
}

.meta {
  display: flex;
  flex-direction: column;
  gap: 32px;
  align-self: start;
}

.meta-row {
  padding-bottom: 24px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.8);
}

.meta-row:last-child { border-bottom: none; }

.meta-row label {
  display: block;
  margin-bottom: 14px;
  color: var(--text-tertiary);
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.6;
}

.meta-row span {
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.status-badge {
  display: inline-flex;
  padding: 4px 14px;
  border-radius: 99px;
  background: rgba(0, 0, 0, 0.05);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-tertiary);
}

.status-badge.published {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}
</style>
