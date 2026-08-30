<script setup lang="ts">
import type { RuntimeTraceEvent } from '../../composables/useChat'
import { buildWorkflowToolSummary, type WorkflowToolSummary } from '../../features/chat/workflowToolSummary'

defineProps<{
  trace: RuntimeTraceEvent[]
  expanded: boolean
}>()

const emit = defineEmits<{ (event: 'toggle'): void }>()

function traceSummary(trace: RuntimeTraceEvent[]): { label: string; status: string; confidence?: number } {
  const decision = trace.find((item) => item.stage === 'runtime.decision')
  if (!decision) return { label: 'TRACE', status: 'pending' }
  if (decision.status === 'execute') {
    if (decision.data?.kind === 'llm_primary') {
      return { label: '模型回答', status: 'hit', confidence: decision.confidence }
    }
    return {
      label: '路径已确定',
      status: 'hit',
      confidence: decision.confidence,
    }
  }
  if (decision.status === 'fallback') return { label: '模型接管', status: 'fallback', confidence: decision.confidence }
  if (decision.status === 'error') return { label: '异常', status: 'error', confidence: decision.confidence }
  return { label: 'TRACE', status: decision.status, confidence: decision.confidence }
}

function traceIntentLabel(trace: RuntimeTraceEvent[]): string {
  const intent = trace.find((item) => item.stage === 'runtime.intent')
  if (!intent) return ''
  const kind = intentKindLabel(String(intent.title ?? '').replace(/^Intent:\s*/, ''))
  const policy = contextPolicyLabel(String(intent.data?.context_policy ?? ''))
  const tools = intent.data?.allow_tools === true ? '工具可用' : '仅对话'
  return [kind, policy, tools].filter(Boolean).join(' · ')
}

function intentKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    chat: '闲聊',
    device_control: '设备控制',
    device_query: '设备查询',
    ambiguous_device_action: '动作待确认',
    memory_note: '记忆线索',
    meta: '助手说明',
  }
  return labels[kind] ?? kind
}

function contextPolicyLabel(policy: string): string {
  const labels: Record<string, string> = {
    current_only: '只看本轮',
    light_recent: '轻量近期',
    recent: '带近期上下文',
    device_focused: '设备上下文',
  }
  return labels[policy] ?? policy
}

function formatConfidence(value?: number): string {
  if (typeof value !== 'number') return ''
  return value.toFixed(2)
}

function formatTraceData(data?: Record<string, unknown>): string {
  if (!data || Object.keys(data).length === 0) return ''
  return JSON.stringify(data, null, 2)
}

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    'runtime.intent': '意图识别',
    'runtime.context': '上下文',
    'runtime.l1.command': '快捷指令',
    'runtime.l1.rule': '固定规则',
    'runtime.l2.candidates': '经验候选',
    'runtime.decision': '路线选择',
    'runtime.l3.llm': '模型回答',
    'runtime.execution': '执行',
  }
  return labels[stage] ?? stage
}

function statusLabel(status: RuntimeTraceEvent['status']): string {
  const labels: Record<RuntimeTraceEvent['status'], string> = {
    hit: '命中',
    miss: '未命中',
    skipped: '跳过',
    execute: '执行',
    fallback: '模型接管',
    success: '完成',
    error: '失败',
    approval_required: '待确认',
  }
  return labels[status] ?? status
}

