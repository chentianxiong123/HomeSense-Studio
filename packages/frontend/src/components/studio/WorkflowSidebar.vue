<script setup lang="ts">
import { computed } from 'vue'
import ManifestExplorer from '../ManifestExplorer.vue'
import {
  formatNodeLabel,
  formatNodeDescription,
} from '../../features/studio/studioNodeDisplay'
import {
  formatShowcaseBadge,
  formatShowcaseEyebrow,
} from '../../features/studio/studioViewDisplay'

const props = defineProps<{
  workflows: any[]
  currentWorkflow: any | null
  workflowCollectionMetrics: any[]
  workflowShowcase: any[]
  workbenchWorkflows: any[]
  mainlineHeading: any
  workbenchHeading: any
  nodeLibrarySections: any[]
  availablePlans: any[]
  t: (key: any, vars?: any) => string
  label: (zh: string, en: string) => string
  workflowDescription: (wf: any) => string
}>()

const emit = defineEmits<{
  (e: 'reseed'): void
  (e: 'create'): void
  (e: 'select-workflow', id: number): void
  (e: 'apply-plan', id: string): void
  (e: 'dragstart', event: DragEvent, type: string, label: string): void
}>()

function onDragStart(event: DragEvent, type: string, label: string) {
  emit('dragstart', event, type, label)
}
</script>

<template>
  <aside class="workflow-sidebar custom-scrollbar">
    <section class="sidebar-section">
      <div class="section-head">
        <h4>{{ t('studio.workflows') }}</h4>
        <div class="section-actions">
          <button class="ghost-btn" @click="emit('reseed')">{{ t('studio.reseed') }}</button>
          <button class="create-btn" @click="emit('create')">{{ t('studio.new') }}</button>
        </div>
      </div>
      <div class="workflow-metrics">
        <div
          v-for="metric in workflowCollectionMetrics"
          :key="metric.label"
          class="workflow-metric-card"
        >
          <span class="workflow-metric-label">{{ metric.label }}</span>
          <strong class="workflow-metric-value">{{ metric.value }}</strong>
        </div>
      </div>
      <div v-if="workflows.length === 0" class="empty">{{ label('当前还没有工作流。', 'No workflows yet.') }}</div>

      <!-- Featured Workflows -->
      <div v-if="workflowShowcase.length > 0" class="workflow-group">
        <div class="group-heading">
          <div class="group-label">{{ mainlineHeading.title }}</div>
          <div class="group-summary">{{ mainlineHeading.summary }}</div>
        </div>
        <button
          v-for="workflow in workflowShowcase"
          :key="workflow.id"
          :class="['workflow-item', 'featured', `lane-${workflow.lane}`, { active: currentWorkflow?.id === workflow.id }]"
          @click="emit('select-workflow', workflow.id)"
        >
          <div class="workflow-top">
            <span class="wf-name">{{ workflow.name }}</span>
            <span class="workflow-badge">{{ formatShowcaseBadge(workflow.badge, label) }}</span>
          </div>
          <div class="workflow-subline">
            <span class="workflow-eyebrow">{{ formatShowcaseEyebrow(workflow.eyebrow, label) }}</span>
            <span v-if="workflow.published" class="published-badge">{{ label('已发布', 'Live') }}</span>
          </div>
          <span class="workflow-desc">{{ workflowDescription(workflow) }}</span>
        </button>
      </div>

      <!-- Workbench Workflows -->
      <div v-if="workbenchWorkflows.length > 0" class="workflow-group">
        <div class="group-heading">
          <div class="group-label">{{ workbenchHeading.title }}</div>
          <div class="group-summary">{{ workbenchHeading.summary }}</div>
        </div>
        <button
          v-for="workflow in workbenchWorkflows"
          :key="workflow.id"
          :class="['workflow-item', 'compact', { active: currentWorkflow?.id === workflow.id }]"
          @click="emit('select-workflow', workflow.id)"
        >
          <div class="workflow-top">
            <span class="wf-name">{{ workflow.name }}</span>
            <span v-if="workflow.published" class="published-badge">{{ label('已发布', 'Live') }}</span>
          </div>
          <span v-if="workflow.description" class="workflow-desc">{{ workflow.description }}</span>
        </button>
      </div>
    </section>

    <!-- Node Library -->
    <section class="sidebar-section">
      <h4>{{ t('studio.nodeLibrary') }}</h4>
      <div
        v-for="section in nodeLibrarySections"
        :key="section.key"
        class="node-library-group"
      >
        <div class="group-label">{{ section.title }}</div>
        <div
          v-for="nodeType in section.nodes"
          :key="nodeType.type"
          class="node-type-item"
          draggable="true"
          :style="{ borderLeftColor: nodeType.color }"
          @dragstart="onDragStart($event, nodeType.type, formatNodeLabel(nodeType.type, nodeType.label, label))"
        >
          <span class="nt-icon">{{ nodeType.icon }}</span>
          <div class="nt-meta">
            <span class="nt-label">{{ formatNodeLabel(nodeType.type, nodeType.label, label) }}</span>
            <span v-if="nodeType.description" class="nt-desc">{{ formatNodeDescription(nodeType.type, nodeType.description, label) }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Compiled Plans -->
    <section class="sidebar-section">
      <h4>{{ t('studio.compiledPlans') }}</h4>
      <div v-if="availablePlans.length === 0" class="empty">{{ t('studio.noPlans') }}</div>
      <button
        v-for="plan in availablePlans"
        :key="String(plan.id)"
        class="plan-item"
        @click="emit('apply-plan', String(plan.id))"
      >
        <span class="plan-name">{{ String(plan.name) }}</span>
        <span class="plan-input">{{ String(plan.input ?? '') }}</span>
      </button>
    </section>

    <!-- Execution Fabric -->
    <section class="sidebar-section">
      <h4>{{ t('studio.executionFabric') }}</h4>
      <ManifestExplorer layout="sidebar" />
    </section>
  </aside>
</template>

<style scoped>
.workflow-sidebar {
  width: 300px;
  border-right: 1px solid rgba(229, 231, 235, 0.4);
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(48px);
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  z-index: 15;
  box-shadow: 8px 0 40px rgba(0, 0, 0, 0.04);
}

.sidebar-section {
  padding: 40px 24px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.5);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
}

