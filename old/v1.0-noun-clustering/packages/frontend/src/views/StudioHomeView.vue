<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { workflowApi, type Workflow } from '@/api/workflow'
import { buildWorkflowDetailTabs } from '@/features/studio/detailNavigation'
import { buildWorkflowRoute } from '@/features/studio/workflowEditorRoute'
import { useLocale } from '@/composables/useLocale'

const router = useRouter()
const { locale, t } = useLocale()

const loading = ref(false)
const workflows = ref<Workflow[]>([])
const isZh = computed(() => locale.value === 'zh')

const publishedCount = computed(() => workflows.value.filter((w) => w.published).length)
const draftCount = computed(() => workflows.value.filter((w) => !w.published).length)

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

function workflowTabs(workflow: Workflow) {
  return buildWorkflowDetailTabs(workflow.id, label)
}

function triggerLabel(type: string) {
  const map: Record<string, string> = {
    manual: label('手动', 'Manual'),
    cron: label('定时', 'Cron'),
    chat: label('对话', 'Chat'),
  }
  return map[type] || type
}

onMounted(loadWorkflows)

async function loadWorkflows() {
  loading.value = true
  try {
    const result = await workflowApi.list()
    workflows.value = result.workflows ?? []
  } catch {
    workflows.value = []
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  const name = window.prompt(t('studio.workflowNamePrompt'))
  if (!name) return
  try {
    const result = await workflowApi.create({ name })
    if (result.data?.id) {
      await router.push(buildWorkflowRoute(result.data.id, 'editor'))
    }
  } catch {
    // silent
  }
}

async function handleReseed() {
  if (!window.confirm(t('studio.reseedConfirm'))) return
  try {
    const result = await workflowApi.reseedDefaults(true)
    const data = result.data
    window.alert(t('studio.reseedDone', {
      created: data.created.length,
      updated: data.updated.length,
      skipped: data.skipped.length,
    }))
    await loadWorkflows()
  } catch {
    // silent
  }
}

function openEditor(workflow: Workflow) {
  router.push(buildWorkflowRoute(workflow.id, 'editor'))
}
</script>

<template>
  <div class="studio-home">
    <section class="summary-strip">
      <div class="summary-card hero">
        <span class="summary-label">{{ label('Studio 工作流', 'Studio Workflows') }}</span>
        <strong>{{ label('工作流中心', 'Workflow Hub') }}</strong>
        <p>{{ label('创建、编排和运行自动化工作流。', 'Create, orchestrate, and run automated workflows.') }}</p>
      </div>
      <div class="summary-card">
        <span class="summary-label">{{ label('全部工作流', 'Total') }}</span>
        <strong>{{ workflows.length }}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">{{ label('已发布', 'Published') }}</span>
        <strong>{{ publishedCount }}</strong>
      </div>
      <div class="summary-card">
        <span class="summary-label">{{ label('草稿', 'Draft') }}</span>
        <strong>{{ draftCount }}</strong>
      </div>
    </section>

    <section class="action-bar">
      <button class="primary-btn" @click="handleCreate">{{ label('新建工作流', 'Create Workflow') }}</button>
      <button class="ghost-btn" @click="handleReseed">{{ label('重置默认', 'Reseed Defaults') }}</button>
      <button class="ghost-btn" @click="loadWorkflows">{{ label('刷新', 'Refresh') }}</button>
    </section>

    <div v-if="loading" class="empty-state">{{ label('加载中…', 'Loading…') }}</div>
    <div v-else-if="workflows.length === 0" class="empty-state">{{ label('暂无工作流。', 'No workflows yet.') }}</div>
    <section v-else class="workflow-grid">
      <article v-for="workflow in workflows" :key="workflow.id" class="workflow-card">
        <div class="card-header">
          <div class="card-badges">
            <span class="trigger-badge">{{ triggerLabel(workflow.trigger_type) }}</span>
            <span :class="['status-badge', workflow.published ? 'published' : 'draft']">
              {{ workflow.published ? label('已发布', 'Published') : label('草稿', 'Draft') }}
            </span>
          </div>
        </div>

        <h3 class="card-title">{{ workflow.name }}</h3>
        <p class="card-desc">{{ workflow.description || label('无描述', 'No description') }}</p>

        <div class="card-actions">
          <button
            v-for="tab in workflowTabs(workflow)"
            :key="tab.route"
            class="card-action-btn"
            @click="router.push(tab.route)"
          >
            {{ tab.label }}
          </button>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.studio-home {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding: 40px;
  background: #f7f9fa;
  overflow-y: auto;
}

.summary-strip {
  display: grid;
  grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr));
  gap: 24px;
}

.summary-card {
  padding: 40px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.summary-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.9);
}

.summary-card.hero {
  background: rgba(255, 255, 255, 0.6);
}

.summary-label {
  display: inline-block;
  margin-bottom: 20px;
  color: #10b981;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 12px;
  border-radius: 8px;
}

.summary-card strong {
  display: block;
  font-size: 44px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.05em;
  line-height: 1;
}

.summary-card.hero strong {
  font-size: 40px;
  background: linear-gradient(135deg, #1e293b 0%, #64748b 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  line-height: 1.1;
}

.summary-card p {
  margin: 20px 0 0;
  color: var(--text-secondary);
  font-size: 17px;
  line-height: 1.7;
  font-weight: 600;
  max-width: 600px;
  letter-spacing: -0.01em;
}

.action-bar {
  display: flex;
  gap: 16px;
}

.ghost-btn,
.primary-btn {
  height: 48px;
  border-radius: 14px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  background: rgba(255, 255, 255, 0.8);
  padding: 0 24px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  color: var(--text-primary);
}

.ghost-btn:hover {
  border-color: #10b981;
  color: #10b981;
  transform: translateY(-2px);
  background: #fff;
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.12);
}

.primary-btn {
  background: #10b981;
  color: #fff;
  border: none;
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.25);
}

.primary-btn:hover {
  background: #059669;
  transform: translateY(-4px);
  box-shadow: 0 16px 48px rgba(16, 185, 129, 0.35);
  color: #fff;
}

.workflow-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 24px;
}

.workflow-card {
  padding: 40px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
}

.workflow-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.9);
}

.card-header {
  margin-bottom: 24px;
}

.card-badges {
  display: flex;
  gap: 12px;
}

.trigger-badge {
  display: inline-flex;
  height: 26px;
  align-items: center;
  padding: 0 14px;
  border-radius: 99px;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  background: rgba(37, 99, 235, 0.08);
  color: #2563eb;
}

.status-badge {
  display: inline-flex;
  height: 26px;
  align-items: center;
  padding: 0 14px;
  border-radius: 99px;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

.status-badge.published {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.status-badge.draft {
  background: rgba(148, 163, 184, 0.1);
  color: #94a3b8;
}

.card-title {
  font-size: 22px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.03em;
  margin-bottom: 12px;
}

.card-desc {
  color: var(--text-tertiary);
  font-size: 15px;
  line-height: 1.7;
  font-weight: 600;
  letter-spacing: -0.01em;
  flex: 1;
  margin-bottom: 32px;
}

.card-actions {
  display: flex;
  gap: 12px;
  border-top: 1px solid rgba(236, 239, 242, 0.8);
  padding-top: 24px;
}

.card-action-btn {
  height: 40px;
  padding: 0 20px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.card-action-btn:hover {
  border-color: #10b981;
  color: #10b981;
  transform: translateY(-2px);
  background: #fff;
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.12);
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 15px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.5;
  text-align: center;
  padding: 80px;
}
</style>
