<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { NButton, NCard, NCode, NEmpty, NInput, NSelect, NSpace, NSpin, NTabPane, NTabs, useMessage } from 'naive-ui'
import { fetchTools, fetchToolConfig, updateToolConfig, fetchExperiencePaths, repairExperiencePathSkills, normalizeExperiencePathData, fetchExperiencePathClusters, fetchStrongClusterMergePreview, fetchWeakClusterMergePreview, fetchExperiencePathMergeAudit, clearExperiencePathMergeAudit, mergeExperiencePathCluster, mergeStrongExperiencePathClusters, mergeWeakExperiencePathClusters, fetchRuleCandidates, fetchRules, fetchToolSkills, fetchToolSkillSections, fetchToolSkillsPolicy, promoteRuleCandidate, disableRule, enableRule, rollbackRule } from '@/api'
import { SvgIcon } from '@/components/common'

interface Tool {
  name: string
  description: string
  hasConfig: boolean
}

interface ExperiencePath {
  id: string
  name: string
  input?: string
  description: string
  reuseCount: number
  successRate: number
  maturity?: string
  intent?: string
  promotedRule?: boolean
  contextSnapshot?: Record<string, any>
  llmSummary?: {
    intentHint?: string
    plan?: string[]
    nextHint?: string
    selectedSkills?: string[]
    selectedSkillsSource?: 'recorded' | 'repaired'
    skillInsights?: Array<{
      tool: string
      section: string
      headline?: string
    }>
  }
  toolResultsSummary?: Array<{
    tool: string
    action: string
    success: boolean
    error?: string
  }>
  failureReason?: string
}

interface RuleCandidate {
  trigger: string
  intent: string
  actions?: Array<Record<string, any>>
  responsePreview?: string
  successRate?: number
  reuseCount?: number
  maturity?: string
  recommended?: boolean
  recommendationReason?: string
  sourcePathId: string
  status: string
  contextSnapshot?: Record<string, any>
  llmSummary?: {
    selectedSkills?: string[]
    selectedSkillsSource?: 'recorded' | 'repaired'
  }
}

interface PersistedRule {
  id: number
  trigger: string
  response: string
  actions?: Array<Record<string, any>>
  enabled?: boolean
  hit_count?: number
  last_matched_at?: string
}

interface SkillPolicyPreviewItem {
  stage: string
  refs: string[]
}

interface ToolSkillsPolicyResponse {
  tool: string
  input: string
  intent: string | null
  stages: SkillPolicyPreviewItem[]
  refs: string[]
  globalStages: SkillPolicyPreviewItem[]
  globalRefs: string[]
}

interface RepairStats {
  updated?: number
  skipped?: number
  sourceTagged?: number
  scanned: number
  distribution?: Record<string, number>
  normalized?: number
}

interface ExperiencePathClusterItem {
  id: string
  input?: string
  name: string
  description: string
  successRate: number
  failureReason?: string
  score?: number
  suggestedRole?: 'primary' | 'merge_candidate'
}

interface ExperiencePathCluster {
  id: string
  intent: string
  actionSignature: string
  size: number
  confidence: 'strong' | 'weak'
  sampleInput: string
  suggestedPrimaryPathId?: string
  suggestedMergeCandidateIds?: string[]
  paths: ExperiencePathClusterItem[]
}

interface StrongClusterMergePreview {
  clusterCount: number
  totalMergeCandidates: number
  clusters: Array<{
    id: string
    confidence: 'strong' | 'weak'
    intent: string
    sampleInput: string
    primaryId?: string
    mergeIds?: string[]
  }>
}

type WeakClusterMergePreview = StrongClusterMergePreview

interface MergeAudit {
  mode: 'single' | 'strong_batch' | 'weak_batch'
  mergedCount: number
  primaryId?: string
  mergedIds?: string[]
  preview?: StrongClusterMergePreview
  updatedAt: number
}

interface MergeAuditPayload {
  current: MergeAudit | null
  history: MergeAudit[]
}

interface MergeAuditPreviewClusterItem {
  id: string
  confidence: 'strong' | 'weak'
  intent: string
  sampleInput: string
  primaryId?: string
  mergeIds?: string[]
}

function mergeAuditModeText(mode?: MergeAudit['mode'] | 'all' | null) {
  return mode === 'strong_batch'
    ? '强置信批量合并'
    : mode === 'weak_batch'
      ? '弱置信批量合并'
      : mode === 'single'
        ? '单次合并'
        : mode === 'all'
          ? '全部审计'
          : '未知'
}

function sourceText(source?: string) {
  return source === 'repaired' ? '历史估算补全' : source === 'recorded' ? '运行时真实记录' : '未知'
}

function anomalyText(type?: string) {
  return type === 'long_error'
    ? '长错误文本'
    : type === 'failure'
      ? '失败'
      : type === 'normalized'
        ? '已归一化错误'
        : type === 'repaired'
          ? '历史补全'
          : ''
}

function mergeAuditModeOptionList() {
  return [
    { label: mergeAuditModeText('all'), value: 'all' },
    { label: mergeAuditModeText('single'), value: 'single' },
    { label: mergeAuditModeText('strong_batch'), value: 'strong_batch' },
    { label: mergeAuditModeText('weak_batch'), value: 'weak_batch' },
  ]
}

function maturityOptions() {
  return [
    { label: '全部成熟度', value: 'all' },
    { label: maturityLabel('new'), value: 'new' },
    { label: maturityLabel('warming'), value: 'warming' },
    { label: maturityLabel('ready'), value: 'ready' },
    { label: maturityLabel('promoted'), value: 'promoted' },
  ]
}

function candidateFilterOptions() {
  return [
    { label: '全部候选', value: 'all' },
    { label: '推荐候选', value: 'recommended' },
    { label: '待处理候选', value: 'pending' },
    { label: maturityLabel('promoted'), value: 'promoted' },
  ]
}

function provenanceOptions() {
  return [
    { label: '全部来源', value: 'all' },
    { label: sourceText('recorded'), value: 'recorded' },
    { label: sourceText('repaired'), value: 'repaired' },
  ]
}

function clusterConfidenceOptions() {
  return [
    { label: '全部簇', value: 'all' },
    { label: confidenceLabel('strong'), value: 'strong' },
    { label: confidenceLabel('weak'), value: 'weak' },
  ]
}

function previewModeLabel(mode: 'strong_batch' | 'weak_batch') {
  return mode === 'strong_batch' ? '强置信' : '弱置信'
}

function mergeAuditModeLabel(audit: MergeAudit | null) {
  return mergeAuditModeText(audit?.mode)
}

function mergeAuditModeBadgeClass(audit: MergeAudit | null) {
  return governanceBadgeClass(audit?.mode === 'weak_batch'
    ? 'weak'
    : audit?.mode === 'strong_batch'
      ? 'strong'
      : 'single')
}

function mergeAuditSummaryText(audit: MergeAudit | null) {
  if (!audit) return '暂无审计记录'
  if (audit.mode === 'single') return `${mergeAuditModeText(audit.mode)} / 合并数: ${audit.mergedCount}`
  return `${mergeAuditModeText(audit.mode)} / 合并数: ${audit.mergedCount} / 预览簇数: ${audit.preview?.clusterCount || 0} / 预览候选数: ${audit.preview?.totalMergeCandidates || 0}`
}

function mergeAuditUpdatedAtText(audit: MergeAudit | null) {
  return audit ? new Date(audit.updatedAt).toLocaleString() : '-'
}

function mergeAuditPreviewItems(audit: MergeAudit | null): MergeAuditPreviewClusterItem[] {
  return audit?.preview?.clusters || []
}

function mergeAuditPreviewTitle(audit: MergeAudit | null) {
  return `${previewModeLabel(audit?.mode === 'weak_batch' ? 'weak_batch' : 'strong_batch')}预览明细`
}

function mergeAuditPreviewText(item: MergeAuditPreviewClusterItem) {
  return `${item.intent} / ${item.sampleInput}`
}

function mergeAuditPreviewMetaText(item: MergeAuditPreviewClusterItem) {
  return `主路径: ${item.primaryId || '-'} / 合并项: ${(item.mergeIds || []).join(', ') || '-'}`
}

function confidenceBadgeClass(kind: 'strong' | 'weak') {
  return governanceBadgeClass(kind)
}

function mergeAuditPreviewBadgeClass(item: MergeAuditPreviewClusterItem) {
  return confidenceBadgeClass(item.confidence)
}

function mergeAuditEmptyPreviewText(audit: MergeAudit | null) {
  if (!audit?.preview) return '当前审计没有预览信息'
  return audit.mode === 'single' ? '单次合并没有批量预览信息' : `${previewModeLabel(audit.mode)}预览当时没有候选簇`
}

function mergeAuditModeOptions() {
  return mergeAuditModeOptionList()
}

function maturitySelectOptions() {
  return maturityOptions()
}

function candidateSelectOptions() {
  return candidateFilterOptions()
}

function provenanceSelectOptions() {
  return provenanceOptions()
}

function clusterConfidenceSelectOptions() {
  return clusterConfidenceOptions()
}

function anomalyOptions() {
  return [
    { label: '全部异常态', value: 'all' },
    { label: anomalyText('failure'), value: 'failure' },
    { label: anomalyText('repaired'), value: 'repaired' },
    { label: anomalyText('long_error'), value: 'long_error' },
    { label: anomalyText('normalized'), value: 'normalized' },
  ]
}

function mergeAuditModeFilterLabel() {
  return mergeAuditModeText(mergeAuditModeFilter.value)
}

