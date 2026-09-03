<script setup lang="ts">
import { computed } from 'vue'
import type { ToolCallState } from '../../composables/useChat'
import { buildWorkflowToolSummary } from '../../features/chat/workflowToolSummary'

const props = defineProps<{
  toolCall: ToolCallState
  locale: string
}>()

const emit = defineEmits<{ (event: 'toggle'): void }>()

const deviceCard = computed(() => props.toolCall.device?.card ?? props.toolCall.result?.device?.card ?? null)
const workflowSummary = computed(() => buildWorkflowToolSummary(props.toolCall, label))

function deviceRoom(): string {
  return deviceCard.value?.room?.name || props.toolCall.device?.room || ''
}

function deviceSources(): string[] {
  return Array.isArray(deviceCard.value?.sources) ? deviceCard.value.sources : []
}

function deviceStatus(): string {
  return deviceCard.value?.display?.status ?? 'unknown'
}

function stepLabel(): string {
  if (props.toolCall.name === 'context-command') return props.locale === 'zh' ? '真实执行' : 'Execution'
  if (props.toolCall.name === 'execute_device_capability') return props.locale === 'zh' ? '真实执行' : 'Execution'
  if (props.toolCall.name === 'get_device_type_skill') return props.locale === 'zh' ? '加载设备 Skill' : 'Load Device Skill'
  if (props.toolCall.name === 'get_device_capabilities') return props.locale === 'zh' ? '加载设备能力' : 'Load Capabilities'
  if (props.toolCall.name === 'list_user_devices') return props.locale === 'zh' ? '读取设备列表' : 'List Devices'
  if (props.toolCall.name === 'list_workflows') return props.locale === 'zh' ? '读取工作流' : 'List Workflows'
  if (props.toolCall.name === 'preview_workflow') return props.locale === 'zh' ? '预演工作流' : 'Preview Workflow'
  if (props.toolCall.name === 'run_workflow') return props.locale === 'zh' ? '执行工作流' : 'Run Workflow'
  return friendlyToolName(props.toolCall.name)
}

function outcomeLabel(): string {
  const tc = props.toolCall
  if (tc.status === 'running') return props.locale === 'zh' ? '运行中' : 'Running'
  if (tc.status === 'error') return props.locale === 'zh' ? '失败' : 'Failed'
  if (tc.name === 'preview_workflow') {
    return tc.result?.executable === false
      ? (props.locale === 'zh' ? '阻塞' : 'Blocked')
      : (props.locale === 'zh' ? '可执行' : 'Executable')
  }
  if (tc.name === 'run_workflow') {
    return tc.result?.run?.status === 'succeeded'
      ? (props.locale === 'zh' ? '完成' : 'Done')
      : (props.locale === 'zh' ? '阻塞' : 'Blocked')
  }
  return props.locale === 'zh' ? '完成' : 'Done'
}

function capabilityList(): any[] {
  const caps = props.toolCall.result?.capabilities
    ?? props.toolCall.result?.data?.capabilities
    ?? props.toolCall.result?.output?.capabilities
  return Array.isArray(caps) ? caps.slice(0, 10) : []
}

function capabilityCount(): number {
  const caps = props.toolCall.result?.capabilities
    ?? props.toolCall.result?.data?.capabilities
    ?? props.toolCall.result?.output?.capabilities
  return Array.isArray(caps) ? caps.length : 0
}

function isCapabilityLoad(): boolean {
  return props.toolCall.name === 'get_device_capabilities'
}

function isDeviceTypeSkillLoad(): boolean {
  return props.toolCall.name === 'get_device_type_skill'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function friendlyToolName(name: string): string {
  const normalized = name
    .replace(/^service\./, props.locale === 'zh' ? '服务 ' : 'Service ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return props.locale === 'zh' ? '工具调用' : 'Tool Call'
  if (/^adb cli$/i.test(normalized)) return 'ADB CLI'
  if (/^mi cli$/i.test(normalized)) return 'Mi CLI'
  return normalized
    .split(' ')
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
    .join(' ')
}

function hasRawArguments(): boolean {
  return isRecord(props.toolCall.args) && Object.keys(props.toolCall.args).length > 0
}

function argumentSummary(): string {
  const args = isRecord(props.toolCall.args) ? props.toolCall.args : {}
  const entries = Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 4)

  if (entries.length === 0) return props.locale === 'zh' ? '无参数' : 'No arguments'

  const suffix = Object.keys(args).length > entries.length ? ' ...' : ''
  return entries
    .map(([key, value]) => `${key}: ${briefValue(value)}`)
    .join(' · ') + suffix
}

function briefValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return props.locale === 'zh' ? `${value.length} 项` : `${value.length} items`
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined && item !== null && item !== '')
      .slice(0, 3)
    if (entries.length === 0) return '{}'
    const suffix = Object.keys(value).length > entries.length ? ', ...' : ''
    return `{${entries.map(([key, item]) => `${key}=${briefValue(item)}`).join(', ')}${suffix}}`
  }
  return String(value)
}

