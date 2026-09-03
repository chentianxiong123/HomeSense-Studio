<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import StudioDetailLayout from '@/components/studio/StudioDetailLayout.vue'
import { buildWorkflowDetailTabs } from '@/features/studio/detailNavigation'
import { buildWorkflowRunExperiencePayload } from '@/features/studio/workflowRunMemory'
import { buildWorkflowRunHistorySteps } from '@/features/studio/workflowRunHistory'
import { memoryAssetsApi, type MemoryAssetRecord } from '@/api/memoryAssets'
import { workflowApi, type Workflow, type WorkflowRun } from '@/api/workflow'
import { useLocale } from '@/composables/useLocale'

type RunMemoryStatus = 'saving' | 'saved' | 'error'

const route = useRoute()
const { locale } = useLocale()

const workflow = ref<Workflow | null>(null)
const runs = ref<WorkflowRun[]>([])
const runMemoryAssetIds = ref<Record<number, string>>({})
const runMemoryStatus = ref<Record<number, RunMemoryStatus | undefined>>({})
const runMemoryErrors = ref<Record<number, string | undefined>>({})
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
    const [workflowResult, runResult, memoryResult] = await Promise.all([
      workflowApi.get(id),
      workflowApi.runs(id),
      memoryAssetsApi.list(),
    ])
    workflow.value = workflowResult.workflow
    runs.value = runResult.runs ?? []
    runMemoryAssetIds.value = buildRunMemoryAssetMap(id, memoryResult.assets ?? [])
  } finally {
    loading.value = false
  }
}

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

const tabs = computed(() => buildWorkflowDetailTabs(workflowId.value, label))

function buildRunMemoryAssetMap(id: number, assets: MemoryAssetRecord[]) {
  const map: Record<number, string> = {}
  for (const asset of assets) {
    if (asset.kind !== 'experience_path') continue
    if (Number(asset.metadata.workflow_id) !== id) continue
    const runId = Number(asset.metadata.workflow_run_id)
    if (Number.isInteger(runId) && runId > 0) map[runId] = asset.id
  }
  return map
}

function memoryAssetId(run: WorkflowRun) {
  return runMemoryAssetIds.value[Number(run.id)] ?? ''
}

function memoryAssetRoute(id: string) {
  return `/assets/memory/${encodeURIComponent(id)}/overview`
}

function runInputKeys(run: WorkflowRun) {
  const inputs = parseJsonObject(run.inputs_json)
  if (!inputs) return label('无法解析', 'Invalid')
  const keys = Object.keys(inputs)
  if (keys.length === 0) return '-'
  if (keys.length <= 3) return keys.join(', ')
  return `${keys.slice(0, 3).join(', ')} +${keys.length - 3}`
}

function runOutputKeys(run: WorkflowRun) {
  const outputs = parseJsonObject(run.result_json)
  if (!outputs) return label('无法解析', 'Invalid')
  const keys = Object.keys(outputs)
  if (keys.length === 0) return '-'
  if (keys.length <= 3) return keys.join(', ')
  return `${keys.slice(0, 3).join(', ')} +${keys.length - 3}`
}

function prettyJson(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw || '{}'), null, 2)
  } catch {
    return raw || '{}'
  }
}

function runTraceSteps(run: WorkflowRun) {
  return buildWorkflowRunHistorySteps(run.trace_json || '[]', label)
}

function runTraceTitle(run: WorkflowRun) {
  return label('运行 Trace', 'Run Trace')
}

function runTraceCount(run: WorkflowRun) {
  return runTraceSteps(run).length
}

function parseRunEvents(run: WorkflowRun): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(run.events_json || '[]')
    return Array.isArray(parsed) ? parsed.filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === 'object' && !Array.isArray(event)) : []
  } catch {
    return []
  }
}

function runEvents(run: WorkflowRun): Array<Record<string, unknown>> {
  return parseRunEvents(run).slice(0, 10)
}

function runEventCount(run: WorkflowRun) {
  return parseRunEvents(run).length
}

function runEventLabel(event: Record<string, unknown>) {
  const type = String(event.type ?? '')
  const nodeType = String(event.node_type ?? '')
  const nodeId = String(event.node_id ?? '')
  const base = [type, nodeType].filter(Boolean).join(' · ')
  return [base, nodeId ? `#${nodeId}` : ''].filter(Boolean).join(' ')
}

function runEventTone(event: Record<string, unknown>) {
  const type = String(event.type ?? '')
  if (type === 'node_failed') return 'error'
  if (type === 'node_skipped') return 'warning'
  return 'success'
}

