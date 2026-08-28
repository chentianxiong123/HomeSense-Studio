<script setup lang="ts">
import { computed } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import { Controls } from '@vue-flow/controls'
import WorkflowRunner from '../WorkflowRunner.vue'

const props = defineProps<{
  currentWorkflow: any
  flowNodes: any[]
  flowEdges: any[]
  nodeTypesMap: any
  latestRun: any | null
  latestPreview: any | null
  workflowRunHistory: any[]
  workflowRunPresets: any[]
  workflowRunMemoryStatus: Record<number, 'saving' | 'saved' | 'error' | undefined>
  workflowRunMemoryErrors: Record<number, string | undefined>
  activeRunId: number | null
  runInputsText: string
  runInputError: string | null
  runtimeDeviceManifest: any[]
  runtimeDeviceManifestLoading: boolean
  selectedRunDeviceId: number | null
  selectedRunCapabilityId: string
  selectedRunCapabilities: any[]
  workflowHeaderChips: any[]
  workflowEditorSummaryItems: any[]
  workflowPublishEvidence: any
  isDirty: boolean
  t: (key: any, vars?: any) => string
  label: (zh: string, en: string) => string
  previewStateLabel: (state: any) => string
  previewModeLabel: (mode: any) => string
  previewRiskLabel: (risk: any) => string
}>()

const emit = defineEmits<{
  (e: 'node-click', event: any): void
  (e: 'pane-click', event: any): void
  (e: 'dragover', event: DragEvent): void
  (e: 'drop', event: DragEvent): void
  (e: 'node-drag-stop', event: any): void
  (e: 'show-obs'): void
  (e: 'save'): void
  (e: 'toggle-publish'): void
  (e: 'preview'): void
  (e: 'run'): void
  (e: 'delete'): void
  (e: 'create'): void
  (e: 'select-run-device', id: number | null): void
  (e: 'select-run-capability', id: string): void
  (e: 'apply-run-device-inputs'): void
  (e: 'refresh-runtime-device-manifest'): void
  (e: 'reuse-run-inputs', run: any): void
  (e: 'apply-run-preset', preset: any): void
  (e: 'save-run-memory', run: any): void
  (e: 'select-trace-node', nodeId: string): void
  (e: 'update:runInputsText', value: string): void
  (e: 'update-active-steps', nodeIds: Set<string>): void
}>()

const publishLocked = computed(() => !props.currentWorkflow?.published && props.workflowPublishEvidence?.status !== 'proven')

function handleActiveSteps(nodeIds: Set<string>) {
  emit('update-active-steps', nodeIds)
}

function handleNodeClick(event: any) { emit('node-click', event) }
function handlePaneClick(event: any) { emit('pane-click', event) }
function handleDragOver(event: DragEvent) { emit('dragover', event) }
function handleDrop(event: DragEvent) { emit('drop', event) }
function handleNodeDragStop(event: any) { emit('node-drag-stop', event) }

function selectedRunDevice() {
  return props.runtimeDeviceManifest.find((device) => device.id === props.selectedRunDeviceId) ?? null
}

function runDeviceLabel(device: any): string {
  return [device.name, device.room?.name, device.device_type].filter(Boolean).join(' · ')
}

function runDeviceHint(): string {
  const device = selectedRunDevice()
  if (!device) return props.label('选择真实设备后，可把能力参数写入运行输入。', 'Pick a real device to fill workflow inputs.')
  const status = device.display?.status === 'online'
    ? props.label('在线', 'Online')
    : device.display?.status === 'offline'
      ? props.label('离线', 'Offline')
      : props.label('未知', 'Unknown')
  return `${status} · ${props.label('能力', 'Capabilities')} ${device.capability_count ?? props.selectedRunCapabilities.length}`
}

function previewMetaLabel(value: string): string {
  const labels: Record<string, [string, string]> = {
    'device.capability': ['设备能力', 'Device Capability'],
    'workflow.subflow': ['子流程', 'Subflow'],
    'cli.invoke': ['CLI 调用', 'CLI Invoke'],
    'agent.dispatch': ['能力适配', 'Capability Dispatch'],
    'service.invoke': ['服务调用', 'Service Invoke'],
    'plan.run': ['计划路径', 'Plan Run'],
  }
  const labelPair = labels[value]
  return labelPair ? props.label(labelPair[0], labelPair[1]) : value
}

function isDeviceCapabilityPreview(step: any): boolean {
  return step.executor_name === 'device.capability' || step.node_type === 'device_capability'
}

function isSubflowPreview(step: any): boolean {
  return step.executor_name === 'workflow.subflow' || step.node_type === 'subflow'
}

function isStructuredPreview(step: any): boolean {
  return isDeviceCapabilityPreview(step) || isSubflowPreview(step)
}