function clusterConfidenceFilterSummaryLabel() {
  return clusterConfidenceFilter.value === 'all' ? '全部' : confidenceLabel(clusterConfidenceFilter.value)
}

function filterSummaryLabel() {
  const parts: string[] = []
  if (provenanceFilter.value !== 'all') parts.push(`来源:${sourceText(provenanceFilter.value)}`)
  if (anomalyFilter.value !== 'all') parts.push(`异常:${anomalyText(anomalyFilter.value)}`)
  if (mergeAuditModeFilter.value !== 'all') parts.push(`审计:${mergeAuditModeFilterLabel()}`)
  if (clusterConfidenceFilter.value !== 'all') parts.push(`簇:${clusterConfidenceFilterSummaryLabel()}`)
  return parts.join(' / ')
}

function showFilterSummaryLabel() {
  return filterSummaryLabel().length > 0
}

function clearBadgeFilterButtonVisible() {
  return provenanceFilter.value !== 'all'
    || anomalyFilter.value !== 'all'
    || mergeAuditModeFilter.value !== 'all'
    || clusterConfidenceFilter.value !== 'all'
}

function onClearBadgeFilterButtonClick() {
  provenanceFilter.value = 'all'
  anomalyFilter.value = 'all'
  mergeAuditModeFilter.value = 'all'
  clusterConfidenceFilter.value = 'all'
  loadInsights()
}

function showPathSourceBadge(path: ExperiencePath) {
  return getPathSkills(path).length > 0 && getPathSkillsSource(path) !== '未知'
}

function showCandidateSourceBadge(candidate: RuleCandidate) {
  return getCandidateSkills(candidate).length > 0 && getCandidateSkillsSource(candidate) !== '未知'
}

function showRuleSourceBadge(rule: PersistedRule) {
  return getRuleSkills(rule).length > 0 && getRuleSkillsSource(rule) !== '未知'
}

function showPathAnomalyBadge(path: ExperiencePath) {
  return Boolean(getPathAnomalyLabel(path))
}

function showCandidateAnomalyBadge(candidate: RuleCandidate) {
  return Boolean(getCandidateAnomalyLabel(candidate))
}

function showRuleAnomalyBadge(rule: PersistedRule) {
  return Boolean(getRuleAnomalyLabel(rule))
}

function pathSourceBadgeText(path: ExperiencePath) {
  return sourceText(getPathSkillsSource(path))
}

function candidateSourceBadgeText(candidate: RuleCandidate) {
  return sourceText(getCandidateSkillsSource(candidate))
}

function ruleSourceBadgeText(rule: PersistedRule) {
  return sourceText(getRuleSkillsSource(rule))
}

function pathAnomalyBadgeText(path: ExperiencePath) {
  return getPathAnomalyLabel(path)
}

function candidateAnomalyBadgeText(candidate: RuleCandidate) {
  return getCandidateAnomalyLabel(candidate)
}

function ruleAnomalyBadgeText(rule: PersistedRule) {
  return getRuleAnomalyLabel(rule)
}

function pathSourceBadgeButtonClass(path: ExperiencePath) {
  return clickableBadgeClass(sourceBadgeClass(getPathSkillsSource(path)), sourceBadgeIsActive(getPathSkillsSource(path)))
}

function candidateSourceBadgeButtonClass(candidate: RuleCandidate) {
  return clickableBadgeClass(sourceBadgeClass(getCandidateSkillsSource(candidate)), sourceBadgeIsActive(getCandidateSkillsSource(candidate)))
}

function ruleSourceBadgeButtonClass(rule: PersistedRule) {
  return clickableBadgeClass(sourceBadgeClass(getRuleSkillsSource(rule)), sourceBadgeIsActive(getRuleSkillsSource(rule)))
}

function pathAnomalyBadgeButtonClass(path: ExperiencePath) {
  return clickableBadgeClass(anomalyBadgeClass(getPathAnomalyLabel(path)), anomalyBadgeIsActive(getPathAnomalyLabel(path)))
}

function candidateAnomalyBadgeButtonClass(candidate: RuleCandidate) {
  return clickableBadgeClass(anomalyBadgeClass(getCandidateAnomalyLabel(candidate)), anomalyBadgeIsActive(getCandidateAnomalyLabel(candidate)))
}

function ruleAnomalyBadgeButtonClass(rule: PersistedRule) {
  return clickableBadgeClass(anomalyBadgeClass(getRuleAnomalyLabel(rule)), anomalyBadgeIsActive(getRuleAnomalyLabel(rule)))
}

function getPathSourceBadgeTitle(path: ExperiencePath) {
  return `点击筛选来源：${sourceText(getPathSkillsSource(path))}`
}

function getCandidateSourceBadgeTitle(candidate: RuleCandidate) {
  return `点击筛选来源：${sourceText(getCandidateSkillsSource(candidate))}`
}

function getRuleSourceBadgeTitle(rule: PersistedRule) {
  return `点击筛选来源：${sourceText(getRuleSkillsSource(rule))}`
}

function getPathAnomalyBadgeTitle(path: ExperiencePath) {
  return `点击筛选异常：${getPathAnomalyLabel(path)}`
}

function getCandidateAnomalyBadgeTitle(candidate: RuleCandidate) {
  return `点击筛选异常：${getCandidateAnomalyLabel(candidate)}`
}

function getRuleAnomalyBadgeTitle(rule: PersistedRule) {
  return `点击筛选异常：${getRuleAnomalyLabel(rule)}`
}

function pathSourceAriaPressed(path: ExperiencePath) {
  return String(sourceBadgeIsActive(getPathSkillsSource(path)))
}

function candidateSourceAriaPressed(candidate: RuleCandidate) {
  return String(sourceBadgeIsActive(getCandidateSkillsSource(candidate)))
}

function ruleSourceAriaPressed(rule: PersistedRule) {
  return String(sourceBadgeIsActive(getRuleSkillsSource(rule)))
}

function pathAnomalyAriaPressed(path: ExperiencePath) {
  return String(anomalyBadgeIsActive(getPathAnomalyLabel(path)))
}

function candidateAnomalyAriaPressed(candidate: RuleCandidate) {
  return String(anomalyBadgeIsActive(getCandidateAnomalyLabel(candidate)))
}

function ruleAnomalyAriaPressed(rule: PersistedRule) {
  return String(anomalyBadgeIsActive(getRuleAnomalyLabel(rule)))
}

function onPathSourceBadgeClick(path: ExperiencePath) {
  toggleSourceFilter(getPathSkillsSource(path))
}

function onCandidateSourceBadgeClick(candidate: RuleCandidate) {
  toggleSourceFilter(getCandidateSkillsSource(candidate))
}

function onRuleSourceBadgeClick(rule: PersistedRule) {
  toggleSourceFilter(getRuleSkillsSource(rule))
}

function onPathAnomalyBadgeClick(path: ExperiencePath) {
  toggleAnomalyFilter(getPathAnomalyLabel(path))
}

function onCandidateAnomalyBadgeClick(candidate: RuleCandidate) {
  toggleAnomalyFilter(getCandidateAnomalyLabel(candidate))
}

function onRuleAnomalyBadgeClick(rule: PersistedRule) {
  toggleAnomalyFilter(getRuleAnomalyLabel(rule))
}

function onPathSourceBadgeKeydown(event: KeyboardEvent, path: ExperiencePath) {
  onSourceBadgeKeydown(event, getPathSkillsSource(path))
}

function onCandidateSourceBadgeKeydown(event: KeyboardEvent, candidate: RuleCandidate) {
  onSourceBadgeKeydown(event, getCandidateSkillsSource(candidate))
}

function onRuleSourceBadgeKeydown(event: KeyboardEvent, rule: PersistedRule) {
  onSourceBadgeKeydown(event, getRuleSkillsSource(rule))
}

function onPathAnomalyBadgeKeydown(event: KeyboardEvent, path: ExperiencePath) {
  onAnomalyBadgeKeydown(event, getPathAnomalyLabel(path))
}

function onCandidateAnomalyBadgeKeydown(event: KeyboardEvent, candidate: RuleCandidate) {
  onAnomalyBadgeKeydown(event, getCandidateAnomalyLabel(candidate))
}

function onRuleAnomalyBadgeKeydown(event: KeyboardEvent, rule: PersistedRule) {
  onAnomalyBadgeKeydown(event, getRuleAnomalyLabel(rule))
}

