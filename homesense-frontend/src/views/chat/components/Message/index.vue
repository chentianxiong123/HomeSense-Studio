<script setup lang='ts'>
import { computed, ref, watch } from 'vue'
import { NDropdown, useMessage } from 'naive-ui'
import AvatarComponent from './Avatar.vue'
import TextComponent from './Text.vue'
import { SvgIcon } from '@/components/common'
import { useIconRender } from '@/hooks/useIconRender'
import { t } from '@/locales'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { copyToClip } from '@/utils/copy'

interface StageTraceEntry {
  stage: string
  ok: boolean
  next: string
  message?: string
  reason?: string
  confidence?: number
}

interface WriteBackResult {
  type: string
  success: boolean
  message?: string
  pathName?: string
  successState?: boolean
}

interface LlmData {
  intent_hint?: string
  plan?: string[]
  suggested_actions?: Array<{ tool: string, action: string }>
  next_hint?: string
  needs_model_config?: boolean
  selected_skills?: string[]
  selected_skill_refs?: string[]
  skill_insights?: Array<{ tool: string, section: string, headline?: string }>
  context_summary?: {
    selectedSkills?: Array<{ tool: string, section: string }>
  }
}

interface CommandSummaryItem {
  commandId?: string | null
  capability?: string | null
  preferredTool?: string | null
  action?: string | null
  riskLevel?: string | null
  input?: Record<string, any>
}

interface SelectedSkillMetadataItem {
  skill_id?: string
  tool?: string
  section?: string
  capabilities?: string[]
  exposure_level?: string | null
  risk_level?: string | null
  preconditions?: string[]
}

interface WorkflowDraftNode {
  nodeId: string
  type: string
  label: string
  capability?: string
  command?: {
    input?: Record<string, any>
  }
  policy?: {
    riskLevel?: string
  }
}

interface WorkflowDraftEdge {
  edgeId: string
  from: string
  to: string
  when?: {
    result?: string
    expression?: string
  }
}

interface WorkflowDraft {
  workflowId: string
  name: string
  description?: string
  goal?: string
  nodes?: WorkflowDraftNode[]
  edges?: WorkflowDraftEdge[]
}

interface RegistryResolutionMeta {
  resolutionSource?: string | null
  outcomeType?: string | null
  matched?: boolean | null
  matchedTrigger?: string | null
  matchedPathName?: string | null
  matchedPathCandidates?: Array<{
    id?: string | null
    name?: string | null
    score?: number | null
    successRate?: number | null
    isFailurePath?: boolean | null
  }>
  deepMatchedPathName?: string | null
  deepTopCandidateNames?: string[]
  deepCandidateCount?: number | null
  commandSummary?: CommandSummaryItem[]
  selectedSkillMetadata?: SelectedSkillMetadataItem[]
  workflowDraft?: WorkflowDraft | null
  blockedActions?: Array<Record<string, any>>
  gatedBySkills?: boolean | null
  gatedActionCount?: number | null
  gatingReason?: string | null
  preconditionsEnforced?: boolean | null
  writeBackRecordType?: string | null
}

interface RegistryDebugPayload {
  refs?: string[]
  registry?: {
    capabilities?: any[]
    skills?: any[]
  }
  metadata?: SelectedSkillMetadataItem[]
  resolutionMeta?: RegistryResolutionMeta
}

interface Props {
  dateTime?: string
  text?: string
  inversion?: boolean
  error?: boolean
  loading?: boolean
  trace?: StageTraceEntry[]
  writeBackResults?: WriteBackResult[]
  llm?: LlmData
  skillsHint?: string[]
  registryDebug?: RegistryDebugPayload
  workflowDraft?: WorkflowDraft | null
}

