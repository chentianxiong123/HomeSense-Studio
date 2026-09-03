<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { agentApi } from '@/api/agents'
import { deviceSkillApi } from '@/api/deviceSkills'
import StudioDetailLayout from '@/components/studio/StudioDetailLayout.vue'
import { executorApi } from '@/api/executor'
import { buildSkillDetailTabs } from '@/features/studio/detailNavigation'
import { manifestApi } from '@/api/manifests'
import { memoryAssetsApi, type MemoryAssetRecord } from '@/api/memoryAssets'
import { skillApi, type SkillRecord } from '@/api/skills'
import { useLocale } from '@/composables/useLocale'

type AssetKind = 'device_skill' | 'skill' | 'manifest' | 'plan' | 'memory' | 'agent'

const route = useRoute()
const { locale } = useLocale()

const loading = ref(false)
const detail = ref<Record<string, unknown> | null>(null)
const extraText = ref('')

const assetKind = computed(() => (route.meta.assetKind ?? 'skill') as AssetKind)
const assetTab = computed(() => String(route.meta.assetTab ?? 'overview'))
const isZh = computed(() => locale.value === 'zh')

watch([assetKind, assetTab, () => route.params], async () => {
  await loadDetail()
}, { deep: true, immediate: true })

onMounted(loadDetail)

async function loadDetail() {
  loading.value = true
  try {
    if (assetKind.value === 'device_skill') {
      const id = String(route.params.id)
      const result = await deviceSkillApi.get(id)
      detail.value = result.skill as unknown as Record<string, unknown>
      extraText.value = ''
      return
    }

    if (assetKind.value === 'skill') {
      const name = String(route.params.name)
      const result = await skillApi.get(name)
      detail.value = result.skill as unknown as Record<string, unknown>
      extraText.value = assetTab.value === 'prompt'
        ? (await skillApi.getFull(name)).prompt_template
        : ''
      return
    }

    if (assetKind.value === 'manifest') {
      detail.value = (await manifestApi.get(String(route.params.id))).manifest as unknown as Record<string, unknown>
      extraText.value = ''
      return
    }

    if (assetKind.value === 'plan') {
      detail.value = (await executorApi.getPlan(String(route.params.id))).data as unknown as Record<string, unknown>
      extraText.value = ''
      return
    }

    if (assetKind.value === 'memory') {
      const result = await memoryAssetsApi.get(String(route.params.id))
      detail.value = result.asset as unknown as Record<string, unknown>
      extraText.value = ''
      return
    }

    detail.value = await agentApi.getByTarget(String(route.params.target)) as unknown as Record<string, unknown>
    extraText.value = ''
  } finally {
    loading.value = false
  }
}

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

const title = computed(() => {
  if (assetKind.value === 'device_skill') return String(detail.value?.title ?? label('设备技能', 'Device Skill'))
  if (assetKind.value === 'skill') return String((detail.value as SkillRecord | null)?.name ?? label('技能', 'Skill'))
  if (assetKind.value === 'manifest') return String(detail.value?.display_name ?? label('记忆项', 'Memory Item'))
  if (assetKind.value === 'plan') return String((detail.value?.plan as Record<string, unknown> | undefined)?.name ?? label('计划', 'Plan'))
  if (assetKind.value === 'memory') return String(detail.value?.title ?? label('记忆', 'Memory'))
  return String(detail.value?.name ?? label('遗留配置', 'Legacy Config'))
})

const tabs = computed(() => {
  if (assetKind.value !== 'skill') return []
  return buildSkillDetailTabs(String(route.params.name), label)
})

function safeStringify(value: unknown) {
  return JSON.stringify(value, null, 2)
}

const deviceSkill = computed(() => assetKind.value === 'device_skill' ? detail.value : null)
const memoryAsset = computed(() => assetKind.value === 'memory' ? detail.value as unknown as MemoryAssetRecord | null : null)
const memoryMetadata = computed(() => memoryAsset.value?.metadata ?? {})
const memorySteps = computed(() => Array.isArray(memoryMetadata.value.steps) ? memoryMetadata.value.steps as Array<Record<string, unknown>> : [])
const memoryWorkflowId = computed(() => {
  const value = Number(memoryMetadata.value.workflow_id)
  return Number.isInteger(value) && value > 0 ? value : null
})
const memoryInputs = computed(() => {
  const inputs = memoryMetadata.value.workflow_inputs
  return inputs && typeof inputs === 'object' && !Array.isArray(inputs)
    ? inputs as Record<string, unknown>
    : null
})
const memoryStats = computed(() => ({
  success: readNumber(memoryMetadata.value.success_count),
  failure: readNumber(memoryMetadata.value.failure_count),
  lastSuccessAt: String(memoryMetadata.value.last_success_at ?? ''),
}))

