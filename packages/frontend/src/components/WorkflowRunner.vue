<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { WorkflowRunResult } from '../api/workflow'
import { useLocale } from '../composables/useLocale'

const props = defineProps<{
  runId: number
  result?: WorkflowRunResult | null
}>()

const emit = defineEmits<{
  selectNode: [nodeId: string]
  updateActiveSteps: [nodeIds: Set<string>]
}>()

interface StepLog {
  nodeId: string
  nodeType: string
  status: 'running' | 'succeeded' | 'failed' | 'skipped'
  outputs?: Record<string, unknown>
  error?: string
  durationMs?: number
}

interface StepSummary {
  title: string
  rows: Array<{ label: string; value: string }>
}

const steps = ref<StepLog[]>([])
const activeNodeIds = computed(() => new Set(steps.value.filter(s => s.status === 'running').map(s => s.nodeId)))

watch(activeNodeIds, (newIds) => {
  emit('updateActiveSteps', newIds)
}, { immediate: true })

const status = ref<'running' | 'succeeded' | 'failed'>('running')
const ws = ref<WebSocket | null>(null)
const disposed = ref(false)
const { t } = useLocale()

const runStats = computed(() => {
  const total = steps.value.length
  const succeeded = steps.value.filter((step) => step.status === 'succeeded').length
  const failed = steps.value.filter((step) => step.status === 'failed').length
  const duration = steps.value.reduce((sum, step) => sum + (step.durationMs ?? 0), 0)
  return { total, succeeded, failed, duration }
})

watch(
  () => props.result,
  (value) => {
    if (!value) return
    status.value = value.status
    steps.value = value.trace.map((trace) => ({
      nodeId: trace.node_id,
      nodeType: trace.node_type,
      status: trace.status === 'skipped' ? 'skipped' : trace.status,
      outputs: trace.outputs,
      error: trace.error,
      durationMs: trace.duration_ms,
    }))
  },
  { immediate: true },
)

function connect() {
  const wsBase = import.meta.env.VITE_WS_BASE || `ws://${window.location.host}`
  const socket = new WebSocket(`${wsBase}/ws`)

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data)
      if (payload.type === 'workflow_step' && payload.data.run_id === props.runId) {
        const existingIdx = steps.value.findIndex((item) => item.nodeId === payload.data.node_id)
        const step: StepLog = {
          nodeId: payload.data.node_id,
          nodeType: payload.data.node_type ?? '',
          status: payload.data.status,
          outputs: payload.data.outputs,
          error: payload.data.error,
        }
        if (existingIdx >= 0) {
          steps.value[existingIdx] = step
        } else {
          steps.value.push(step)
        }
      }

      if (payload.type === 'workflow_completed' && payload.data.run_id === props.runId) {
        status.value = 'succeeded'
      }
    } catch {
      return
    }
  }

  socket.onclose = () => {
    if (disposed.value) return
    setTimeout(connect, 2000)
  }

  ws.value = socket
}

connect()

onBeforeUnmount(() => {
  disposed.value = true
  ws.value?.close()
})

function statusColor(value: string) {
  if (value === 'succeeded') return '#18a058'
  if (value === 'failed') return '#d03050'
  if (value === 'running') return '#2080f0'
  return '#999'
}

function statusLabel(value: string) {
  if (value === 'succeeded') return t('runner.done')
  if (value === 'failed') return t('runner.failed')
  if (value === 'running') return t('runner.running')
  return t('runner.skipped')
}

function summarizeStep(step: StepLog): StepSummary | null {
  const outputs = asRecord(step.outputs)
  const result = asRecord(outputs.result)

  if (step.nodeType === 'executor_call') {
    return summarizeExecutorResult(result)
  }

  if (step.nodeType === 'answer') {
    const answer = stringifyValue(outputs.answer)
    return answer ? { title: t('runner.answer'), rows: [{ label: 'message', value: answer }] } : null
  }

  if (step.nodeType === 'subflow') {
    const subflow = asRecord(outputs.subflow)
    return Object.keys(subflow).length > 0
      ? {
          title: t('runner.subflow'),
          rows: compactRows([
            ['workflow', stringifyValue(subflow.workflow_id)],
            ['run', stringifyValue(subflow.run_id)],
            ['status', stringifyValue(subflow.status)],
            ['trace', stringifyValue(subflow.trace_count)],
          ]),
        }
      : null
  }

  return null
}