function previewDeviceTarget(step: any): string {
  const target = String(step.target ?? '')
  if (!target) return ''
  const [, name] = target.split(':', 2)
  return name || target
}

function previewDeviceId(step: any): string {
  const target = String(step.target ?? '')
  if (!target) return ''
  return target.includes(':') ? target.split(':', 1)[0] : target
}

function previewPhaseTone(step: any): 'success' | 'warning' | 'error' | 'neutral' {
  if (step.preview_state === 'ready') return 'success'
  if (step.preview_state === 'blocked') return 'warning'
  if (step.preview_state === 'skipped') return 'neutral'
  return 'neutral'
}

function previewSubflowName(step: any): string {
  const name = step.subflow?.workflow_name
  if (name) return String(name)
  const target = String(step.target ?? '')
  if (!target) return ''
  const [, parsedName] = target.split(':', 2)
  return parsedName || target
}

function previewSubflowId(step: any): string {
  const id = step.subflow?.workflow_id
  if (id !== undefined && id !== null) return String(id)
  const target = String(step.target ?? '')
  if (!target) return ''
  const raw = target.includes(':') ? target.split(':', 1)[0] : target
  const normalized = raw.replace(/^#/, '')
  return /^\d+$/.test(normalized) ? normalized : ''
}

function previewSubflowInputSummary(step: any): string {
  const rawKeys = Array.isArray(step.subflow?.input_keys)
    ? step.subflow.input_keys
    : step.params && typeof step.params === 'object'
      ? Object.keys(step.params)
      : []
  const keys = rawKeys.map((key: unknown) => String(key)).filter(Boolean)
  if (keys.length === 0) return '-'
  if (keys.length <= 2) return keys.join(', ')
  return `${keys.slice(0, 2).join(', ')} +${keys.length - 2}`
}

function previewSubflowOutputKey(step: any): string {
  const outputKey = step.subflow?.output_key
  return outputKey ? String(outputKey) : '-'
}

function previewSubflowNodeCount(step: any): string {
  const count = Number(step.subflow?.node_count)
  return Number.isFinite(count) && count > 0 ? String(count) : '-'
}

function runHistoryInputKeys(run: any): string {
  try {
    const parsed = JSON.parse(String(run.inputs_json ?? '{}'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '-'
    const keys = Object.keys(parsed)
    if (keys.length === 0) return '-'
    if (keys.length <= 3) return keys.join(', ')
    return `${keys.slice(0, 3).join(', ')} +${keys.length - 3}`
  } catch {
    return props.label('无法解析', 'Invalid')
  }
}

function runHistoryTime(run: any): string {
  return String(run.started_at ?? run.finished_at ?? '')
}

function runMemoryStatusLabel(run: any): string {
  const status = props.workflowRunMemoryStatus[Number(run.id)]
  if (status === 'saving') return props.label('沉淀中', 'Saving')
  if (status === 'saved') return props.label('已沉淀', 'Saved')
  if (status === 'error') return props.label('失败', 'Failed')
  return props.label('沉淀记忆', 'Save')
}

function runPresetInputKeys(preset: any): string {
  const inputs = preset?.inputs
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return '-'
  const keys = Object.keys(inputs)
  if (keys.length === 0) return '-'
  if (keys.length <= 3) return keys.join(', ')
  return `${keys.slice(0, 3).join(', ')} +${keys.length - 3}`
}

function runPresetStatusLabel(status: string): string {
  if (status === 'active') return props.label('可用', 'Ready')
  if (status === 'planned') return props.label('计划中', 'Planned')
  if (status === 'legacy') return props.label('旧路径', 'Legacy')
  return status || '-'
}

function runPresetDetailLabel(detail: string): string {
  if (detail === 'workflow_run_history') return props.label('来自运行历史', 'From run history')
  if (detail === 'workflow_success') return props.label('来自成功执行', 'From successful run')
  if (detail === 'workflow_failure') return props.label('来自失败观察', 'From failure observation')
  if (detail === 'runtime') return props.label('来自对话执行', 'From chat execution')
  if (detail === 'user') return props.label('手动保存', 'Saved manually')
  return detail || props.label('经验路径', 'Experience path')
}

function runPresetStats(preset: any): string {
  const parts: string[] = []
  const successCount = Number(preset?.successCount ?? 0)
  const failureCount = Number(preset?.failureCount ?? 0)
  if (Number.isFinite(successCount) && successCount > 0) parts.push(props.label(`成功 ${successCount}`, `Success ${successCount}`))
  if (Number.isFinite(failureCount) && failureCount > 0) parts.push(props.label(`失败 ${failureCount}`, `Failure ${failureCount}`))
  return parts.join(' · ')
}
</script>

<template>
  <main class="canvas-area">
    <div v-if="currentWorkflow" class="canvas-container">
      <!-- Toolbar -->
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="workflow-title-block">
            <span class="wf-title">{{ currentWorkflow.name }}</span>
            <span class="workflow-route-hint">{{ `/studio/workflows/${currentWorkflow.id}/editor` }}</span>
          </div>
          <div class="toolbar-chip-list">
            <span
              v-for="chip in workflowHeaderChips"
              :key="chip.label"
              :class="['toolbar-chip', chip.tone]"
            >
              {{ chip.label }}
            </span>
          </div>
          <div class="toolbar-summary">
            <div
              v-for="item in workflowEditorSummaryItems"
              :key="item.label"
              class="toolbar-summary-item"
            >
              <span class="toolbar-summary-label">{{ item.label }}</span>
              <strong class="toolbar-summary-value">{{ item.value }}</strong>
            </div>
          </div>
        </div>
        <div class="toolbar-right">
          <button class="toolbar-btn" @click="emit('show-obs')">{{ t('studio.observability') }}</button>
          <div
            v-if="workflowPublishEvidence"
            :class="['publish-evidence', workflowPublishEvidence.tone]"
          >
            <span>{{ workflowPublishEvidence.label }}</span>
            <em>{{ workflowPublishEvidence.hint }}</em>
          </div>
          <button
            :class="['toolbar-btn', 'publish', workflowPublishEvidence?.tone || 'neutral']"
            :disabled="publishLocked"
            @click="emit('toggle-publish')"
          >
            {{ currentWorkflow.published ? label('收回', 'Unpublish') : label('发布', 'Publish') }}
          </button>
          <button class="toolbar-btn" :disabled="!isDirty" @click="emit('save')">{{ t('studio.save') }}</button>
          <button class="toolbar-btn" @click="emit('preview')">{{ t('studio.preview') }}</button>
          <button class="toolbar-btn primary" @click="emit('run')">{{ t('studio.run') }}</button>
          <button class="toolbar-btn danger" @click="emit('delete')">{{ t('studio.delete') }}</button>
        </div>
      </div>

      <div class="workspace">
        <!-- Flow Editor -->
        <div class="flow-shell">
          <VueFlow
            :nodes="flowNodes"
            :edges="flowEdges"
            :node-types="nodeTypesMap"
            fit-view-on-init
            @node-click="handleNodeClick"
            @pane-click="handlePaneClick"
            @dragover="handleDragOver"
            @drop="handleDrop"
            @node-drag-stop="handleNodeDragStop"
          >
            <Background :gap="18" />
            <MiniMap />
            <Controls />
          </VueFlow>
        </div>

        <!-- Right Run/Preview Panel -->
        <div class="run-panel custom-scrollbar">
          <div class="panel-card">
            <div class="panel-card-head">
              <h4>{{ t('studio.runtime') }}</h4>
              <span v-if="latestRun" class="runtime-status" :class="latestRun.status">{{ latestRun.status }}</span>
            </div>
            <div class="run-inputs">
              <label>{{ t('studio.runInputs') }}</label>
              <div class="device-input-helper">
                <div class="device-helper-head">
                  <span>{{ label('设备能力输入', 'Device Capability Input') }}</span>
                  <button
                    type="button"
                    class="helper-ghost-btn"
                    :disabled="runtimeDeviceManifestLoading"
                    @click="emit('refresh-runtime-device-manifest')"
                  >
                    {{ runtimeDeviceManifestLoading ? label('读取中', 'Loading') : label('刷新', 'Refresh') }}
                  </button>
                </div>
                <div class="helper-select-row">
                  <select
                    class="styled-select"
                    :value="selectedRunDeviceId ?? ''"
                    :disabled="runtimeDeviceManifestLoading || runtimeDeviceManifest.length === 0"
                    @change="emit('select-run-device', ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null)"
                  >
                    <option value="">{{ label('选择设备', 'Select device') }}</option>
                    <option
                      v-for="device in runtimeDeviceManifest"
                      :key="device.id"
                      :value="device.id"
                    >
                      {{ runDeviceLabel(device) }}
                    </option>
                  </select>
                  <select
                    class="styled-select"
                    :value="selectedRunCapabilityId"
                    :disabled="selectedRunCapabilities.length === 0"
                    @change="emit('select-run-capability', ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">{{ label('选择能力', 'Select capability') }}</option>
                    <option
                      v-for="capability in selectedRunCapabilities"
                      :key="capability.capability_id"
                      :value="capability.capability_id"
                    >
                      {{ capability.name || capability.capability_id }}
                    </option>
                  </select>
                </div>
                <div class="helper-bottom">
                  <span class="helper-hint">{{ runDeviceHint() }}</span>
                  <button
                    type="button"
                    class="helper-action-btn"
                    :disabled="!selectedRunDeviceId || !selectedRunCapabilityId"
                    @click="emit('apply-run-device-inputs')"
                  >
                    {{ label('写入输入', 'Fill') }}
                  </button>
                </div>
              </div>
              <textarea
                :value="runInputsText"
                @input="emit('update:runInputsText', ($event.target as HTMLTextAreaElement).value)"
                rows="4"
                spellcheck="false"
                class="styled-textarea"
              ></textarea>
              <div v-if="runInputError" class="input-error">{{ runInputError }}</div>
            </div>

            <!-- Preview Results -->
            <div v-if="latestPreview" class="preview-box">
              <div class="preview-head">
                <h4>{{ t('studio.previewTitle') }}</h4>
                <span :class="['preview-status', latestPreview.executable ? 'ready' : 'blocked']">
                  {{ latestPreview.executable ? t('studio.ready') : t('studio.blocked') }}
                </span>
              </div>
              <div v-if="latestPreview.warnings.length > 0" class="preview-warnings">
                <div
                  v-for="warning in latestPreview.warnings"
                  :key="warning"
                  class="preview-warning"
                >
                  {{ warning }}
                </div>
              </div>
              <div class="preview-steps">
                <button
                  v-for="step in latestPreview.steps"
                  :key="step.node_id"
                  type="button"
                  :class="['preview-step', { 'device-capability-preview': isDeviceCapabilityPreview(step), 'subflow-preview': isSubflowPreview(step) }]"
                  @click="emit('select-trace-node', step.node_id)"
                >
                  <div class="preview-step-top">
                    <span class="preview-step-name">{{ step.label || step.node_type }}</span>
                    <div class="preview-step-chips">
                      <span :class="['preview-node-state', step.preview_state]">{{ previewStateLabel(step.preview_state) }}</span>
                      <span :class="['preview-mode-chip', step.resolution_mode]">{{ previewModeLabel(step.resolution_mode) }}</span>
                      <span :class="['risk-chip', step.risk]">{{ previewRiskLabel(step.risk) }}</span>
                    </div>
                  </div>
                  <div class="preview-summary">{{ step.summary }}</div>
                  <div v-if="step.executor_name || step.target || step.cli_name || step.action" class="preview-meta">
                    <span v-if="step.executor_name">{{ previewMetaLabel(step.executor_name) }}</span>
                    <span v-if="step.cli_name">{{ step.cli_name }}</span>
                    <span v-if="step.target">{{ step.target }}</span>
                    <span v-if="step.action">{{ step.action }}</span>
                  </div>
                  <div v-if="isDeviceCapabilityPreview(step)" class="preview-device-card">
                    <div class="preview-device-grid">
                      <div>
                        <span>{{ label('设备', 'Device') }}</span>
                        <strong>{{ previewDeviceTarget(step) || label('未解析', 'Unresolved') }}</strong>
                      </div>
                      <div>
                        <span>{{ label('设备 ID', 'Device ID') }}</span>
                        <strong>{{ previewDeviceId(step) || '-' }}</strong>
                      </div>
                      <div>
                        <span>{{ label('能力', 'Capability') }}</span>
                        <strong>{{ step.action || '-' }}</strong>
                      </div>
                      <div>
                        <span>{{ label('参数', 'Arguments') }}</span>
                        <strong>{{ step.params && Object.keys(step.params).length ? Object.keys(step.params).join(', ') : '-' }}</strong>
                      </div>
                    </div>
                    <div class="preview-phase-row">
                      <span :class="['preview-phase-chip', previewPhaseTone(step)]">
                        <em>{{ label('沙箱演练', 'Rehearsal') }}</em>
                        <strong>{{ step.preview_state === 'ready' ? label('可预演', 'Ready') : previewStateLabel(step.preview_state) }}</strong>
                      </span>
                      <span :class="['preview-phase-chip', previewPhaseTone(step)]">
                        <em>{{ label('真实执行', 'Execution') }}</em>
                        <strong>{{ step.preview_state === 'ready' ? label('待执行', 'Planned') : previewStateLabel(step.preview_state) }}</strong>
                      </span>
                    </div>
                  </div>
                  <div v-if="isSubflowPreview(step)" class="preview-subflow-card">
                    <div class="preview-device-grid preview-subflow-grid">
                      <div>
                        <span>{{ label('子流程', 'Subflow') }}</span>
                        <strong>{{ previewSubflowName(step) || label('未解析', 'Unresolved') }}</strong>
                      </div>
                      <div>
                        <span>{{ label('工作流 ID', 'Workflow ID') }}</span>
                        <strong>{{ previewSubflowId(step) || '-' }}</strong>
                      </div>
                      <div>
                        <span>{{ label('输入键', 'Input Keys') }}</span>
                        <strong>{{ previewSubflowInputSummary(step) }}</strong>
                      </div>
                      <div>
                        <span>{{ label('输出键', 'Output Key') }}</span>
                        <strong>{{ previewSubflowOutputKey(step) }}</strong>
                      </div>
                    </div>
                    <div class="preview-phase-row">
                      <span :class="['preview-phase-chip', previewPhaseTone(step)]">
                        <em>{{ label('沙箱预演', 'Rehearsal') }}</em>
                        <strong>{{ step.preview_state === 'ready' ? label('可执行', 'Ready') : previewStateLabel(step.preview_state) }}</strong>
                      </span>
                      <span class="preview-phase-chip">
                        <em>{{ label('节点数', 'Node Count') }}</em>
                        <strong>{{ previewSubflowNodeCount(step) }}</strong>
                      </span>
                    </div>
                  </div>
                  <pre v-if="step.params && Object.keys(step.params).length && !isStructuredPreview(step)" class="preview-params">{{ JSON.stringify(step.params, null, 2) }}</pre>
                </button>
              </div>
            </div>

            <!-- Runner Component -->
            <WorkflowRunner
              v-if="activeRunId"
              :run-id="activeRunId"
              :result="latestRun"
              @select-node="emit('select-trace-node', $event)"
              @update-active-steps="handleActiveSteps"
              @repair-preview="emit('preview')"
              @repair-run="emit('run')"
            />
            <div v-else-if="!latestPreview" class="empty-panel">{{ t('studio.emptyRun') }}</div>
          </div>

          <div v-if="workflowRunHistory.length > 0" class="panel-card">
            <div class="panel-card-head">
              <h4>{{ label('运行历史', 'Run History') }}</h4>
            </div>
            <div class="run-history-list">
              <div
                v-for="run in workflowRunHistory.slice(0, 5)"
                :key="run.id"
                class="run-history-entry"
              >
                <div class="run-history-item">
                  <div class="run-history-main">
                    <div class="run-history-top">
                      <strong>#{{ run.id }}</strong>
                      <span :class="['run-history-status', run.status]">{{ run.status }}</span>
                    </div>
                    <div class="run-history-meta">
                      <span>{{ run.triggered_by }}</span>
                      <span>{{ runHistoryTime(run) || '-' }}</span>
                    </div>
                    <div class="run-history-inputs">
                      {{ label('输入', 'Inputs') }}: {{ runHistoryInputKeys(run) }}
                    </div>
                  </div>
                  <button
                    type="button"
                    class="history-reuse-btn"
                    @click="emit('reuse-run-inputs', run)"
                  >
                    {{ label('复用输入', 'Reuse') }}
                  </button>
                  <button
                    type="button"
                    :class="['history-memory-btn', workflowRunMemoryStatus[Number(run.id)] ?? 'idle']"
                    :disabled="workflowRunMemoryStatus[Number(run.id)] === 'saving' || workflowRunMemoryStatus[Number(run.id)] === 'saved'"
                    @click="emit('save-run-memory', run)"
                  >
                    {{ runMemoryStatusLabel(run) }}
                  </button>
                </div>
                <div
                  v-if="workflowRunMemoryStatus[Number(run.id)] === 'error' && workflowRunMemoryErrors[Number(run.id)]"
                  class="run-history-error"
                >
                  {{ workflowRunMemoryErrors[Number(run.id)] }}
                </div>
              </div>
            </div>
          </div>

          <div v-if="workflowRunPresets.length > 0" class="panel-card">
            <div class="panel-card-head">
              <h4>{{ label('运行模板', 'Run Presets') }}</h4>
            </div>
            <div class="run-preset-list">
              <div
                v-for="preset in workflowRunPresets.slice(0, 5)"
                :key="preset.id"
                class="run-preset-item"
              >
                <div class="run-preset-main">
                  <div class="run-preset-top">
                    <strong>{{ preset.title }}</strong>
                    <span class="run-preset-status">{{ runPresetStatusLabel(preset.status) }}</span>
                  </div>
                  <div class="run-preset-detail">{{ runPresetDetailLabel(preset.detail) }}</div>
                  <div v-if="runPresetStats(preset)" class="run-preset-stats">{{ runPresetStats(preset) }}</div>
                  <div class="run-preset-inputs">{{ label('输入', 'Inputs') }}: {{ runPresetInputKeys(preset) }}</div>
                </div>
                <button
                  type="button"
                  class="run-preset-btn"
                  @click="emit('apply-run-preset', preset)"
                >
                  {{ label('填入', 'Apply') }}
                </button>
              </div>
            </div>
          </div>

          <!-- Final Outputs -->
          <div v-if="latestRun" class="panel-card">
            <div class="panel-card-head">
              <h4>{{ t('studio.outputs') }}</h4>
            </div>
            <pre class="json-block">{{ JSON.stringify(latestRun.outputs, null, 2) }}</pre>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="empty-canvas">
      <div class="empty-hero">
        <h3>{{ t('studio.emptyTitle') }}</h3>
        <p>{{ t('studio.emptyDescription') }}</p>
        <button class="create-btn-large" @click="emit('create')">{{ t('studio.createWorkflow') }}</button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.canvas-area {
  flex: 1;
  min-width: 0;
  background: #f7f9fa;
  display: flex;
  flex-direction: column;
}

.canvas-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.toolbar {
  height: 88px;
  padding: 0 40px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  border-bottom: 1px solid rgba(229, 231, 235, 0.4);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  z-index: 10;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 40px;
  min-width: 0;
}

.workflow-title-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wf-title {
  font-size: 24px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.04em;
  line-height: 1;
}

.workflow-route-hint {
  font-size: 13px;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-weight: 800;
  letter-spacing: 0.05em;
  opacity: 0.6;
  text-transform: uppercase;
}

.toolbar-chip-list {
  display: flex;
  gap: 12px;
}

.toolbar-chip {
  font-size: 13px;
  padding: 4px 14px;
  border-radius: 99px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  border: 1px solid transparent;
}

.toolbar-chip.primary {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.toolbar-chip.warning {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.toolbar-summary {
  display: flex;
  gap: 32px;
  border-left: 1px solid rgba(229, 231, 235, 0.6);
  padding-left: 40px;
}

.toolbar-summary-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.toolbar-summary-label {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.6;
}

.toolbar-summary-value {
  font-size: 18px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  line-height: 1;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.publish-evidence {
  max-width: 240px;
  min-width: 160px;
  padding: 8px 12px;
  border-radius: 14px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: rgba(255, 255, 255, 0.68);
}

.publish-evidence span,
.publish-evidence em {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.publish-evidence span {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.publish-evidence em {
  margin-top: 3px;
  color: var(--text-tertiary);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}

.publish-evidence.success {
  border-color: rgba(16, 185, 129, 0.24);
  background: rgba(16, 185, 129, 0.08);
}

.publish-evidence.warning {
  border-color: rgba(245, 158, 11, 0.26);
  background: rgba(245, 158, 11, 0.08);
}

.publish-evidence.danger {
  border-color: rgba(239, 68, 68, 0.22);
  background: rgba(239, 68, 68, 0.08);
}

.toolbar-btn {
  height: 44px;
  padding: 0 20px;
  border-radius: 12px;
  border: 1px solid rgba(217, 217, 217, 0.6);
  background: rgba(255, 255, 255, 0.8);
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.toolbar-btn:hover:not(:disabled) {
  background: #fff;
  border-color: #10b981;
  color: #10b981;
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.12);
}

.toolbar-btn.primary {
  background: #10b981;
  color: white;
  border: none;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.25);
}

.toolbar-btn.publish {
  border-color: rgba(16, 185, 129, 0.2);
  background: rgba(16, 185, 129, 0.08);
  color: #047857;
}

.toolbar-btn.publish.warning {
  border-color: rgba(245, 158, 11, 0.22);
  background: rgba(245, 158, 11, 0.08);
  color: #b45309;
}

.toolbar-btn.publish.danger {
  border-color: rgba(239, 68, 68, 0.22);
  background: rgba(239, 68, 68, 0.08);
  color: #dc2626;
}

.toolbar-btn.primary:hover:not(:disabled) {
  background: #059669;
  transform: translateY(-4px);
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.35);
  color: #fff;
}

.toolbar-btn.danger {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.15);
  background: rgba(254, 242, 242, 0.8);
}

.toolbar-btn.danger:hover:not(:disabled) {
  background: #ef4444;
  color: white;
  border-color: #ef4444;
}

.toolbar-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}

.workspace {
  flex: 1;
  display: flex;
  min-height: 0;
  background: #f7f9fa;
}

.flow-shell {
  flex: 1;
  position: relative;
  background: radial-gradient(circle at center, rgba(255, 255, 255, 0.8) 0%, #f7f9fa 100%);
}

.run-panel {
  width: 420px;
  border-left: 1px solid rgba(229, 231, 235, 0.4);
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  padding: 40px 32px;
  overflow-y: auto;
  box-shadow: -12px 0 48px rgba(0, 0, 0, 0.03);
}

.panel-card {
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 32px;
  padding: 32px;
  margin-bottom: 32px;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.01);
}

.panel-card:hover {
  background: rgba(255, 255, 255, 0.8);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.05);
  transform: translateY(-4px);
}

.panel-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
}

.panel-card-head h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.6;
}

.runtime-status {
  font-size: 13px;
  padding: 4px 14px;
  border-radius: 99px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  text-transform: uppercase;
  font-weight: 900;
  letter-spacing: 0.1em;
  border: 1px solid rgba(16, 185, 129, 0.1);
}

.run-inputs label {
  display: block;
  font-size: 13px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.15em;
  margin-bottom: 16px;
  opacity: 0.6;
}

.device-input-helper {
  padding: 16px;
  margin-bottom: 18px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.55);
}