const summaryRows = computed(() => [
  { label: label('类型', 'Type'), value: formatDetailAssetKind(assetKind.value) },
  { label: label('标签页', 'Tab'), value: assetTab.value },
  {
    label: label('标识', 'Identifier'),
    value: assetKind.value === 'device_skill'
      ? String(route.params.id ?? '-')
      : assetKind.value === 'skill'
      ? String(route.params.name ?? '-')
      : assetKind.value === 'memory'
      ? String(route.params.id ?? '-')
      : assetKind.value === 'agent'
        ? String(route.params.target ?? '-')
        : String(route.params.id ?? '-'),
  },
])

function formatDetailAssetKind(kind: AssetKind) {
  const labels: Record<AssetKind, [string, string]> = {
    device_skill: ['设备技能', 'Device Skill'],
    skill: ['技能', 'Skill'],
    manifest: ['旧执行入口', 'Legacy Manifest'],
    plan: ['旧计划', 'Legacy Plan'],
    memory: ['记忆', 'Memory'],
    agent: ['遗留配置', 'Legacy Config'],
  }
  const item = labels[kind]
  return label(item[0], item[1])
}

function formatMemoryStatus(status: unknown) {
  const value = String(status ?? '')
  if (value === 'active') return label('可用', 'Ready')
  if (value === 'planned') return label('规划中', 'Planned')
  if (value === 'legacy') return label('迁移项', 'Legacy')
  return value || '-'
}

function formatMemorySource(source: unknown) {
  const value = String(source ?? '')
  if (value === 'runtime') return label('运行时沉淀', 'Runtime')
  if (value === 'user') return label('用户固化', 'User')
  if (value === 'manifest') return label('旧执行入口', 'Legacy Manifest')
  if (value === 'plan') return label('旧计划', 'Legacy Plan')
  if (value === 'imported') return label('导入', 'Imported')
  if (value === 'system') return label('系统', 'System')
  return value || '-'
}

function stepTitle(step: Record<string, unknown>, index: number) {
  return `${index + 1}. ${String(step.tool ?? '-')}.${String(step.action ?? '-')}`
}

function stepParams(step: Record<string, unknown>) {
  const params = step.params
  return params && typeof params === 'object' && !Array.isArray(params) ? params : null
}

function readNumber(value: unknown) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}
</script>