function governanceBadgeClass(kind: 'current' | 'single' | 'strong' | 'weak') {
  return badgePillClass(kind === 'current'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    : kind === 'single'
      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
      : kind === 'strong'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
        : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300')
}

function scrollToClusterSection() {
  return nextTick().then(() => {
    clusterSectionRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function restoreAuditFilters(audit: MergeAudit) {
  mergeAuditModeFilter.value = audit.mode
  if (audit.mode === 'strong_batch') clusterConfidenceFilter.value = 'strong'
  else if (audit.mode === 'weak_batch') clusterConfidenceFilter.value = 'weak'
  else clusterConfidenceFilter.value = 'all'
  loadInsights().then(() => scrollToClusterSection())
}

function restoreAuditButtonLabel(audit: MergeAudit) {
  return audit.mode === 'single' ? '恢复审计筛选' : '恢复审计视图'
}

function applyPreviewQuickFilters(mode: 'strong_batch' | 'weak_batch') {
  mergeAuditModeFilter.value = mode
  clusterConfidenceFilter.value = mode === 'strong_batch' ? 'strong' : 'weak'
  loadInsights().then(() => scrollToClusterSection())
}

function previewQuickButtonLabel(mode: 'strong_batch' | 'weak_batch') {
  return `切到${previewModeLabel(mode)}视图`
}

function previewQuickButtonActive(mode: 'strong_batch' | 'weak_batch') {
  return mergeAuditModeFilter.value === mode
    && clusterConfidenceFilter.value === (mode === 'strong_batch' ? 'strong' : 'weak')
}

function previewHeadingTitle(mode: 'strong_batch' | 'weak_batch') {
  return `${previewModeLabel(mode)}合并预览`
}

function previewHeadingMatchedBadgeTone(mode: 'strong_batch' | 'weak_batch') {
  return confidenceBadgeClass(mode === 'strong_batch' ? 'strong' : 'weak')
}

function previewHeadingMatchedBadgeShow(mode: 'strong_batch' | 'weak_batch') {
  return previewQuickButtonActive(mode)
}

function previewHeadingMatchedBadgeLabel() {
  return '当前已命中'
}

function previewHeadingActionBtnKind(mode: 'strong_batch' | 'weak_batch') {
  return previewQuickButtonActive(mode) ? 'primary' : 'default'
}

function previewHeadingActionBtnIsDisabled(mode: 'strong_batch' | 'weak_batch') {
  return previewQuickButtonActive(mode)
}

function previewHeadingActionBtnTooltip(mode: 'strong_batch' | 'weak_batch') {
  return previewQuickButtonActive(mode) ? '当前已在该视图' : previewQuickButtonLabel(mode)
}

function previewHeadingActionBtnText(mode: 'strong_batch' | 'weak_batch') {
  return previewQuickButtonLabel(mode)
}

function previewHeadingActionHandler(mode: 'strong_batch' | 'weak_batch') {
  applyPreviewQuickFilters(mode)
}

function previewHeadingLayoutClass() {
  return 'flex flex-wrap items-center justify-between gap-2'
}

function previewHeadingLeftClass() {
  return 'flex flex-wrap items-center gap-2'
}

function previewHeadingTitleClass() {
  return 'font-medium'
}


function isCurrentAuditEntry(audit: MergeAudit) {
  if (!mergeAudit.value) return false
  return mergeAudit.value.updatedAt === audit.updatedAt
    && mergeAudit.value.mode === audit.mode
    && mergeAudit.value.mergedCount === audit.mergedCount
}

function auditHistoryLabel(audit: MergeAudit, index: number) {
  return isCurrentAuditEntry(audit) ? '最近一次合并审计' : `历史审计 #${index + 1}`
}

function showCurrentAuditBadge(audit: MergeAudit) {
  return isCurrentAuditEntry(audit)
}

function currentAuditBadgeText() {
  return '当前'
}

function currentAuditBadgeClass() {
  return governanceBadgeClass('current')
}

function restoreAuditButtonActive(audit: MergeAudit) {
  if (audit.mode === 'strong_batch' || audit.mode === 'weak_batch') {
    return previewQuickButtonActive(audit.mode)
  }
  return mergeAuditModeFilter.value === 'single' && clusterConfidenceFilter.value === 'all'
}

function restoreAuditButtonType(audit: MergeAudit) {
  return restoreAuditButtonActive(audit) ? 'primary' : 'default'
}

const tools = ref<Tool[]>([])
const loading = ref(false)
const selectedTool = ref<string | null>(null)
const config = ref<Record<string, any>>({})
const rawYaml = ref('')
const saving = ref(false)
const selectedSkillSection = ref('index')
const availableSkillSections = ref<string[]>([])
const toolSkillsContent = ref('')
const skillsLoading = ref(false)
const skillsPolicyPreview = ref<SkillPolicyPreviewItem[]>([])
const globalSkillsPolicyPreview = ref<SkillPolicyPreviewItem[]>([])
const estimatorInput = ref('')
const estimatorIntent = ref('')
const skillsPolicyLoading = ref(false)
const repairStats = ref<RepairStats | null>(null)
const mergeAudit = ref<MergeAudit | null>(null)
const mergeAuditHistory = ref<MergeAudit[]>([])
const mergeAuditModeFilter = ref<'all' | 'single' | 'strong_batch' | 'weak_batch'>('all')
const clearingMergeAudit = ref(false)
const clusterSectionRef = ref<HTMLElement | null>(null)
const strongClusterPreview = ref<StrongClusterMergePreview | null>(null)
const weakClusterPreview = ref<WeakClusterMergePreview | null>(null)
const clusterConfidenceFilter = ref<'all' | 'strong' | 'weak'>('all')
const experiencePathClusters = ref<ExperiencePathCluster[]>([])
const experiencePaths = ref<ExperiencePath[]>([])
const ruleCandidates = ref<RuleCandidate[]>([])
const rules = ref<PersistedRule[]>([])
const insightsLoading = ref(false)
const repairingSkills = ref(false)
const normalizingData = ref(false)
const mergingClusterId = ref<string | null>(null)
const mergingStrongClusters = ref(false)
const mergingWeakClusters = ref(false)
const pendingCandidates = ref<RuleCandidate[]>([])
const promotedCandidates = ref<RuleCandidate[]>([])
const expandedPathIds = ref<string[]>([])
const expandedRuleIds = ref<number[]>([])
const searchKeyword = ref('')
const maturityFilter = ref<'all' | 'new' | 'warming' | 'ready' | 'promoted'>('all')
const candidateFilter = ref<'all' | 'recommended' | 'pending' | 'promoted'>('all')
const provenanceFilter = ref<'all' | 'recorded' | 'repaired'>('all')
const anomalyFilter = ref<'all' | 'failure' | 'repaired' | 'long_error' | 'normalized'>('all')
const ms = useMessage()

const promotedRuleByTrigger = computed(() => new Map(promotedCandidates.value.map(candidate => [candidate.trigger, candidate])))

function formatDistribution(distribution?: Record<string, number>) {
  return Object.entries(distribution || {}).map(([tool, count]) => `${tool}:${count}`).join(', ')
}

function getSkillsSource(item: { llmSummary?: { selectedSkillsSource?: 'recorded' | 'repaired' } }) {
  return item.llmSummary?.selectedSkillsSource || '未知'
}

function getSourceLabel(source: string) {
  return sourceText(source)
}

function getPathSkills(path: ExperiencePath) {
  return path.llmSummary?.selectedSkills || path.contextSnapshot?.skillsHint || []
}

function getCandidateSkills(candidate: RuleCandidate) {
  return candidate.llmSummary?.selectedSkills || candidate.contextSnapshot?.skillsHint || []
}

function getRuleSource(rule: PersistedRule) {
  return promotedRuleByTrigger.value.get(rule.trigger)
}

function getRuleSkills(rule: PersistedRule) {
  const source = getRuleSource(rule)
  return source?.llmSummary?.selectedSkills || source?.contextSnapshot?.skillsHint || []
}

function getPathSkillsSource(path: ExperiencePath) {
  return getSkillsSource(path)
}

function getCandidateSkillsSource(candidate: RuleCandidate) {
  return getSkillsSource(candidate)
}

function getRuleSkillsSource(rule: PersistedRule) {
  return getSkillsSource(getRuleSource(rule) || {})
}

function getRuleSourcePathId(rule: PersistedRule) {
  return getRuleSource(rule)?.sourcePathId
}

function hasFailure(path: ExperiencePath) {
  return Boolean(path.failureReason) || (path.toolResultsSummary || []).some(item => !item.success)
}

function hasLongError(path: ExperiencePath) {
  return (path.failureReason?.length || 0) > 120 || (path.toolResultsSummary || []).some(item => (item.error?.length || 0) > 120)
}

function hasNormalizedError(path: ExperiencePath) {
  return (path.failureReason || '').includes('ADB device not found') || (path.failureReason || '').includes('Target service refused the connection')
}

function candidateHasFailure(candidate: RuleCandidate) {
  return String(candidate.responsePreview || '').includes('失败经验')
}

function getPathAnomalyLabel(path: ExperiencePath) {
  if (hasLongError(path)) return anomalyText('long_error')
  if (hasFailure(path)) return anomalyText('failure')
  if (hasNormalizedError(path)) return anomalyText('normalized')
  return ''
}

function getCandidateAnomalyLabel(candidate: RuleCandidate) {
  return candidateHasFailure(candidate) ? anomalyText('failure') : ''
}

function getRuleAnomalyLabel(rule: PersistedRule) {
  return getRuleSkillsSource(rule) === 'repaired' ? anomalyText('repaired') : ''
}

function matchesProvenanceFilter(source: string, filter: string) {
  return filter === 'all' || source === filter
}

function matchesPathAnomaly(path: ExperiencePath, filter: string) {
  if (filter === 'all') return true
  if (filter === 'failure') return hasFailure(path)
  if (filter === 'repaired') return getPathSkillsSource(path) === 'repaired'
  if (filter === 'long_error') return hasLongError(path)
  if (filter === 'normalized') return hasNormalizedError(path)
  return true
}

function matchesCandidateAnomaly(candidate: RuleCandidate, filter: string) {
  if (filter === 'all') return true
  if (filter === 'failure') return candidateHasFailure(candidate)
  if (filter === 'repaired') return getCandidateSkillsSource(candidate) === 'repaired'
  return false
}

function matchesRuleAnomaly(rule: PersistedRule, filter: string) {
  if (filter === 'all') return true
  if (filter === 'repaired') return getRuleSkillsSource(rule) === 'repaired'
  return false
}

function sourceBadgeClass(source: string) {
  return source === 'repaired'
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    : source === 'recorded'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
      : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
}

function anomalyBadgeClass(label: string) {
  return label === anomalyText('long_error')
    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
    : label === anomalyText('failure')
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
      : label === anomalyText('normalized')
        ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
        : label === anomalyText('repaired')
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
          : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
}

function badgeWrapClass() {
  return 'flex flex-wrap gap-2 mt-2 text-xs'
}

function badgePillClass(base: string) {
  return `inline-flex rounded px-2 py-0.5 ${base}`
}

function clickableBadgeClass(base: string, active: boolean) {
  return `${badgePillClass(base)} cursor-pointer transition hover:opacity-80 ${active ? 'ring-1 ring-current' : ''}`
}

function toggleSourceFilter(source: string) {
  provenanceFilter.value = provenanceFilter.value === source ? 'all' : source as 'recorded' | 'repaired'
}

function toggleAnomalyFilter(label: string) {
  if (label === anomalyText('failure')) anomalyFilter.value = anomalyFilter.value === 'failure' ? 'all' : 'failure'
  else if (label === anomalyText('long_error')) anomalyFilter.value = anomalyFilter.value === 'long_error' ? 'all' : 'long_error'
  else if (label === anomalyText('normalized')) anomalyFilter.value = anomalyFilter.value === 'normalized' ? 'all' : 'normalized'
  else if (label === anomalyText('repaired')) anomalyFilter.value = anomalyFilter.value === 'repaired' ? 'all' : 'repaired'
}

function sourceBadgeIsActive(source: string) {
  return provenanceFilter.value === source
}

function anomalyBadgeIsActive(label: string) {
  return (label === anomalyText('failure') && anomalyFilter.value === 'failure')
    || (label === anomalyText('long_error') && anomalyFilter.value === 'long_error')
    || (label === anomalyText('normalized') && anomalyFilter.value === 'normalized')
    || (label === anomalyText('repaired') && anomalyFilter.value === 'repaired')
}

function onSourceBadgeKeydown(event: KeyboardEvent, source: string) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    toggleSourceFilter(source)
  }
}

function onAnomalyBadgeKeydown(event: KeyboardEvent, label: string) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    toggleAnomalyFilter(label)
  }
}