.device-helper-head,
.helper-bottom,
.helper-select-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.device-helper-head,
.helper-bottom {
  justify-content: space-between;
}

.device-helper-head {
  margin-bottom: 12px;
}

.device-helper-head span {
  font-size: 12px;
  font-weight: 900;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.helper-select-row {
  margin-bottom: 10px;
}

.styled-select {
  width: 100%;
  min-width: 0;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 16px;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 700;
  outline: none;
}

.helper-select-row .styled-select {
  flex: 1 1 0;
}

.styled-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.helper-hint {
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-tertiary);
  font-weight: 700;
  flex: 1;
  min-width: 0;
}

.helper-ghost-btn,
.helper-action-btn {
  height: 36px;
  border-radius: 12px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  background: rgba(255, 255, 255, 0.8);
  padding: 0 14px;
  font-size: 13px;
  font-weight: 800;
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;
}

.helper-action-btn {
  border-color: rgba(16, 185, 129, 0.25);
  background: rgba(16, 185, 129, 0.08);
  color: #059669;
}

.helper-ghost-btn:disabled,
.helper-action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.styled-textarea {
  width: 100%;
  padding: 20px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 18px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 15px;
  color: var(--text-primary);
  resize: vertical;
  outline: none;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  font-weight: 600;
  line-height: 1.6;
}