<template>
  <StudioDetailLayout
    :title="title"
    :description="label('资产注册表保留结构化细节，用于承接设备技能、记忆、通用技能以及未来的 MCP Skills 和消息网关。', 'Asset registry details for device skills, memory, general skills, and future MCP skills and gateways.')"
    :back-label="label('返回资产中心', 'Back to Assets')"
    back-route="/assets"
    :tabs="tabs"
    :loading="loading"
    :loading-label="label('加载资产详情中…', 'Loading asset detail…')"
  >
    <section class="asset-detail-grid">
      <aside class="summary-aside">
        <article class="detail-card glass-panel summary-card">
          <header class="card-head">
            <span class="eyebrow">{{ label('基础信息', 'Overview') }}</span>
            <h3>{{ label('资产概览', 'Asset Overview') }}</h3>
          </header>
          <div class="summary-list">
            <div v-for="row in summaryRows" :key="row.label" class="summary-row">
              <label class="eyebrow">{{ row.label }}</label>
              <span class="summary-value">{{ row.value }}</span>
            </div>
          </div>
        </article>
      </aside>

      <main class="detail-main">
        <template v-if="deviceSkill">
          <section class="detail-card glass-panel">
            <header class="card-head">
              <span class="eyebrow">Device Skill</span>
              <h3>{{ label('加载策略', 'Load Policy') }}</h3>
            </header>
            <div class="summary-list compact">
              <div class="summary-row">
                <label>{{ label('设备类型', 'Device Type') }}</label>
                <span class="summary-value">{{ deviceSkill.device_type }}</span>
              </div>
              <div class="summary-row">
                <label>{{ label('触发时机', 'When To Load') }}</label>
                <div class="chip-list">
                  <span v-for="item in (deviceSkill.when_to_load as string[] || [])" :key="item">{{ item }}</span>
                </div>
              </div>
              <div class="summary-row">
                <label>{{ label('首选工具', 'Preferred Tools') }}</label>
                <div class="chip-list">
                  <span v-for="item in (deviceSkill.preferred_tools as string[] || [])" :key="item">{{ item }}</span>
                </div>
              </div>
            </div>
          </section>

          <section class="detail-card glass-panel">
            <header class="card-head">
              <span class="eyebrow">Paths</span>
              <h3>{{ label('常见路径', 'Common Paths') }}</h3>
            </header>
            <div class="path-list">
              <article v-for="path in (deviceSkill.common_paths as Array<{ intent: string; steps: string[] }> || [])" :key="path.intent" class="path-item">
                <strong>{{ path.intent }}</strong>
                <ol>
                  <li v-for="step in path.steps" :key="step">{{ step }}</li>
                </ol>
              </article>
            </div>
          </section>

          <section class="detail-card glass-panel">
            <header class="card-head">
              <span class="eyebrow">Rules</span>
              <h3>{{ label('参数与失败恢复', 'Arguments & Recovery') }}</h3>
            </header>
            <pre class="json-block">{{ safeStringify({ argument_rules: deviceSkill.argument_rules, failure_recovery: deviceSkill.failure_recovery }) }}</pre>
          </section>
        </template>
        <template v-else-if="memoryAsset">
          <section class="detail-card glass-panel memory-overview-card">
            <header class="card-head">
              <span class="eyebrow">{{ label('记忆路径', 'Memory Path') }}</span>
              <h3>{{ label('路径概览', 'Path Overview') }}</h3>
            </header>
            <p class="memory-summary">{{ memoryAsset.summary || label('没有摘要。', 'No summary.') }}</p>
            <div class="memory-stat-grid">
              <div>
                <span>{{ label('状态', 'Status') }}</span>
                <strong>{{ formatMemoryStatus(memoryAsset.status) }}</strong>
              </div>
              <div>
                <span>{{ label('来源', 'Source') }}</span>
                <strong>{{ formatMemorySource(memoryAsset.source) }}</strong>
              </div>
              <div>
                <span>{{ label('成功', 'Success') }}</span>
                <strong>{{ memoryStats.success }}</strong>
              </div>
              <div>
                <span>{{ label('失败', 'Failure') }}</span>
                <strong>{{ memoryStats.failure }}</strong>
              </div>
            </div>
          </section>

          <section v-if="memoryWorkflowId" class="detail-card glass-panel">
            <header class="card-head">
              <span class="eyebrow">{{ label('回流', 'Return Path') }}</span>
              <h3>{{ label('关联 Workflow', 'Linked Workflow') }}</h3>
            </header>
            <div class="workflow-return">
              <div>
                <label>{{ label('Workflow ID', 'Workflow ID') }}</label>
                <strong>#{{ memoryWorkflowId }}</strong>
              </div>
              <div>
                <label>{{ label('最近成功', 'Last Success') }}</label>
                <span>{{ memoryStats.lastSuccessAt || '-' }}</span>
              </div>
            </div>
            <div class="action-row">
              <RouterLink class="detail-action primary" :to="`/studio/workflows/${memoryWorkflowId}/editor`">
                {{ label('打开编排', 'Open Editor') }}
              </RouterLink>
              <RouterLink class="detail-action" :to="`/studio/workflows/${memoryWorkflowId}/runs`">
                {{ label('查看运行', 'View Runs') }}
              </RouterLink>
            </div>
            <pre v-if="memoryInputs" class="json-block compact-json">{{ safeStringify(memoryInputs) }}</pre>
          </section>

          <section class="detail-card glass-panel">
            <header class="card-head">
              <span class="eyebrow">{{ label('执行步骤', 'Steps') }}</span>
              <h3>{{ label('经验路径步骤', 'Experience Path Steps') }}</h3>
            </header>
            <div v-if="memorySteps.length > 0" class="memory-step-list">
              <article v-for="(step, index) in memorySteps" :key="`${index}-${stepTitle(step, index)}`" class="memory-step-item">
                <strong>{{ stepTitle(step, index) }}</strong>
                <pre v-if="stepParams(step)" class="json-block compact-json">{{ safeStringify(stepParams(step)) }}</pre>
              </article>
            </div>
            <div v-else class="empty-detail-line">
              {{ label('这条记忆还没有结构化步骤。', 'This memory has no structured steps yet.') }}
            </div>
          </section>

          <section class="detail-card glass-panel">
            <header class="card-head">
              <span class="eyebrow">{{ label('召回', 'Recall') }}</span>
              <h3>{{ label('检索与引用', 'Retrieval & Links') }}</h3>
            </header>
            <div class="summary-list compact">
              <div class="summary-row">
                <label>{{ label('召回提示', 'Retrieval Hint') }}</label>
                <span class="summary-value soft">{{ memoryAsset.retrieval_hint || '-' }}</span>
              </div>
              <div class="summary-row">
                <label>{{ label('关联设备', 'Devices') }}</label>
                <div class="chip-list">
                  <span v-for="item in memoryAsset.device_refs" :key="item">{{ item }}</span>
                  <span v-if="memoryAsset.device_refs.length === 0">-</span>
                </div>
              </div>
              <div class="summary-row">
                <label>{{ label('引用 Skill', 'Skills') }}</label>
                <div class="chip-list">
                  <span v-for="item in memoryAsset.skill_refs" :key="`${item.kind}:${item.id}`">{{ item.label || item.id }}</span>
                  <span v-if="memoryAsset.skill_refs.length === 0">-</span>
                </div>
              </div>
            </div>
          </section>
        </template>
        <template v-else-if="assetKind === 'skill' && assetTab === 'prompt'">
          <section class="detail-card glass-panel">
            <header class="card-head">
              <span class="eyebrow">Prompt Template</span>
              <h3>{{ label('完整提示词', 'Full Prompt Template') }}</h3>
            </header>
            <pre class="json-block">{{ extraText || label('当前没有 prompt_template。', 'No prompt_template available.') }}</pre>
          </section>
        </template>
        <template v-else>
          <section class="detail-card glass-panel">
            <header class="card-head">
              <span class="eyebrow">Structured JSON</span>
              <h3>{{ label('结构化详情', 'Structured Detail') }}</h3>
            </header>
            <pre class="json-block">{{ safeStringify(detail) }}</pre>
          </section>
        </template>
      </main>
    </section>
  </StudioDetailLayout>