function pathMatchesFilters(path: ExperiencePath, keyword: string, maturity: string, provenance: string, anomaly: string) {
  const matchesKeyword = !keyword || `${path.name} ${path.description} ${path.intent || ''} ${path.input || ''}`.toLowerCase().includes(keyword)
  const matchesMaturity = maturity === 'all' || path.maturity === maturity
  const matchesProvenance = matchesProvenanceFilter(getPathSkillsSource(path), provenance)
  const matchesAnomaly = matchesPathAnomaly(path, anomaly)
  return matchesKeyword && matchesMaturity && matchesProvenance && matchesAnomaly
}

function candidateMatchesFilters(candidate: RuleCandidate, keyword: string, maturity: string, candidateState: string, provenance: string, anomaly: string) {
  const matchesKeyword = !keyword || `${candidate.trigger} ${candidate.intent} ${candidate.responsePreview || ''}`.toLowerCase().includes(keyword)
  const matchesCandidateFilter = candidateState === 'all' || candidateState === 'pending' || (candidateState === 'recommended' && candidate.recommended)
  const matchesMaturity = maturity === 'all' || candidate.maturity === maturity
  const matchesProvenance = matchesProvenanceFilter(getCandidateSkillsSource(candidate), provenance)
  const matchesAnomaly = matchesCandidateAnomaly(candidate, anomaly)
  return matchesKeyword && matchesCandidateFilter && matchesMaturity && matchesProvenance && matchesAnomaly
}

function ruleMatchesFilters(rule: PersistedRule, keyword: string, provenance: string, anomaly: string) {
  const matchesKeyword = !keyword || `${rule.trigger} ${rule.response}`.toLowerCase().includes(keyword)
  const matchesProvenance = matchesProvenanceFilter(getRuleSkillsSource(rule), provenance)
  const matchesAnomaly = matchesRuleAnomaly(rule, anomaly)
  return matchesKeyword && matchesProvenance && matchesAnomaly
}

const filteredExperiencePaths = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  return experiencePaths.value.filter(path => pathMatchesFilters(path, keyword, maturityFilter.value, provenanceFilter.value, anomalyFilter.value))
})

const filteredExperiencePathClusters = computed(() => {
  return experiencePathClusters.value.filter(cluster => clusterConfidenceFilter.value === 'all' || cluster.confidence === clusterConfidenceFilter.value)
})
const filteredPendingCandidates = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  return pendingCandidates.value.filter(candidate => candidateMatchesFilters(candidate, keyword, maturityFilter.value, candidateFilter.value, provenanceFilter.value, anomalyFilter.value))
})

const filteredRules = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  return rules.value.filter(rule => ruleMatchesFilters(rule, keyword, provenanceFilter.value, anomalyFilter.value))
})

async function loadSkillsPolicyPreview(name: string, input = estimatorInput.value.trim(), intent = estimatorIntent.value.trim()) {
  skillsPolicyLoading.value = true
  try {
    const res = await fetchToolSkillsPolicy<ToolSkillsPolicyResponse>(name, input, intent || undefined)
    skillsPolicyPreview.value = res.data?.stages || []
    globalSkillsPolicyPreview.value = res.data?.globalStages || []
  }
  catch {
    skillsPolicyPreview.value = []
    globalSkillsPolicyPreview.value = []
  }
  finally {
    skillsPolicyLoading.value = false
  }
}

async function loadToolSkills(name: string, section = 'index') {
  skillsLoading.value = true
  selectedSkillSection.value = section
  try {
    const res = await fetchToolSkills<{ content: string }>(name, section)
    toolSkillsContent.value = res.data?.content || ''
  }
  catch {
    toolSkillsContent.value = ''
  }
  finally {
    skillsLoading.value = false
  }
}

async function loadSkillSections(name: string) {
  try {
    const res = await fetchToolSkillSections<string[]>(name)
    availableSkillSections.value = res.data || ['index']
  }
  catch {
    availableSkillSections.value = ['index']
  }
}

async function loadInsights() {
  insightsLoading.value = true
  try {
    const [pathsRes, candidatesRes, rulesRes, clustersRes, previewRes, weakPreviewRes, auditRes] = await Promise.all([
      fetchExperiencePaths<ExperiencePath[]>(),
      fetchRuleCandidates<RuleCandidate[]>(),
      fetchRules<PersistedRule[]>(),
      fetchExperiencePathClusters<ExperiencePathCluster[]>(),
      fetchStrongClusterMergePreview<StrongClusterMergePreview>(),
      fetchWeakClusterMergePreview<WeakClusterMergePreview>(),
      fetchExperiencePathMergeAudit<MergeAuditPayload>(mergeAuditModeFilter.value === 'all' ? undefined : mergeAuditModeFilter.value),
    ])

    experiencePaths.value = pathsRes.data || []
    ruleCandidates.value = candidatesRes.data || []
    rules.value = rulesRes.data || []
    experiencePathClusters.value = clustersRes.data || []
    strongClusterPreview.value = previewRes.data || null
    weakClusterPreview.value = weakPreviewRes.data || null
    mergeAudit.value = auditRes.data?.current || null
    mergeAuditHistory.value = auditRes.data?.history || []
    pendingCandidates.value = ruleCandidates.value.filter(item => item.status !== 'promoted')
    promotedCandidates.value = ruleCandidates.value.filter(item => item.status === 'promoted')
  }
  catch {
    ms.error('加载经验/候选失败')
  }
  finally {
    insightsLoading.value = false
  }
}

async function refreshAll() {
  await Promise.all([loadTools(), loadInsights()])
}

async function repairSkillsTrace() {
  repairingSkills.value = true
  try {
    const res = await repairExperiencePathSkills<RepairStats>()
    repairStats.value = res.data || null
    const distributionText = formatDistribution(res.data?.distribution)
    ms.success(`已修复 ${res.data?.updated || 0} 条，补来源 ${res.data?.sourceTagged || 0} 条，跳过 ${res.data?.skipped || 0} 条 / 共 ${res.data?.scanned || 0} 条${distributionText ? `，分布 ${distributionText}` : ''}`)
    await refreshAll()
  }
  catch {
    ms.error('修复历史技能轨迹失败')
  }
  finally {
    repairingSkills.value = false
  }
}

async function normalizePathData() {
  normalizingData.value = true
  try {
    const res = await normalizeExperiencePathData<RepairStats>()
    repairStats.value = { ...(repairStats.value || { scanned: 0 }), ...res.data }
    ms.success(`已归一化 ${res.data?.normalized || 0} / ${res.data?.scanned || 0} 条历史数据`)
    await refreshAll()
  }
  catch {
    ms.error('归一化历史数据失败')
  }
  finally {
    normalizingData.value = false
  }
}

async function mergeCluster(cluster: ExperiencePathCluster) {
  if (!cluster.suggestedPrimaryPathId || !cluster.suggestedMergeCandidateIds?.length) return
  mergingClusterId.value = cluster.id
  try {
    await mergeExperiencePathCluster({ primaryId: cluster.suggestedPrimaryPathId, mergeIds: cluster.suggestedMergeCandidateIds })
    ms.success(`已按建议合并簇 ${cluster.id}`)
    await refreshAll()
  }
  catch {
    ms.error('合并重复经验失败')
  }
  finally {
    mergingClusterId.value = null
  }
}

