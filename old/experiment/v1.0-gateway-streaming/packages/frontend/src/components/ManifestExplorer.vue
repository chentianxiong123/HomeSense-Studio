<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { useLocale } from '../composables/useLocale'

type Manifest = Awaited<ReturnType<typeof api.manifests.list>>['manifests'][number]
type Kind = Manifest['kind']

const props = defineProps<{
  layout?: 'sidebar' | 'panel'
  filterKinds?: Kind[]
}>()

const manifests = ref<Manifest[]>([])
const summary = ref<{ total: number; by_kind: Record<string, number>; configured: number } | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
const selectedKind = ref<Kind | 'all'>('all')

const runModal = ref<Manifest | null>(null)
const runBodyText = ref('{}')
const runBusy = ref(false)
const runResult = ref<unknown>(null)
const runError = ref<string | null>(null)
const { t } = useLocale()

const KIND_LABELS: Record<Kind, string> = {
  cli: t('manifest.kind.cli'),
  agent: t('manifest.kind.agent'),
  a2a: t('manifest.kind.a2a'),
  service: t('manifest.kind.service'),
  channel: t('manifest.kind.channel'),
}

const KIND_COLORS: Record<Kind, string> = {
  cli: '#0f766e',
  agent: '#1f7a4f',
  a2a: '#2563eb',
  service: '#9333ea',
  channel: '#d97706',
}

const visible = computed(() => {
  let list = manifests.value
  if (props.filterKinds && props.filterKinds.length > 0) {
    list = list.filter((manifest) => (props.filterKinds as Kind[]).includes(manifest.kind))
  }
  if (selectedKind.value !== 'all') {
    list = list.filter((manifest) => manifest.kind === selectedKind.value)
  }
  return list
})

const groupedByKind = computed(() => {
  const groups: Record<string, Manifest[]> = {}
  for (const manifest of visible.value) {
    if (!groups[manifest.kind]) groups[manifest.kind] = []
    groups[manifest.kind].push(manifest)
  }
  return groups
})

