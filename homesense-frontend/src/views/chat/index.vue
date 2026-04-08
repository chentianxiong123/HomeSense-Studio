<script setup lang="ts">
import type { Ref } from 'vue'
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NInput } from 'naive-ui'
import { Message } from './components'
import { useScroll } from './hooks/useScroll'
import HeaderComponent from './components/Header/index.vue'
import { HoverButton, SvgIcon } from '@/components/common'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { useRuntimePanelStore } from '@/store'
import { acceptWorkflowUpgrade, fetchChatAPI, fetchMessages, fetchRegistryPreview, fetchWorkflowCandidates, fetchWorkflowExamples, saveWorkflowDraft, upgradeWorkflowDraft } from '@/api'
import { t } from '@/locales'
import { setCachedMessages, clearCachedMessages } from '@/utils/cache'

useRoute()

const { isMobile } = useBasicLayout()
const { scrollRef, scrollToBottom, scrollToBottomIfAtBottom } = useScroll()
const runtimePanelStore = useRuntimePanelStore()


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

interface ResolutionMeta {
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
  gatingReason?: string | null
  writeBackRecordType?: string | null
  commandSummary?: CommandSummaryItem[]
  selectedSkillMetadata?: SelectedSkillMetadataItem[]
  workflowDraft?: WorkflowDraft | null
  blockedActions?: Array<Record<string, any>>
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

interface PendingWorkflowCandidate extends WorkflowDraft {
  isPendingCandidate?: boolean
  candidateSource?: string
  targetWorkflowId?: string | null
  targetWorkflowName?: string | null
}

interface RegistryDebugPayload {
  refs?: string[]
  registry?: {
    capabilities?: any[]
    skills?: any[]
  }
  metadata?: SelectedSkillMetadataItem[]
  resolutionMeta?: ResolutionMeta
}

interface ChatMessage {
  workflowDraft?: WorkflowDraft
  resolutionMeta?: ResolutionMeta
  id: number
  role: string
  content: string
  created_at: string
  dateTime: string
  text: string
  inversion: boolean
  error: boolean
  loading: boolean
  trace?: StageTraceEntry[]
  writeBackResults?: WriteBackResult[]
  llm?: LlmData
  skillsHint?: string[]
  registryDebug?: RegistryDebugPayload
}

interface MessagePageInfo {
  oldestCursorId: number | null
  newestCursorId: number | null
  hasOlder: boolean
  hasNewer: boolean
}

const messages = ref<ChatMessage[]>([])
const prompt = ref<string>('')
const loading = ref<boolean>(false)
const loadingMore = ref<boolean>(false)
const hasMoreOlder = ref<boolean>(true)
const oldestCursorId = ref<number | null>(null)
const inputRef = ref<Ref | null>(null)

const PAGE_SIZE = 20
const showPreviewPanel = ref(false)
const showPreviewDebug = ref(false)
const registryPreview = ref<any>(null)
const workflowPreview = ref<any[]>([])
const pendingWorkflowCandidates = ref<PendingWorkflowCandidate[]>([])
const selectedCapability = ref<any | null>(null)
const selectedWorkflow = ref<any | null>(null)
const workflowUpgradeResult = ref<any | null>(null)
const workflowSaveResult = ref<any | null>(null)
const upgradingWorkflowDraft = ref(false)
const savingWorkflowDraft = ref(false)
const acceptingWorkflowUpgrade = ref(false)
let loadRequestSequence = 0

const latestWorkflowDraft = computed(() => {
  const drafts = messages.value
    .map(item => item.workflowDraft)
    .filter((item): item is WorkflowDraft => Boolean(item))
  return drafts[drafts.length - 1] || null
})

const combinedWorkflowPreview = computed(() => {
  const examples = workflowPreview.value || []
  const pending = pendingWorkflowCandidates.value || []
  const draft = latestWorkflowDraft.value
    ? [{ ...latestWorkflowDraft.value, isDraft: true }]
    : []
  const persistedIds = new Set(examples.map((item: any) => item.workflowId))
  const pendingOnly = pending.filter(item => !persistedIds.has(item.workflowId))
  return [...draft, ...pendingOnly, ...examples]
})

const workflowPreviewSections = computed(() => {
  const examples = workflowPreview.value || []
  const pending = pendingWorkflowCandidates.value || []
  const latestDraft = latestWorkflowDraft.value
    ? [{ ...latestWorkflowDraft.value, isDraft: true }]
    : []
  const registeredIds = new Set(examples.map((item: any) => item.workflowId))
  const pendingOnly = pending.filter(item => !registeredIds.has(item.workflowId))

  return [
    {
      key: 'latest_draft',
      title: 'Latest Draft',
      emptyText: 'No draft yet',
      items: latestDraft,
    },
    {
      key: 'pending_candidates',
      title: 'Pending Candidates',
      emptyText: 'No pending candidates',
      items: pendingOnly,
    },
    {
      key: 'registered_workflows',
      title: 'Registered Workflows',
      emptyText: 'No registered workflows',
      items: examples,
      caption: workflowRegisteredSectionCaption.value,
    },
  ].filter(section => section.items.length > 0 || section.key === 'registered_workflows')
})

const totalWorkflowPreviewCount = computed(() => {
  return workflowPreviewSections.value.reduce((sum, section) => sum + section.items.length, 0)
})

const acceptedRegisteredWorkflowCount = computed(() => {
  return workflowPreview.value.filter((item: any) => pendingWorkflowCandidates.value.some(candidate => candidate.workflowId === item.workflowId)).length
})

const pendingOnlyWorkflowCount = computed(() => {
  const registeredIds = new Set(workflowPreview.value.map((item: any) => item.workflowId))
  return pendingWorkflowCandidates.value.filter(item => !registeredIds.has(item.workflowId)).length
})

const registeredOnlyWorkflowCount = computed(() => {
  return Math.max(workflowPreview.value.length - acceptedRegisteredWorkflowCount.value, 0)
})

const latestDraftWorkflowCount = computed(() => {
  return latestWorkflowDraft.value ? 1 : 0
})

const workflowPreviewSummaryLines = computed(() => {
  return [
    `preview items: ${totalWorkflowPreviewCount.value}`,
    `latest draft: ${latestDraftWorkflowCount.value}`,
    `pending candidates: ${pendingOnlyWorkflowCount.value}`,
    `accepted in registry: ${acceptedRegisteredWorkflowCount.value}`,
    `registered only: ${registeredOnlyWorkflowCount.value}`,
  ]
})

const hasWorkflowPreviewItems = computed(() => {
  return totalWorkflowPreviewCount.value > 0
})

const workflowPreviewEmptyText = computed(() => {
  return hasWorkflowPreviewItems.value ? '' : 'No workflow previews yet'
})

const workflowPanelTitle = computed(() => {
  return 'Workflow Preview'
})

const workflowPanelSubtitle = computed(() => {
  if (!hasWorkflowPreviewItems.value)
    return 'Draft, pending, and registered workflows will appear here'
  return 'Grouped by workflow state'
})

const workflowRegisteredSectionCaption = computed(() => {
  if (!acceptedRegisteredWorkflowCount.value)
    return registeredOnlyWorkflowCount.value
      ? `${registeredOnlyWorkflowCount.value} registered workflows`
      : null
  if (!registeredOnlyWorkflowCount.value)
    return `${acceptedRegisteredWorkflowCount.value} accepted workflows now in the registry`
  return `${acceptedRegisteredWorkflowCount.value} accepted in registry · ${registeredOnlyWorkflowCount.value} registered only`
})

function workflowCandidateMeta(workflowId?: string | null) {
  if (!workflowId) return null
  return pendingWorkflowCandidates.value.find(item => item.workflowId === workflowId) || null
}

function workflowGroupBadge(item: any) {
  if (item?.isDraft) return 'draft'
  const candidateMeta = workflowCandidateMeta(item?.workflowId)
  if (candidateMeta?.candidateSource === 'accepted_candidate') return 'accepted'
  if (item?.isPendingCandidate || candidateMeta) return 'pending'
  return 'registered'
}

function workflowBadgeClass(item: any) {
  const badge = workflowGroupBadge(item)
  if (badge === 'draft')
    return 'bg-[#dbeafe] text-[#1d4ed8] dark:bg-[#1e3a8a] dark:text-[#bfdbfe]'
  if (badge === 'accepted')
    return 'bg-[#dcfce7] text-[#166534] dark:bg-[#14532d] dark:text-[#bbf7d0]'
  if (badge === 'pending')
    return 'bg-[#fef3c7] text-[#92400e] dark:bg-[#78350f] dark:text-[#fde68a]'
  return 'bg-[#e5e7eb] text-[#4b5563] dark:bg-[#3a3a40] dark:text-[#d1d5db]'
}

function workflowSectionItemCaption(item: any) {
  const candidateMeta = workflowCandidateMeta(item?.workflowId)
  const targetWorkflowName = item?.targetWorkflowName || candidateMeta?.targetWorkflowName

  if (item?.isPendingCandidate && targetWorkflowName)
    return `target: ${targetWorkflowName}`
  if (item?.isPendingCandidate)
    return pendingCandidateCaption(item)
  if (candidateMeta?.candidateSource === 'accepted_candidate' && targetWorkflowName)
    return `registered from accepted candidate for ${targetWorkflowName}`
  if (candidateMeta?.candidateSource === 'accepted_candidate')
    return 'registered from accepted candidate'
  return null
}

function workflowListItemMetaLines(item: any) {
  const lines: string[] = []
  const candidateMeta = workflowCandidateMeta(item?.workflowId)
  const caption = workflowSectionItemCaption(item)
  const targetWorkflowName = item?.targetWorkflowName || candidateMeta?.targetWorkflowName
  const candidateSource = item?.candidateSource || candidateMeta?.candidateSource

  if (caption)
    lines.push(caption)
  if (item?.isPendingCandidate && targetWorkflowName && caption !== `target: ${targetWorkflowName}`)
    lines.push(`upgrade target: ${targetWorkflowName}`)
  if (item?.isPendingCandidate && candidateSource && candidateSource !== 'accepted_candidate')
    lines.push(`source: ${candidateSource}`)

  return lines
}

function selectedWorkflowLifecycleNote(item: any) {
  const candidateMeta = workflowCandidateMeta(item?.workflowId)
  const targetWorkflowName = item?.targetWorkflowName || candidateMeta?.targetWorkflowName
  if (!candidateMeta || candidateMeta.candidateSource !== 'accepted_candidate' || item?.isPendingCandidate)
    return null
  if (targetWorkflowName)
    return `This workflow is now registered and originated from an accepted candidate targeting ${targetWorkflowName}.`
  return 'This workflow is now registered and originated from an accepted candidate.'
}

const selectedWorkflowLifecycleDescription = computed(() => {
  if (!selectedWorkflow.value) return null
  return selectedWorkflowLifecycleNote(selectedWorkflow.value)
})

const selectedWorkflowIsDraft = computed(() => {
  return selectedWorkflow.value?.workflowId === latestWorkflowDraft.value?.workflowId
})

const selectedWorkflowCandidateMeta = computed(() => {
  return workflowCandidateMeta(selectedWorkflow.value?.workflowId)
})

const selectedWorkflowIsPendingCandidate = computed(() => {
  return !selectedWorkflowIsDraft.value && Boolean(selectedWorkflowCandidateMeta.value)
})

const selectedWorkflowBadge = computed(() => {
  if (!selectedWorkflow.value) return ''
  return workflowGroupBadge(selectedWorkflow.value)
})

const selectedWorkflowCaption = computed(() => {
  if (!selectedWorkflow.value) return null
  return workflowSectionItemCaption(selectedWorkflow.value)
})

const selectedWorkflowTargetName = computed(() => {
  return selectedWorkflow.value?.targetWorkflowName || selectedWorkflowCandidateMeta.value?.targetWorkflowName || null
})

const selectedWorkflowCandidateSource = computed(() => {
  return selectedWorkflow.value?.candidateSource || selectedWorkflowCandidateMeta.value?.candidateSource || null
})

const selectedWorkflowMetaLines = computed(() => {
  const lines: string[] = []
  if (selectedWorkflowCaption.value)
    lines.push(selectedWorkflowCaption.value)
  if (selectedWorkflowLifecycleDescription.value)
    lines.push(selectedWorkflowLifecycleDescription.value)
  if (
    selectedWorkflowIsPendingCandidate.value
    && selectedWorkflowTargetName.value
    && selectedWorkflowCaption.value !== `target: ${selectedWorkflowTargetName.value}`
  ) {
    lines.push(`upgrade target: ${selectedWorkflowTargetName.value}`)
  }
  if (
    selectedWorkflowIsPendingCandidate.value
    && selectedWorkflowCandidateSource.value
    && selectedWorkflowCandidateSource.value !== 'accepted_candidate'
  ) {
    lines.push(`source: ${selectedWorkflowCandidateSource.value}`)
  }
  return lines
})

const selectedWorkflowHasMetaBlock = computed(() => {
  return selectedWorkflowMetaLines.value.length > 0
})

const selectedWorkflowDescriptionClass = computed(() => {
  return selectedWorkflowHasMetaBlock.value ? 'mt-2 text-[#9ca3af]' : 'mt-1 text-[#9ca3af]'
})

const selectedWorkflowBadgeClass = computed(() => {
  if (!selectedWorkflow.value) return ''
  return workflowBadgeClass(selectedWorkflow.value)
})

const selectedWorkflowShowMetaBlock = computed(() => {
  return selectedWorkflowMetaLines.value.length > 0
})

const selectedWorkflowMetaBlockLines = computed(() => {
  return selectedWorkflowMetaLines.value
})

const workflowComparisonSummary = computed(() => {
  if (!selectedWorkflow.value || (!selectedWorkflowIsDraft.value && !selectedWorkflowIsPendingCandidate.value))
    return null

  const draftCapabilities = new Set(workflowCapabilities(selectedWorkflow.value))
  const matchedExample = workflowPreview.value.find((item: any) => {
    const exampleCapabilities = workflowCapabilities(item)
    return exampleCapabilities.some(capability => draftCapabilities.has(capability))
  })

  if (!matchedExample)
    return null

  return {
    workflowId: matchedExample.workflowId,
    name: matchedExample.name,
    sharedCapabilities: workflowCapabilities(matchedExample).filter(capability => draftCapabilities.has(capability)),
  }
})

function upsertPendingWorkflowCandidate(candidate: PendingWorkflowCandidate) {
  const next = pendingWorkflowCandidates.value.filter(item => item.workflowId !== candidate.workflowId)
  pendingWorkflowCandidates.value = [candidate, ...next]
}

function buildPendingWorkflowCandidate(source: WorkflowDraft, meta?: Record<string, any>): PendingWorkflowCandidate {
  return {
    ...source,
    workflowId: typeof meta?.workflowId === 'string' ? meta.workflowId : source.workflowId,
    name: typeof meta?.workflowName === 'string'
      ? meta.workflowName
      : typeof meta?.name === 'string'
        ? meta.name
        : source.name,
    isPendingCandidate: true,
    candidateSource: typeof meta?.mode === 'string' ? meta.mode : 'pending_candidate',
    targetWorkflowId: typeof meta?.targetWorkflowId === 'string' ? meta.targetWorkflowId : null,
    targetWorkflowName: typeof meta?.targetWorkflowName === 'string' ? meta.targetWorkflowName : null,
  }
}

function syncSelectedWorkflow(workflowId?: string | null) {
  if (!workflowId) return
  const next = combinedWorkflowPreview.value.find(item => item.workflowId === workflowId)
  if (next)
    selectedWorkflow.value = next
}

function clearWorkflowActionState() {
  workflowUpgradeResult.value = null
  workflowSaveResult.value = null
}

function resetWorkflowActionStateForIncomingDraft() {
  clearWorkflowActionState()
}

function selectLatestDraftIfIdle() {
  if (!selectedWorkflow.value && latestWorkflowDraft.value)
    selectWorkflow(latestWorkflowDraft.value)
}

function syncLatestDraftSelection(previousDraftId?: string | null) {
  if (selectedWorkflow.value?.workflowId === previousDraftId && latestWorkflowDraft.value)
    selectedWorkflow.value = { ...latestWorkflowDraft.value, isDraft: true }
}

function handleIncomingWorkflowDraft(previousDraftId?: string | null) {
  resetWorkflowActionStateForIncomingDraft()
  syncLatestDraftSelection(previousDraftId)
  selectLatestDraftIfIdle()
}

function normalizeWorkflowDraftFromMessage(message?: ChatMessage | null) {
  return message?.workflowDraft || null
}

function latestAssistantWorkflowDraftId() {
  const drafts = messages.value
    .map(normalizeWorkflowDraftFromMessage)
    .filter((item): item is WorkflowDraft => Boolean(item))
  return drafts[drafts.length - 1]?.workflowId || null
}

function applyPendingCandidateFromResult(source: WorkflowDraft, resultData?: Record<string, any> | null) {
  if (!resultData || !source) return
  upsertPendingWorkflowCandidate(buildPendingWorkflowCandidate(source, resultData))
}

function selectPendingOrDraftWorkflow(workflowId?: string | null, fallback?: WorkflowDraft | null) {
  syncSelectedWorkflow(workflowId)
  if (!selectedWorkflow.value && fallback)
    selectedWorkflow.value = fallback
}

function clearSelectedCapabilityIfMissing() {
  if (selectedCapability.value && !registryCapabilityMap.value.has(selectedCapability.value.capability))
    selectedCapability.value = null
}

function refreshSelectionAfterWorkflowMutation(workflowId?: string | null, fallback?: WorkflowDraft | null) {
  selectPendingOrDraftWorkflow(workflowId, fallback)
  clearSelectedCapabilityIfMissing()
}

function pendingCandidateCaption(item: any) {
  if (!item?.isPendingCandidate) return null
  if (item?.targetWorkflowName)
    return `target: ${item.targetWorkflowName}`
  if (item?.candidateSource === 'accepted_candidate')
    return 'accepted candidate'
  if (item?.candidateSource)
    return `source: ${item.candidateSource}`
  return 'pending candidate'
}

async function handleUpgradeWorkflowDraft() {
  if (!latestWorkflowDraft.value || upgradingWorkflowDraft.value) return

  upgradingWorkflowDraft.value = true
  workflowSaveResult.value = null
  try {
    const res = await upgradeWorkflowDraft({
      workflowDraft: latestWorkflowDraft.value,
      targetWorkflowId: workflowComparisonSummary.value?.workflowId || null,
    })
    workflowUpgradeResult.value = res.data || null
    applyPendingCandidateFromResult(latestWorkflowDraft.value, res.data || null)
    refreshSelectionAfterWorkflowMutation(res.data?.workflowId || latestWorkflowDraft.value.workflowId, latestWorkflowDraft.value)
  }
  catch (error) {
    console.error('Failed to upgrade workflow draft:', error)
    workflowUpgradeResult.value = {
      accepted: false,
      message: 'Failed to create workflow upgrade candidate',
    }
  }
  finally {
    upgradingWorkflowDraft.value = false
  }
}

async function handleSaveWorkflowDraft() {
  if (!latestWorkflowDraft.value || savingWorkflowDraft.value) return

  savingWorkflowDraft.value = true
  try {
    const res = await saveWorkflowDraft({
      workflowDraft: latestWorkflowDraft.value,
    })
    workflowSaveResult.value = res.data || null
    applyPendingCandidateFromResult(latestWorkflowDraft.value, res.data || null)
    refreshSelectionAfterWorkflowMutation(res.data?.workflowId || latestWorkflowDraft.value.workflowId, latestWorkflowDraft.value)
  }
  catch (error) {
    console.error('Failed to save workflow draft:', error)
    workflowSaveResult.value = {
      accepted: false,
      message: 'Failed to save workflow draft',
    }
  }
  finally {
    savingWorkflowDraft.value = false
  }
}

async function handleAcceptWorkflowUpgrade() {
  if (!latestWorkflowDraft.value || acceptingWorkflowUpgrade.value) return

  acceptingWorkflowUpgrade.value = true
  try {
    const res = await acceptWorkflowUpgrade({
      workflowDraft: latestWorkflowDraft.value,
      targetWorkflowId: workflowUpgradeResult.value?.targetWorkflowId || workflowComparisonSummary.value?.workflowId || null,
    })
    workflowSaveResult.value = res.data || null
    applyPendingCandidateFromResult(latestWorkflowDraft.value, {
      ...res.data,
      targetWorkflowId: workflowUpgradeResult.value?.targetWorkflowId || workflowComparisonSummary.value?.workflowId || null,
      targetWorkflowName: workflowUpgradeResult.value?.targetWorkflowName || workflowComparisonSummary.value?.name || null,
    })
    refreshSelectionAfterWorkflowMutation(res.data?.workflowId || latestWorkflowDraft.value.workflowId, latestWorkflowDraft.value)
  }
  catch (error) {
    console.error('Failed to accept workflow upgrade:', error)
    workflowSaveResult.value = {
      accepted: false,
      message: 'Failed to accept workflow upgrade',
    }
  }
  finally {
    acceptingWorkflowUpgrade.value = false
  }
}

function selectWorkflow(workflow: any) {
  selectedWorkflow.value = workflow
  clearWorkflowActionState()
  const firstCapability = workflowCapabilities(workflow)[0]
  if (firstCapability)
    selectCapabilityDetail(firstCapability)
}

function workflowNodeSummary(node: any) {
  if (node.type === 'capability')
    return `${node.label} → ${node.capability || 'unknown capability'}`
  return `${node.label} (${node.type})`
}

function workflowEdgeSummary(edge: any) {
  if (edge.when?.result)
    return `${edge.from} -> ${edge.to} [${edge.when.result}]`
  if (edge.when?.expression)
    return `${edge.from} -> ${edge.to} [${edge.when.expression}]`
  return `${edge.from} -> ${edge.to}`
}

function workflowNodeMetaLines(node: any) {
  const lines: string[] = []
  if (node?.nodeId)
    lines.push(`nodeId: ${node.nodeId}`)
  if (node?.policy?.riskLevel)
    lines.push(`risk: ${node.policy.riskLevel}`)
  if (node?.command?.input)
    lines.push(`input: ${JSON.stringify(node.command.input)}`)
  return lines
}

function workflowEdgeMetaLines(edge: any) {
  const lines: string[] = []
  if (edge?.edgeId)
    lines.push(`edgeId: ${edge.edgeId}`)
  if (edge?.label)
    lines.push(`label: ${edge.label}`)
  return lines
}

const registryCapabilityMap = computed(() => {
  const list = Array.isArray(registryPreview.value?.registry?.capabilities)
    ? registryPreview.value.registry.capabilities
    : []
  return new Map(list.map((item: any) => [item.capability, item]))
})

function workflowCapabilities(workflow: any): string[] {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : []
  const capabilities: string[] = []
  nodes.forEach((item: any) => {
    if (typeof item.capability === 'string' && item.capability.length > 0)
      capabilities.push(item.capability)
  })
  return Array.from(new Set(capabilities))
}

function selectCapabilityDetail(capability: string) {
  selectedCapability.value = registryCapabilityMap.value.get(capability) || null
}

function capabilityExposureRefs(capability: string) {
  const skills = Array.isArray(registryPreview.value?.registry?.skills) ? registryPreview.value.registry.skills : []
  return skills
    .filter((item: any) => Array.isArray(item.metadata?.capabilities) && item.metadata.capabilities.includes(capability))
    .map((item: any) => item.ref)
}

function formatRequiredInputs(entry: any) {
  return Array.isArray(entry?.requiredInputs) && entry.requiredInputs.length > 0
    ? entry.requiredInputs.join(', ')
    : 'none'
}

function capabilityDetailLines(entry: any) {
  if (!entry) return []
  return [
    `tool: ${entry.preferredTool || 'none'}`,
    `action: ${entry.action || 'none'}`,
    `risk: ${entry.riskLevel || 'unknown'}`,
    `required inputs: ${formatRequiredInputs(entry)}`,
    `skills: ${capabilityExposureRefs(entry.capability).join('、') || 'none'}`,
  ]
}

function workflowCapabilityButtonClass(capability: string) {
  return selectedCapability.value?.capability === capability
    ? 'rounded border border-[#93c5fd] bg-[#eff6ff] px-2 py-0.5 text-[11px] text-[#1d4ed8] dark:border-[#1d4ed8] dark:bg-[#172554] dark:text-[#bfdbfe]'
    : 'rounded border border-[#d1d5db] px-2 py-0.5 text-[11px] dark:border-[#3a3a40]'
}

function formatMessage(msg: any): ChatMessage {
  const date = new Date(msg.created_at || Date.now())
  const utcTime = date.getTime()
  const chinaTime = new Date(utcTime + 8 * 60 * 60 * 1000)
  return {
    id: msg.id || Date.now(),
    role: msg.role,
    content: msg.content,
    created_at: msg.created_at,
    dateTime: `${chinaTime.getFullYear()}/${String(chinaTime.getMonth() + 1).padStart(2, '0')}/${String(chinaTime.getDate()).padStart(2, '0')} ${String(chinaTime.getHours()).padStart(2, '0')}:${String(chinaTime.getMinutes()).padStart(2, '0')}:${String(chinaTime.getSeconds()).padStart(2, '0')}`,
    text: msg.content,
    inversion: msg.role === 'user',
    error: false,
    loading: false,
    trace: msg.trace || [],
    writeBackResults: msg.writeBackResults || [],
    llm: msg.llm,
    skillsHint: msg.skillsHint || [],
    registryDebug: msg.registryDebug,
    resolutionMeta: msg.resolutionMeta || msg.registryDebug?.resolutionMeta,
    workflowDraft: msg.workflowDraft || msg.resolutionMeta?.workflowDraft,
  }
}

function syncRuntimePanelFromMessages() {
  const latestAssistant = [...messages.value].reverse().find(item => !item.inversion)
  if (!latestAssistant) {
    runtimePanelStore.clearRuntime()
    return
  }

  runtimePanelStore.setLatestRuntime({
    latestText: latestAssistant.text,
    latestAt: latestAssistant.dateTime,
    trace: (latestAssistant.trace || []).map(item => ({
      stage: item.stage,
      ok: item.ok,
      next: item.next,
    })),
    resolutionMeta: latestAssistant.resolutionMeta || latestAssistant.registryDebug?.resolutionMeta || null,
  })
}

function mergeMessagesById(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const merged = new Map<number, ChatMessage>()

  for (const item of existing)
    merged.set(item.id, item)

  for (const item of incoming)
    merged.set(item.id, item)

  return [...merged.values()].sort((left, right) => left.id - right.id)
}

function syncPaginationState(pageInfo?: Partial<MessagePageInfo> | null) {
  if (pageInfo?.oldestCursorId != null) {
    oldestCursorId.value = pageInfo.oldestCursorId
    return
  }

  oldestCursorId.value = messages.value[0]?.id ?? null
}

async function ensureScrollableHistory() {
  let attempts = 0

  while (hasMoreOlder.value && attempts < 10) {
    await nextTick()
    const container = scrollRef.value

    if (!container)
      return

    if (container.scrollHeight > container.clientHeight + 8)
      return

    await loadFromBackend('older')
    attempts += 1
  }
}

async function loadFromBackend(direction: 'latest' | 'older' = 'latest') {
  const isOlderLoad = direction === 'older'

  if (isOlderLoad) {
    if (loadingMore.value || !hasMoreOlder.value || oldestCursorId.value == null)
      return
    loadingMore.value = true
  }

  const requestId = ++loadRequestSequence

  try {
    const res = await fetchMessages<{ messages: any[], pageInfo?: MessagePageInfo }>({
      limit: PAGE_SIZE,
      direction,
      cursorId: isOlderLoad ? oldestCursorId.value ?? undefined : undefined,
    })
    const backendMessages = res.data?.messages || []
    const pageInfo = res.data?.pageInfo
    const formatted = backendMessages.map(formatMessage)

    if (!isOlderLoad) {
      if (requestId !== loadRequestSequence)
        return

      messages.value = mergeMessagesById([], formatted)
      setCachedMessages(messages.value)
      hasMoreOlder.value = pageInfo?.hasOlder ?? backendMessages.length === PAGE_SIZE
      syncPaginationState(pageInfo)
      syncRuntimePanelFromMessages()
      scrollToBottom()
    } else if (backendMessages.length > 0) {
      const container = scrollRef.value
      const prevScrollHeight = container?.scrollHeight || 0

      messages.value = mergeMessagesById(formatted, messages.value)
      setCachedMessages(messages.value)
      hasMoreOlder.value = pageInfo?.hasOlder ?? backendMessages.length === PAGE_SIZE
      syncPaginationState(pageInfo)
      syncRuntimePanelFromMessages()

      await nextTick()
      if (container) {
        container.scrollTop = container.scrollHeight - prevScrollHeight
      }
    } else {
      hasMoreOlder.value = pageInfo?.hasOlder ?? false
    }

    if (!backendMessages.length && !isOlderLoad)
      hasMoreOlder.value = pageInfo?.hasOlder ?? false
  } catch (error) {
    console.error('Failed to load from backend:', error)
  } finally {
    loadingMore.value = false
  }
}

async function initMessages() {
  // TODO: 暂时禁用缓存，直接从后端加载
  // loadFromCache()
  await loadFromBackend('latest')
  await ensureScrollableHistory()
  await scrollToBottom()
  try {
    const [registryRes, workflowRes, candidateRes] = await Promise.all([
      fetchRegistryPreview<any>(),
      fetchWorkflowExamples<any>(),
      fetchWorkflowCandidates<any>(),
    ])
    registryPreview.value = registryRes.data || null
    workflowPreview.value = workflowRes.data?.workflows || []
    pendingWorkflowCandidates.value = (candidateRes.data?.workflows || []).map((item: any) => buildPendingWorkflowCandidate(item.workflow || item, {
      workflowId: item.workflowId,
      workflowName: item.name,
      mode: item.status === 'accepted' ? 'accepted_candidate' : (item.status || item.source || 'pending_candidate'),
      targetWorkflowId: item.targetWorkflowId,
      targetWorkflowName: item.targetWorkflowName,
    }))
    clearSelectedCapabilityIfMissing()
    selectLatestDraftIfIdle()
  }
  catch (error) {
    console.error('Failed to load preview data:', error)
  }
}

async function handleScroll() {
  const container = scrollRef.value
  if (!container || loadingMore.value || !hasMoreOlder.value) return
  if (container.scrollTop < 50) {
    await loadFromBackend('older')
  }
}

async function sendMessage() {
  const message = prompt.value
  if (loading.value) return
  if (!message || message.trim() === '') return

  const previousDraftId = latestAssistantWorkflowDraftId()

  loading.value = true
  prompt.value = ''

  const userMsg: ChatMessage = {
    id: Date.now(),
    role: 'user',
    content: message,
    created_at: new Date().toISOString(),
    dateTime: new Date().toLocaleString(),
    text: message,
    inversion: true,
    error: false,
    loading: false,
  }
  messages.value.push(userMsg)
  scrollToBottom()

  const thinkingMsg: ChatMessage = {
    id: Date.now() + 1,
    role: 'assistant',
    content: t('chat.thinking'),
    created_at: new Date().toISOString(),
    dateTime: new Date().toLocaleString(),
    text: t('chat.thinking'),
    inversion: false,
    error: false,
    loading: true,
    trace: [],
    writeBackResults: [],
    llm: undefined,
    skillsHint: [],
  }
  messages.value.push(thinkingMsg)
  scrollToBottom()

  try {
    const res = await fetchChatAPI(message)

    messages.value[messages.value.length - 1] = {
      ...thinkingMsg,
      id: typeof res.data?.messageId === 'number' ? res.data.messageId : thinkingMsg.id,
      text: res.data?.reply || '好的',
      content: res.data?.reply || '好的',
      error: false,
      loading: false,
      trace: res.data?.trace || [],
      writeBackResults: res.data?.writeBackResults || [],
      llm: res.data?.llm,
      skillsHint: res.data?.skillsHint || [],
      registryDebug: res.data?.registryDebug || (res.data?.resolutionMeta ? { resolutionMeta: res.data.resolutionMeta } : undefined),
      resolutionMeta: res.data?.resolutionMeta,
      workflowDraft: res.data?.workflowDraft || res.data?.resolutionMeta?.workflowDraft,
    }
    syncRuntimePanelFromMessages()
    handleIncomingWorkflowDraft(previousDraftId)
    scrollToBottom()
  } catch (error: any) {
    const errorMessage = error?.message ?? t('common.wrong')
    messages.value[messages.value.length - 1] = {
      ...thinkingMsg,
      text: errorMessage,
      content: errorMessage,
      error: true,
      loading: false,
    }
    scrollToBottomIfAtBottom()
  } finally {
    loading.value = false
  }
}

function handleClear() {
  if (loading.value) return
  messages.value = []
  hasMoreOlder.value = false
  oldestCursorId.value = null
  runtimePanelStore.clearRuntime()
  clearCachedMessages()
}

function handleDelete(index: number) {
  if (loading.value) return
  messages.value.splice(index, 1)
  setCachedMessages(messages.value)
}

function handleEnter(event: KeyboardEvent) {
  if (!isMobile.value) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  } else {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault()
      sendMessage()
    }
  }
}

