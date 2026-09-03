<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { api } from '../api'
import type { WorkflowRunResult } from '../api/workflow'
import { useLocale } from '../composables/useLocale'
import {
  buildWorkflowStepSummary,
  type WorkflowRunnerStepLike,
} from '../features/studio/workflowRunSummary'

const props = defineProps<{
  runId: number
  result?: WorkflowRunResult | null
}>()

const emit = defineEmits<{
  selectNode: [nodeId: string]
  updateActiveSteps: [nodeIds: Set<string>]
  repairPreview: []
  repairRun: []
}>()

interface StepLog extends WorkflowRunnerStepLike {
  nodeId: string
  nodeType: string
  status: 'running' | 'succeeded' | 'failed' | 'skipped'
  inputs?: Record<string, unknown>
  resolvedInputs?: Record<string, unknown>
  outputs?: Record<string, unknown>
  error?: string
  durationMs?: number
  attempts?: number
  retryErrors?: string[]
  compensationTaskId?: number
}

interface CompensationPreview {
  can_execute: boolean
  checks: Array<{ name: string; passed: boolean; message: string }>
  estimated_impact: string
  warnings: string[]
}

const steps = ref<StepLog[]>([])
const activeNodeIds = computed(() => new Set(steps.value.filter(s => s.status === 'running').map(s => s.nodeId)))

watch(activeNodeIds, (newIds) => {
  emit('updateActiveSteps', newIds)
}, { immediate: true })

const status = ref<'running' | 'succeeded' | 'failed'>('running')
const ws = ref<WebSocket | null>(null)
const disposed = ref(false)
const compensationPreviews = ref<Record<number, CompensationPreview>>({})
const compensationBusy = ref<Record<number, boolean>>({})
const compensationMessages = ref<Record<number, string>>({})
const { t, locale } = useLocale()

function label(zh: string, en: string) {
  return locale.value === 'zh' ? zh : en
}

const runStats = computed(() => {
  const total = steps.value.length
  const succeeded = steps.value.filter((step) => step.status === 'succeeded').length
  const failed = steps.value.filter((step) => step.status === 'failed').length
  const duration = steps.value.reduce((sum, step) => sum + (step.durationMs ?? 0), 0)
  return { total, succeeded, failed, duration }
})

const stepViewModels = computed(() =>
  steps.value.map((step) => ({
    step,
    summary: buildWorkflowStepSummary(step, label),
  })),
)