function summarizeExecutorResult(result: Record<string, unknown>): StepSummary | null {
  if (!Object.keys(result).length) return null

  const adapterResult = asRecord(result.adapter_result)
  if (adapterResult.status) {
    if (adapterResult.protocol === 'a2a') {
      const request = asRecord(adapterResult.request)
      return {
        title: t('runner.a2aDispatch'),
        rows: compactRows([
          ['target', stringifyValue(result.target)],
          ['dispatch', stringifyValue(result.status)],
          ['a2a', stringifyValue(adapterResult.status)],
          ['method', stringifyValue(request.method)],
          ['endpoint', stringifyValue(adapterResult.endpoint) || 'dry-run'],
        ]),
      }
    }

    const adapterData = asRecord(adapterResult.data)
    const draft = asRecord(adapterData.draft)
    if (draft.draft_id) {
      return {
        title: t('runner.adapterDispatch'),
        rows: compactRows([
          ['target', stringifyValue(result.target)],
          ['dispatch', stringifyValue(result.status)],
          ['draft', stringifyValue(draft.draft_id)],
          ['title', stringifyValue(asRecord(draft.metadata).title)],
          ['source', stringifyValue(asRecord(draft.upload).source_path)],
        ]),
      }
    }

    if (adapterData.launched) {
      return {
        title: 'Adapter Dispatch',
        rows: compactRows([
          ['target', stringifyValue(result.target)],
          ['dispatch', stringifyValue(result.status)],
          ['launched', stringifyValue(adapterData.launched)],
          ['active', stringifyValue(adapterData.active_package)],
        ]),
      }
    }
  }

  const data = asRecord(result.data)
  const draft = asRecord(data.draft)
  if (draft.draft_id) {
    return {
      title: t('runner.cliDraft'),
      rows: compactRows([
        ['status', stringifyValue(result.status)],
        ['draft', stringifyValue(draft.draft_id)],
        ['title', stringifyValue(asRecord(draft.metadata).title)],
        ['source', stringifyValue(asRecord(draft.upload).source_path)],
        ['dry_run', stringifyValue(asRecord(draft.upload).dry_run)],
      ]),
    }
  }

  if (data.launched) {
    return {
      title: t('runner.deviceAction'),
      rows: compactRows([
        ['status', stringifyValue(result.status)],
        ['launched', stringifyValue(data.launched)],
        ['active', stringifyValue(data.active_package)],
      ]),
    }
  }

  if (Array.isArray(result.results)) {
    return {
      title: t('runner.compiledPlan'),
      rows: compactRows([
        ['plan', stringifyValue(result.plan_id)],
        ['steps', String(result.results.length)],
        ['executable', stringifyValue(result.executable)],
      ]),
    }
  }

  if (result.target || result.dispatch_id) {
    return {
      title: t('runner.agentDispatch'),
      rows: compactRows([
        ['target', stringifyValue(result.target)],
        ['status', stringifyValue(result.status)],
        ['mode', stringifyValue(result.execution_mode)],
      ]),
    }
  }

  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function compactRows(rows: Array<[string, string]>): Array<{ label: string; value: string }> {
  return rows
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => ({ label, value }))
}
</script>