async function mergeStrongClusters() {
  mergingStrongClusters.value = true
  try {
    const res = await mergeStrongExperiencePathClusters<{ mergedCount?: number, preview?: StrongClusterMergePreview }>()
    strongClusterPreview.value = res.data?.preview || null
    ms.success(`已批量合并 ${res.data?.mergedCount || 0} 个强置信重复簇`)
    await refreshAll()
  }
  catch {
    ms.error('批量合并强置信重复簇失败')
  }
  finally {
    mergingStrongClusters.value = false
  }
}

async function mergeWeakClusters() {
  mergingWeakClusters.value = true
  try {
    const res = await mergeWeakExperiencePathClusters<{ mergedCount?: number, preview?: WeakClusterMergePreview }>()
    weakClusterPreview.value = res.data?.preview || null
    ms.success(`已批量合并 ${res.data?.mergedCount || 0} 个弱置信重复簇`)
    await refreshAll()
  }
  catch {
    ms.error('批量合并弱置信重复簇失败')
  }
  finally {
    mergingWeakClusters.value = false
  }
}

async function clearMergeAuditHistory() {
  clearingMergeAudit.value = true
  try {
    const res = await clearExperiencePathMergeAudit<MergeAuditPayload>()
    mergeAudit.value = res.data?.current || null
    mergeAuditHistory.value = res.data?.history || []
    ms.success('已清空合并审计历史')
  }
  catch {
    ms.error('清空合并审计历史失败')
  }
  finally {
    clearingMergeAudit.value = false
  }
}

function clusterCanMerge(cluster: ExperiencePathCluster) {
  return Boolean(cluster.suggestedPrimaryPathId && cluster.suggestedMergeCandidateIds?.length)
}

function clusterMergeButtonLabel(cluster: ExperiencePathCluster) {
  return cluster.confidence === 'strong' ? '按建议合并' : '谨慎合并'
}

function confidenceTextClass(kind: 'strong' | 'weak') {
  return kind === 'strong' ? 'text-amber-600 dark:text-amber-300' : 'text-sky-600 dark:text-sky-300'
}

function confidenceBorderClass(kind: 'strong' | 'weak') {
  return kind === 'strong' ? 'border-amber-300 dark:border-amber-900/30' : 'border-sky-300 dark:border-sky-900/30'
}

function clusterMergeHint(cluster: ExperiencePathCluster) {
  return cluster.confidence === 'strong' ? '强置信重复簇' : '弱置信重复簇'
}

function clusterConfidenceClass(cluster: ExperiencePathCluster) {
  return confidenceTextClass(cluster.confidence)
}

function clusterContainerClass(cluster: ExperiencePathCluster) {
  return confidenceBorderClass(cluster.confidence)
}

function clusterRoleClass(role?: string) {
  return role === 'primary' ? 'text-emerald-600 dark:text-emerald-300' : 'text-neutral-500'
}

function clusterRoleLabel(role?: string) {
  return role === 'primary' ? '主路径' : '待合并项'
}

function clusterHeaderText(cluster: ExperiencePathCluster) {
  return `${cluster.intent} / ${cluster.sampleInput}`
}

function confidenceLabel(kind: 'strong' | 'weak') {
  return kind === 'strong' ? '强置信' : '弱置信'
}

function maturityLabel(value?: string) {
  return value === 'new'
    ? '新建'
    : value === 'warming'
      ? '预热中'
      : value === 'ready'
        ? '就绪'
        : value === 'promoted'
          ? '已提升'
          : value || '未知'
}

function clusterMetaText(cluster: ExperiencePathCluster) {
  return `簇大小: ${cluster.size} / 置信度: ${confidenceLabel(cluster.confidence)}`
}

function clusterPathScore(path: ExperiencePathClusterItem) {
  return (path.score || 0).toFixed(2)
}

function clusterButtonClass(cluster: ExperiencePathCluster) {
  return cluster.confidence === 'strong' ? 'primary' : 'default'
}

function clusterButtonLoading(cluster: ExperiencePathCluster) {
  return mergingClusterId.value === cluster.id
}

function clusterButtonDisabled(cluster: ExperiencePathCluster) {
  return !clusterCanMerge(cluster)
}

function clusterPathSuccessRateText(path: ExperiencePathClusterItem) {
  return path.successRate.toFixed(2)
}

function clusterPathLabel(path: ExperiencePathClusterItem) {
  return path.input || path.name
}

function clusterPreviewSummaryText(preview: StrongClusterMergePreview | WeakClusterMergePreview | null, confidence: 'strong' | 'weak') {
  if (!preview) return '尚未生成预览'
  if (preview.clusterCount === 0) return `暂无可直接参考的${confidenceLabel(confidence)}合并候选`
  return `簇数: ${preview.clusterCount} / 候选数: ${preview.totalMergeCandidates}`
}

function clusterConfidenceFilterLabel() {
  return clusterConfidenceFilterSummaryLabel() === '全部'
    ? '全部簇'
    : `${clusterConfidenceFilterSummaryLabel()}簇`
}

function clusterAuditModeLabel() {
  return mergeAuditModeFilterLabel()
}

function showClusterPanel() {
  return experiencePathClusters.value.length > 0 || clusterConfidenceFilter.value !== 'all'
}

function clusterPanelEmptyText() {
  if (experiencePathClusters.value.length === 0) return '当前没有可展示的重复经验簇'
  return `当前筛选下没有 ${clusterConfidenceFilterLabel()} 结果`
}

async function loadTools() {
  loading.value = true
  try {
    const res = await fetchTools<Tool[]>()
    tools.value = res.data || []
    if (tools.value.length > 0) await selectTool(tools.value[0].name)
  }
  catch {
    ms.error('加载工具列表失败')
  }
  finally {
    loading.value = false
  }
}

async function selectTool(name: string) {
  selectedTool.value = name
  try {
    const res = await fetchToolConfig<{ config: Record<string, any>, raw: string }>(name)
    config.value = res.data?.config || {}
    rawYaml.value = res.data?.raw || ''
    await loadSkillsPolicyPreview(name)
    await loadSkillSections(name)
    await loadToolSkills(name, 'index')
  }
  catch {
    ms.error('加载配置失败')
  }
}

async function saveConfig() {
  if (!selectedTool.value) return
  saving.value = true
  try {
    await updateToolConfig(selectedTool.value, { config: config.value })
    ms.success('保存成功')
  }
  catch {
    ms.error('保存失败')
  }
  finally {
    saving.value = false
  }
}

async function saveRawConfig() {
  if (!selectedTool.value) return
  saving.value = true
  try {
    await updateToolConfig(selectedTool.value, { raw: rawYaml.value })
    ms.success('保存成功')
  }
  catch {
    ms.error('保存失败')
  }
  finally {
    saving.value = false
  }
}

async function promoteCandidate(candidate: RuleCandidate) {
  try {
    await promoteRuleCandidate({ trigger: candidate.trigger, intent: candidate.intent, actions: candidate.actions || [], sourcePathId: candidate.sourcePathId })
    ms.success('已提升为规则')
    await refreshAll()
  }
  catch {
    ms.error('提升规则失败')
  }
}

async function disablePersistedRule(rule: PersistedRule) {
  try {
    await disableRule({ trigger: rule.trigger })
    ms.success('已禁用规则')
    await refreshAll()
  }
  catch {
    ms.error('禁用规则失败')
  }
}

async function enablePersistedRule(rule: PersistedRule) {
  try {
    await enableRule({ trigger: rule.trigger })
    ms.success('已启用规则')
    await refreshAll()
  }
  catch {
    ms.error('启用规则失败')
  }
}

async function rollbackPersistedRule(rule: PersistedRule) {
  try {
    await rollbackRule({ trigger: rule.trigger, sourcePathId: getRuleSourcePathId(rule) })
    ms.success('已回退规则')
    await refreshAll()
  }
  catch {
    ms.error('回退规则失败')
  }
}

function togglePathDetails(pathId: string) {
  if (expandedPathIds.value.includes(pathId)) expandedPathIds.value = expandedPathIds.value.filter(id => id !== pathId)
  else expandedPathIds.value = [...expandedPathIds.value, pathId]
}

function toggleRuleDetails(ruleId: number) {
  if (expandedRuleIds.value.includes(ruleId)) expandedRuleIds.value = expandedRuleIds.value.filter(id => id !== ruleId)
  else expandedRuleIds.value = [...expandedRuleIds.value, ruleId]
}

const toolIcons: Record<string, string> = {
  rule_engine: 'ri:list-check',
  memory: 'ri:brain-line',
  adb: 'ri:smartphone-line',
  hami: 'ri:home-4-line',
  success_paths: 'ri:checkbox-circle-line',
  web_search: 'ri:search-line',
  local_intent: 'ri:message-2-line',
  llm_agent: 'ri:robot-line',
}

onMounted(refreshAll)
</script>

