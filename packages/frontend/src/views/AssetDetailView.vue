<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { agentApi } from '@/api/agents'
import StudioDetailLayout from '@/components/studio/StudioDetailLayout.vue'
import { executorApi } from '@/api/executor'
import { formatAssetKind } from '@/features/studio/assetWorkbench'
import { buildSkillDetailTabs } from '@/features/studio/detailNavigation'
import { manifestApi } from '@/api/manifests'
import { skillApi, type SkillRecord } from '@/api/skills'
import { useLocale } from '@/composables/useLocale'

type AssetKind = 'skill' | 'manifest' | 'plan' | 'agent'

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
  if (assetKind.value === 'skill') return String((detail.value as SkillRecord | null)?.name ?? label('技能', 'Skill'))
  if (assetKind.value === 'manifest') return String(detail.value?.display_name ?? label('执行清单', 'Manifest'))
  if (assetKind.value === 'plan') return String((detail.value?.plan as Record<string, unknown> | undefined)?.name ?? label('计划', 'Plan'))
  return String(detail.value?.name ?? label('智能体', 'Agent'))
})

const tabs = computed(() => {
  if (assetKind.value !== 'skill') return []
  return buildSkillDetailTabs(String(route.params.name), label)
})

function safeStringify(value: unknown) {
  return JSON.stringify(value, null, 2)
}

const summaryRows = computed(() => [
  { label: label('类型', 'Type'), value: formatAssetKind(assetKind.value, label) },
  { label: label('标签页', 'Tab'), value: assetTab.value },
  {
    label: label('标识', 'Identifier'),
    value: assetKind.value === 'skill'
      ? String(route.params.name ?? '-')
      : assetKind.value === 'agent'
        ? String(route.params.target ?? '-')
        : String(route.params.id ?? '-'),
  },
])
</script>

<template>
  <StudioDetailLayout
    :title="title"
    :description="label('浅资产页保留结构化细节，用于承接 skill、manifest、plan、agent 的统一浏览。', 'Structured shallow-asset page for skills, manifests, plans, and agents.')"
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
        <template v-if="assetKind === 'skill' && assetTab === 'prompt'">
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
</style>