<template>
  <div class="workflow-runner">
    <div class="runner-header">
      <h4>Execution Status</h4>
      <span :class="['status-tag', status]">{{ statusLabel(status) }}</span>
    </div>

    <div v-if="steps.length > 0" class="run-stats">
      <div class="stat-item">
        <span class="stat-value">{{ runStats.total }}</span>
        <span class="stat-label">steps</span>
      </div>
      <div class="stat-item success">
        <span class="stat-value">{{ runStats.succeeded }}</span>
        <span class="stat-label">done</span>
      </div>
      <div class="stat-item danger">
        <span class="stat-value">{{ runStats.failed }}</span>
        <span class="stat-label">failed</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">{{ runStats.duration }}ms</span>
        <span class="stat-label">duration</span>
      </div>
    </div>

    <div class="step-list">
      <div v-if="steps.length === 0" class="empty">Waiting for execution...</div>
      <button
        v-for="step in steps"
        :key="step.nodeId"
        type="button"
        class="step-item"
        @click="emit('selectNode', step.nodeId)"
      >
        <div class="step-dot" :style="{ background: statusColor(step.status) }"></div>
        <div class="step-info">
          <div class="step-title-row">
            <span class="step-name">Node {{ step.nodeId }}</span>
            <span class="step-type">{{ step.nodeType }}</span>
          </div>
          <span v-if="step.durationMs" class="step-duration">{{ step.durationMs }}ms</span>
          <span v-if="step.error" class="step-error">{{ step.error }}</span>
          <div v-if="summarizeStep(step)" class="step-summary">
            <div class="summary-title">{{ summarizeStep(step)?.title }}</div>
            <div
              v-for="row in summarizeStep(step)?.rows"
              :key="row.label"
              class="summary-row"
            >
              <span class="summary-label">{{ row.label }}</span>
              <span class="summary-value">{{ row.value }}</span>
            </div>
          </div>
        </div>
        <span class="step-status" :style="{ color: statusColor(step.status) }">{{ statusLabel(step.status) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.workflow-runner {
  border: 1px solid rgba(229, 231, 235, 0.5);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(48px);
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.03);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.workflow-runner:hover {
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 20px 56px rgba(0, 0, 0, 0.06);
  transform: translateY(-4px);
}

.runner-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.5);
}

.runner-header h4 {
  margin: 0;
  font-size: 10px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

.status-tag {
  padding: 4px 12px;
  border-radius: 99px;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: 1px solid transparent;
}

.status-tag.running {
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
  border-color: rgba(59, 130, 246, 0.1);
}
.status-tag.succeeded {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
  border-color: rgba(16, 185, 129, 0.1);
}
.status-tag.failed {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
  border-color: rgba(239, 68, 68, 0.1);
}

.run-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.5);
}

.stat-item {
  min-width: 0;
  padding: 12px 4px;
  border-radius: 14px;
  background: rgba(241, 245, 249, 0.4);
  text-align: center;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid rgba(0, 0, 0, 0.02);
}

.stat-item:hover {
  background: #fff;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
}

.stat-value {
  display: block;
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-label {
  display: block;
  margin-top: 4px;
  font-size: 8px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  opacity: 0.7;
}

.stat-item.success .stat-value { color: #10b981; }
.stat-item.danger .stat-value { color: #ef4444; }

.step-list {
  padding: 12px 20px;
}

.step-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 16px 0;
  border: none;
  border-bottom: 1px solid rgba(236, 239, 242, 0.5);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.step-item:last-child {
  border-bottom: none;
}

.step-item:hover {
  transform: translateX(6px);
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
  box-shadow: 0 0 0 3px #fff, 0 4px 12px rgba(0,0,0,0.1);
}

.step-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.step-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.step-name {
  font-size: 14px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.step-type {
  font-size: 9px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.6;
}

.step-duration {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.step-error {
  font-size: 11px;
  font-weight: 600;
  color: #ef4444;
  background: rgba(254, 242, 242, 0.6);
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(239, 68, 68, 0.1);
  margin-top: 4px;
}

.step-status {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-top: 4px;
}

.step-summary {
  margin-top: 12px;
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.4);
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.4);
  backdrop-filter: blur(8px);
}

.summary-title {
  margin-bottom: 10px;
  font-size: 9px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  opacity: 0.8;
}

.summary-row {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 16px;
  margin-top: 8px;
  font-size: 11px;
}

.summary-label {
  color: var(--text-tertiary);
  font-weight: 800;
  text-transform: uppercase;
  font-size: 8px;
  letter-spacing: 0.05em;
}

.summary-value {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  background: rgba(255, 255, 255, 0.5);
  padding: 2px 6px;
  border-radius: 4px;
}

.empty {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  padding: 48px 0;
  opacity: 0.5;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

</style>
