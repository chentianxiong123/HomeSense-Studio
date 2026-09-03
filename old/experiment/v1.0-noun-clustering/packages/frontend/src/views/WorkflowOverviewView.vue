<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import StudioDetailLayout from '@/components/studio/StudioDetailLayout.vue'
import WorkflowGraphPreview from '@/components/studio/WorkflowGraphPreview.vue'
import type { WorkflowGraphSnapshot } from '@/features/studio/workflowGraph'
import { buildWorkflowDetailTabs } from '@/features/studio/detailNavigation'
import { useLocale } from '@/composables/useLocale'
import { workflowApi, type Workflow, type WorkflowRunQuality } from '@/api/workflow'

const route = useRoute()
const { locale } = useLocale()

const workflow = ref<Workflow | null>(null)
const runQuality = ref<WorkflowRunQuality | null>(null)
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
    runQuality.value = result.run_quality
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

function evidenceLabel(status?: WorkflowRunQuality['evidence_status']) {
  if (status === 'proven') return label('最近成功', 'Last run succeeded')
  if (status === 'regressed') return label('曾成功，最近失败', 'Previously succeeded, last run failed')
  if (status === 'failing') return label('最近失败', 'Last run failed')
  if (status === 'running') return label('运行中', 'Running')
  return label('还没有运行证据', 'No run evidence yet')
}

function evidenceHint(status?: WorkflowRunQuality['evidence_status']) {
  if (status === 'proven') return label('这个流程已有成功运行记录，适合发布给 Chat 候选。', 'This workflow has a successful run and is suitable for Chat candidates.')
  if (status === 'regressed') return label('这个流程曾经成功，但最近失败；发布前建议重新跑通。', 'This workflow has succeeded before, but the latest run failed; rerun it before publishing.')
  if (status === 'failing') return label('这个流程还没有成功记录；建议先修复再发布。', 'This workflow has no successful run yet; fix it before publishing.')
  if (status === 'running') return label('当前有运行中的记录，等待结果后再判断。', 'A run is in progress; wait for the result before judging readiness.')
  return label('先在 Studio 预演并运行一次，成功后再让 Chat 复用它。', 'Preview and run it in Studio once before letting Chat reuse it.')
}

function lastSuccessInputKeys() {
  return runQuality.value?.last_success_input_keys?.length
    ? runQuality.value.last_success_input_keys.join(', ')
    : '-'
}

function lastSuccessInputsText() {
  const raw = runQuality.value?.last_success_inputs_json
  if (!raw) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}
</script>

<template>
  <StudioDetailLayout
    :title="workflow?.name || label('工作流详情', 'Workflow Detail')"
    :description="workflow?.description || label('查看工作流编译结果、节点图和运行入口。', 'Inspect workflow graph, metadata, and execution entry.')"
    :back-label="label('返回 Studio', 'Back to Studio')"
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
      <section class="panel quality">
        <h3>{{ label('发布证据', 'Publish Evidence') }}</h3>
        <div class="quality-status">
          <span :class="['quality-badge', runQuality?.evidence_status || 'untested']">
            {{ evidenceLabel(runQuality?.evidence_status) }}
          </span>
          <p>{{ evidenceHint(runQuality?.evidence_status) }}</p>
        </div>
        <div class="quality-grid">
          <div>
            <label>{{ label('成功', 'Success') }}</label>
            <strong>{{ runQuality?.success_count ?? 0 }}</strong>
          </div>
          <div>
            <label>{{ label('失败', 'Failure') }}</label>
            <strong>{{ runQuality?.failure_count ?? 0 }}</strong>
          </div>
          <div>
            <label>{{ label('最近运行', 'Last Run') }}</label>
            <strong>{{ runQuality?.last_run_status || '-' }}</strong>
          </div>
          <div>
            <label>{{ label('最近成功', 'Last Success') }}</label>
            <strong>{{ runQuality?.last_success_at || '-' }}</strong>
          </div>
          <div>
            <label>{{ label('成功输入键', 'Success Input Keys') }}</label>
            <strong>{{ lastSuccessInputKeys() }}</strong>
          </div>
        </div>
        <div v-if="lastSuccessInputsText()" class="quality-inputs">
          <label>{{ label('最近成功输入', 'Last Successful Inputs') }}</label>
          <pre>{{ lastSuccessInputsText() }}</pre>
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

.workflow-layout .quality {
  grid-column: 1 / -1;
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
  font-size: 14px;
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
  font-size: 13px;
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
  font-size: 14px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-tertiary);
}

.status-badge.published {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.quality-status {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-bottom: 28px;
}

.quality-status p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.6;
}

.quality-badge {
  flex-shrink: 0;
  display: inline-flex;
  padding: 8px 16px;
  border-radius: 999px;
  background: rgba(100, 116, 139, 0.1);
  color: #475569;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.quality-badge.proven {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
}

.quality-badge.regressed,
.quality-badge.failing {
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
}

.quality-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
}

.quality-grid div {
  min-width: 0;
  padding: 18px;
  border: 1px solid rgba(229, 231, 235, 0.72);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.55);
}

.quality-grid label {
  display: block;
  margin-bottom: 10px;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.quality-grid strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 900;
}

.quality-inputs {
  margin-top: 20px;
}

.quality-inputs label {
  display: block;
  margin-bottom: 10px;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.quality-inputs pre {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  padding: 18px;
  border-radius: 18px;
  background: #111827;
  color: #e5e7eb;
  font-size: 13px;
  line-height: 1.6;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
</style>