interface Emit {
  (ev: 'regenerate'): void
  (ev: 'delete'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()

const { isMobile } = useBasicLayout()
const { iconRender } = useIconRender()
const message = useMessage()

const asRawText = ref(props.inversion)
const messageRef = ref<HTMLElement>()

// 默认折叠，loading 时展开，loading 结束后自动折叠
const showDebug = ref(false)

// loading 时暂时显示 trace
watch(() => props.loading, (loading) => {
  if (loading) showDebug.value = true
  else showDebug.value = false
}, { immediate: true })
// Demo Mode: showDebugDetails 已禁用
// const showDebugDetails = ref(false)

const hasDebugInfo = computed(() => {
  return (props.trace?.length || 0) > 0 || (props.writeBackResults?.length || 0) > 0 || Boolean(props.llm) || (props.skillsHint?.length || 0) > 0 || Boolean(props.registryDebug)
})
const debugSummary = computed(() => (props.trace || []).map(item => item.stage).join(' → '))
const registryResolutionMeta = computed(() => props.registryDebug?.resolutionMeta || null)
const blockedActions = computed(() => Array.isArray(props.registryDebug?.resolutionMeta?.blockedActions) ? props.registryDebug.resolutionMeta.blockedActions : [])
const commandSummary = computed(() => Array.isArray(props.registryDebug?.resolutionMeta?.commandSummary) ? props.registryDebug.resolutionMeta.commandSummary : [])
const selectedRuntimeSkillMetadata = computed(() => Array.isArray(props.registryDebug?.resolutionMeta?.selectedSkillMetadata) ? props.registryDebug.resolutionMeta.selectedSkillMetadata : [])
const matchedPathCandidates = computed(() => Array.isArray(props.registryDebug?.resolutionMeta?.matchedPathCandidates) ? props.registryDebug.resolutionMeta.matchedPathCandidates : [])
// Demo Mode: 以下调试相关 computed 和函数已禁用
/*
const registryRefs = computed(() => Array.isArray(props.registryDebug?.refs) ? props.registryDebug.refs : [])
const registryCapabilities = computed(() => Array.isArray(props.registryDebug?.registry?.capabilities) ? props.registryDebug.registry.capabilities : [])
const registrySkills = computed(() => Array.isArray(props.registryDebug?.registry?.skills) ? props.registryDebug.registry.skills : [])
const selectedRegistryMetadata = computed(() => Array.isArray(props.registryDebug?.metadata) ? props.registryDebug.metadata : [])
const registryResolutionMeta = computed(() => props.registryDebug?.resolutionMeta || null)
const blockedActions = computed(() => Array.isArray(props.registryDebug?.resolutionMeta?.blockedActions) ? props.registryDebug.resolutionMeta.blockedActions : [])
const commandSummary = computed(() => Array.isArray(props.registryDebug?.resolutionMeta?.commandSummary) ? props.registryDebug.resolutionMeta.commandSummary : [])
const selectedRuntimeSkillMetadata = computed(() => Array.isArray(props.registryDebug?.resolutionMeta?.selectedSkillMetadata) ? props.registryDebug.resolutionMeta.selectedSkillMetadata : [])
const workflowDraft = computed(() => props.workflowDraft || props.registryDebug?.resolutionMeta?.workflowDraft || null)
const capabilityCountLabel = computed(() => `${registryCapabilities.value.length}`)
const skillCountLabel = computed(() => `${registrySkills.value.length}`)
const debugOverviewLines = computed(() => {
  const lines: string[] = []

  if (props.trace?.length)
    lines.push(`trace stages: ${props.trace.length}`)
  if (props.llm)
    lines.push(`deep layer: ${(props.llm.plan?.length || 0)} planned steps`)
  if (registryRefs.value.length || registryCapabilities.value.length || registrySkills.value.length)
    lines.push(`registry: ${registryRefs.value.length} refs · ${registryCapabilities.value.length} capabilities · ${registrySkills.value.length} skills`)
  if (workflowDraft.value)
    lines.push(`workflow draft: ${workflowDraft.value.name}`)
  if (props.writeBackResults?.length)
    lines.push(`write-back records: ${props.writeBackResults.length}`)

  return lines
})
const debugModeDescription = computed(() => {
  return showDebugDetails.value ? 'Debug details are visible' : 'Showing the normal summary view'
})
const hasDebugOverview = computed(() => debugOverviewLines.value.length > 0)
const shouldShowRuntimeGating = computed(() => {
  return Boolean(registryResolutionMeta.value)
    || commandSummary.value.length > 0
    || selectedRuntimeSkillMetadata.value.length > 0
    || blockedActions.value.length > 0
    || Boolean(workflowDraft.value)
})

function formatRegistryMetadata(item: any) {
  const capabilities = Array.isArray(item?.capabilities) ? item.capabilities.join('、') : 'none'
  const risk = item?.risk_level || 'unknown'
  const exposure = item?.exposure_level || 'unknown'
  return `${item?.skill_id || item?.tool || 'unknown'} → ${capabilities} | risk: ${risk} | exposure: ${exposure}`
}

function formatBlockedAction(item: any) {
  const base = `${item?.tool || 'unknown'}.${item?.action || 'unknown'}`
  const capability = item?.capability ? ` → ${item.capability}` : ''
  const reason = item?.reason ? ` (${item.reason})` : ''
  return `${base}${capability}${reason}`
}

function formatCommandSummary(item: CommandSummaryItem) {
  const capability = item.capability || 'unknown capability'
  const tool = item.preferredTool || 'unknown tool'
  const action = item.action || 'unknown action'
  const risk = item.riskLevel || 'unknown'
  const input = item.input && Object.keys(item.input).length > 0 ? ` | input: ${JSON.stringify(item.input)}` : ''
  return `${capability} → ${tool}.${action} | risk: ${risk}${input}`
}

function formatWorkflowDraftNode(node: WorkflowDraftNode) {
  if (node.capability)
    return `${node.label} → ${node.capability}`
  return `${node.label} (${node.type})`
}

function formatWorkflowDraftEdge(edge: WorkflowDraftEdge) {
  if (edge.when?.result)
    return `${edge.from} -> ${edge.to} [${edge.when.result}]`
  if (edge.when?.expression)
    return `${edge.from} -> ${edge.to} [${edge.when.expression}]`
  return `${edge.from} -> ${edge.to}`
}
*/

const options = computed(() => {
  const common = [
    {
      label: t('chat.copy'),
      key: 'copyText',
      icon: iconRender({ icon: 'ri:file-copy-2-line' }),
    },
    {
      label: t('common.delete'),
      key: 'delete',
      icon: iconRender({ icon: 'ri:delete-bin-line' }),
    },
  ]

  if (!props.inversion) {
    common.unshift({
      label: asRawText.value ? t('chat.preview') : t('chat.showRawText'),
      key: 'toggleRenderType',
      icon: iconRender({ icon: asRawText.value ? 'ic:outline-code-off' : 'ic:outline-code' }),
    })
  }

  return common
})

function formatWriteBack(result: WriteBackResult) {
  if (result.type === 'success_path') {
    return result.successState === false
      ? `已记录失败经验：${result.pathName || 'unknown'}`
      : `已记录成功经验：${result.pathName || 'unknown'}`
  }
  return result.message || result.type
}

function formatBlockedAction(item: any) {
  const base = `${item?.tool || 'unknown'}.${item?.action || 'unknown'}`
  const capability = item?.capability ? ` -> ${item.capability}` : ''
  const reason = item?.reason ? ` (${item.reason})` : ''
  return `${base}${capability}${reason}`
}

function formatCommandSummary(item: CommandSummaryItem) {
  const capability = item.capability || 'unknown capability'
  const tool = item.preferredTool || 'unknown tool'
  const action = item.action || 'unknown action'
  const risk = item.riskLevel || 'unknown'
  const input = item.input && Object.keys(item.input).length > 0 ? ` | input: ${JSON.stringify(item.input)}` : ''
  return `${capability} -> ${tool}.${action} | risk: ${risk}${input}`
}

function formatRegistryMetadata(item: any) {
  const capabilities = Array.isArray(item?.capabilities) ? item.capabilities.join(', ') : 'none'
  const risk = item?.risk_level || 'unknown'
  const exposure = item?.exposure_level || 'unknown'
  return `${item?.skill_id || item?.tool || 'unknown'} -> ${capabilities} | risk: ${risk} | exposure: ${exposure}`
}

function formatPathCandidate(item: {
  name?: string | null
  score?: number | null
  successRate?: number | null
  isFailurePath?: boolean | null
}) {
  const score = typeof item.score === 'number' ? item.score.toFixed(2) : 'n/a'
  const successRate = typeof item.successRate === 'number' ? `${Math.round(item.successRate * 100)}%` : 'n/a'
  const kind = item.isFailurePath ? 'failure hint' : 'success path'
  return `${item.name || 'unknown'} | ${kind} | score: ${score} | success: ${successRate}`
}

// Demo Mode: 以下函数已禁用
/*
function formatSuggestedAction(action: { tool: string, action: string }) {
  return `${action.tool}.${action.action}`
}

function formatSkillRef(skill: string) {
  return skill
}

function formatSkillInsight(insight: { tool: string, section: string, headline?: string }) {
  return insight.headline || `${insight.tool}/${insight.section}`
}

const selectedSkillRefs = computed(() => {
  return props.llm?.selected_skills || props.llm?.selected_skill_refs || []
})

const selectedSkillSummary = computed(() => {
  return props.llm?.context_summary?.selectedSkills || []
})

const stageSkillHints = computed(() => {
  return props.skillsHint || []
})
*/

function handleSelect(key: 'copyText' | 'delete' | 'toggleRenderType') {
  switch (key) {
    case 'copyText':
      handleCopy()
      return
    case 'toggleRenderType':
      asRawText.value = !asRawText.value
      return
    case 'delete':
      emit('delete')
  }
}

function handleRegenerate() {
  messageRef.value?.scrollIntoView()
  emit('regenerate')
}

async function handleCopy() {
  try {
    await copyToClip(props.text || '')
    message.success(t('chat.copied'))
  }
  catch {
    message.error(t('chat.copyFailed'))
  }
}
</script>

<template>
  <div
    ref="messageRef"
    class="flex w-full mb-6 overflow-hidden"
    :class="[{ 'flex-row-reverse': inversion }]"
  >
    <div
      v-if="inversion"
      class="flex items-center justify-center flex-shrink-0 h-8 overflow-hidden rounded-full basis-8 ml-2"
    >
      <AvatarComponent :image="inversion" />
    </div>
    <div class="overflow-hidden text-sm" :class="[inversion ? 'items-end' : 'items-start']">
      <p class="text-xs text-[#b4bbc4]" :class="[inversion ? 'text-right' : 'text-left']">
        {{ dateTime }}
      </p>
      <div
        class="flex items-end gap-1 mt-2"
        :class="[inversion ? 'flex-row-reverse' : 'flex-row']"
      >
        <div>
          <TextComponent
            :inversion="inversion"
            :error="error"
            :text="text"
            :loading="loading"
            :as-raw-text="asRawText"
          />

          <div
            v-if="!inversion && hasDebugInfo"
            class="mt-2 rounded-md border border-[#e5e7eb] bg-white/70 p-2 text-xs text-[#4b5563] dark:border-[#2a2a2d] dark:bg-[#151518] dark:text-[#c7c9d1]"
          >
            <button class="flex w-full items-center justify-between" @click="showDebug = !showDebug">
              <span>{{ debugSummary || '执行信息' }}</span>
              <SvgIcon :icon="showDebug ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'" />
            </button>

            <div v-if="showDebug" class="mt-2 space-y-2">
              <!-- Demo Mode: 轻量 trace 展示 - 只保留主链阶段和最终落点 -->
              <div v-if="trace?.length">
                <div class="mb-1 font-medium">执行链路</div>
                <div class="rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]">
                  <div class="flex flex-wrap items-center gap-1">
                    <template v-for="(item, index) in trace" :key="`${item.stage}-${index}`">
                      <span
                        :class="item.ok ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'"
                      >{{ item.stage }}</span>
                      <span v-if="index < trace.length - 1" class="text-[#9ca3af]">→</span>
                    </template>
                  </div>
                  <!-- ReAct 详细信息 -->
                  <div v-for="(item, index) in trace" :key="`detail-${index}`" class="mt-2 border-t border-[#e5e7eb] dark:border-[#2a2a2d] pt-2">
                    <div class="font-medium text-[#1d4ed8] dark:text-[#93c5fd]">[{{ item.stage }}]</div>
                    <div v-if="item.message" class="mt-1 text-[#4b5563] dark:text-[#c7c9d1]">{{ item.message }}</div>
                    <div v-if="item.reason" class="mt-1 text-[#9ca3af]">原因: {{ item.reason }}</div>
                    <div v-if="item.confidence" class="mt-1">
                      <span class="text-[#9ca3af]">置信度:</span>
                      <span :class="item.confidence >= 0.7 ? 'text-green-600' : 'text-orange-500'">
                        {{ (item.confidence * 100).toFixed(0) }}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Demo Mode: 轻量执行结果 -->
              <div v-if="writeBackResults?.length">
                <div class="mb-1 font-medium">执行结果</div>
                <div
                  v-for="(item, index) in writeBackResults"
                  :key="`${item.type}-${index}`"
                  class="mb-1 rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]"
                >
                  {{ formatWriteBack(item) }}
                </div>
              </div>

              <!-- Demo Mode: 可选 - intent / 来源 / 目标设备简述 -->
              <div v-if="llm?.intent_hint" class="rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]">
                <div class="text-[#9ca3af]">意图: {{ llm.intent_hint }}</div>
              </div>

              <div v-if="registryResolutionMeta" class="rounded bg-[#f6f8fa] px-2 py-2 dark:bg-[#1d1f23]">
                <div class="mb-1 font-medium">对齐诊断</div>
                <div class="space-y-1 text-[#6b7280] dark:text-[#9ca3af]">
                  <div>决策来源: {{ registryResolutionMeta.resolutionSource || 'unknown' }}</div>
                  <div>结果类型: {{ registryResolutionMeta.outcomeType || 'unknown' }}</div>
                  <div>是否命中: {{ registryResolutionMeta.matched ? 'yes' : 'no' }}</div>
                  <div v-if="registryResolutionMeta.matchedTrigger">规则触发词: {{ registryResolutionMeta.matchedTrigger }}</div>
                  <div v-if="registryResolutionMeta.matchedPathName">命中的成功路径: {{ registryResolutionMeta.matchedPathName }}</div>
                  <div v-if="registryResolutionMeta.deepMatchedPathName">Deep 引用路径: {{ registryResolutionMeta.deepMatchedPathName }}</div>
                  <div v-if="registryResolutionMeta.gatingReason">约束原因: {{ registryResolutionMeta.gatingReason }}</div>
                  <div v-if="registryResolutionMeta.writeBackRecordType">写回类型: {{ registryResolutionMeta.writeBackRecordType }}</div>
                </div>
              </div>

              <div v-if="matchedPathCandidates.length" class="rounded bg-[#f6f8fa] px-2 py-2 dark:bg-[#1d1f23]">
                <div class="mb-1 font-medium">成功路径经验</div>
                <div
                  v-for="(item, index) in matchedPathCandidates"
                  :key="`${item.id || item.name || 'candidate'}-${index}`"
                  class="mb-1 rounded bg-[#ffffff] px-2 py-1 dark:bg-[#111214]"
                >
                  {{ formatPathCandidate(item) }}
                </div>
              </div>

              <div v-if="commandSummary.length" class="rounded bg-[#f6f8fa] px-2 py-2 dark:bg-[#1d1f23]">
                <div class="mb-1 font-medium">执行计划</div>
                <div
                  v-for="(item, index) in commandSummary"
                  :key="`${item.commandId || item.capability || 'command'}-${index}`"
                  class="mb-1 rounded bg-[#ffffff] px-2 py-1 dark:bg-[#111214]"
                >
                  {{ formatCommandSummary(item) }}
                </div>
              </div>

              <div v-if="selectedRuntimeSkillMetadata.length" class="rounded bg-[#f6f8fa] px-2 py-2 dark:bg-[#1d1f23]">
                <div class="mb-1 font-medium">技能选择</div>
                <div
                  v-for="(item, index) in selectedRuntimeSkillMetadata"
                  :key="`${item.skill_id || item.tool || 'skill'}-${index}`"
                  class="mb-1 rounded bg-[#ffffff] px-2 py-1 dark:bg-[#111214]"
                >
                  {{ formatRegistryMetadata(item) }}
                </div>
              </div>

              <div v-if="blockedActions.length" class="rounded bg-[#f6f8fa] px-2 py-2 dark:bg-[#1d1f23]">
                <div class="mb-1 font-medium">被拦截动作</div>
                <div
                  v-for="(item, index) in blockedActions"
                  :key="`blocked-${index}`"
                  class="mb-1 rounded bg-[#ffffff] px-2 py-1 dark:bg-[#111214]"
                >
                  {{ formatBlockedAction(item) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex flex-col">
          <button
            v-if="!inversion"
            class="mb-2 transition text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-300"
            @click="handleRegenerate"
          >
            <SvgIcon icon="ri:restart-line" />
          </button>
          <NDropdown
            :trigger="isMobile ? 'click' : 'hover'"
            :placement="!inversion ? 'right' : 'left'"
            :options="options"
            @select="handleSelect"
          >
            <button class="transition text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-200">
              <SvgIcon icon="ri:more-2-fill" />
            </button>
          </NDropdown>
        </div>
      </div>
    </div>
  </div>
</template>