const placeholder = computed(() => {
  if (isMobile.value) return t('chat.placeholderMobile')
  return t('chat.placeholder')
})

const buttonDisabled = computed(() => {
  return loading.value || !prompt.value || prompt.value.trim() === ''
})

const footerClass = computed(() => {
  let classes = ['p-4']
  if (isMobile.value) classes = ['sticky', 'left-0', 'bottom-0', 'right-0', 'p-2', 'pr-3', 'overflow-hidden']
  return classes
})

onMounted(() => {
  initMessages()
  if (inputRef.value && !isMobile.value) inputRef.value?.focus()
})

</script>

<template>
  <div class="flex flex-col w-full h-full">
    <HeaderComponent
      v-if="isMobile"
      :using-context="false"
      @export="() => {}"
      @handle-clear="handleClear"
    />
    <main class="flex-1 overflow-hidden">
      <!-- Demo Mode: Capability & Workflow Preview 面板已隐藏 -->
      <div v-if="false" class="w-full max-w-screen-xl m-auto px-4 pt-2">
        <div class="rounded-md border border-[#e5e7eb] bg-white/70 p-2 text-xs text-[#4b5563] dark:border-[#2a2a2d] dark:bg-[#151518] dark:text-[#c7c9d1]">
          <button class="flex w-full items-center justify-between" @click="showPreviewPanel = !showPreviewPanel">
            <span>Capability & Workflow Preview</span>
            <SvgIcon :icon="showPreviewPanel ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'" />
          </button>
          <div v-if="showPreviewPanel" class="mt-2 space-y-2">
            <div class="flex items-center justify-between rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]">
              <div>
                <div class="font-medium">Preview Mode</div>
                <div class="text-[11px] text-[#9ca3af]">{{ showPreviewDebug ? 'Debug details are visible' : 'Showing the normal summary view' }}</div>
              </div>
              <button
                class="rounded border border-[#d1d5db] px-2 py-0.5 text-[11px] dark:border-[#3a3a40]"
                @click="showPreviewDebug = !showPreviewDebug"
              >
                {{ showPreviewDebug ? 'Hide Debug' : 'Show Debug' }}
              </button>
            </div>
            <div class="rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]">
              <div>Capabilities: {{ registryPreview?.registry?.capabilities?.length || 0 }}</div>
              <div>Skills: {{ registryPreview?.registry?.skills?.length || 0 }}</div>
              <div>Current refs: {{ (registryPreview?.refs || []).join('、') || 'none' }}</div>
              <div v-if="showPreviewDebug && selectedCapability" class="mt-2 border-t border-[#e5e7eb] pt-2 dark:border-[#2a2a2d]">
                <div class="font-medium">Capability Detail</div>
                <div>{{ selectedCapability.capability }}</div>
                <div class="mt-1 rounded bg-[#ffffff] px-2 py-1 text-[#4b5563] dark:bg-[#111214] dark:text-[#c7c9d1]">
                  <div v-for="line in capabilityDetailLines(selectedCapability)" :key="line" class="leading-5">{{ line }}</div>
                </div>
              </div>
            </div>
            <div class="rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]">
              <div class="font-medium mb-1">{{ workflowPanelTitle }}</div>
              <div class="mb-1 text-[11px] text-[#9ca3af]">{{ workflowPanelSubtitle }}</div>
              <div class="mb-2 rounded bg-[#ffffff] px-2 py-1 text-[#4b5563] dark:bg-[#111214] dark:text-[#c7c9d1]">
                <div v-for="line in workflowPreviewSummaryLines" :key="line">{{ line }}</div>
              </div>
              <div v-if="!hasWorkflowPreviewItems">{{ workflowPreviewEmptyText }}</div>
              <div v-for="section in workflowPreviewSections" :key="section.key" class="mb-3 rounded bg-[#ffffff] px-2 py-2 dark:bg-[#111214]">
                <div class="font-medium">{{ section.title }}</div>
                <div v-if="section.caption" class="mb-1 text-[11px] text-[#9ca3af]">{{ section.caption }}</div>
                <div v-if="section.items.length === 0" class="text-[#9ca3af]">{{ section.emptyText }}</div>
                <div v-for="item in section.items" :key="`${section.key}-${item.workflowId}`" class="mt-2 rounded border border-[#eef0f3] px-2 py-2 dark:border-[#2a2a2d]">
                  <button class="w-full text-left" @click="selectWorkflow(item)">
                    <div class="flex items-center gap-2">
                      <span>{{ item.name }}</span>
                      <span :class="workflowBadgeClass(item)" class="rounded px-1.5 py-0.5 text-[10px]">{{ workflowGroupBadge(item) }}</span>
                    </div>
                    <div v-if="workflowListItemMetaLines(item).length" class="mt-1 rounded bg-[#f6f8fa] px-2 py-1 text-[#6b7280] dark:bg-[#1d1f23] dark:text-[#9ca3af]">
                      <div v-for="line in workflowListItemMetaLines(item)" :key="line" class="leading-5">{{ line }}</div>
                    </div>
                    <div class="mt-1 text-[#9ca3af]">{{ item.description || item.goal || 'No description' }}</div>
                    <div class="mt-1 text-[#9ca3af]">nodes: {{ item.nodes?.length || 0 }} · edges: {{ item.edges?.length || 0 }}</div>
                  </button>
                  <div v-if="showPreviewDebug" class="mt-2 flex flex-wrap gap-1">
                    <button
                      v-for="capability in workflowCapabilities(item)"
                      :key="`${section.key}-${item.workflowId}-${capability}`"
                      :class="workflowCapabilityButtonClass(capability)"
                      @click="selectCapabilityDetail(capability)"
                    >
                      {{ capability }}
                    </button>
                  </div>
                </div>
              </div>


              <div v-if="showPreviewDebug && selectedWorkflow" class="mt-2 border-t border-[#e5e7eb] pt-2 dark:border-[#2a2a2d]">
                <div class="font-medium">Workflow Detail</div>
                <div class="flex items-center gap-2">
                  <span>{{ selectedWorkflow.name }}</span>
                  <span :class="selectedWorkflowBadgeClass" class="rounded px-1.5 py-0.5 text-[10px]">{{ selectedWorkflowBadge }}</span>
                </div>
                <div v-if="selectedWorkflowShowMetaBlock" class="mt-1 rounded bg-[#ffffff] px-2 py-1 text-[#6b7280] dark:bg-[#111214] dark:text-[#9ca3af]">
                  <div v-for="line in selectedWorkflowMetaBlockLines" :key="line" class="leading-5">{{ line }}</div>
                </div>
                <div :class="selectedWorkflowDescriptionClass">{{ selectedWorkflow.description || selectedWorkflow.goal || 'No description' }}</div>
                <div class="mt-1 text-[#9ca3af]">workflowId: {{ selectedWorkflow.workflowId }}</div>
                <div v-if="workflowComparisonSummary" class="mt-1 rounded bg-[#ffffff] px-2 py-1 text-[#4b5563] dark:bg-[#111214] dark:text-[#c7c9d1]">
                  <div>matched example: {{ workflowComparisonSummary?.name }}</div>
                  <div class="mt-1 flex flex-wrap gap-1">
                    <span
                      v-for="capability in (workflowComparisonSummary?.sharedCapabilities || [])"
                      :key="`shared-${capability}`"
                      :class="workflowCapabilityButtonClass(capability)"
                    >
                      {{ capability }}
                    </span>
                    <span v-if="!(workflowComparisonSummary?.sharedCapabilities?.length)" class="text-[#9ca3af]">none</span>
                  </div>
                </div>
                <div v-if="selectedWorkflowIsDraft" class="mt-2">
                  <div class="flex flex-wrap gap-2">
                    <NButton size="small" type="primary" :loading="upgradingWorkflowDraft" @click="handleUpgradeWorkflowDraft">
                      Upgrade Draft
                    </NButton>
                    <NButton size="small" :loading="savingWorkflowDraft" @click="handleSaveWorkflowDraft">
                      Save Draft
                    </NButton>
                    <NButton size="small" type="success" :disabled="!workflowUpgradeResult" :loading="acceptingWorkflowUpgrade" @click="handleAcceptWorkflowUpgrade">
                      Accept Upgrade
                    </NButton>
                  </div>
                  <div v-if="workflowUpgradeResult" class="mt-2 rounded bg-[#ffffff] px-2 py-1 text-[#4b5563] dark:bg-[#111214] dark:text-[#c7c9d1]">
                    <div>{{ workflowUpgradeResult.message || 'Upgrade candidate prepared' }}</div>
                    <div>mode: {{ workflowUpgradeResult.mode || 'unknown' }}</div>
                    <div>next: {{ workflowUpgradeResult.next || 'unknown' }}</div>
                    <div v-if="workflowUpgradeResult.targetWorkflowName">target: {{ workflowUpgradeResult.targetWorkflowName }}</div>
                    <div v-if="Array.isArray(workflowUpgradeResult.sharedCapabilities) && workflowUpgradeResult.sharedCapabilities.length">shared: {{ workflowUpgradeResult.sharedCapabilities.join('、') }}</div>
                  </div>
                  <div v-if="workflowSaveResult" class="mt-2 rounded bg-[#ffffff] px-2 py-1 text-[#4b5563] dark:bg-[#111214] dark:text-[#c7c9d1]">
                    <div>{{ workflowSaveResult.message || 'Workflow action prepared' }}</div>
                    <div v-if="workflowSaveResult.mode">mode: {{ workflowSaveResult.mode }}</div>
                    <div v-if="workflowSaveResult.next">next: {{ workflowSaveResult.next }}</div>
                    <div v-if="workflowSaveResult.workflowName">workflow: {{ workflowSaveResult.workflowName }}</div>
                    <div v-else-if="workflowSaveResult.name">workflow: {{ workflowSaveResult.name }}</div>
                    <div v-if="workflowSaveResult.workflowId">workflowId: {{ workflowSaveResult.workflowId }}</div>
                    <div v-if="typeof workflowSaveResult.mergedNodeCount === 'number'">merged nodes: {{ workflowSaveResult.mergedNodeCount }}</div>
                    <div v-if="typeof workflowSaveResult.mergedEdgeCount === 'number'">merged edges: {{ workflowSaveResult.mergedEdgeCount }}</div>
                  </div>
                </div>
                <div class="mt-2">
                  <div class="font-medium mb-1">Nodes</div>
                  <div v-for="node in (selectedWorkflow.nodes || [])" :key="node.nodeId" class="mb-2 rounded border border-[#eef0f3] bg-[#ffffff] px-2 py-2 dark:border-[#2a2a2d] dark:bg-[#111214]">
                    <div>{{ workflowNodeSummary(node) }}</div>
                    <div v-if="workflowNodeMetaLines(node).length" class="mt-1 rounded bg-[#f6f8fa] px-2 py-1 text-[#6b7280] dark:bg-[#1d1f23] dark:text-[#9ca3af]">
                      <div v-for="line in workflowNodeMetaLines(node)" :key="line" class="leading-5">{{ line }}</div>
                    </div>
                  </div>
                </div>
                <div class="mt-2">
                  <div class="font-medium mb-1">Edges</div>
                  <div v-for="edge in (selectedWorkflow.edges || [])" :key="edge.edgeId" class="mb-2 rounded border border-[#eef0f3] bg-[#ffffff] px-2 py-2 dark:border-[#2a2a2d] dark:bg-[#111214]">
                    <div>{{ workflowEdgeSummary(edge) }}</div>
                    <div v-if="workflowEdgeMetaLines(edge).length" class="mt-1 rounded bg-[#f6f8fa] px-2 py-1 text-[#6b7280] dark:bg-[#1d1f23] dark:text-[#9ca3af]">
                      <div v-for="line in workflowEdgeMetaLines(edge)" :key="line" class="leading-5">{{ line }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="scrollRef" ref="scrollRef" class="h-full overflow-hidden overflow-y-auto" @scroll="handleScroll">
        <div
          class="w-full max-w-screen-xl m-auto dark:bg-[#101014]"
          :class="[isMobile ? 'p-2' : 'p-4']"
        >
          <div id="image-wrapper" class="relative">
            <template v-if="loadingMore">
              <div class="flex justify-center py-4">
                <div class="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
              </div>
            </template>
            <template v-if="!messages.length && !loadingMore">
              <div class="flex items-center justify-center mt-4 text-center text-neutral-300">
                <SvgIcon icon="ri:bubble-chart-fill" class="mr-2 text-3xl" />
                <span>{{ t('chat.newChatTitle') }}</span>
              </div>
            </template>
            <template v-else>
              <div>
                <Message
                  v-for="(item, index) of messages"
                  :key="item.id"
                  :date-time="item.dateTime"
                  :text="item.text"
                  :inversion="item.inversion"
                  :error="item.error"
                  :loading="item.loading"
                  :trace="item.trace"
                  :write-back-results="item.writeBackResults"
                  :llm="item.llm"
                  :skills-hint="item.skillsHint"
                  :registry-debug="item.registryDebug"
                  :workflow-draft="item.workflowDraft"
                  @regenerate="() => {}"
                  @delete="handleDelete(index)"
                />
                <div class="sticky bottom-0 left-0 flex justify-center">
                  <NButton v-if="loading" type="warning">
                    <template #icon>
                      <SvgIcon icon="ri:loader-4-line" class="animate-spin" />
                    </template>
                    处理中...
                  </NButton>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </main>
    <footer :class="footerClass">
      <div class="w-full max-w-screen-xl m-auto">
        <div class="flex items-center justify-between space-x-2">
          <HoverButton v-if="!isMobile" @click="handleClear">
            <span class="text-xl text-[#4f555e] dark:text-white">
              <SvgIcon icon="ri:delete-bin-line" />
            </span>
          </HoverButton>
          <NInput
            ref="inputRef"
            v-model:value="prompt"
            type="textarea"
            :placeholder="placeholder"
            :autosize="{ minRows: 1, maxRows: isMobile ? 4 : 8 }"
            @keypress="handleEnter"
          />
          <NButton type="primary" :disabled="buttonDisabled" @click="sendMessage">
            <template #icon>
              <span class="dark:text-black">
                <SvgIcon icon="ri:send-plane-fill" />
              </span>
            </template>
          </NButton>
        </div>
      </div>
    </footer>
  </div>
</template>
