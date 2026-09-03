<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { useLocale } from '../composables/useLocale'
import { formatChinaDateTime } from '../utils/chinaTime'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

type Tab = 'crons' | 'compensations' | 'rules' | 'experiences' | 'memory' | 'approvals' | 'devtest'

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

const smokeSequence = ref<Array<{ order: number; label: string; tool: string; action: string; params: Record<string, unknown> }>>([])
const smokeResult = ref<Awaited<ReturnType<typeof api.devtest.runSmoke>> | null>(null)
const smokeBusy = ref(false)
const virtualHome = ref<Record<string, unknown> | null>(null)
const { t } = useLocale()

async function runSmoke() {
  smokeBusy.value = true
  error.value = null
  smokeResult.value = null
  try {
    smokeResult.value = await api.devtest.runSmoke()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    smokeBusy.value = false
  }
}

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
    } else if (tab.value === 'devtest') {
      const [sequenceResult, sandboxResult] = await Promise.all([
        api.devtest.smokeSequence(),
        api.devtest.virtualHome(),
      ])
      smokeSequence.value = sequenceResult.sequence
      virtualHome.value = sandboxResult.sandbox
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
  { key: 'devtest', label: t('obs.devtest') },
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

      <section v-if="tab === 'devtest'" class="section">
        <div class="devtest-head">
          <div>
            <div class="sub-head">{{ t('obs.virtualSmoke') }}</div>
            <div class="devtest-hint">{{ t('obs.virtualSmokeHint') }}</div>
          </div>
          <button class="run-btn" :disabled="smokeBusy" @click="runSmoke">
            {{ smokeBusy ? t('obs.running') : t('obs.runSmoke') }}
          </button>
        </div>

        <div v-if="smokeResult" class="smoke-result">
          <div :class="['smoke-overall', smokeResult.overall]">
            {{ smokeResult.overall }} - {{ t('obs.success') }} {{ smokeResult.summary.success }} / {{ t('obs.error') }} {{ smokeResult.summary.error }} / {{ t('obs.skipped') }} {{ smokeResult.summary.skipped }} - {{ smokeResult.duration_ms }}ms
          </div>
          <div class="smoke-steps">
            <div
              v-for="step in smokeResult.steps"
              :key="step.order"
              :class="['smoke-step', step.status]"
            >
              <div class="smoke-step-head">
                <span class="smoke-order">#{{ step.order }}</span>
                <span class="smoke-label">{{ step.label }}</span>
                <span :class="['smoke-status', step.status]">{{ step.status }}</span>
                <span class="smoke-dur">{{ step.duration_ms }}ms</span>
              </div>
              <div class="smoke-meta">
                <code>{{ step.tool }}.{{ step.action }}</code>
              </div>
              <div v-if="step.error" class="smoke-err">{{ step.error }}</div>
              <pre v-if="step.result" class="smoke-pre">{{ JSON.stringify(step.result, null, 2) }}</pre>
            </div>
          </div>
        </div>

        <div v-else-if="smokeSequence.length > 0">
          <div v-if="virtualHome" class="sandbox-box">
            <div class="sub-head">{{ t('obs.virtualHome') }}</div>
            <div class="sandbox-grid">
              <div>
                <span class="k">{{ t('obs.home') }}</span>
                <span class="v">{{ (virtualHome.home as any)?.name ?? 'sandbox-home' }}</span>
              </div>
              <div>
                <span class="k">{{ t('obs.rooms') }}</span>
                <span class="v">{{ Array.isArray(virtualHome.rooms) ? virtualHome.rooms.length : 0 }}</span>
              </div>
              <div>
                <span class="k">{{ t('obs.devices') }}</span>
                <span class="v">{{ Array.isArray(virtualHome.devices) ? virtualHome.devices.length : 0 }}</span>
              </div>
              <div>
                <span class="k">{{ t('obs.events') }}</span>
                <span class="v">{{ Array.isArray(virtualHome.timeline) ? virtualHome.timeline.length : 0 }}</span>
              </div>
            </div>
          </div>

          <div class="sub-head">{{ t('obs.plannedSequence') }}</div>
          <ol class="smoke-plan">
            <li v-for="step in smokeSequence" :key="step.order">
              <code>{{ step.tool }}.{{ step.action }}</code> - {{ step.label }}
            </li>
          </ol>
        </div>
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

.devtest-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
}
.devtest-head > div:first-child { flex: 1; }
.devtest-hint { font-size: 15px; color: var(--text-secondary); line-height: 1.6; margin-top: 6px; }
.run-btn {
  padding: 10px 18px;
  background: var(--primary-color);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(16, 163, 127, 0.2);
  transition: all 0.2s;
}
.run-btn:hover:not(:disabled) { background: var(--primary-hover); transform: translateY(-1px); }
.run-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.smoke-overall {
  padding: 12px 16px;
  border-radius: 10px;
  font-weight: 800;
  font-size: 15px;
  margin-bottom: 16px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  display: flex;
  align-items: center;
  gap: 8px;
}
.smoke-overall.success { background: rgba(240, 253, 244, 0.8); color: #166534; border: 1px solid rgba(187, 247, 208, 0.5); }
.smoke-overall.partial { background: rgba(255, 251, 235, 0.8); color: #92400e; border: 1px solid rgba(253, 230, 138, 0.5); }
.smoke-overall.failed { background: rgba(254, 242, 242, 0.8); color: #b4322a; border: 1px solid rgba(254, 202, 202, 0.5); }

.smoke-steps { display: flex; flex-direction: column; gap: 8px; }
.smoke-step {
  border: 1px solid rgba(236, 239, 242, 0.8);
  border-radius: 10px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.4);
  transition: all 0.2s;
}
.smoke-step.success { border-color: rgba(187, 247, 208, 0.6); background: rgba(240, 253, 244, 0.3); }
.smoke-step.error { border-color: rgba(254, 202, 202, 0.6); background: rgba(254, 242, 242, 0.3); }
.smoke-step.skipped { opacity: 0.6; }

.smoke-step-head { display: flex; align-items: center; gap: 10px; }
.smoke-order { font-family: ui-monospace, monospace; font-size: 14px; font-weight: 700; color: var(--text-tertiary); }
.smoke-label { flex: 1; font-size: 15px; font-weight: 700; color: var(--text-primary); }
.smoke-status {
  font-size: 13px;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 800;
}
.smoke-status.success { background: #d1fae5; color: #065f46; }
.smoke-status.error { background: #fecaca; color: #991b1b; }
.smoke-status.skipped { background: #e5e7eb; color: #6b7280; }
.smoke-dur { font-size: 14px; color: var(--text-tertiary); font-weight: 600; }

.smoke-meta { margin-top: 6px; font-size: 15px; color: var(--text-secondary); }
.smoke-meta code { font-family: ui-monospace, monospace; background: rgba(241, 243, 245, 0.8); padding: 1px 5px; border-radius: 4px; color: var(--text-primary); }
.smoke-err { margin-top: 6px; font-size: 15px; color: #b4322a; font-weight: 500; }
.smoke-pre {
  margin: 10px 0 0;
  padding: 12px;
  background: #1e293b;
  border-radius: 8px;
  font-family: ui-monospace, monospace;
  font-size: 15px;
  color: #e2e8f0;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
}
.smoke-plan { list-style: decimal; padding-left: 24px; font-size: 16px; color: var(--text-secondary); }
.smoke-plan li { margin-bottom: 6px; }
.smoke-plan code { font-family: ui-monospace, monospace; background: rgba(241, 243, 245, 0.8); padding: 1px 5px; border-radius: 4px; color: var(--text-primary); }

.sandbox-box {
  margin-bottom: 18px;
}

.sandbox-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 12px;
}

.sandbox-grid > div {
  border: 1px solid rgba(236, 239, 242, 0.6);
  border-radius: 14px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.45);
}

.sandbox-pre {
  margin: 0;
  padding: 12px;
  border-radius: 10px;
  background: #0f172a;
  color: #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
}

</style>