watch(
  () => props.result,
  (value) => {
    if (!value) return
    status.value = value.status
    steps.value = value.trace.map((trace) => ({
      nodeId: trace.node_id,
      nodeType: trace.node_type,
      status: trace.status === 'skipped' ? 'skipped' : trace.status,
      inputs: trace.inputs,
      resolvedInputs: trace.resolved_inputs,
      outputs: trace.outputs,
      error: trace.error,
      durationMs: trace.duration_ms,
      attempts: trace.attempts,
      retryErrors: trace.retry_errors,
      compensationTaskId: trace.compensation_task_id,
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
          durationMs: payload.data.duration_ms,
          attempts: payload.data.attempts,
          retryErrors: payload.data.retry_errors,
          compensationTaskId: payload.data.compensation_task_id,
        }
        if (existingIdx >= 0) {
          steps.value[existingIdx] = step
        } else {
          steps.value.push(step)
        }
      }

      if ((payload.type === 'workflow_completed' || payload.type === 'workflow_failed') && payload.data.run_id === props.runId) {
        status.value = payload.type === 'workflow_failed' || payload.data.status === 'failed' ? 'failed' : 'succeeded'
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

function selectStep(nodeId: string) {
  emit('selectNode', nodeId)
}

function compensationPreview(taskId: number): CompensationPreview | null {
  return compensationPreviews.value[taskId] ?? null
}

function compensationMessage(taskId: number): string {
  return compensationMessages.value[taskId] ?? ''
}

function isCompensationBusy(taskId: number): boolean {
  return Boolean(compensationBusy.value[taskId])
}

async function previewCompensation(taskId: number) {
  setCompensationBusy(taskId, true)
  setCompensationMessage(taskId, '')
  try {
    const response = await api.observability.previewCompensationTask(taskId)
    if (response.status !== 'success') throw new Error('Preview failed')
    compensationPreviews.value = { ...compensationPreviews.value, [taskId]: response.result }
  } catch (err) {
    setCompensationMessage(taskId, (err as Error).message)
  } finally {
    setCompensationBusy(taskId, false)
  }
}

async function retryCompensation(taskId: number) {
  setCompensationBusy(taskId, true)
  setCompensationMessage(taskId, '')
  try {
    const response = await api.observability.retryCompensationTask(taskId)
    if (response.status !== 'success') throw new Error('Retry failed')
    await previewCompensation(taskId)
    setCompensationMessage(taskId, response.success ? label('重试已执行', 'Retry executed') : label('重试未完成', 'Retry did not complete'))
  } catch (err) {
    setCompensationMessage(taskId, (err as Error).message)
  } finally {
    setCompensationBusy(taskId, false)
  }
}

function setCompensationBusy(taskId: number, value: boolean) {
  compensationBusy.value = { ...compensationBusy.value, [taskId]: value }
}

function setCompensationMessage(taskId: number, value: string) {
  compensationMessages.value = { ...compensationMessages.value, [taskId]: value }
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
      <div
        v-for="view in stepViewModels"
        :key="view.step.nodeId"
        :class="['step-item', view.summary?.kind, view.summary?.tone]"
        role="button"
        tabindex="0"
        @click="selectStep(view.step.nodeId)"
        @keydown.enter.prevent="selectStep(view.step.nodeId)"
        @keydown.space.prevent="selectStep(view.step.nodeId)"
      >
        <div class="step-dot" :style="{ background: statusColor(view.step.status) }"></div>
        <div class="step-info">
          <div class="step-title-row">
            <span class="step-name">Node {{ view.step.nodeId }}</span>
            <span class="step-type">{{ view.step.nodeType }}</span>
          </div>
          <span v-if="view.step.durationMs" class="step-duration">{{ view.step.durationMs }}ms</span>
          <span v-if="view.step.attempts && view.step.attempts > 1" class="step-attempts">
            {{ label('重试', 'Attempts') }} {{ view.step.attempts }}
          </span>
          <span v-if="view.step.error" class="step-error">{{ view.step.error }}</span>
          <div v-if="view.step.retryErrors?.length" class="retry-error-list">
            <span
              v-for="(retryError, index) in view.step.retryErrors"
              :key="`${view.step.nodeId}:retry:${index}`"
            >
              {{ label('尝试', 'Attempt') }} {{ index + 1 }} · {{ retryError }}
            </span>
          </div>
          <div v-if="view.step.compensationTaskId" class="compensation-card" @click.stop>
            <div class="compensation-head">
              <div>
                <span class="compensation-eyebrow">{{ label('修复任务', 'Repair Task') }}</span>
                <strong>#{{ view.step.compensationTaskId }}</strong>
              </div>
              <div class="compensation-actions">
                <button
                  type="button"
                  class="compensation-btn"
                  :disabled="isCompensationBusy(view.step.compensationTaskId)"
                  @click.stop="previewCompensation(view.step.compensationTaskId)"
                >
                  {{ label('预览', 'Preview') }}
                </button>
                <button
                  type="button"
                  class="compensation-btn"
                  @click.stop="emit('repairPreview')"
                >
                  {{ label('重新预演', 'Re-preview') }}
                </button>
                <button
                  type="button"
                  class="compensation-btn primary"
                  @click.stop="emit('repairRun')"
                >
                  {{ label('重新运行', 'Re-run') }}
                </button>
                <button
                  v-if="compensationPreview(view.step.compensationTaskId)?.can_execute"
                  type="button"
                  class="compensation-btn primary"
                  :disabled="isCompensationBusy(view.step.compensationTaskId)"
                  @click.stop="retryCompensation(view.step.compensationTaskId)"
                >
                  {{ label('重试', 'Retry') }}
                </button>
              </div>
            </div>
            <div v-if="compensationMessage(view.step.compensationTaskId)" class="compensation-message">
              {{ compensationMessage(view.step.compensationTaskId) }}
            </div>
            <div v-if="compensationPreview(view.step.compensationTaskId)" class="compensation-preview">
              <div class="compensation-impact">
                {{ compensationPreview(view.step.compensationTaskId)?.estimated_impact }}
              </div>
              <div
                v-for="check in compensationPreview(view.step.compensationTaskId)?.checks ?? []"
                :key="check.name"
                :class="['compensation-check', check.passed ? 'passed' : 'blocked']"
              >
                <span>{{ check.passed ? label('通过', 'Pass') : label('阻塞', 'Block') }}</span>
                <strong>{{ check.message }}</strong>
              </div>
            </div>
          </div>
          <div v-if="view.summary" :class="['step-summary', view.summary.kind, view.summary.tone]">
            <div class="summary-title">{{ view.summary.title }}</div>
            <div v-if="view.summary.device" class="summary-device">
              <span :class="['device-status-dot', view.summary.device.status]"></span>
              <div class="device-copy">
                <strong>{{ view.summary.device.name }}</strong>
                <span v-if="view.summary.device.detail">{{ view.summary.device.detail }}</span>
              </div>
            </div>
            <div v-if="view.summary.phases?.length" class="phase-strip">
              <span
                v-for="phase in view.summary.phases"
                :key="phase.label"
                :class="['phase-chip', phase.tone]"
              >
                <em>{{ phase.label }}</em>
                <strong>{{ phase.value }}</strong>
              </span>
            </div>
            <div v-if="view.summary.effect" class="summary-effect">{{ view.summary.effect }}</div>
            <div v-if="view.summary.changedFields?.length" class="changed-fields">
              <span
                v-for="field in view.summary.changedFields"
                :key="field"
              >
                {{ field }}
              </span>
            </div>
            <div v-if="view.summary.substeps?.length" class="substep-list">
              <div class="substep-list-title">{{ label('子流程追踪', 'Subflow Trace') }}</div>
              <div
                v-for="substep in view.summary.substeps"
                :key="`${view.step.nodeId}:${substep.title}:${substep.duration ?? ''}`"
                class="substep-row"
              >
                <span :class="['substep-dot', substep.tone]"></span>
                <div class="substep-body">
                  <div class="substep-head">
                    <strong>{{ substep.title }}</strong>
                    <span v-if="substep.duration" class="substep-duration">{{ substep.duration }}</span>
                  </div>
                  <span v-if="substep.detail" class="substep-detail">{{ substep.detail }}</span>
                </div>
              </div>
            </div>
            <div
              v-for="row in view.summary.rows"
              :key="row.label"
              class="summary-row"
            >
              <span class="summary-label">{{ row.label }}</span>
              <span class="summary-value">{{ row.value }}</span>
            </div>
          </div>
        </div>
        <span class="step-status" :style="{ color: statusColor(view.step.status) }">{{ statusLabel(view.step.status) }}</span>
      </div>
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
  font-size: 14px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

.status-tag {
  padding: 4px 12px;
  border-radius: 99px;
  font-size: 14px;
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

.step-item:focus-visible {
  outline: 2px solid rgba(16, 185, 129, 0.45);
  outline-offset: 4px;
  border-radius: 14px;
}

.step-item:last-child {
  border-bottom: none;
}

.step-item:hover {
  transform: translateX(6px);
}

.step-item.device_capability {
  padding: 18px 14px;
  border: 1px solid rgba(16, 185, 129, 0.12);
  border-radius: 18px;
  margin: 10px 0;
  background: rgba(16, 185, 129, 0.035);
}

.step-item.device_capability.error {
  border-color: rgba(239, 68, 68, 0.18);
  background: rgba(239, 68, 68, 0.035);
}

.step-item.device_capability.warning {
  border-color: rgba(245, 158, 11, 0.22);
  background: rgba(245, 158, 11, 0.04);
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
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.step-type {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.6;
}

.step-duration {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.step-attempts {
  width: fit-content;
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.1);
  color: #b45309;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.step-error {
  font-size: 15px;
  font-weight: 600;
  color: #ef4444;
  background: rgba(254, 242, 242, 0.6);
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(239, 68, 68, 0.1);
  margin-top: 4px;
}

.retry-error-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
}

.retry-error-list span {
  padding: 6px 9px;
  border-radius: 9px;
  background: rgba(255, 251, 235, 0.75);
  color: #92400e;
  font-size: 12px;
  font-weight: 750;
}

.compensation-card {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid rgba(254, 202, 202, 0.8);
  border-radius: 14px;
  background: rgba(254, 242, 242, 0.72);
}

.compensation-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.compensation-head strong {
  display: block;
  font-size: 14px;
  font-weight: 900;
  color: var(--text-primary);
}

.compensation-eyebrow {
  display: block;
  font-size: 8px;
  font-weight: 900;
  color: #b91c1c;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin-bottom: 4px;
}

.compensation-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.compensation-btn {
  height: 30px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid rgba(254, 202, 202, 0.9);
  background: rgba(255, 255, 255, 0.72);
  color: #9f1239;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.compensation-btn.primary {
  border-color: rgba(244, 63, 94, 0.28);
  background: rgba(244, 63, 94, 0.1);
  color: #be123c;
}

.compensation-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.compensation-message {
  margin-top: 8px;
  font-size: 12px;
  color: #9f1239;
  font-weight: 700;
}

.compensation-preview {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.compensation-impact {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.72);
  color: #7f1d1d;
  font-size: 12px;
  font-weight: 800;
}

.compensation-check {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.66);
}

.compensation-check span {
  flex-shrink: 0;
  width: fit-content;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.compensation-check.passed span {
  color: #059669;
  background: rgba(16, 185, 129, 0.1);
}

.compensation-check.blocked span {
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.1);
}

.compensation-check strong {
  min-width: 0;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
}

.step-status {
  font-size: 14px;
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

.step-summary.device_capability {
  border-color: rgba(16, 185, 129, 0.16);
  background: rgba(255, 255, 255, 0.62);
}

.step-summary.device_capability.error {
  border-color: rgba(239, 68, 68, 0.18);
}

.step-summary.device_capability.warning {
  border-color: rgba(245, 158, 11, 0.22);
}

.summary-title {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  opacity: 0.8;
}

.summary-device {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid rgba(226, 232, 240, 0.55);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.56);
  margin-bottom: 12px;
}

.device-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.device-status-dot.online { background: #10b981; }
.device-status-dot.offline { background: #ef4444; }
.device-status-dot.unknown { background: #94a3b8; }

.device-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.device-copy strong,
.device-copy span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-copy strong {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 900;
}

.device-copy span {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 800;
}

.phase-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.phase-chip {
  min-width: 0;
  padding: 9px 10px;
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.6);
  background: rgba(248, 250, 252, 0.72);
}

.phase-chip em,
.phase-chip strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: normal;
}

.phase-chip em {
  font-size: 8px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}

.phase-chip strong {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
}

.phase-chip.success {
  border-color: rgba(16, 185, 129, 0.18);
  background: rgba(16, 185, 129, 0.08);
}

.phase-chip.warning {
  border-color: rgba(245, 158, 11, 0.2);
  background: rgba(245, 158, 11, 0.08);
}

.phase-chip.error {
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.08);
}

.summary-effect {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-left: 3px solid rgba(16, 185, 129, 0.55);
  border-radius: 10px;
  background: rgba(16, 185, 129, 0.055);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
  font-weight: 750;
}

.changed-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.changed-fields span {
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.08);
  color: #2563eb;
  font-size: 11px;
  font-weight: 850;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.substep-list {
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid rgba(191, 219, 254, 0.7);
  border-radius: 14px;
  background: rgba(239, 246, 255, 0.72);
}

.substep-list-title {
  margin-bottom: 10px;
  font-size: 8px;
  font-weight: 900;
  color: #2563eb;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.substep-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 0;
}

.substep-row + .substep-row {
  border-top: 1px solid rgba(191, 219, 254, 0.45);
}

.substep-dot {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 999px;
  flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.55);
}

.substep-dot.success { background: #10b981; }
.substep-dot.warning { background: #f59e0b; }
.substep-dot.error { background: #ef4444; }
.substep-dot.neutral { background: #94a3b8; }

.substep-body {
  flex: 1;
  min-width: 0;
}

.substep-head {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.substep-head strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
}

.substep-duration {
  font-size: 11px;
  font-weight: 800;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: nowrap;
}

.substep-detail {
  display: block;
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
  font-weight: 700;
}

.summary-row {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 16px;
  margin-top: 8px;
  font-size: 15px;
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
  font-size: 15px;
  font-weight: 700;
  text-align: center;
  padding: 48px 0;
  opacity: 0.5;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

</style>
