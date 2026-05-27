<script setup lang="ts">
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
  activeRunId: number | null
  runInputsText: string
  runInputError: string | null
  workflowHeaderChips: any[]
  workflowEditorSummaryItems: any[]
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
  (e: 'preview'): void
  (e: 'run'): void
  (e: 'delete'): void
  (e: 'create'): void
  (e: 'select-trace-node', nodeId: string): void
  (e: 'update:runInputsText', value: string): void
  (e: 'update-active-steps', nodeIds: Set<string>): void
}>()

function handleActiveSteps(nodeIds: Set<string>) {
  emit('update-active-steps', nodeIds)
}

function handleNodeClick(event: any) { emit('node-click', event) }
function handlePaneClick(event: any) { emit('pane-click', event) }
function handleDragOver(event: DragEvent) { emit('dragover', event) }
function handleDrop(event: DragEvent) { emit('drop', event) }
function handleNodeDragStop(event: any) { emit('node-drag-stop', event) }
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
                  class="preview-step"
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
                    <span v-if="step.executor_name">{{ step.executor_name }}</span>
                    <span v-if="step.cli_name">{{ step.cli_name }}</span>
                    <span v-if="step.target">{{ step.target }}</span>
                    <span v-if="step.action">{{ step.action }}</span>
                  </div>
                  <pre v-if="step.params && Object.keys(step.params).length" class="preview-params">{{ JSON.stringify(step.params, null, 2) }}</pre>
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
            />
            <div v-else-if="!latestPreview" class="empty-panel">{{ t('studio.emptyRun') }}</div>
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
  gap: 12px;
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