function displayTraceTitle(item: RuntimeTraceEvent): string {
  const raw = String(item.title ?? '')
  const mapped: Record<string, string> = {
    'Runtime Trace': '处理过程',
    'Device inventory loaded': '设备清单已读取',
    'Context completed': '上下文已准备',
    'Context compressed': '上下文已压缩',
    'No rule matched': '没有命中固定规则',
    'No candidate plan': '没有找到可复用路径',
    'Fallback to L3': '交给模型回答',
    'LLM fallback': '模型继续回答',
    'LLM skipped': '模型无需接管',
    'LLM failed': '模型调用失败',
    'LLM primary': '模型主导',
    'LLM primary after compression': '压缩后由模型处理',
    'LLM tool call': '准备调用工具',
    'LLM response': '直接回答',
    'Sandbox rehearsal': '沙箱演练',
    'L1 executed': '固定规则已执行',
    'L2 executed': '经验路径已执行',
  }
  const title = mapped[raw] ?? raw
  return title
    .replace(/\bL1\b/g, '快捷路径')
    .replace(/\bL2\b/g, '经验候选')
    .replace(/\bL3\b/g, '模型')
    .replace(/\bLLM\b/g, '模型')
    .replace(/\bRule #/g, '固定规则 #')
    .replace(/\sselected$/i, ' 已选择')
}

function displayTraceDetail(item: RuntimeTraceEvent): string {
  const raw = String(item.detail ?? '')
  if (!raw) return ''
  return raw
    .replace(/L2 recalled candidate paths; unified LLM will validate device, capability, and arguments\./g, '召回到候选路径；统一模型会继续校验设备、能力和参数。')
    .replace(/No executable L1\/L2 path met the runtime threshold\./g, '没有候选路径达到可直接执行的阈值。')
    .replace(/Input is not treated as a direct action intent\./g, '当前输入不被视为直接设备动作。')
    .replace(/Runtime fell back to L3 and answered without tool execution\./g, '本轮不需要执行工具，由模型直接回答。')
    .replace(/L1 selected an executable rule\./g, '已经选择可执行路径。')
    .replace(/\bL1\b/g, '快捷路径')
    .replace(/\bL2\b/g, '经验候选')
    .replace(/\bL3\b/g, '模型')
    .replace(/\bLLM\b/g, '模型')
}

function traceDeviceCard(item: RuntimeTraceEvent): any {
  const data = item.data as any
  return data?.device?.card ?? null
}

function traceDeviceStatus(item: RuntimeTraceEvent): string {
  return traceDeviceCard(item)?.display?.status ?? 'unknown'
}

function inventoryDevices(item: RuntimeTraceEvent): any[] {
  const devices = (item.data as any)?.devices
  return Array.isArray(devices) ? devices.slice(0, 8) : []
}

function hasInventory(item: RuntimeTraceEvent): boolean {
  return inventoryDevices(item).length > 0
}

function onlineText(value: boolean | null | undefined): string {
  if (value === true) return '在线'
  if (value === false) return '离线'
  return '未知'
}

function shouldShowRawData(item: RuntimeTraceEvent): boolean {
  if (!item.data || Object.keys(item.data).length === 0) return false
  if (hasInventory(item)) return false
  if (isSandboxTrace(item)) return false
  if (isWorkflowTrace(item)) return false
  if (hasL2Candidates(item)) return false
  if (item.stage === 'runtime.intent') return false
  if (item.stage === 'runtime.decision' && item.data.kind === 'llm_primary') return false
  return true
}

function l2Candidates(item: RuntimeTraceEvent): any[] {
  const candidates = (item.data as any)?.candidates
  return Array.isArray(candidates) ? candidates.slice(0, 5) : []
}

function hasL2Candidates(item: RuntimeTraceEvent): boolean {
  return item.stage === 'runtime.l2.candidates' && l2Candidates(item).length > 0
}

function candidateSourceLabel(source: string): string {
  if (source === 'memory') return '记忆路径'
  if (source === 'plan_library') return '计划库'
  if (source === 'compiled_knowledge') return '编译知识'
  return source || '候选'
}

function candidateEvidenceLabel(status: string): string {
  const labels: Record<string, string> = {
    proven: '已验证',
    regressed: '需复查',
    failing: '失败多',
    running: '运行中',
    untested: '未测试',
  }
  return labels[status] ?? status
}

function candidateEvidenceClass(status: string): string {
  if (status === 'proven') return 'proven'
  if (status === 'regressed') return 'regressed'
  if (status === 'failing') return 'failing'
  if (status === 'running') return 'running'
  return 'untested'
}

function candidateReuseScore(candidate: any): string {
  const score = Number(candidate.reuse_score)
  return Number.isFinite(score) && score > 0 ? score.toFixed(2) : ''
}

function candidateRefs(candidate: any): string[] {
  const refs = [
    ...(Array.isArray(candidate.device_refs) ? candidate.device_refs : []),
    ...(Array.isArray(candidate.skill_refs) ? candidate.skill_refs.map((ref: any) => ref.label || ref.id) : []),
  ]
  return refs.map((ref) => String(ref)).filter(Boolean).slice(0, 4)
}

function candidateStats(candidate: any): string[] {
  const stats: string[] = []
  if (candidate.workflow_id !== undefined && candidate.workflow_id !== null && candidate.workflow_id !== '') {
    stats.push(`workflow #${candidate.workflow_id}`)
  }
  if (typeof candidate.success_count === 'number') {
    stats.push(`成功 ${candidate.success_count}`)
  }
  if (typeof candidate.failure_count === 'number') {
    stats.push(`失败 ${candidate.failure_count}`)
  }
  return stats
}

function candidateSteps(candidate: any): string[] {
  const steps = Array.isArray(candidate.steps) ? candidate.steps : []
  return steps
    .map((step: any) => [step.tool, step.action].filter(Boolean).join('.'))
    .filter(Boolean)
    .slice(0, 4)
}

function isSandboxTrace(item: RuntimeTraceEvent): boolean {
  const title = String(item.title ?? '').toLowerCase()
  const data = item.data as any
  return item.stage === 'runtime.execution' && (
    title.includes('sandbox')
    || Boolean(data?.rehearsal)
    || data?.sandbox === true
  )
}

function sandboxData(item: RuntimeTraceEvent): any {
  const data = item.data as any
  return data?.rehearsal ?? data ?? {}
}

function sandboxDevice(item: RuntimeTraceEvent): any {
  return sandboxData(item)?.device?.card ?? sandboxData(item)?.device ?? traceDeviceCard(item)
}

function sandboxCapability(item: RuntimeTraceEvent): string {
  const data = sandboxData(item)
  return data.capability || data.capability_id || (item.data as any)?.capability || ''
}

function sandboxArgs(item: RuntimeTraceEvent): Record<string, unknown> {
  const data = sandboxData(item)
  const args = data.arguments ?? (item.data as any)?.arguments ?? {}
  return args && typeof args === 'object' && !Array.isArray(args) ? args : {}
}

function sandboxOk(item: RuntimeTraceEvent): boolean {
  const data = sandboxData(item)
  return item.status === 'success' && data.ok !== false && data.executable !== false
}

function sandboxEffect(item: RuntimeTraceEvent): string {
  return String(sandboxData(item)?.effect_summary ?? sandboxData(item)?.predicted_effect ?? '')
}

function sandboxNextStep(item: RuntimeTraceEvent): string {
  return String(sandboxData(item)?.next_step ?? '')
}

function sandboxChangedFields(item: RuntimeTraceEvent): any[] {
  const fields = sandboxData(item)?.changed_fields
  return Array.isArray(fields) ? fields.slice(0, 4) : []
}

function sandboxStatusLabel(item: RuntimeTraceEvent): string {
  if (item.status === 'error') return '演练失败'
  return sandboxOk(item) ? '演练通过' : '需要补充'
}

function sandboxStatusClass(item: RuntimeTraceEvent): string {
  if (item.status === 'error') return 'error'
  return sandboxOk(item) ? 'success' : 'blocked'
}

function formatInlineArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return '无参数'
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ')
}