async function saveRunMemory(run: WorkflowRun) {
  if (!workflow.value) return
  if (memoryAssetId(run) || runMemoryStatus.value[run.id] === 'saving') return

  const payload = buildWorkflowRunExperiencePayload(workflow.value, run)
  if (!payload) {
    runMemoryStatus.value = { ...runMemoryStatus.value, [run.id]: 'error' }
    runMemoryErrors.value = { ...runMemoryErrors.value, [run.id]: label('输入无法解析，不能沉淀记忆。', 'Inputs are invalid; cannot save memory.') }
    return
  }

  runMemoryStatus.value = { ...runMemoryStatus.value, [run.id]: 'saving' }
  runMemoryErrors.value = { ...runMemoryErrors.value, [run.id]: '' }
  try {
    const result = await memoryAssetsApi.recordExperiencePath(payload)
    if (result.status !== 'success') throw new Error(result.message || 'Save failed')
    const assetId = result.asset?.id ?? payload.id
    if (assetId) {
      runMemoryAssetIds.value = { ...runMemoryAssetIds.value, [run.id]: assetId }
    }
    runMemoryStatus.value = { ...runMemoryStatus.value, [run.id]: 'saved' }
  } catch (error) {
    runMemoryStatus.value = { ...runMemoryStatus.value, [run.id]: 'error' }
    runMemoryErrors.value = { ...runMemoryErrors.value, [run.id]: (error as Error).message }
  }
}

function saveRunMemoryLabel(run: WorkflowRun) {
  const status = runMemoryStatus.value[run.id]
  if (status === 'saving') return label('沉淀中', 'Saving')
  if (status === 'error') return label('失败', 'Failed')
  return label('沉淀记忆', 'Save Memory')
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}
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
          <div>
            <strong>#{{ run.id }}</strong>
            <span class="status-chip">{{ run.status }}</span>
          </div>
          <div class="run-actions">
            <RouterLink
              v-if="memoryAssetId(run)"
              class="memory-link"
              :to="memoryAssetRoute(memoryAssetId(run))"
            >
              {{ label('打开记忆', 'Open Memory') }}
            </RouterLink>
            <button
              v-else
              type="button"
              class="memory-btn"
              :disabled="runMemoryStatus[run.id] === 'saving'"
              @click="saveRunMemory(run)"
            >
              {{ saveRunMemoryLabel(run) }}
            </button>
          </div>
        </div>
        <div class="run-meta">
          <span>{{ label('触发方', 'Triggered by') }}: {{ run.triggered_by }}</span>
          <span>{{ label('开始', 'Started') }}: {{ run.started_at || '-' }}</span>
          <span>{{ label('结束', 'Finished') }}: {{ run.finished_at || '-' }}</span>
          <span>{{ label('输入键', 'Input Keys') }}: {{ runInputKeys(run) }}</span>
          <span>{{ label('输出键', 'Output Keys') }}: {{ runOutputKeys(run) }}</span>
          <span>{{ label('事件', 'Events') }}: {{ runEventCount(run) }}</span>
        </div>
        <div v-if="runMemoryStatus[run.id] === 'error' && runMemoryErrors[run.id]" class="run-error">
          {{ runMemoryErrors[run.id] }}
        </div>
        <div class="run-json-grid">
          <div>
            <div class="json-label">{{ label('输入', 'Inputs') }}</div>
            <pre>{{ prettyJson(run.inputs_json) }}</pre>
          </div>
          <div>
            <div class="json-label">{{ label('输出', 'Outputs') }}</div>
            <pre>{{ prettyJson(run.result_json) }}</pre>
          </div>
        </div>
        <div class="run-trace-section">
          <div class="json-label">{{ runTraceTitle(run) }} · {{ runTraceCount(run) }}</div>
          <div v-if="runTraceSteps(run).length === 0" class="trace-empty">
            {{ label('没有可回看的 trace。', 'No trace available.') }}
          </div>
          <div v-else class="trace-card-list">
            <article
              v-for="view in runTraceSteps(run)"
              :key="view.step.nodeId"
              :class="['trace-card', view.summary?.kind ?? 'generic', view.summary?.tone ?? 'neutral']"
            >
              <div class="trace-card-head">
                <strong>{{ view.summary?.title || view.step.nodeType }}</strong>
                <span>{{ view.step.status }}</span>
              </div>
              <div v-if="view.step.error" class="trace-error">{{ view.step.error }}</div>
              <div v-if="view.step.compensationTaskId || (view.step.attempts && view.step.attempts > 1)" class="trace-badges">
                <span v-if="view.step.compensationTaskId">{{ label('修复任务', 'Repair Task') }} #{{ view.step.compensationTaskId }}</span>
                <span v-if="view.step.attempts && view.step.attempts > 1">{{ label('重试', 'Attempts') }} {{ view.step.attempts }}</span>
              </div>
              <div v-if="view.summary?.rows?.length" class="trace-row-list">
                <div v-for="row in view.summary.rows.slice(0, 4)" :key="row.label" class="trace-row">
                  <span>{{ row.label }}</span>
                  <strong>{{ row.value }}</strong>
                </div>
              </div>
              <div v-if="view.summary?.effect" class="trace-effect">{{ view.summary.effect }}</div>
              <div v-if="view.summary?.phases?.length" class="trace-phase-row">
                <span
                  v-for="phase in view.summary.phases"
                  :key="phase.label"
                  :class="['trace-phase-chip', phase.tone]"
                >
                  <em>{{ phase.label }}</em>
                  <strong>{{ phase.value }}</strong>
                </span>
              </div>
              <div v-if="view.summary?.substeps?.length" class="trace-substep-list">
                <div
                  v-for="substep in view.summary.substeps"
                  :key="`${view.step.nodeId}:${substep.title}:${substep.duration ?? ''}`"
                  class="trace-substep"
                >
                  <strong>{{ substep.title }}</strong>
                  <span>{{ substep.detail }}</span>
                </div>
              </div>
            </article>
          </div>
        </div>
        <div class="run-event-section">
          <div class="json-label">{{ label('运行事件', 'Run Events') }} · {{ runEventCount(run) }}</div>
          <div v-if="runEvents(run).length === 0" class="trace-empty">
            {{ label('没有事件记录。', 'No events recorded.') }}
          </div>
          <div v-else class="event-chip-row">
            <span
              v-for="(event, index) in runEvents(run)"
              :key="`${run.id}-${index}-${String(event.type ?? '')}`"
              :class="['event-chip', runEventTone(event)]"
            >
              {{ runEventLabel(event) }}
            </span>
          </div>
        </div>
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

