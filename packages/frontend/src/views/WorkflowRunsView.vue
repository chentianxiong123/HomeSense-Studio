<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import StudioDetailLayout from '@/components/studio/StudioDetailLayout.vue'
import { buildWorkflowDetailTabs } from '@/features/studio/detailNavigation'
import { workflowApi, type Workflow, type WorkflowRun } from '@/api/workflow'
import { useLocale } from '@/composables/useLocale'

const route = useRoute()
const { locale } = useLocale()

const workflow = ref<Workflow | null>(null)
const runs = ref<WorkflowRun[]>([])
const loading = ref(false)

const workflowId = computed(() => Number(route.params.id))
const isZh = computed(() => locale.value === 'zh')

watch(workflowId, async (id) => {
  if (Number.isFinite(id)) await loadRuns(id)
}, { immediate: true })

onMounted(async () => {
  if (Number.isFinite(workflowId.value)) await loadRuns(workflowId.value)
})

async function loadRuns(id: number) {
  loading.value = true
  try {
    const [workflowResult, runResult] = await Promise.all([
      workflowApi.get(id),
      workflowApi.runs(id),
    ])
    workflow.value = workflowResult.workflow
    runs.value = runResult.runs ?? []
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
    :title="workflow?.name || label('运行记录', 'Workflow Runs')"
    :description="label('查看工作流最近的执行记录、触发来源和返回结果。', 'Inspect recent workflow executions, trigger source, and returned results.')"
    :back-label="label('返回 Studio', 'Back to Studio')"
    :tabs="tabs"
    :loading="loading"
    :loading-label="label('加载运行记录中…', 'Loading runs…')"
  >
    <section v-if="runs.length === 0" class="empty-state">{{ label('当前没有运行记录。', 'No runs recorded yet.') }}</section>
    <section v-else class="runs-panel">
      <article v-for="run in runs" :key="run.id" class="run-card">
        <div class="run-head">
          <strong>#{{ run.id }}</strong>
          <span class="status-chip">{{ run.status }}</span>
        </div>
        <div class="run-meta">
          <span>{{ label('触发方', 'Triggered by') }}: {{ run.triggered_by }}</span>
          <span>{{ label('开始', 'Started') }}: {{ run.started_at || '-' }}</span>
          <span>{{ label('结束', 'Finished') }}: {{ run.finished_at || '-' }}</span>
        </div>
        <pre>{{ run.result_json }}</pre>
      </article>
    </section>
  </StudioDetailLayout>
</template>

<style scoped>
.runs-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 100%;
}

.run-card,
.empty-state {
  padding: 40px;
  border: 1px solid rgba(229, 231, 235, 0.5);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.03);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.run-card:hover {
  background: rgba(255, 255, 255, 0.8);
  transform: translateY(-6px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.08);
  border-color: rgba(16, 185, 129, 0.25);
}

.run-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 32px;
}

.run-head strong {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 15px;
  font-weight: 900;
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 16px;
  border-radius: 99px;
  letter-spacing: -0.02em;
}

.run-meta {
  display: flex;
  align-items: center;
  gap: 40px;
  color: var(--text-tertiary);
  font-size: 14px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  flex-wrap: wrap;
  opacity: 0.6;
}

.run-meta span {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.status-chip {
  padding: 6px 18px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-secondary);
  border: 1px solid rgba(0,0,0,0.03);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
}

pre {
  margin: 32px 0 0;
  padding: 32px;
  background: #1e293b;
  color: #e2e8f0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 15px;
  line-height: 1.8;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  font-size: 15px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--text-tertiary);
  opacity: 0.5;
}
</style>