async function refresh() {
  loading.value = true
  error.value = null
  try {
    const result = await api.manifests.list()
    manifests.value = result.manifests
    summary.value = result.summary
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

function statusColor(status: Manifest['status']): string {
  if (status === 'ready') return '#1f7a4f'
  if (status === 'dry_run') return '#d97706'
  if (status === 'planned') return '#6366f1'
  return '#94a3b8'
}

function openRun(manifest: Manifest) {
  runModal.value = manifest
  runResult.value = null
  runError.value = null
  runBodyText.value = JSON.stringify(buildSampleBody(manifest), null, 2)
}

function buildSampleBody(manifest: Manifest): Record<string, unknown> {
  const sample = manifest.sample_invocation ?? {}
  if (manifest.kind === 'cli') {
    return {
      action: sample.action ?? manifest.actions[0]?.name ?? '',
      params: sample.params ?? {},
    }
  }
  if (manifest.kind === 'agent' || manifest.kind === 'a2a') {
    return {
      task: sample.task ?? '',
      payload: sample.payload ?? {},
      execution_mode: sample.execution_mode ?? 'deferred',
    }
  }
  return {
    params: (sample.params as Record<string, unknown>) ?? {},
  }
}

function closeRun() {
  runModal.value = null
}

async function submitRun() {
  if (!runModal.value) return
  runBusy.value = true
  runError.value = null
  runResult.value = null
  try {
    const body = JSON.parse(runBodyText.value)
    const response = await api.manifests.invoke(runModal.value.id, body)
    if (response.status === 'success') {
      runResult.value = response.data
    } else {
      runError.value = response.message || response.error || t('manifest.invokeFailed')
    }
  } catch (err) {
    runError.value = (err as Error).message
  } finally {
    runBusy.value = false
  }
}

onMounted(refresh)
defineExpose({ refresh })
</script>

<template>
  <div :class="['manifest-explorer', layout || 'panel']">
    <div class="explorer-head">
      <div class="head-title">{{ t('manifest.title') }}</div>
      <button class="refresh-btn" :disabled="loading" @click="refresh">R</button>
    </div>

    <div v-if="summary" class="summary-row">
      <span class="summary-chip">{{ t('manifest.total', { count: summary.total }) }}</span>
      <span class="summary-chip ok">{{ t('manifest.configured', { count: summary.configured }) }}</span>
      <span
        v-for="(count, kind) in summary.by_kind"
        :key="kind"
        class="summary-chip"
        :style="{ borderColor: KIND_COLORS[kind as Kind], color: KIND_COLORS[kind as Kind] }"
      >{{ KIND_LABELS[kind as Kind] || kind }} {{ count }}</span>
    </div>

    <div class="filter-row">
      <button
        :class="['filter-btn', selectedKind === 'all' && 'active']"
        @click="selectedKind = 'all'"
      >{{ t('manifest.all') }}</button>
      <button
        v-for="kind in (Object.keys(KIND_LABELS) as Kind[])"
        :key="kind"
        :class="['filter-btn', selectedKind === kind && 'active']"
        :style="selectedKind === kind ? { background: KIND_COLORS[kind], color: '#fff', borderColor: KIND_COLORS[kind] } : {}"
        @click="selectedKind = kind"
      >{{ KIND_LABELS[kind] }}</button>
    </div>

    <div v-if="error" class="error-row">{{ error }}</div>

    <div v-for="(items, kind) in groupedByKind" :key="kind" class="kind-group">
      <div class="kind-head" :style="{ color: KIND_COLORS[kind as Kind] }">
        {{ KIND_LABELS[kind as Kind] || kind }} - {{ items.length }}
      </div>
      <div class="manifest-list">
        <div
          v-for="manifest in items"
          :key="manifest.id"
          :class="['manifest-card', manifest.status]"
        >
          <div class="card-head">
            <span class="card-name">{{ manifest.display_name }}</span>
            <span
              class="card-status"
              :style="{ background: statusColor(manifest.status) + '20', color: statusColor(manifest.status) }"
            >{{ manifest.status }}</span>
            <button class="card-run" @click="openRun(manifest)">{{ t('manifest.run') }}</button>
          </div>
          <div class="card-id">{{ manifest.id }}</div>
          <div v-if="manifest.description" class="card-desc">{{ manifest.description }}</div>
          <div v-if="manifest.capabilities.length > 0" class="card-caps">
            <span
              v-for="cap in manifest.capabilities"
              :key="cap"
              class="cap-chip"
            >{{ cap }}</span>
          </div>
          <div v-if="manifest.actions.length > 0" class="card-actions">
            <span class="actions-label">{{ t('manifest.actions', { count: manifest.actions.length }) }}:</span>
            <span
              v-for="action in manifest.actions.slice(0, 4)"
              :key="action.name"
              class="action-chip"
              :title="action.description"
            >{{ action.name }}</span>
            <span v-if="manifest.actions.length > 4" class="action-chip more">+{{ manifest.actions.length - 4 }}</span>
          </div>
          <div v-if="manifest.endpoint_env" class="card-meta">
            {{ t('manifest.env') }}: <code>{{ manifest.endpoint_env }}</code>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!loading && visible.length === 0" class="empty">{{ t('manifest.empty') }}</div>

    <div v-if="runModal" class="run-modal" @click.self="closeRun">
      <div class="run-dialog">
        <div class="run-head">
          <span class="run-title">{{ t('manifest.runTitle') }} - {{ runModal.display_name }}</span>
          <button class="run-close" @click="closeRun">x</button>
        </div>
        <div class="run-id">{{ runModal.id }} - {{ runModal.kind }}</div>
        <textarea v-model="runBodyText" class="run-body" rows="10" spellcheck="false" />
        <div class="run-actions">
          <button class="run-cancel" @click="closeRun" :disabled="runBusy">{{ t('manifest.cancel') }}</button>
          <button class="run-submit" @click="submitRun" :disabled="runBusy">
            {{ runBusy ? t('manifest.running') : t('manifest.invoke') }}
          </button>
        </div>
        <div v-if="runError" class="run-error">{{ runError }}</div>
        <pre v-if="runResult !== null" class="run-result">{{ JSON.stringify(runResult, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.manifest-explorer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 16px;
}
.manifest-explorer.sidebar { padding: 0; }
.manifest-explorer.panel {
  padding: 20px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(32px);
  border: 1px solid rgba(229, 231, 235, 0.5);
  border-radius: 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.03);
}

.explorer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.head-title {
  font-size: 14px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-tertiary);
}

.refresh-btn {
  width: 24px;
  height: 24px;
  border: 1px solid rgba(217, 217, 217, 0.3);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.refresh-btn:hover {
  background: #fff;
  border-color: var(--text-tertiary);
  color: var(--text-primary);
  transform: rotate(90deg);
}

.summary-row, .filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.summary-chip {
  font-size: 13px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(217, 217, 217, 0.3);
  background: rgba(255, 255, 255, 0.5);
  color: var(--text-secondary);
  font-weight: 700;
  letter-spacing: 0.02em;
}

.summary-chip.ok { color: #166534; border-color: rgba(187, 247, 208, 0.4); background: rgba(240, 253, 244, 0.5); }

.filter-btn {
  padding: 4px 10px;
  font-size: 14px;
  font-weight: 700;
  border: 1px solid rgba(217, 217, 217, 0.3);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.6);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.filter-btn:hover {
  background: #fff;
  color: var(--text-primary);
  border-color: var(--text-tertiary);
}

.filter-btn.active {
  background: var(--text-primary);
  color: #fff;
  border-color: var(--text-primary);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.error-row {
  font-size: 15px;
  color: #b4322a;
  padding: 10px;
  border-radius: 8px;
  background: rgba(253, 245, 245, 0.8);
  border: 1px solid #fecdd3;
  margin-bottom: 12px;
}

.kind-group { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
.kind-head {
  font-size: 14px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  opacity: 0.6;
}

.manifest-list { display: flex; flex-direction: column; gap: 10px; }
.manifest-card {
  border: 1px solid rgba(236, 239, 242, 0.8);
  border-radius: 12px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.5);
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: all 0.2s;
}

.manifest-card:hover {
  border-color: var(--primary-color);
  background: #fff;
  box-shadow: var(--shadow-sm);
  transform: translateY(-2px);
}

.manifest-card.dry_run { border-color: rgba(253, 224, 163, 0.6); background: rgba(255, 248, 232, 0.4); }
.manifest-card.planned { border-color: rgba(212, 216, 247, 0.6); background: rgba(245, 245, 252, 0.4); }
.manifest-card.disabled { opacity: 0.4; }

.card-head { display: flex; align-items: center; gap: 10px; }
.card-name { font-size: 15px; font-weight: 800; color: var(--text-primary); flex: 1 1 auto; overflow-wrap: anywhere; letter-spacing: -0.01em; }
.card-status {
  font-size: 13px;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: uppercase;
  font-weight: 800;
  letter-spacing: 0.05em;
}

.card-id {
  font-family: ui-monospace, monospace;
  font-size: 14px;
  color: var(--text-tertiary);
  font-weight: 500;
  overflow-wrap: anywhere;
}
.card-desc { font-size: 15px; color: var(--text-secondary); line-height: 1.5; font-weight: 500; }

.card-caps, .card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.cap-chip {
  font-size: 13px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(241, 243, 245, 0.8);
  color: var(--text-secondary);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.actions-label {
  font-size: 13px;
  color: var(--text-tertiary);
  margin-right: 4px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.action-chip {
  font-family: ui-monospace, monospace;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(238, 242, 255, 0.8);
  color: #3730a3;
  font-weight: 700;
}
.action-chip.more { background: rgba(241, 243, 245, 0.8); color: var(--text-tertiary); }

.card-meta { font-size: 14px; color: var(--text-tertiary); font-weight: 500; }
.card-meta code {
  font-family: ui-monospace, monospace;
  background: rgba(241, 245, 249, 0.8);
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--text-secondary);
  font-weight: 700;
}

.empty { font-size: 16px; color: var(--text-tertiary); padding: 48px 24px; text-align: center; font-weight: 500; }

.card-run {
  margin-left: auto;
  padding: 4px 12px;
  border-radius: 8px;
  border: none;
  background: var(--primary-color);
  color: #fff;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(16, 163, 127, 0.2);
  transition: all 0.2s;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.card-run:hover { background: var(--primary-hover); transform: translateY(-1px); }

.run-modal {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.3);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.run-dialog {
  width: min(640px, 90vw);
  max-height: 80vh;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 16px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}
.run-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.run-title { font-size: 16px; font-weight: 800; color: var(--text-primary); letter-spacing: -0.01em; }
.run-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: rgba(241, 243, 245, 0.8);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.run-close:hover { background: #fff; color: #ef4444; }

.run-id {
  font-family: ui-monospace, monospace;
  font-size: 15px;
  color: var(--text-tertiary);
  background: rgba(241, 245, 249, 0.8);
  padding: 4px 8px;
  border-radius: 6px;
  align-self: flex-start;
}
.run-body {
  font-family: ui-monospace, monospace;
  font-size: 16px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: #f8fafc;
  resize: vertical;
  min-height: 180px;
  outline: none;
}
.run-body:focus { border-color: var(--primary-color); box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.1); }
.run-actions { display: flex; gap: 10px; justify-content: flex-end; }
.run-cancel {
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
}
.run-submit {
  padding: 8px 20px;
  border: none;
  border-radius: 8px;
  background: var(--primary-color);
  color: #fff;
  cursor: pointer;
  font-size: 15px;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(16, 163, 127, 0.2);
}
.run-submit:hover:not(:disabled) { background: var(--primary-hover); transform: translateY(-1px); }
.run-submit:disabled, .run-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
.run-error {
  font-size: 16px;
  color: #be123c;
  background: rgba(255, 241, 242, 0.8);
  border: 1px solid #fecdd3;
  border-radius: 8px;
  padding: 10px;
}
.run-result {
  margin: 0;
  padding: 12px;
  border-radius: 10px;
  background: #1e293b;
  color: #e2e8f0;
  font-family: ui-monospace, monospace;
  font-size: 15px;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