.styled-textarea:focus {
  border-color: #10b981;
  background: #fff;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.1);
  transform: translateY(-2px);
}

.input-error {
  color: #ef4444;
  font-size: 15px;
  font-weight: 800;
  margin-top: 12px;
  padding-left: 8px;
}

.preview-box {
  margin-top: 40px;
  border-top: 1px solid rgba(236, 239, 242, 0.8);
  padding-top: 32px;
}

.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.preview-status {
  font-size: 13px;
  padding: 4px 14px;
  border-radius: 99px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.preview-status.ready {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}
.preview-status.blocked {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.preview-step {
  width: 100%;
  text-align: left;
  padding: 24px;
  background: rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 24px;
  margin-bottom: 16px;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.preview-step:hover {
  border-color: #10b981;
  background: #fff;
  transform: translateX(8px);
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.08);
}

.preview-step.device-capability-preview {
  padding-bottom: 18px;
  border-color: rgba(16, 185, 129, 0.18);
  background: rgba(16, 185, 129, 0.035);
}

.preview-step.device-capability-preview:hover {
  border-color: rgba(16, 185, 129, 0.36);
  box-shadow: 0 14px 34px rgba(16, 185, 129, 0.1);
}

.preview-step.subflow-preview {
  padding-bottom: 18px;
  border-color: rgba(37, 99, 235, 0.18);
  background: rgba(37, 99, 235, 0.035);
}

.preview-step.subflow-preview:hover {
  border-color: rgba(37, 99, 235, 0.34);
  box-shadow: 0 14px 34px rgba(37, 99, 235, 0.1);
}

.preview-step-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.preview-step-name {
  font-size: 16px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.preview-step-chips {
  display: flex;
  gap: 8px;
}

.preview-node-state, .preview-mode-chip, .risk-chip {
  font-size: 8px;
  padding: 3px 10px;
  border-radius: 8px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.preview-node-state.ready { background: rgba(16, 185, 129, 0.1); color: #10b981; }
.preview-mode-chip.static { background: rgba(100, 116, 139, 0.1); color: #64748b; }
.risk-chip.none { background: rgba(100, 116, 139, 0.1); color: #64748b; }

.preview-summary {
  font-size: 15px;
  color: var(--text-secondary);
  line-height: 1.6;
  font-weight: 600;
  opacity: 0.9;
}

.preview-meta {
  margin-top: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 13px;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.preview-meta span {
  background: rgba(0, 0, 0, 0.04);
  padding: 4px 10px;
  border-radius: 6px;
}

.preview-device-card {
  margin-top: 16px;
  padding: 14px;
  border: 1px solid rgba(226, 232, 240, 0.65);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.62);
}

.preview-subflow-card {
  margin-top: 16px;
  padding: 14px;
  border: 1px solid rgba(191, 219, 254, 0.72);
  border-radius: 18px;
  background: rgba(239, 246, 255, 0.74);
}

.preview-device-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}

.preview-device-grid div {
  min-width: 0;
}

.preview-device-grid span {
  display: block;
  margin-bottom: 4px;
  font-size: 8px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.preview-device-grid strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
}

.preview-phase-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.preview-phase-chip {
  display: block;
  min-width: 0;
  padding: 9px 10px;
  border-radius: 12px;
  border: 1px solid rgba(226, 232, 240, 0.6);
  background: rgba(248, 250, 252, 0.8);
}

.preview-phase-chip em,
.preview-phase-chip strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: normal;
}

.preview-phase-chip em {
  margin-bottom: 4px;
  font-size: 8px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.preview-phase-chip strong {
  font-size: 12px;
  font-weight: 900;
  color: var(--text-primary);
}

.preview-phase-chip.success {
  border-color: rgba(16, 185, 129, 0.18);
  background: rgba(16, 185, 129, 0.08);
}

.preview-phase-chip.warning {
  border-color: rgba(245, 158, 11, 0.2);
  background: rgba(245, 158, 11, 0.08);
}

.preview-phase-chip.error {
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.08);
}

.preview-params {
  margin-top: 20px;
  padding: 20px;
  background: #1e293b;
  color: #e2e8f0;
  border-radius: 16px;
  font-size: 16px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  overflow-x: auto;
  line-height: 1.7;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.run-history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.run-history-entry {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.run-history-item {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid rgba(226, 232, 240, 0.65);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.58);
}

.run-history-main {
  min-width: 0;
  flex: 1;
}

.run-history-top,
.run-history-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.run-history-top {
  margin-bottom: 6px;
}

.run-history-top strong {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
}

.run-history-status {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(100, 116, 139, 0.1);
  color: #64748b;
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.run-history-status.succeeded {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
}

.run-history-status.failed {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

.run-history-meta,
.run-history-inputs {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.45;
}

.run-history-meta span,
.run-history-inputs {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-reuse-btn {
  flex-shrink: 0;
  height: 34px;
  padding: 0 12px;
  border-radius: 11px;
  border: 1px solid rgba(16, 185, 129, 0.22);
  background: rgba(16, 185, 129, 0.08);
  color: #059669;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.history-memory-btn {
  flex-shrink: 0;
  height: 34px;
  padding: 0 12px;
  border-radius: 11px;
  border: 1px solid rgba(59, 130, 246, 0.18);
  background: rgba(59, 130, 246, 0.08);
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.history-memory-btn.saved {
  border-color: rgba(16, 185, 129, 0.22);
  background: rgba(16, 185, 129, 0.08);
  color: #059669;
}

.history-memory-btn.error {
  border-color: rgba(239, 68, 68, 0.18);
  background: rgba(239, 68, 68, 0.08);
  color: #dc2626;
}

.history-memory-btn.saving {
  opacity: 0.7;
}

.run-history-error {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(254, 242, 242, 0.8);
  color: #b91c1c;
  font-size: 12px;
  font-weight: 700;
}

.run-preset-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.run-preset-item {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid rgba(191, 219, 254, 0.7);
  border-radius: 16px;
  background: rgba(239, 246, 255, 0.68);
}

.run-preset-main {
  flex: 1;
  min-width: 0;
}

.run-preset-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-bottom: 5px;
}

.run-preset-top strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 900;
}

.run-preset-status {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.1);
  color: #1d4ed8;
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.run-preset-detail,
.run-preset-stats,
.run-preset-inputs {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.45;
}

.run-preset-stats {
  color: #2563eb;
}

.run-preset-btn {
  flex-shrink: 0;
  height: 34px;
  padding: 0 12px;
  border-radius: 11px;
  border: 1px solid rgba(59, 130, 246, 0.2);
  background: rgba(59, 130, 246, 0.09);
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.json-block {
  padding: 24px;
  background: #1e293b;
  color: #e2e8f0;
  border-radius: 20px;
  font-size: 16px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  overflow-x: auto;
  line-height: 1.7;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.empty-canvas {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f7f9fa;
}

.empty-hero {
  text-align: center;
  max-width: 520px;
  padding: 64px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  border-radius: 40px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.05);
}

.empty-hero h3 {
  font-size: 32px;
  font-weight: 900;
  color: var(--text-primary);
  margin-bottom: 20px;
  letter-spacing: -0.04em;
  line-height: 1.1;
}

.empty-hero p {
  color: var(--text-secondary);
  font-size: 17px;
  line-height: 1.7;
  margin-bottom: 40px;
  font-weight: 600;
  opacity: 0.8;
}

.create-btn-large {
  padding: 0 48px;
  height: 60px;
  background: #10b981;
  color: white;
  border: none;
  border-radius: 20px;
  font-size: 16px;
  font-weight: 900;
  cursor: pointer;
  box-shadow: 0 16px 40px rgba(16, 185, 129, 0.3);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.create-btn-large:hover {
  background: #059669;
  transform: translateY(-6px) scale(1.02);
  box-shadow: 0 24px 64px rgba(16, 185, 129, 0.4);
}

.empty-panel {
  text-align: center;
  padding: 80px 0;
  font-size: 15px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.4;
}

/* Scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.08);
  border-radius: 10px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
}
</style>