</template>

<style scoped>
.asset-detail-grid {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 24px;
  min-height: 100%;
}

.detail-card {
  padding: 40px;
  border: 1px solid rgba(229, 231, 235, 0.5);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.03);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.detail-card:hover {
  background: rgba(255, 255, 255, 0.8);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.08);
  transform: translateY(-6px);
  border-color: rgba(16, 185, 129, 0.25);
}

.summary-card {
  align-self: start;
}

.card-head {
  margin-bottom: 32px;
}

.eyebrow {
  display: inline-block;
  color: #10b981;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 12px;
  border-radius: 8px;
  margin-bottom: 20px;
  width: fit-content;
}

.detail-card h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.summary-list {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.summary-list.compact {
  gap: 20px;
}

.summary-row {
  padding-bottom: 24px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.8);
}

.summary-row:last-child {
  border-bottom: none;
}

.summary-row label {
  display: block;
  margin-bottom: 14px;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.6;
  background: none;
  padding: 0;
}

.summary-value {
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 900;
  word-break: break-all;
  letter-spacing: -0.02em;
}

.summary-value.soft {
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.7;
  font-weight: 750;
}

.json-block {
  margin: 0;
  padding: 32px;
  background: #1e293b;
  color: #e2e8f0;
  border-radius: 24px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 15px;
  line-height: 1.8;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.compact-json {
  padding: 18px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.65;
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip-list span {
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(16, 185, 129, 0.08);
  color: #047857;
  font-size: 13px;
  font-weight: 900;
}

.path-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.path-item {
  padding: 18px;
  border: 1px solid rgba(229, 231, 235, 0.55);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.55);
}

.path-item strong {
  display: block;
  margin-bottom: 10px;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
}

.path-item ol {
  margin: 0;
  padding-left: 20px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.8;
}

.memory-summary {
  margin: 0 0 24px;
  color: var(--text-secondary);
  font-size: 15px;
  font-weight: 750;
  line-height: 1.8;
}

.memory-stat-grid,
.workflow-return {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.workflow-return {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: 18px;
}

.memory-stat-grid > div,
.workflow-return > div {
  min-width: 0;
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.82);
}

.memory-stat-grid span,
.workflow-return label {
  display: block;
  margin-bottom: 8px;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.memory-stat-grid strong,
.workflow-return strong,
.workflow-return span {
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 900;
  word-break: break-word;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 18px;
}

.detail-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid rgba(37, 99, 235, 0.22);
  border-radius: 10px;
  background: rgba(37, 99, 235, 0.08);
  color: #1d4ed8;
  font-size: 13px;
  font-weight: 900;
  text-decoration: none;
}

.detail-action.primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}

.memory-step-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.memory-step-item {
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.62);
}

.memory-step-item strong {
  display: block;
  margin-bottom: 10px;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 900;
}

.empty-detail-line {
  padding: 18px;
  border: 1px dashed rgba(148, 163, 184, 0.7);
  border-radius: 12px;
  color: var(--text-tertiary);
  font-size: 14px;
  font-weight: 800;
}

@media (max-width: 1100px) {
  .asset-detail-grid,
  .memory-stat-grid,
  .workflow-return {
    grid-template-columns: 1fr;
  }
}
</style>