function isWorkflowTrace(item: RuntimeTraceEvent): boolean {
  return Boolean((item.data as any)?.workflow_tool)
}

function workflowTraceSummary(item: RuntimeTraceEvent): WorkflowToolSummary | null {
  const workflowTool = (item.data as any)?.workflow_tool
  if (!workflowTool) return null
  return buildWorkflowToolSummary({
    call_id: `${item.stage}:${item.title}`,
    name: String(workflowTool.name ?? ''),
    args: workflowTool.args ?? {},
    status: workflowTool.status === 'error' ? 'error' : item.status === 'execute' ? 'running' : 'success',
    result: workflowTool.result,
    error: workflowTool.error,
  }, label)
}

function label(zh: string, _en: string): string {
  return zh
}

function workflowToneClass(tone: string): string {
  if (tone === 'success') return 'success'
  if (tone === 'error') return 'error'
  if (tone === 'warning') return 'warning'
  return 'neutral'
}
</script>

<template>
  <div class="trace-card" :class="[traceSummary(trace).status, { collapsed: !expanded }]">
    <button class="trace-toggle" @click="emit('toggle')">
      <svg :style="{ transform: expanded ? 'rotate(90deg)' : '' }" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
      <span class="trace-title">处理过程</span>
      <span v-if="traceIntentLabel(trace)" class="trace-intent">{{ traceIntentLabel(trace) }}</span>
      <span :class="['trace-badge', traceSummary(trace).status]">{{ traceSummary(trace).label }}</span>
      <span v-if="formatConfidence(traceSummary(trace).confidence)" class="trace-score">{{ formatConfidence(traceSummary(trace).confidence) }}</span>
    </button>
    <div v-show="expanded" class="trace-body">
      <div v-for="(item, index) in trace" :key="`${item.stage}-${item.title}-${index}`" class="trace-step">
        <div class="trace-step-head">
          <span :class="['trace-dot', item.status]"></span>
          <span class="trace-stage">{{ stageLabel(item.stage) }}</span>
          <span :class="['trace-status', item.status]">{{ statusLabel(item.status) }}</span>
          <span v-if="formatConfidence(item.confidence)" class="trace-confidence">{{ formatConfidence(item.confidence) }}</span>
        </div>
        <div class="trace-step-title">{{ displayTraceTitle(item) }}</div>
        <div v-if="displayTraceDetail(item)" class="trace-detail">{{ displayTraceDetail(item) }}</div>
        <div v-if="isSandboxTrace(item)" class="sandbox-card">
          <div class="sandbox-head">
            <span :class="['sandbox-status-dot', sandboxStatusClass(item)]"></span>
            <div class="sandbox-main">
              <strong>{{ sandboxCapability(item) || '设备能力' }}</strong>
              <span>{{ formatInlineArgs(sandboxArgs(item)) }}</span>
            </div>
            <span :class="['sandbox-badge', sandboxStatusClass(item)]">{{ sandboxStatusLabel(item) }}</span>
          </div>
          <div v-if="sandboxDevice(item)" class="sandbox-device">
            <span>{{ sandboxDevice(item).display?.title || sandboxDevice(item).name }}</span>
            <span>{{ [sandboxDevice(item).room?.name, sandboxDevice(item).device_type].filter(Boolean).join(' · ') }}</span>
          </div>
          <div v-if="sandboxEffect(item)" class="sandbox-note">{{ sandboxEffect(item) }}</div>
          <div v-if="sandboxChangedFields(item).length > 0" class="sandbox-changes">
            <span v-for="field in sandboxChangedFields(item)" :key="field.path">
              {{ field.path }}
            </span>
          </div>
          <div v-if="sandboxNextStep(item)" class="sandbox-note muted">{{ sandboxNextStep(item) }}</div>
        </div>
        <div v-if="workflowTraceSummary(item)" class="workflow-trace-card">
          <div class="workflow-trace-head">
            <div class="workflow-trace-main">
              <strong>{{ workflowTraceSummary(item)?.title }}</strong>
              <span v-if="workflowTraceSummary(item)?.subtitle">{{ workflowTraceSummary(item)?.subtitle }}</span>
            </div>
            <span :class="['workflow-trace-badge', workflowToneClass(workflowTraceSummary(item)?.tone || 'neutral')]">
              {{ workflowTraceSummary(item)?.tone === 'success' ? '完成' : workflowTraceSummary(item)?.tone === 'warning' ? '需确认' : workflowTraceSummary(item)?.tone === 'error' ? '失败' : '记录' }}
            </span>
          </div>
          <div v-if="workflowTraceSummary(item)?.phases?.length" class="workflow-trace-phases">
            <span
              v-for="phase in workflowTraceSummary(item)?.phases"
              :key="phase.label"
              :class="['workflow-trace-phase', workflowToneClass(phase.tone)]"
            >
              <em>{{ phase.label }}</em>
              <strong>{{ phase.value }}</strong>
            </span>
          </div>
          <div v-if="workflowTraceSummary(item)?.rows.length" class="workflow-trace-rows">
            <div v-for="row in workflowTraceSummary(item)?.rows" :key="row.label" class="workflow-trace-row">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
          <div v-if="workflowTraceSummary(item)?.workflows?.length" class="workflow-trace-list">
            <div
              v-for="(workflow, index) in workflowTraceSummary(item)?.workflows"
              :key="`${workflow.title}-${index}`"
              class="workflow-trace-list-item"
            >
              <strong>{{ workflow.title }}</strong>
              <span v-if="workflow.detail">{{ workflow.detail }}</span>
            </div>
          </div>
          <div v-if="workflowTraceSummary(item)?.steps?.length" class="workflow-trace-list">
            <div
              v-for="(step, index) in workflowTraceSummary(item)?.steps"
              :key="`${step.title}-${index}`"
              class="workflow-trace-list-item"
            >
              <strong>{{ step.title }}</strong>
              <span v-if="step.detail">{{ step.detail }}</span>
            </div>
          </div>
          <div v-if="workflowTraceSummary(item)?.warnings?.length" class="workflow-trace-warnings">
            <span
              v-for="(warning, index) in workflowTraceSummary(item)?.warnings"
              :key="`${warning}-${index}`"
            >
              {{ warning }}
            </span>
          </div>
        </div>
        <div v-if="hasL2Candidates(item)" class="candidate-stack">
          <article
            v-for="candidate in l2Candidates(item)"
            :key="candidate.id"
            :class="['candidate-card', candidate.source === 'memory' ? 'memory' : '']"
          >
            <div class="candidate-head">
              <span class="candidate-source">{{ candidateSourceLabel(candidate.source) }}</span>
              <strong>{{ candidate.title }}</strong>
              <span class="candidate-score">{{ formatConfidence(candidate.confidence) }}</span>
            </div>
            <div v-if="candidate.goal" class="candidate-goal">{{ candidate.goal }}</div>
            <div class="candidate-meta">
              <span
                v-if="candidate.evidence_status"
                :class="['candidate-evidence', candidateEvidenceClass(candidate.evidence_status)]"
              >
                {{ candidateEvidenceLabel(candidate.evidence_status) }}
              </span>
              <span v-if="candidateReuseScore(candidate)">复用 {{ candidateReuseScore(candidate) }}</span>
              <span :class="['candidate-exec', candidate.executable ? 'yes' : 'no']">
                {{ candidate.executable ? '可执行' : '需确认' }}
              </span>
              <span v-for="stat in candidateStats(candidate)" :key="stat">{{ stat }}</span>
              <span v-for="ref in candidateRefs(candidate)" :key="ref">{{ ref }}</span>
            </div>
            <div v-if="candidateSteps(candidate).length > 0" class="candidate-steps">
              <span v-for="step in candidateSteps(candidate)" :key="step">{{ step }}</span>
            </div>
          </article>
        </div>
        <div v-if="hasInventory(item)" class="inventory-grid">
          <div v-for="device in inventoryDevices(item)" :key="device.id" class="inventory-device">
            <span :class="['inventory-dot', device.online === true ? 'online' : device.online === false ? 'offline' : 'unknown']"></span>
            <div class="inventory-main">
              <strong>{{ device.name }}</strong>
              <span>{{ [device.room, device.device_type].filter(Boolean).join(' · ') || '未分组' }}</span>
            </div>
            <span class="inventory-state">{{ onlineText(device.online) }}</span>
          </div>
        </div>
        <div v-if="traceDeviceCard(item)" class="trace-device-row">
          <span :class="['trace-device-dot', traceDeviceStatus(item)]"></span>
          <strong>{{ traceDeviceCard(item).display?.title || traceDeviceCard(item).name }}</strong>
          <span>{{ [traceDeviceCard(item).room?.name, traceDeviceCard(item).device_type].filter(Boolean).join(' · ') }}</span>
        </div>
        <details v-if="shouldShowRawData(item)" class="trace-raw">
          <summary>原始数据</summary>
          <pre class="trace-code">{{ formatTraceData(item.data) }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trace-card {
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.35);
}
.trace-card.hit { border-color: rgba(16, 185, 129, 0.28); background: rgba(16, 185, 129, 0.035); }
.trace-card.fallback,
.trace-card.pending { border-color: rgba(59, 130, 246, 0.24); background: rgba(59, 130, 246, 0.035); }
.trace-card.error { border-color: rgba(239, 68, 68, 0.28); background: rgba(239, 68, 68, 0.035); }
.trace-card.collapsed .trace-body { display: none; }
.trace-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.2s;
}
.trace-toggle:hover { background: rgba(0, 0, 0, 0.025); }
.trace-toggle svg { flex-shrink: 0; color: var(--text-tertiary); transition: transform 0.2s; }
.trace-title {
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  text-align: left;
}
.trace-intent {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-align: left;
}
.trace-badge {
  padding: 2px 8px;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  background: rgba(100, 116, 139, 0.1);
  color: #64748b;
}
.trace-badge.hit { background: rgba(16, 185, 129, 0.12); color: #059669; }
.trace-badge.fallback,
.trace-badge.pending { background: rgba(59, 130, 246, 0.12); color: #2563eb; }
.trace-badge.error { background: rgba(239, 68, 68, 0.12); color: #dc2626; }
.trace-score {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  font-weight: 900;
  color: var(--text-tertiary);
}
.trace-body {
  padding: 2px 14px 14px;
  border-top: 1px solid rgba(0, 0, 0, 0.035);
}
.trace-step {
  position: relative;
  padding: 10px 0 10px 18px;
  border-left: 1px solid rgba(100, 116, 139, 0.18);
}
.trace-step:last-child { padding-bottom: 0; }
.trace-step-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.trace-dot {
  position: absolute;
  left: -4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94a3b8;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.8);
}
.trace-dot.hit,
.trace-dot.execute,
.trace-dot.success { background: #10b981; }
.trace-dot.fallback,
.trace-dot.skipped { background: #3b82f6; }
.trace-dot.error { background: #ef4444; }
.trace-dot.miss { background: #94a3b8; }
.trace-stage {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  font-weight: 800;
  color: var(--text-secondary);
  flex: 1;
  overflow-wrap: anywhere;
}
.trace-status,
.trace-confidence {
  font-size: 10px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.trace-status.hit,
.trace-status.execute,
.trace-status.success { color: #059669; }
.trace-status.fallback,
.trace-status.skipped { color: #2563eb; }
.trace-status.error { color: #dc2626; }
.trace-step-title {
  margin-top: 4px;
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
}
.trace-detail {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  font-weight: 600;
  color: var(--text-secondary);
  opacity: 0.85;
}
.sandbox-card {
  margin-top: 8px;
  padding: 10px;
  border: 1px solid rgba(14, 165, 233, 0.16);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(14, 165, 233, 0.055), rgba(255, 255, 255, 0.42));
}
.sandbox-head {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.sandbox-status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #94a3b8;
  flex-shrink: 0;
}
.sandbox-status-dot.success { background: #10b981; }
.sandbox-status-dot.blocked { background: #f59e0b; }
.sandbox-status-dot.error { background: #ef4444; }
.sandbox-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sandbox-main strong,
.sandbox-main span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sandbox-main strong {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
}
.sandbox-main span,
.sandbox-device span,
.sandbox-note {
  font-size: 12px;
  line-height: 1.45;
  font-weight: 700;
  color: var(--text-secondary);
}
.sandbox-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.06em;
}
.sandbox-badge.success { color: #047857; background: rgba(16, 185, 129, 0.12); }
.sandbox-badge.blocked { color: #b45309; background: rgba(245, 158, 11, 0.13); }
.sandbox-badge.error { color: #dc2626; background: rgba(239, 68, 68, 0.12); }
.sandbox-device {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.sandbox-device span {
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.05);
}
.sandbox-note { margin-top: 7px; }
.sandbox-note.muted { color: var(--text-tertiary); }
.sandbox-changes {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}
.sandbox-changes span {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(16, 185, 129, 0.1);
  color: #047857;
  font-size: 11px;
  font-weight: 900;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.workflow-trace-card {
  margin-top: 8px;
  padding: 10px;
  border: 1px solid rgba(59, 130, 246, 0.14);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.055), rgba(255, 255, 255, 0.45));
}
.workflow-trace-head {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 0;
}
.workflow-trace-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.workflow-trace-main strong,
.workflow-trace-main span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workflow-trace-main strong {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
}
.workflow-trace-main span {
  font-size: 12px;
  line-height: 1.45;
  font-weight: 700;
  color: var(--text-secondary);
}
.workflow-trace-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.06em;
  color: #64748b;
  background: rgba(100, 116, 139, 0.1);
}
.workflow-trace-badge.success { color: #047857; background: rgba(16, 185, 129, 0.12); }
.workflow-trace-badge.warning { color: #b45309; background: rgba(245, 158, 11, 0.13); }
.workflow-trace-badge.error { color: #dc2626; background: rgba(239, 68, 68, 0.12); }
.workflow-trace-phases,
.workflow-trace-rows {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 8px;
}
.workflow-trace-phase,
.workflow-trace-row {
  min-width: 0;
  padding: 8px 9px;
  border-radius: 8px;
  border: 1px solid rgba(226, 232, 240, 0.58);
  background: rgba(255, 255, 255, 0.55);
}
.workflow-trace-phase.success { border-color: rgba(16, 185, 129, 0.18); background: rgba(16, 185, 129, 0.08); }
.workflow-trace-phase.warning { border-color: rgba(245, 158, 11, 0.2); background: rgba(245, 158, 11, 0.08); }
.workflow-trace-phase.error { border-color: rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.08); }
.workflow-trace-phase em,
.workflow-trace-phase strong,
.workflow-trace-row span,
.workflow-trace-row strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: normal;
}
.workflow-trace-phase em,
.workflow-trace-row span {
  margin-bottom: 3px;
  font-size: 8px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.workflow-trace-phase strong,
.workflow-trace-row strong {
  font-size: 12px;
  font-weight: 900;
  color: var(--text-primary);
}
.workflow-trace-list,
.workflow-trace-warnings {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 8px;
}
.workflow-trace-list-item {
  min-width: 0;
  padding: 8px 9px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(226, 232, 240, 0.52);
}
.workflow-trace-list-item strong,
.workflow-trace-list-item span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workflow-trace-list-item strong {
  font-size: 12px;
  font-weight: 900;
  color: var(--text-primary);
}
.workflow-trace-list-item span,
.workflow-trace-warnings span {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.45;
  font-weight: 700;
  color: var(--text-secondary);
}
.workflow-trace-warnings span {
  margin-top: 0;
  padding: 7px 9px;
  border-radius: 8px;
  color: #92400e;
  background: rgba(245, 158, 11, 0.08);
}
.candidate-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.candidate-card {
  padding: 10px;
  border: 1px solid rgba(15, 23, 42, 0.07);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.55);
}
.candidate-card.memory {
  border-color: rgba(16, 185, 129, 0.18);
  background: linear-gradient(180deg, rgba(236, 253, 245, 0.78), rgba(255, 255, 255, 0.5));
}
.candidate-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}
.candidate-head strong,
.candidate-goal {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.candidate-head strong {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-primary);
}
.candidate-source,
.candidate-score,
.candidate-meta span,
.candidate-steps span {
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.06em;
}
.candidate-source {
  padding: 2px 7px;
  border-radius: 7px;
  color: #047857;
  background: rgba(16, 185, 129, 0.12);
}
.candidate-score {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--text-tertiary);
}
.candidate-goal {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.45;
  font-weight: 700;
  color: var(--text-secondary);
}
.candidate-meta,
.candidate-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}
.candidate-meta span,
.candidate-steps span {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.05);
  color: var(--text-secondary);
}
.candidate-meta .candidate-exec.yes {
  color: #047857;
  background: rgba(16, 185, 129, 0.11);
}
.candidate-meta .candidate-exec.no {
  color: #b45309;
  background: rgba(245, 158, 11, 0.13);
}
.candidate-meta .candidate-evidence.proven {
  color: #047857;
  background: rgba(16, 185, 129, 0.11);
}
.candidate-meta .candidate-evidence.regressed,
.candidate-meta .candidate-evidence.untested {
  color: #b45309;
  background: rgba(245, 158, 11, 0.13);
}
.candidate-meta .candidate-evidence.failing {
  color: #dc2626;
  background: rgba(239, 68, 68, 0.12);
}
.candidate-meta .candidate-evidence.running {
  color: #2563eb;
  background: rgba(59, 130, 246, 0.12);
}
.candidate-steps span {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.trace-device-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 7px;
  padding: 7px 9px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.035);
  min-width: 0;
}
.trace-device-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #cbd5e1;
  flex-shrink: 0;
}
.trace-device-dot.online { background: #10b981; }
.trace-device-dot.offline { background: #ef4444; }
.trace-device-row strong,
.trace-device-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 800;
}
.trace-device-row strong { color: var(--text-primary); }
.trace-device-row span { color: var(--text-tertiary); }
.inventory-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
  margin-top: 8px;
}
.inventory-device {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.58);
}
.inventory-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #cbd5e1;
  flex-shrink: 0;
}
.inventory-dot.online { background: #10b981; }
.inventory-dot.offline { background: #ef4444; }
.inventory-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.inventory-main strong,
.inventory-main span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inventory-main strong {
  font-size: 12px;
  font-weight: 900;
  color: var(--text-primary);
}
.inventory-main span,
.inventory-state {
  font-size: 11px;
  font-weight: 800;
  color: var(--text-tertiary);
}
.inventory-state {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 7px;
  background: rgba(100, 116, 139, 0.08);
}
.trace-raw {
  margin-top: 8px;
}
.trace-raw summary {
  cursor: pointer;
  font-size: 11px;
  font-weight: 900;
  color: var(--text-tertiary);
  user-select: none;
}
.trace-code {
  margin: 8px 0 0;
  padding: 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.035);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-wrap;
  overflow-x: auto;
}
</style>