<template>
  <div class="h-full overflow-hidden flex">
    <aside class="w-64 border-r dark:border-gray-700 flex flex-col">
      <header class="p-4 border-b dark:border-gray-700">
        <h1 class="text-lg font-bold">工具配置</h1>
      </header>
      <NSpin :show="loading">
        <div class="flex-1 overflow-auto p-2">
          <NButton
            v-for="tool in tools"
            :key="tool.name"
            quaternary
            block
            :type="selectedTool === tool.name ? 'primary' : 'default'"
            class="justify-start mb-1"
            @click="selectTool(tool.name)"
          >
            <template #icon>
              <SvgIcon :icon="toolIcons[tool.name] || 'ri:tools-line'" />
            </template>
            {{ tool.name }}
          </NButton>
        </div>
      </NSpin>
    </aside>

    <main class="flex-1 overflow-auto p-4 space-y-4">
      <template v-if="!selectedTool">
        <NEmpty description="请选择一个工具" />
      </template>
      <template v-else>
        <NCard :title="selectedTool">
          <NTabs type="line">
            <NTabPane name="form" tab="表单编辑">
              <NSpace vertical>
                <div v-for="(value, key) in config" :key="key">
                  <label class="block mb-1 text-sm font-medium">{{ key }}</label>
                  <NInput v-if="typeof value === 'string' || typeof value === 'number'" :value="String(value)" @update:value="config[key] = $event" />
                  <NCode v-else :code="JSON.stringify(value, null, 2)" language="json" />
                </div>
              </NSpace>
              <div class="mt-4 flex justify-end"><NButton type="primary" :loading="saving" @click="saveConfig">保存</NButton></div>
            </NTabPane>
            <NTabPane name="yaml" tab="配置源码">
              <NInput v-model:value="rawYaml" type="textarea" :autosize="{ minRows: 10, maxRows: 30 }" placeholder="配置源码" />
              <div class="mt-4 flex justify-end"><NButton type="primary" :loading="saving" @click="saveRawConfig">保存</NButton></div>
            </NTabPane>
          </NTabs>
        </NCard>

        <NCard :title="`${selectedTool} 技能说明`">
          <NSpin :show="skillsLoading">
            <div class="space-y-3">
              <div class="flex flex-wrap gap-2">
                <NButton
                  v-for="section in availableSkillSections"
                  :key="section"
                  size="small"
                  :type="selectedSkillSection === section ? 'primary' : 'default'"
                  @click="loadToolSkills(selectedTool, section)"
                >
                  {{ section }}
                </NButton>
              </div>
              <div class="text-xs text-neutral-400">当前分段: {{ selectedSkillSection }}</div>
              <div v-if="toolSkillsContent"><NCode :code="toolSkillsContent" language="markdown" /></div>
              <div v-else class="text-sm text-neutral-400">当前工具暂无该分段说明</div>
            </div>
          </NSpin>
        </NCard>

        <NCard :title="`${selectedTool} 技能加载策略预览`">
          <NSpin :show="skillsPolicyLoading">
            <div class="space-y-3">
              <div class="text-xs text-neutral-400">当前为后端真实策略预览，可按输入示例估算该工具和全局会加载哪些技能。</div>
              <div class="grid gap-2 md:grid-cols-3">
                <NInput v-model:value="estimatorInput" placeholder="输入示例，如：帮我看看电视界面按钮" />
                <NInput v-model:value="estimatorIntent" placeholder="可选 intent，如：navigate_back" />
                <NButton @click="selectedTool && loadSkillsPolicyPreview(selectedTool)">估算加载策略</NButton>
              </div>
              <div>
                <div class="mb-1 font-medium">当前工具命中</div>
                <div v-if="!skillsPolicyPreview.length" class="text-sm text-neutral-400">当前条件下该工具暂无命中分段</div>
                <div v-for="(item, index) in skillsPolicyPreview" :key="`${item.stage}-${index}`" class="mb-2 rounded border border-[#e5e7eb] p-3 text-sm dark:border-[#2a2a2d]">
                  <div class="font-medium">{{ item.stage }}</div>
                  <div class="mt-1 text-xs text-neutral-500">{{ item.refs.join(' / ') }}</div>
                </div>
              </div>
              <div>
                <div class="mb-1 font-medium">全局加载视角</div>
                <div v-for="(item, index) in globalSkillsPolicyPreview" :key="`global-${item.stage}-${index}`" class="mb-2 rounded border border-dashed border-[#e5e7eb] p-3 text-sm dark:border-[#2a2a2d]">
                  <div class="font-medium">{{ item.stage }}</div>
                  <div class="mt-1 text-xs text-neutral-500">{{ item.refs.join(' / ') }}</div>
                </div>
              </div>
            </div>
          </NSpin>
        </NCard>

        <NCard title="经验路径 / 候选规则">
          <NSpin :show="insightsLoading">
            <div class="space-y-4">
              <div class="grid gap-2 md:grid-cols-6">
                <NInput v-model:value="searchKeyword" placeholder="搜索 trigger / intent / 描述" />
                <NSelect v-model:value="maturityFilter" :options="maturitySelectOptions()" />
                <NSelect v-model:value="candidateFilter" :options="candidateSelectOptions()" />
                <NSelect v-model:value="provenanceFilter" :options="provenanceSelectOptions()" />
                <NSelect v-model:value="anomalyFilter" :options="anomalyOptions()" />
                <NSelect v-model:value="clusterConfidenceFilter" :options="clusterConfidenceSelectOptions()" />
              </div>

              <div v-if="showFilterSummaryLabel() || clearBadgeFilterButtonVisible()" class="flex items-center justify-between rounded border border-[#e5e7eb] bg-[#f6f8fa] px-3 py-2 text-xs dark:border-[#2a2a2d] dark:bg-[#1d1f23]">
                <div class="text-neutral-500"><span v-if="showFilterSummaryLabel()">当前快捷筛选：{{ filterSummaryLabel() }}</span></div>
                <NButton v-if="clearBadgeFilterButtonVisible()" size="tiny" @click="onClearBadgeFilterButtonClick">清除快捷筛选</NButton>
              </div>

              <div v-if="repairStats" class="rounded border border-[#e5e7eb] bg-[#f6f8fa] p-3 text-xs dark:border-[#2a2a2d] dark:bg-[#1d1f23]">
                <div class="font-medium">数据治理统计</div>
                <div class="mt-1 text-neutral-500">更新: {{ repairStats.updated || 0 }} / 标注来源: {{ repairStats.sourceTagged || 0 }} / 跳过: {{ repairStats.skipped || 0 }} / 归一化: {{ repairStats.normalized || 0 }} / 扫描: {{ repairStats.scanned }}</div>
                <div v-if="formatDistribution(repairStats.distribution)" class="mt-1 text-neutral-500">分布: {{ formatDistribution(repairStats.distribution) }}</div>
              </div>

              <div>
                <div class="mb-2 flex items-center justify-between">
                  <h2 class="font-medium">经验路径</h2>
                  <div class="flex gap-2">
                    <NButton size="small" :loading="repairingSkills" @click="repairSkillsTrace">修复历史技能轨迹</NButton>
                    <NButton size="small" :loading="normalizingData" @click="normalizePathData">归一化数据</NButton>
                    <NButton size="small" :loading="mergingStrongClusters" @click="mergeStrongClusters">批量合并强置信簇</NButton>
                    <NButton size="small" :loading="mergingWeakClusters" @click="mergeWeakClusters">批量合并弱置信簇</NButton>
                    <NButton size="small" @click="loadInsights">刷新</NButton>
                  </div>
                </div>

                <div v-if="strongClusterPreview" class="mb-3 rounded border border-[#e5e7eb] bg-[#f6f8fa] p-3 text-xs dark:border-[#2a2a2d] dark:bg-[#1d1f23]">
                  <div :class="previewHeadingLayoutClass()">
                    <div :class="previewHeadingLeftClass()">
                      <div :class="previewHeadingTitleClass()">{{ previewHeadingTitle('strong_batch') }}</div>
                      <span v-if="previewHeadingMatchedBadgeShow('strong_batch')" :class="previewHeadingMatchedBadgeTone('strong_batch')">{{ previewHeadingMatchedBadgeLabel() }}</span>
                    </div>
                    <NButton size="tiny" :type="previewHeadingActionBtnKind('strong_batch')" :disabled="previewHeadingActionBtnIsDisabled('strong_batch')" :title="previewHeadingActionBtnTooltip('strong_batch')" @click="previewHeadingActionHandler('strong_batch')">{{ previewHeadingActionBtnText('strong_batch') }}</NButton>
                  </div>
                  <div class="mt-1 text-neutral-500">{{ clusterPreviewSummaryText(strongClusterPreview, 'strong') }}</div>
                  <div v-if="strongClusterPreview.clusters?.length" class="mt-2 space-y-1">
                    <div v-for="item in strongClusterPreview.clusters" :key="item.id" class="text-neutral-500">
                      - {{ item.intent }} / {{ item.sampleInput }} / 主路径: {{ item.primaryId }} / 合并项: {{ item.mergeIds?.join(', ') }}
                    </div>
                  </div>
                </div>

                <div v-if="weakClusterPreview" class="mb-3 rounded border border-[#e5e7eb] bg-[#f6f8fa] p-3 text-xs dark:border-[#2a2a2d] dark:bg-[#1d1f23]">
                  <div :class="previewHeadingLayoutClass()">
                    <div :class="previewHeadingLeftClass()">
                      <div :class="previewHeadingTitleClass()">{{ previewHeadingTitle('weak_batch') }}</div>
                      <span v-if="previewHeadingMatchedBadgeShow('weak_batch')" :class="previewHeadingMatchedBadgeTone('weak_batch')">{{ previewHeadingMatchedBadgeLabel() }}</span>
                    </div>
                    <NButton size="tiny" :type="previewHeadingActionBtnKind('weak_batch')" :disabled="previewHeadingActionBtnIsDisabled('weak_batch')" :title="previewHeadingActionBtnTooltip('weak_batch')" @click="previewHeadingActionHandler('weak_batch')">{{ previewHeadingActionBtnText('weak_batch') }}</NButton>
                  </div>
                  <div class="mt-1 text-neutral-500">{{ clusterPreviewSummaryText(weakClusterPreview, 'weak') }}</div>
                  <div v-if="weakClusterPreview.clusters?.length" class="mt-2 space-y-1">
                    <div v-for="item in weakClusterPreview.clusters" :key="item.id" class="text-neutral-500">
                      - {{ item.intent }} / {{ item.sampleInput }} / 主路径: {{ item.primaryId }} / 合并项: {{ item.mergeIds?.join(', ') }}
                    </div>
                  </div>
                </div>
                <div v-if="mergeAudit || mergeAuditHistory.length || mergeAuditModeFilter !== 'all'" class="mb-3 rounded border border-[#e5e7eb] bg-[#f6f8fa] p-3 text-xs dark:border-[#2a2a2d] dark:bg-[#1d1f23]">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="font-medium">合并审计历史</div>
                    <div class="flex flex-wrap gap-2">
                      <NSelect v-model:value="mergeAuditModeFilter" size="small" style="width: 160px" :options="mergeAuditModeOptions()" @update:value="loadInsights" />
                      <NButton size="small" :loading="clearingMergeAudit" @click="clearMergeAuditHistory">清空历史</NButton>
                    </div>
                  </div>
                  <div v-if="!mergeAuditHistory.length" class="mt-1 text-neutral-500">暂无最近一次合并审计</div>
                  <div v-else class="mt-2 space-y-3">
                    <div v-for="(audit, index) in mergeAuditHistory" :key="`${audit.updatedAt}-${index}`" class="rounded border border-dashed border-[#e5e7eb] p-2 dark:border-[#2a2a2d]">
                      <div class="flex flex-wrap items-center gap-2 justify-between">
                        <div class="flex flex-wrap items-center gap-2">
                          <div class="font-medium">{{ auditHistoryLabel(audit, index) }}</div>
                          <span v-if="showCurrentAuditBadge(audit)" :class="currentAuditBadgeClass()">{{ currentAuditBadgeText() }}</span>
                          <span :class="mergeAuditModeBadgeClass(audit)">{{ mergeAuditModeLabel(audit) }}</span>
                        </div>
                        <NButton size="tiny" :type="restoreAuditButtonType(audit)" :disabled="restoreAuditButtonActive(audit)" @click="restoreAuditFilters(audit)">{{ restoreAuditButtonLabel(audit) }}</NButton>
                      </div>
                      <div class="mt-1 text-neutral-500">{{ mergeAuditSummaryText(audit) }}</div>
                      <div class="mt-1 text-neutral-500">更新时间: {{ mergeAuditUpdatedAtText(audit) }}</div>
                      <div v-if="audit.primaryId" class="mt-1 text-neutral-500">主路径 ID: {{ audit.primaryId }}</div>
                      <div v-if="audit.mergedIds?.length" class="mt-1 text-neutral-500">合并路径 ID: {{ audit.mergedIds.join(', ') }}</div>
                      <div v-if="audit.preview" class="mt-2">
                        <div class="font-medium">{{ mergeAuditPreviewTitle(audit) }}</div>
                        <div class="mt-1 text-neutral-500">预览簇数: {{ audit.preview.clusterCount }} / 预览候选数: {{ audit.preview.totalMergeCandidates }}</div>
                        <div v-if="mergeAuditPreviewItems(audit).length" class="mt-2 space-y-2">
                          <div v-for="item in mergeAuditPreviewItems(audit)" :key="item.id" class="rounded border border-dashed border-[#e5e7eb] p-2 dark:border-[#2a2a2d]">
                            <div class="flex flex-wrap items-center gap-2">
                              <div class="font-medium">{{ mergeAuditPreviewText(item) }}</div>
                              <span :class="mergeAuditPreviewBadgeClass(item)">{{ item.confidence }}</span>
                            </div>
                            <div class="mt-1 text-neutral-500">{{ mergeAuditPreviewMetaText(item) }}</div>
                          </div>
                        </div>
                        <div v-else class="mt-1 text-neutral-500">{{ mergeAuditEmptyPreviewText(audit) }}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-if="showClusterPanel()" ref="clusterSectionRef" class="mb-3 rounded border border-[#e5e7eb] bg-[#f6f8fa] p-3 text-xs dark:border-[#2a2a2d] dark:bg-[#1d1f23]">
                  <div class="mb-2 flex items-center justify-between">
                    <div class="font-medium">重复经验簇</div>
                    <div class="text-neutral-500">当前筛选：{{ clusterConfidenceFilterLabel() }} / 审计：{{ clusterAuditModeLabel() }}</div>
                  </div>
                  <div v-if="!filteredExperiencePathClusters.length" class="text-neutral-500">{{ clusterPanelEmptyText() }}</div>
                  <div v-else class="mt-2 space-y-2">
                    <div v-for="cluster in filteredExperiencePathClusters" :key="cluster.id" class="rounded border border-dashed p-2" :class="clusterContainerClass(cluster)">
                      <div class="font-medium">{{ clusterHeaderText(cluster) }}</div>
                      <div class="text-neutral-500">{{ clusterMetaText(cluster) }}</div>
                      <div class="mt-1" :class="clusterConfidenceClass(cluster)">{{ clusterMergeHint(cluster) }}</div>
                      <div v-if="cluster.suggestedPrimaryPathId" class="mt-1 text-emerald-600 dark:text-emerald-300">建议保留主路径：{{ cluster.suggestedPrimaryPathId }}</div>
                      <div v-if="cluster.suggestedMergeCandidateIds?.length" class="mt-1 text-amber-600 dark:text-amber-300">建议合并：{{ cluster.suggestedMergeCandidateIds.join(', ') }}</div>
                      <div class="mt-2">
                        <NButton
                          v-if="clusterCanMerge(cluster)"
                          size="small"
                          :type="clusterButtonClass(cluster)"
                          :loading="clusterButtonLoading(cluster)"
                          :disabled="clusterButtonDisabled(cluster)"
                          @click="mergeCluster(cluster)"
                        >
                          {{ clusterMergeButtonLabel(cluster) }}
                        </NButton>
                      </div>
                      <div class="mt-2 space-y-1">
                        <div v-for="path in cluster.paths" :key="`${cluster.id}-${path.id}`" class="text-neutral-500">
                          - {{ clusterPathLabel(path) }} / 成功率: {{ clusterPathSuccessRateText(path) }} / 分数: {{ clusterPathScore(path) }} / <span :class="clusterRoleClass(path.suggestedRole)">{{ clusterRoleLabel(path.suggestedRole) }}</span><span v-if="path.failureReason" class="text-red-400"> / {{ path.failureReason }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-if="!filteredExperiencePaths.length" class="text-sm text-neutral-400">暂无经验路径</div>
                <div v-else class="space-y-2">
                  <div v-for="path in filteredExperiencePaths" :key="path.id" class="rounded border border-[#e5e7eb] p-3 dark:border-[#2a2a2d]">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="font-medium">{{ path.name }}</div>
                        <div class="text-sm text-neutral-500">{{ path.description }}</div>
                        <div v-if="showPathSourceBadge(path) || showPathAnomalyBadge(path)" :class="badgeWrapClass()">
                          <button v-if="showPathSourceBadge(path)" type="button" :class="pathSourceBadgeButtonClass(path)" :title="getPathSourceBadgeTitle(path)" :aria-pressed="pathSourceAriaPressed(path) === 'true'" role="button" tabindex="0" @click="onPathSourceBadgeClick(path)" @keydown="onPathSourceBadgeKeydown($event, path)">{{ pathSourceBadgeText(path) }}</button>
                          <button v-if="showPathAnomalyBadge(path)" type="button" :class="pathAnomalyBadgeButtonClass(path)" :title="getPathAnomalyBadgeTitle(path)" :aria-pressed="pathAnomalyAriaPressed(path) === 'true'" role="button" tabindex="0" @click="onPathAnomalyBadgeClick(path)" @keydown="onPathAnomalyBadgeKeydown($event, path)">{{ pathAnomalyBadgeText(path) }}</button>
                        </div>
                        <div class="mt-1 text-xs text-neutral-400">意图: {{ path.intent || '未知' }} / 成功率: {{ path.successRate.toFixed(2) }} / 复用次数: {{ path.reuseCount }}</div>
                        <div v-if="path.maturity" class="mt-1 text-xs text-sky-500">成熟度: {{ maturityLabel(path.maturity) }}</div>
                        <div v-if="path.promotedRule" class="mt-1 text-xs text-emerald-500">已提升为规则</div>
                        <div v-if="path.failureReason" class="mt-1 text-xs text-red-400">失败原因: {{ path.failureReason }}</div>
                      </div>
                      <NButton size="small" @click="togglePathDetails(path.id)">{{ expandedPathIds.includes(path.id) ? '收起详情' : '查看详情' }}</NButton>
                    </div>

                    <div v-if="expandedPathIds.includes(path.id)" class="mt-3 space-y-2 rounded bg-[#f6f8fa] p-3 text-xs dark:bg-[#1d1f23]">
                      <div v-if="path.input">
                        <div class="font-medium">原始输入</div>
                        <div class="text-neutral-500">{{ path.input }}</div>
                      </div>
                      <div v-if="path.llmSummary">
                        <div class="font-medium">模型摘要</div>
                        <div class="text-neutral-500">意图提示: {{ path.llmSummary.intentHint || '未知' }}</div>
                        <div class="text-neutral-500">下一步提示: {{ path.llmSummary.nextHint || '未知' }}</div>
                        <div v-if="path.llmSummary.selectedSkills?.length" class="mt-1">
                          <div class="font-medium">加载的技能</div>
                          <div v-if="path.llmSummary.selectedSkillsSource" class="text-neutral-400">来源：{{ getSourceLabel(path.llmSummary.selectedSkillsSource) }}</div>
                          <div v-for="(skill, index) in getPathSkills(path)" :key="`${path.id}-skill-${index}`" class="text-neutral-500">{{ skill }}</div>
                        </div>
                        <div v-if="path.llmSummary.skillInsights?.length" class="mt-1">
                          <div class="font-medium">技能洞察</div>
                          <div v-for="(insight, index) in path.llmSummary.skillInsights" :key="`${path.id}-insight-${index}`" class="text-neutral-500">{{ insight.headline || `${insight.tool} / ${insight.section}` }}</div>
                        </div>
                        <div v-if="path.llmSummary.plan?.length" class="mt-1">
                          <div v-for="(step, index) in path.llmSummary.plan" :key="`${path.id}-plan-${index}`">{{ index + 1 }}. {{ step }}</div>
                        </div>
                      </div>
                      <div v-if="path.contextSnapshot?.skillsHint?.length">
                        <div class="font-medium">阶段技能提示</div>
                        <div v-for="(skill, index) in path.contextSnapshot.skillsHint" :key="`${path.id}-stage-skill-${index}`" class="text-neutral-500">{{ skill }}</div>
                      </div>
                      <div v-if="path.contextSnapshot?.selectedSkills?.length">
                        <div class="font-medium">写回时选中的技能</div>
                        <div v-for="(skill, index) in path.contextSnapshot.selectedSkills" :key="`${path.id}-selected-skill-${index}`" class="text-neutral-500">{{ skill }}</div>
                      </div>
                      <div v-if="path.toolResultsSummary?.length">
                        <div class="font-medium">工具结果摘要</div>
                        <div v-for="(item, index) in path.toolResultsSummary" :key="`${path.id}-tool-${index}`" class="text-neutral-500">工具: {{ item.tool }} / 动作: {{ item.action }} / 结果: {{ item.success ? '成功' : '失败' }}<span v-if="item.error"> / 错误: {{ item.error }}</span></div>
                      </div>
                      <div v-if="path.contextSnapshot">
                        <div class="font-medium">上下文快照</div>
                        <NCode :code="JSON.stringify(path.contextSnapshot, null, 2)" language="json" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h2 class="mb-2 font-medium">待提升规则候选</h2>
                <div v-if="!filteredPendingCandidates.length" class="text-sm text-neutral-400">暂无待提升候选</div>
                <div v-else class="space-y-2">
                  <div v-for="candidate in filteredPendingCandidates" :key="`${candidate.sourcePathId}-${candidate.intent}`" class="rounded border p-3 dark:border-[#2a2a2d]" :class="candidate.recommended ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/10' : 'border-[#e5e7eb]'">
                    <div class="font-medium">{{ candidate.trigger }}</div>
                    <div class="text-sm text-neutral-500">意图: {{ candidate.intent }}</div>
                    <div v-if="showCandidateSourceBadge(candidate) || showCandidateAnomalyBadge(candidate)" :class="badgeWrapClass()">
                      <button v-if="showCandidateSourceBadge(candidate)" type="button" :class="candidateSourceBadgeButtonClass(candidate)" :title="getCandidateSourceBadgeTitle(candidate)" :aria-pressed="candidateSourceAriaPressed(candidate) === 'true'" role="button" tabindex="0" @click="onCandidateSourceBadgeClick(candidate)" @keydown="onCandidateSourceBadgeKeydown($event, candidate)">{{ candidateSourceBadgeText(candidate) }}</button>
                      <button v-if="showCandidateAnomalyBadge(candidate)" type="button" :class="candidateAnomalyBadgeButtonClass(candidate)" :title="getCandidateAnomalyBadgeTitle(candidate)" :aria-pressed="candidateAnomalyAriaPressed(candidate) === 'true'" role="button" tabindex="0" @click="onCandidateAnomalyBadgeClick(candidate)" @keydown="onCandidateAnomalyBadgeKeydown($event, candidate)">{{ candidateAnomalyBadgeText(candidate) }}</button>
                    </div>
                    <div v-if="candidate.recommended" class="mt-1 inline-flex rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">推荐提升</div>
                    <div v-if="candidate.recommendationReason" class="mt-1 text-xs text-amber-600 dark:text-amber-300">{{ candidate.recommendationReason }}</div>
                    <div v-if="candidate.responsePreview" class="mt-1 text-xs text-neutral-400">响应预览: {{ candidate.responsePreview }}</div>
                    <div v-if="typeof candidate.successRate === 'number'" class="mt-1 text-xs text-neutral-400">成功率: {{ candidate.successRate.toFixed(2) }}</div>
                    <div v-if="typeof candidate.reuseCount === 'number'" class="mt-1 text-xs text-neutral-400">复用次数: {{ candidate.reuseCount }}</div>
                    <div v-if="candidate.maturity" class="mt-1 text-xs text-sky-500">成熟度: {{ maturityLabel(candidate.maturity) }}</div>
                    <div class="mt-1 text-xs text-neutral-400">来源路径 ID: {{ candidate.sourcePathId }}</div>
                    <div v-if="candidate.llmSummary?.selectedSkills?.length || candidate.contextSnapshot?.skillsHint?.length" class="mt-2 rounded bg-[#f6f8fa] p-2 text-xs dark:bg-[#1d1f23]">
                      <div class="font-medium">来源技能</div>
                      <div v-if="candidate.llmSummary?.selectedSkillsSource" class="text-neutral-400">来源：{{ getSourceLabel(candidate.llmSummary.selectedSkillsSource) }}</div>
                      <div v-for="(skill, index) in getCandidateSkills(candidate)" :key="`${candidate.sourcePathId}-skill-${index}`" class="text-neutral-500">{{ skill }}</div>
                    </div>
                    <div class="mt-2 flex justify-end"><NButton size="small" type="primary" @click="promoteCandidate(candidate)">提升为规则</NButton></div>
                  </div>
                </div>
              </div>

              <div>
                <h2 class="mb-2 font-medium">已提升规则</h2>
                <div v-if="!filteredRules.length" class="text-sm text-neutral-400">暂无已提升规则</div>
                <div v-else class="space-y-2">
                  <div v-for="rule in filteredRules" :key="`${rule.id}-${rule.trigger}`" class="rounded border border-[#e5e7eb] p-3 opacity-80 dark:border-[#2a2a2d]">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="font-medium">{{ rule.trigger }}</div>
                        <div class="text-sm text-neutral-500">响应: {{ rule.response }}</div>
                        <div v-if="showRuleSourceBadge(rule) || showRuleAnomalyBadge(rule)" :class="badgeWrapClass()">
                          <button v-if="showRuleSourceBadge(rule)" type="button" :class="ruleSourceBadgeButtonClass(rule)" :title="getRuleSourceBadgeTitle(rule)" :aria-pressed="ruleSourceAriaPressed(rule) === 'true'" role="button" tabindex="0" @click="onRuleSourceBadgeClick(rule)" @keydown="onRuleSourceBadgeKeydown($event, rule)">{{ ruleSourceBadgeText(rule) }}</button>
                          <button v-if="showRuleAnomalyBadge(rule)" type="button" :class="ruleAnomalyBadgeButtonClass(rule)" :title="getRuleAnomalyBadgeTitle(rule)" :aria-pressed="ruleAnomalyAriaPressed(rule) === 'true'" role="button" tabindex="0" @click="onRuleAnomalyBadgeClick(rule)" @keydown="onRuleAnomalyBadgeKeydown($event, rule)">{{ ruleAnomalyBadgeText(rule) }}</button>
                        </div>
                        <div class="mt-1 text-xs text-neutral-400">命中次数: {{ rule.hit_count || 0 }}</div>
                        <div v-if="rule.last_matched_at" class="mt-1 text-xs text-neutral-400">最后命中时间: {{ rule.last_matched_at }}</div>
                        <div class="mt-1 text-xs" :class="rule.enabled === false ? 'text-red-400' : 'text-emerald-500'">状态：{{ rule.enabled === false ? '已禁用' : '已启用' }}</div>
                      </div>
                      <div class="flex flex-col gap-2 items-end">
                        <NButton size="small" @click="toggleRuleDetails(rule.id)">{{ expandedRuleIds.includes(rule.id) ? '收起详情' : '查看详情' }}</NButton>
                        <NButton v-if="rule.enabled !== false" size="small" @click="disablePersistedRule(rule)">禁用</NButton>
                        <NButton v-else size="small" @click="enablePersistedRule(rule)">启用</NButton>
                        <NButton size="small" type="warning" @click="rollbackPersistedRule(rule)">回退为候选</NButton>
                      </div>
                    </div>
                    <div v-if="expandedRuleIds.includes(rule.id)" class="mt-3 space-y-2 rounded bg-[#f6f8fa] p-3 text-xs dark:bg-[#1d1f23]">
                      <div>
                        <div class="font-medium">动作定义</div>
                        <NCode :code="JSON.stringify(rule.actions || [], null, 2)" language="json" />
                      </div>
                      <div v-if="getRuleSkills(rule).length">
                        <div class="font-medium">来源技能</div>
                        <div v-if="getRuleSource(rule)?.llmSummary?.selectedSkillsSource" class="text-neutral-400">来源：{{ getSourceLabel(getRuleSource(rule)?.llmSummary?.selectedSkillsSource || '未知') }}</div>
                        <div v-for="(skill, index) in getRuleSkills(rule)" :key="`${rule.id}-source-skill-${index}`" class="text-neutral-500">{{ skill }}</div>
                      </div>
                      <div v-if="getRuleSourcePathId(rule)" class="text-neutral-400">来源路径 ID: {{ getRuleSourcePathId(rule) }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </NSpin>
        </NCard>
      </template>
    </main>
  </div>
</template>
