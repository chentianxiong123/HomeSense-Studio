<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { useLocale } from '../composables/useLocale'
import { formatChinaDateTime } from '../utils/chinaTime'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

type Tab = 'crons' | 'compensations' | 'rules' | 'experiences' | 'memory' | 'approvals'

const tab = ref<Tab>('crons')
const loading = ref(false)
const error = ref<string | null>(null)

const cronSchedules = ref<Array<{ id: string; cron: string }>>([])
const compensationTasks = ref<Array<Record<string, unknown>>>([])
const rules = ref<Array<Record<string, unknown>>>([])
const experiences = ref<Array<Record<string, unknown>>>([])
const memoryStatus = ref<Record<string, unknown> | null>(null)
const memoryCompiled = ref<Array<Record<string, unknown>>>([])
const approvals = ref<Array<{ id: string; turn_id: string; reason: string; decision?: string; created_at: number; resolved_at?: number }>>([])

const { t } = useLocale()

async function refresh() {
  loading.value = true
  error.value = null
  try {
    if (tab.value === 'crons') {
      const result = await api.observability.cronSchedules()
      cronSchedules.value = result.schedules
    } else if (tab.value === 'compensations') {
      const result = await api.observability.compensationTasks()
      compensationTasks.value = result.tasks
    } else if (tab.value === 'rules') {
      const result = await api.observability.rules()
      rules.value = result.rules
    } else if (tab.value === 'experiences') {
      const result = await api.observability.experiences()
      experiences.value = result.experiences
    } else if (tab.value === 'memory') {
      memoryStatus.value = await api.observability.memoryStatus()
      const result = await api.observability.memoryCompiled()
      memoryCompiled.value = result.items
    } else if (tab.value === 'approvals') {
      const result = await api.approvals.list()
      approvals.value = result.approvals
    }
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

watch([tab, () => props.open], ([, isOpen]) => {
  if (isOpen) refresh()
})

onMounted(() => {
  if (props.open) refresh()
})

const tabs = computed<Array<{ key: Tab; label: string }>>(() => [
  { key: 'crons', label: t('obs.crons') },
  { key: 'compensations', label: t('obs.compensations') },
  { key: 'rules', label: t('obs.rules') },
  { key: 'experiences', label: t('obs.experiences') },
  { key: 'memory', label: t('obs.memory') },
  { key: 'approvals', label: t('obs.approvals') },
])

const approvalStatus = computed(() => ({
  pending: approvals.value.filter((item) => !item.decision).length,
  approved: approvals.value.filter((item) => item.decision === 'approved').length,
  denied: approvals.value.filter((item) => item.decision === 'denied').length,
  timeout: approvals.value.filter((item) => item.decision === 'timeout').length,
}))

function taskState(task: Record<string, unknown>): string {
  return String(task.state ?? task.status ?? '')
}

function taskType(task: Record<string, unknown>): string {
  return String(task.type ?? task.action_type ?? '')
}

function taskAttempts(task: Record<string, unknown>): number {
  const retryCount = task.retry_count ?? task.attempts ?? 0
  return Number(retryCount) || 0
}

function taskNextRetryAt(task: Record<string, unknown>): string {
  return String(task.next_retry_at ?? task.next_attempt_at ?? '')
}
</script>

<template>
  <div v-if="open" class="obs-overlay" @click.self="emit('close')">
    <div class="obs-panel">
      <header class="obs-head">
        <div class="title">{{ t('obs.title') }}</div>
        <div class="tabs">
          <button
            v-for="item in tabs"
            :key="item.key"
            :class="['tab', tab === item.key && 'active']"
            @click="tab = item.key"
          >{{ item.label }}</button>
        </div>
        <div class="actions">
          <button class="mini" :disabled="loading" @click="refresh">R</button>
          <button class="mini" @click="emit('close')">x</button>
        </div>
      </header>

      <div v-if="error" class="error">{{ error }}</div>

      <section v-if="tab === 'crons'" class="section">
        <div v-if="cronSchedules.length === 0" class="empty">{{ t('obs.emptySchedules') }}</div>
        <table v-else class="tbl">
          <thead><tr><th>{{ t('obs.id') }}</th><th>Cron</th></tr></thead>
          <tbody>
            <tr v-for="schedule in cronSchedules" :key="schedule.id">
              <td>{{ schedule.id }}</td>
              <td class="mono">{{ schedule.cron }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="tab === 'compensations'" class="section">
        <div v-if="compensationTasks.length === 0" class="empty">{{ t('obs.emptyCompensations') }}</div>
        <table v-else class="tbl">
          <thead>
            <tr>
              <th>{{ t('obs.id') }}</th>
              <th>{{ t('obs.statusLabel') }}</th>
              <th>{{ t('obs.typeLabel') }}</th>
              <th>{{ t('obs.attempts') }}</th>
              <th>{{ t('obs.next') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in compensationTasks" :key="String(task.id)">
              <td>{{ task.id }}</td>
              <td>{{ taskState(task) }}</td>
              <td>{{ taskType(task) }}</td>
              <td>{{ taskAttempts(task) }}</td>
              <td>{{ formatChinaDateTime(taskNextRetryAt(task)) || t('obs.none') }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="tab === 'rules'" class="section">
        <div v-if="rules.length === 0" class="empty">{{ t('obs.emptyRules') }}</div>
        <table v-else class="tbl">
          <thead>
            <tr>
              <th>{{ t('obs.id') }}</th>
              <th>{{ t('obs.name') }}</th>
              <th>{{ t('obs.trigger') }}</th>
              <th>{{ t('obs.enabledLabel') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rule in rules" :key="String(rule.id)">
              <td>{{ rule.id }}</td>
              <td>{{ rule.name }}</td>
              <td class="mono">{{ rule.trigger }}</td>
              <td>{{ rule.enabled ? t('obs.yes') : t('obs.no') }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="tab === 'experiences'" class="section">
        <div v-if="experiences.length === 0" class="empty">{{ t('obs.emptyExperiences') }}</div>
        <ul v-else class="list">
          <li v-for="experience in experiences" :key="String(experience.id)">
            <div class="item-title">{{ experience.title }}</div>
            <div class="item-meta">{{ experience.category }} - {{ formatChinaDateTime(String(experience.created_at ?? '')) }}</div>
            <div class="item-body">{{ experience.content }}</div>
          </li>
        </ul>
      </section>

      <section v-if="tab === 'memory'" class="section">
        <div v-if="memoryStatus" class="status-grid">
          <div><span class="k">{{ t('obs.entities') }}</span><span class="v">{{ memoryStatus.memory_entity_count }}</span></div>
          <div><span class="k">{{ t('obs.compiled') }}</span><span class="v">{{ memoryStatus.compiled_knowledge_count }}</span></div>
          <div><span class="k">{{ t('obs.embedding') }}</span><span class="v">{{ memoryStatus.embedding_locked ? t('obs.locked') : t('obs.unlocked') }}</span></div>
          <div><span class="k">{{ t('obs.slotMatch') }}</span><span class="v">{{ memoryStatus.slot_matches_canonical ? t('obs.yes') : t('obs.no') }}</span></div>
        </div>
        <h4 class="sub-head">{{ t('obs.compiled') }}</h4>
        <div v-if="memoryCompiled.length === 0" class="empty">{{ t('obs.emptyCompiled') }}</div>
        <ul v-else class="list">
          <li v-for="item in memoryCompiled" :key="String(item.id)">
            <div class="item-title">{{ item.title }}</div>
            <div class="item-meta">{{ item.kind }} - {{ t('obs.rank') }} {{ item.rank_score }}</div>
          </li>
        </ul>
      </section>

      <section v-if="tab === 'approvals'" class="section">
        <div class="status-grid">
          <div><span class="k">{{ t('obs.pending') }}</span><span class="v">{{ approvalStatus.pending }}</span></div>
          <div><span class="k">{{ t('obs.approved') }}</span><span class="v">{{ approvalStatus.approved }}</span></div>
          <div><span class="k">{{ t('obs.denied') }}</span><span class="v">{{ approvalStatus.denied }}</span></div>
          <div><span class="k">{{ t('obs.timeout') }}</span><span class="v">{{ approvalStatus.timeout }}</span></div>
        </div>
        <div v-if="approvals.length === 0" class="empty">{{ t('obs.emptyApprovals') }}</div>
        <table v-else class="tbl">
          <thead>
            <tr>
              <th>{{ t('obs.id') }}</th>
              <th>{{ t('obs.turn') }}</th>
              <th>{{ t('obs.reason') }}</th>
              <th>{{ t('obs.decision') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="approval in approvals" :key="approval.id">
              <td class="mono">{{ approval.id.slice(-8) }}</td>
              <td class="mono">{{ approval.turn_id.slice(-8) }}</td>
              <td>{{ approval.reason }}</td>
              <td>{{ approval.decision ?? t('obs.pending') }}</td>
            </tr>
          </tbody>
        </table>
      </section>

    </div>
  </div>
</template>

<style scoped>
.obs-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.25);
  backdrop-filter: blur(16px);
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  z-index: 900;
}
.obs-panel {
  width: min(760px, 96vw);
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(48px);
  display: flex;
  flex-direction: column;
  box-shadow: -16px 0 64px rgba(0, 0, 0, 0.12);
  border-left: 1px solid rgba(255, 255, 255, 0.4);
}
.obs-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.5);
}
.title { font-size: 15px; font-weight: 800; color: var(--text-primary); letter-spacing: -0.01em; }
.tabs { flex: 1 1 auto; display: flex; gap: 4px; flex-wrap: wrap; }
.tab {
  padding: 5px 12px;
  border: 1px solid rgba(217, 217, 217, 0.3);
  background: rgba(255, 255, 255, 0.5);
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.2s;
}
.tab:hover { background: #fff; color: var(--text-primary); }
.tab.active { background: var(--text-primary); color: #fff; border-color: var(--text-primary); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.actions { display: flex; gap: 6px; }
.mini {
  width: 28px;
  height: 28px;
  border: 1px solid rgba(217, 217, 217, 0.3);
  background: rgba(255, 255, 255, 0.5);
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: all 0.2s;
}
.mini:hover { background: #fff; color: var(--text-primary); border-color: var(--text-tertiary); }
.error {
  font-size: 16px;
  color: #b4322a;
  background: rgba(253, 245, 245, 0.8);
  margin: 10px 20px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #fecdd3;
}
.section { padding: 20px; overflow-y: auto; flex: 1; }
.empty { color: var(--text-tertiary); text-align: center; padding: 48px 0; font-size: 15px; font-weight: 500; }
.tbl { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 16px; }
.tbl th, .tbl td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(244, 245, 247, 0.6);
}
.tbl th { font-size: 14px; font-weight: 800; text-transform: uppercase; color: var(--text-tertiary); letter-spacing: 0.1em; }
.mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 15px; color: var(--text-primary); }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.list li {
  padding: 14px 16px;
  border: 1px solid rgba(236, 239, 242, 0.6);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(12px);
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
}
.list li:hover { background: rgba(255, 255, 255, 0.9); border-color: rgba(16, 185, 129, 0.3); transform: translateX(4px); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.04); }
.item-title { font-size: 15px; color: var(--text-primary); font-weight: 700; }
.item-meta { font-size: 14px; color: var(--text-tertiary); margin-top: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; }
.item-body { font-size: 16px; color: var(--text-secondary); margin-top: 6px; line-height: 1.5; }
.status-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
.status-grid > div {
  border: 1px solid rgba(236, 239, 242, 0.6);
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(12px);
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
}
.status-grid > div:hover { transform: translateY(-4px); background: rgba(255, 255, 255, 0.9); box-shadow: 0 12px 28px rgba(0, 0, 0, 0.06); border-color: rgba(16, 185, 129, 0.25); }
.k { font-size: 13px; color: var(--text-tertiary); font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; }
.v { font-size: 18px; font-weight: 800; color: var(--text-primary); letter-spacing: -0.02em; }
.sub-head { margin: 24px 0 10px; font-size: 14px; font-weight: 800; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.1em; }

</style>