.sidebar-section h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

.section-actions {
  display: flex;
  gap: 10px;
}

.workflow-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 28px;
}

.workflow-metric-card {
  padding: 14px 4px;
  border: 1px solid rgba(236, 239, 242, 0.8);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(16px);
  text-align: center;
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
}

.workflow-metric-card:hover {
  background: rgba(255, 255, 255, 0.85);
  transform: translateY(-3px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.05);
  border-color: rgba(16, 185, 129, 0.25);
}

.workflow-metric-label {
  display: block;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 6px;
  letter-spacing: 0.08em;
}

.workflow-metric-value {
  font-size: 20px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.03em;
}

.create-btn {
  padding: 8px 16px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.25);
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.create-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.35);
}

.ghost-btn {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(217, 217, 217, 0.5);
  border-radius: 12px;
  font-size: 15px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.ghost-btn:hover {
  background: #fff;
  border-color: var(--text-tertiary);
  color: var(--text-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
}

.workflow-group {
  margin-bottom: 36px;
}

.workflow-group:last-child {
  margin-bottom: 0;
}

.group-heading {
  margin-bottom: 18px;
}

.group-label {
  font-size: 14px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.group-summary {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-secondary);
  margin-top: 4px;
  opacity: 0.75;
  line-height: 1.5;
}

.workflow-item {
  width: 100%;
  text-align: left;
  padding: 18px;
  margin-bottom: 14px;
  border: 1px solid rgba(236, 239, 242, 0.6);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(16px);
  cursor: pointer;
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
}

.workflow-item:hover {
  border-color: rgba(16, 185, 129, 0.4);
  background: rgba(255, 255, 255, 0.85);
  transform: scale(1.02) translateY(-3px);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.06);
}

.workflow-item.active {
  border-color: rgba(16, 185, 129, 0.5);
  background: #fff;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1), 0 12px 24px rgba(0, 0, 0, 0.04);
}

.workflow-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.wf-name {
  font-size: 16px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.workflow-badge {
  font-size: 13px;
  padding: 4px 12px;
  background: rgba(241, 245, 249, 0.8);
  border-radius: 99px;
  color: var(--text-secondary);
  text-transform: uppercase;
  font-weight: 900;
  letter-spacing: 0.06em;
  border: 1px solid rgba(0,0,0,0.04);
}

.workflow-subline {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.workflow-eyebrow {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.published-badge {
  font-size: 13px;
  color: #10b981;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.workflow-desc {
  font-size: 16px;
  color: var(--text-secondary);
  display: block;
  line-height: 1.6;
  font-weight: 600;
  opacity: 0.8;
}

.node-library-group {
  margin-top: 28px;
}

.node-type-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  margin-bottom: 12px;
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid rgba(236, 239, 242, 0.6);
  border-left-width: 5px;
  border-radius: 16px;
  cursor: grab;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(12px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
}

.node-type-item:hover {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(16, 185, 129, 0.4);
  transform: translateX(6px) scale(1.02);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.04);
}

.node-type-item:active {
  cursor: grabbing;
  transform: scale(0.97);
}

.nt-icon {
  font-size: 20px;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
}

.nt-label {
  font-size: 15px;
  font-weight: 900;
  color: var(--text-primary);
  display: block;
  letter-spacing: -0.01em;
}

.nt-desc {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-tertiary);
  margin-top: 3px;
  display: block;
  line-height: 1.4;
}

.plan-item {
  width: 100%;
  text-align: left;
  padding: 16px;
  margin-top: 14px;
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid rgba(236, 239, 242, 0.6);
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(12px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
}

.plan-item:hover {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(16, 185, 129, 0.4);
  transform: translateY(-3px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.05);
}

.plan-name {
  display: block;
  font-size: 15px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.plan-input {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  margin-top: 6px;
  display: block;
  opacity: 0.8;
}

.empty {
  padding: 48px 0;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-tertiary);
  opacity: 0.55;
  letter-spacing: 0.02em;
}

/* Scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.06);
  border-radius: 10px;
}

.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
}
</style>