.run-head > div {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
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

.run-actions {
  flex-shrink: 0;
}

.memory-link,
.memory-btn {
  min-height: 38px;
  padding: 0 13px;
  border-radius: 10px;
  border: 1px solid rgba(37, 99, 235, 0.22);
  background: rgba(37, 99, 235, 0.08);
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 900;
  text-decoration: none;
  cursor: pointer;
}

.memory-link {
  display: inline-flex;
  align-items: center;
}

.memory-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.run-error {
  margin-top: 18px;
  padding: 12px 14px;
  border: 1px solid rgba(239, 68, 68, 0.22);
  border-radius: 10px;
  background: rgba(254, 242, 242, 0.82);
  color: #b91c1c;
  font-size: 13px;
  font-weight: 800;
}

.run-json-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  margin-top: 32px;
}

.json-label {
  margin-bottom: 10px;
  font-size: 11px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.14em;
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

.run-json-grid pre {
  margin-top: 0;
}

.run-trace-section {
  margin-top: 28px;
}

.run-event-section {
  margin-top: 28px;
}

.trace-empty {
  padding: 18px;
  border: 1px dashed rgba(148, 163, 184, 0.7);
  border-radius: 12px;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 800;
}

.trace-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.trace-card {
  padding: 14px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.78);
}

.trace-card.success {
  border-color: rgba(16, 185, 129, 0.2);
  background: rgba(16, 185, 129, 0.06);
}

.trace-card.error {
  border-color: rgba(239, 68, 68, 0.22);
  background: rgba(254, 242, 242, 0.74);
}

.trace-card.warning {
  border-color: rgba(245, 158, 11, 0.24);
  background: rgba(255, 251, 235, 0.74);
}

.trace-card-head {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 10px;
}

.trace-card-head strong {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 900;
}

.trace-card-head span {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.trace-row-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.trace-row {
  min-width: 0;
  padding: 8px 9px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.58);
}

.trace-row span {
  display: block;
  margin-bottom: 4px;
  color: var(--text-tertiary);
  font-size: 10px;
  font-weight: 900;
}

.trace-row strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.trace-error {
  margin-bottom: 8px;
  color: #b91c1c;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.6;
}

.trace-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.trace-badges span {
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.08);
  color: #1d4ed8;
  font-size: 11px;
  font-weight: 900;
}

.trace-effect {
  margin-top: 10px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 750;
  line-height: 1.6;
}

.trace-phase-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.trace-phase-chip {
  padding: 8px 9px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.58);
}

.trace-phase-chip em,
.trace-phase-chip strong {
  display: block;
  font-style: normal;
}

.trace-phase-chip em {
  margin-bottom: 4px;
  color: var(--text-tertiary);
  font-size: 9px;
  font-weight: 900;
}

.trace-phase-chip strong {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
}

.trace-substep-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.trace-substep {
  padding: 8px 9px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.58);
}

.trace-substep strong,
.trace-substep span {
  display: block;
}

.trace-substep strong {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
}

.trace-substep span {
  margin-top: 3px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 750;
}

.event-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.event-chip {
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.05);
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.06em;
}

.event-chip.success {
  color: #047857;
  background: rgba(16, 185, 129, 0.1);
}

.event-chip.warning {
  color: #b45309;
  background: rgba(245, 158, 11, 0.12);
}

.event-chip.error {
  color: #dc2626;
  background: rgba(239, 68, 68, 0.1);
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