function hasRawResult(): boolean {
  if (isDeviceTypeSkillLoad() && props.toolCall.status === 'success') return Boolean(props.toolCall.error)
  return Boolean(props.toolCall.result || props.toolCall.error)
}

function skillPreferredTools(): string[] {
  const tools = props.toolCall.result?.preferred_tools
  return Array.isArray(tools) ? tools.map((item: unknown) => String(item)).filter(Boolean).slice(0, 6) : []
}

function label(zh: string, en: string): string {
  return props.locale === 'zh' ? zh : en
}

function workflowToneClass(): string {
  return workflowSummary.value?.tone ?? 'neutral'
}

function workflowPhaseTone(tone: string): string {
  if (tone === 'success') return 'success'
  if (tone === 'error') return 'error'
  if (tone === 'warning') return 'warning'
  return 'neutral'
}
</script>

<template>
  <div :class="['tool-card', toolCall.status, { collapsed: !toolCall.expanded }]">
    <div class="tool-header" @click="emit('toggle')">
      <span class="tool-status-icon">
        <span v-if="toolCall.status === 'running'" class="tool-spinner"></span>
        <span v-else-if="toolCall.status === 'success'" class="tool-success-check">✓</span>
        <span v-else class="tool-error-cross">✗</span>
      </span>
      <span class="tool-name">{{ stepLabel() }}</span>
      <span class="tool-toggle-icon">
        <svg :style="{ transform: toolCall.expanded ? 'rotate(90deg)' : '' }" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </span>
    </div>
    <div v-show="toolCall.expanded" class="tool-body">
      <div v-if="deviceCard" class="tool-device-card">
        <div class="tool-device-head">
          <span :class="['tool-device-status', deviceStatus()]"></span>
          <div class="tool-device-main">
            <strong>{{ deviceCard.display?.title || deviceCard.name }}</strong>
            <span>{{ [deviceRoom(), deviceCard.device_type].filter(Boolean).join(' · ') }}</span>
          </div>
          <span :class="['tool-outcome', toolCall.status]">{{ outcomeLabel() }}</span>
        </div>
        <div class="tool-device-meta">
          <span>{{ stepLabel() }}</span>
          <span v-if="toolCall.capability || toolCall.result?.capability">{{ toolCall.capability || toolCall.result?.capability }}</span>
          <span v-for="source in deviceSources()" :key="source">{{ source }}</span>
        </div>
        <div v-if="toolCall.predictedEffect" class="tool-device-note">{{ toolCall.predictedEffect }}</div>
        <div v-if="toolCall.nextStep" class="tool-device-note muted">{{ toolCall.nextStep }}</div>
      </div>
      <div v-if="workflowSummary" class="workflow-summary-card">
        <div class="workflow-summary-head">
          <div class="workflow-summary-main">
            <strong>{{ workflowSummary.title }}</strong>
            <span v-if="workflowSummary.subtitle">{{ workflowSummary.subtitle }}</span>
          </div>
          <span :class="['tool-outcome', workflowToneClass()]">{{ outcomeLabel() }}</span>
        </div>
        <div v-if="workflowSummary.phases?.length" class="workflow-phase-row">
          <span
            v-for="phase in workflowSummary.phases"
            :key="phase.label"
            :class="['workflow-phase-chip', workflowPhaseTone(phase.tone)]"
          >
            <em>{{ phase.label }}</em>
            <strong>{{ phase.value }}</strong>
          </span>
        </div>
        <div v-if="workflowSummary.rows.length" class="workflow-rows">
          <div v-for="row in workflowSummary.rows" :key="row.label" class="workflow-row">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
        <div v-if="workflowSummary.workflows?.length" class="workflow-list">
          <div v-for="(item, index) in workflowSummary.workflows" :key="`${item.title}-${index}`" class="workflow-list-item">
            <div class="workflow-list-main">
              <strong>{{ item.title }}</strong>
              <span v-if="item.detail">{{ item.detail }}</span>
            </div>
            <div v-if="item.tags.length" class="workflow-tags">
              <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
            </div>
          </div>
        </div>
        <div v-if="workflowSummary.steps?.length" class="workflow-step-list">
          <div v-for="(step, index) in workflowSummary.steps" :key="`${step.title}-${index}`" class="workflow-step-item">
            <div class="workflow-step-head">
              <strong>{{ step.title }}</strong>
              <span :class="['workflow-step-tone', workflowPhaseTone(step.tone)]"></span>
            </div>
            <span v-if="step.detail">{{ step.detail }}</span>
          </div>
        </div>
        <div v-if="workflowSummary.warnings?.length" class="workflow-warning-list">
          <span v-for="(warning, index) in workflowSummary.warnings" :key="`${warning}-${index}`">{{ warning }}</span>
        </div>
      </div>
      <div v-if="isCapabilityLoad() && capabilityCount() > 0" class="capability-summary">
        <div class="tool-section-title">{{ locale === 'zh' ? '能力已加载' : 'Capabilities Loaded' }}</div>
        <div class="capability-pills">
          <span v-for="cap in capabilityList()" :key="cap.capability_id || cap.name">
            {{ cap.name || cap.capability_id }}
          </span>
        </div>
        <div v-if="capabilityCount() > capabilityList().length" class="capability-more">
          +{{ capabilityCount() - capabilityList().length }} more
        </div>
      </div>
      <div v-if="isDeviceTypeSkillLoad() && toolCall.result" class="skill-summary">
        <div class="tool-section-title">{{ locale === 'zh' ? '设备 Skill 已加载' : 'Device Skill Loaded' }}</div>
        <div class="skill-main">
          <strong>{{ toolCall.result.title || toolCall.result.id || toolCall.args?.device_type }}</strong>
          <span>{{ toolCall.result.summary || (locale === 'zh' ? '无摘要' : 'No summary') }}</span>
        </div>
        <div v-if="toolCall.result.when_to_load" class="tool-device-note">
          {{ toolCall.result.when_to_load }}
        </div>
        <div v-if="skillPreferredTools().length > 0" class="capability-pills skill-tools">
          <span v-for="tool in skillPreferredTools()" :key="tool">{{ tool }}</span>
        </div>
      </div>
      <div class="tool-section">
        <div class="tool-section-title">{{ locale === 'zh' ? '参数' : 'Arguments' }}</div>
        <div class="tool-arg-summary">{{ argumentSummary() }}</div>
        <details v-if="hasRawArguments()" class="tool-raw compact">
          <summary>{{ locale === 'zh' ? '原始参数' : 'Raw Arguments' }}</summary>
          <pre class="tool-code">{{ JSON.stringify(toolCall.args, null, 2) }}</pre>
        </details>
      </div>
      <details v-if="hasRawResult()" class="tool-raw">
        <summary>{{ locale === 'zh' ? '原始结果' : 'Raw Result' }}</summary>
        <pre v-if="toolCall.result" class="tool-code">{{ JSON.stringify(toolCall.result, null, 2) }}</pre>
        <pre v-if="toolCall.error" class="tool-code error">{{ toolCall.error }}</pre>
      </details>
    </div>
  </div>
</template>

<style scoped>
.tool-card {
  border-radius: 16px;
  overflow: hidden;
  border: 1px solid rgba(229, 231, 235, 0.3);
  background: transparent;
  transition: all 0.3s;
}
.tool-card.running { border-color: rgba(59, 130, 246, 0.3); background: rgba(59, 130, 246, 0.03); }
.tool-card.success { border-color: rgba(16, 185, 129, 0.3); background: rgba(16, 185, 129, 0.03); }
.tool-card.error { border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.03); }
.tool-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
}
.tool-header:hover { background: rgba(0, 0, 0, 0.02); }
.tool-status-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tool-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(59, 130, 246, 0.2);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.tool-success-check { color: #10b981; font-weight: bold; font-size: 14px; }
.tool-error-cross { color: #ef4444; font-weight: bold; font-size: 14px; }
.tool-name {
  font-size: 12px;
  font-weight: 800;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--text-primary);
  flex: 1;
}
.tool-toggle-icon {
  display: flex;
  align-items: center;
  color: var(--text-tertiary);
  transition: transform 0.2s;
}
.tool-body {
  padding: 0 14px 14px;
  border-top: 1px solid rgba(0, 0, 0, 0.03);
}
.tool-device-card {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.55);
}
.tool-device-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.tool-device-status {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #cbd5e1;
  flex-shrink: 0;
}
.tool-device-status.online { background: #10b981; }
.tool-device-status.offline { background: #ef4444; }
.tool-device-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tool-device-main strong {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-device-main span,
.tool-device-note {
  font-size: 12px;
  line-height: 1.45;
  font-weight: 700;
  color: var(--text-secondary);
}
.tool-outcome {
  padding: 2px 8px;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  color: #64748b;
  background: rgba(100, 116, 139, 0.1);
}
.tool-outcome.success { color: #059669; background: rgba(16, 185, 129, 0.12); }
.tool-outcome.error { color: #dc2626; background: rgba(239, 68, 68, 0.12); }
.tool-outcome.running { color: #2563eb; background: rgba(59, 130, 246, 0.12); }
.tool-outcome.warning { color: #d97706; background: rgba(245, 158, 11, 0.12); }
.tool-outcome.neutral { color: #64748b; background: rgba(100, 116, 139, 0.1); }
.tool-device-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}
.tool-device-meta span {
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.05);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 900;
}
.tool-device-note { margin-top: 8px; }
.tool-device-note.muted { color: var(--text-tertiary); }
.workflow-summary-card {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid rgba(59, 130, 246, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.52);
}
.workflow-summary-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.workflow-summary-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.workflow-summary-main strong {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
}
.workflow-summary-main span {
  font-size: 12px;
  line-height: 1.45;
  font-weight: 700;
  color: var(--text-secondary);
}
.workflow-phase-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}
.workflow-phase-chip {
  min-width: 0;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid rgba(226, 232, 240, 0.6);
  background: rgba(248, 250, 252, 0.82);
}
.workflow-phase-chip em,
.workflow-phase-chip strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: normal;
}
.workflow-phase-chip em {
  margin-bottom: 4px;
  font-size: 8px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.workflow-phase-chip strong {
  font-size: 12px;
  font-weight: 900;
  color: var(--text-primary);
}
.workflow-phase-chip.success { border-color: rgba(16, 185, 129, 0.18); background: rgba(16, 185, 129, 0.08); }
.workflow-phase-chip.warning { border-color: rgba(245, 158, 11, 0.2); background: rgba(245, 158, 11, 0.08); }
.workflow-phase-chip.error { border-color: rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.08); }
.workflow-phase-chip.neutral { border-color: rgba(148, 163, 184, 0.18); background: rgba(148, 163, 184, 0.07); }
.workflow-rows {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}
.workflow-row {
  min-width: 0;
  padding: 8px 9px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.035);
}
.workflow-row span {
  display: block;
  margin-bottom: 4px;
  font-size: 8px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}
.workflow-row strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 800;
  color: var(--text-secondary);
}
.workflow-list,
.workflow-step-list,
.workflow-warning-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.workflow-list-item,
.workflow-step-item {
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid rgba(226, 232, 240, 0.55);
  background: rgba(255, 255, 255, 0.55);
}
.workflow-list-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.workflow-step-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.workflow-list-main strong,
.workflow-step-head strong {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
}
.workflow-list-main span,
.workflow-step-item > span {
  font-size: 12px;
  line-height: 1.45;
  font-weight: 700;
  color: var(--text-secondary);
}
.workflow-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.workflow-tags span {
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.08);
  color: #2563eb;
  font-size: 10px;
  font-weight: 900;
}
.workflow-step-tone {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #94a3b8;
}
.workflow-step-tone.success { background: #10b981; }
.workflow-step-tone.warning { background: #f59e0b; }
.workflow-step-tone.error { background: #ef4444; }
.workflow-warning-list span {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.08);
  color: #92400e;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
}
.capability-summary {
  margin-top: 12px;
  padding: 10px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.035);
}
.skill-summary {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid rgba(124, 58, 237, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.52);
}
.skill-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.skill-main strong {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
}
.skill-main span {
  font-size: 12px;
  line-height: 1.5;
  font-weight: 700;
  color: var(--text-secondary);
}
.capability-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.capability-pills span {
  padding: 3px 7px;
  border-radius: 6px;
  background: rgba(16, 185, 129, 0.1);
  color: #047857;
  font-size: 11px;
  font-weight: 900;
}
.skill-tools span {
  background: rgba(124, 58, 237, 0.09);
  color: #6d28d9;
}
.capability-more {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 900;
  color: var(--text-tertiary);
}
.tool-section { margin-top: 10px; }
.tool-section-title {
  font-size: 10px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 4px;
}
.tool-arg-summary {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.035);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.tool-raw {
  margin-top: 10px;
}
.tool-raw.compact {
  margin-top: 8px;
}
.tool-raw summary {
  cursor: pointer;
  font-size: 11px;
  font-weight: 900;
  color: var(--text-tertiary);
  user-select: none;
}
.tool-code {
  margin: 0;
  padding: 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.03);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-wrap;
  overflow-x: auto;
}
.tool-code.error { background: rgba(239, 68, 68, 0.05); color: #ef4444; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
