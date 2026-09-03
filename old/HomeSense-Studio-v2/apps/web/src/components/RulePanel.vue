<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api, type UserDevice } from '@/api'

const props = withDefaults(defineProps<{ showEntry?: boolean }>(), { showEntry: true })

interface Alias { id: number; device_type: string; device_id: number | null; capability: string; ir_key: string; alias: string; is_custom: number; enabled: number }
interface Stopword { id: number; word: string; is_custom: number }
interface Capability { name: string; kind: string; type?: string; source?: string }
interface L1PolicyRule { id: string; label: string; description: string; examples: string[] }
interface L1Policy {
  max_compact_length: number
  allow_summary: string
  blocked_markers: L1PolicyRule[]
  blocked_punctuation: L1PolicyRule[]
  blocked_patterns: L1PolicyRule[]
}

const showModal = ref(false)
const modalTab = ref<'aliases' | 'stopwords' | 'l1_policy' | 'workflows'>('aliases')

// Devices
const devices = ref<UserDevice[]>([])
const selectedDeviceId = ref<number | null>(null)

// Aliases
const aliases = ref<Alias[]>([])
const capsLoading = ref(false)
const capabilities = ref<Capability[]>([])
const showAddAlias = ref(false)
const newAliasWord = ref('')
const newAliasCap = ref('')
const newAliasIrKey = ref('')

// Stopwords
const stopwords = ref<Stopword[]>([])
const newStopword = ref('')

// L1 policy
const l1Policy = ref<L1Policy | null>(null)
const l1ProbeInput = ref('')
const l1ProbeResult = ref<{ allowed: boolean; reason: string } | null>(null)

const zh = true
function label(z: string, e: string) { return zh ? z : e }

async function load() {
  try {
    const [devRes, swRes, policyRes] = await Promise.all([
      api.userDevices.list().catch(() => ({ devices: [] as UserDevice[] })),
      api.command.listStopwords().catch(() => ({ stopwords: [] as Stopword[] })),
      api.command.l1Policy().catch(() => ({ policy: null })),
    ])
    devices.value = devRes.devices
    stopwords.value = swRes.stopwords
    l1Policy.value = policyRes.policy
    if (devices.value.length > 0 && !selectedDeviceId.value) {
      selectedDeviceId.value = devices.value[0].id
    }
    await loadAliases()
  } catch {}
}

async function loadAliases() {
  if (!selectedDeviceId.value) return
  try {
    const r = await api.command.listAliases(selectedDeviceId.value)
    aliases.value = r.aliases
  } catch {}
}

async function loadCapabilities() {
  if (!selectedDeviceId.value) { capabilities.value = []; return }
  capsLoading.value = true
  try {
    const r = await api.userDevices.capabilities(selectedDeviceId.value)
    capabilities.value = r.data?.capabilities ?? []
  } catch {} finally { capsLoading.value = false }
}

onMounted(load)

function openModal() { showModal.value = true; loadCapabilities() }
function closeModal() { showModal.value = false; showAddAlias.value = false }
defineExpose({ openModal })

async function onDeviceChange() {
  await loadAliases()
  await loadCapabilities()
}

// ── Alias CRUD ──
function openAddAlias() {
  newAliasWord.value = ''
  newAliasCap.value = capabilities.value[0]?.name ?? ''
  newAliasIrKey.value = ''
  showAddAlias.value = true
}

async function saveAlias() {
  if (!selectedDeviceId.value || !newAliasCap.value || !newAliasWord.value.trim()) return
  await api.command.addAlias({
    device_id: selectedDeviceId.value,
    capability: newAliasCap.value,
    ir_key: newAliasIrKey.value || undefined,
    alias: newAliasWord.value.trim(),
  }).catch(() => {})
  showAddAlias.value = false
  await loadAliases()
}

async function removeAlias(id: number) {
  await api.command.removeAlias(id).catch(() => {})
  await loadAliases()
}

// ── Stopword CRUD ──
async function addStopword() {
  if (!newStopword.value.trim()) return
  await api.command.addStopword(newStopword.value.trim()).catch(() => {})
  newStopword.value = ''
  const r = await api.command.listStopwords().catch(() => ({ stopwords: [] }))
  stopwords.value = r.stopwords
}

async function removeStopword(id: number) {
  await api.command.removeStopword(id).catch(() => {})
  const r = await api.command.listStopwords().catch(() => ({ stopwords: [] }))
  stopwords.value = r.stopwords
}

async function checkL1Probe() {
  if (!l1ProbeInput.value.trim()) {
    l1ProbeResult.value = null
    return
  }
  l1ProbeResult.value = await api.command.checkL1Policy(l1ProbeInput.value).catch(() => null)
}

// ── Group aliases by capability ──
const groupedAliases = computed(() => {
  const groups: Record<string, Alias[]> = {}
  for (const a of aliases.value) {
    const key = a.ir_key ? `${a.capability} / ${a.ir_key}` : a.capability
    if (!groups[key]) groups[key] = []
    groups[key].push(a)
  }
  return groups
})

function deviceIcon(t: string | undefined) {
  const m: Record<string, string> = { television: '📺', stb: '📡', speaker: '🔊', phone: '📱', computer: '💻' }
  return t ? (m[t] ?? '⚙') : '⚙'
}

function l1RuleGroups(policy: L1Policy | null) {
  if (!policy) return []
  return [
    { key: 'markers', title: label('硬阻断', 'Hard Blocks'), items: policy.blocked_markers },
    { key: 'punctuation', title: label('标点阻断', 'Punctuation'), items: policy.blocked_punctuation },
    { key: 'patterns', title: label('复杂句式', 'Complex Patterns'), items: policy.blocked_patterns },
  ]
}
</script>

<template>
  <!-- Sidebar entry -->
  <div v-if="showEntry" class="rp-entry" @click="openModal">
    <svg class="rp-entry-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
    <span class="rp-entry-label">{{ label('规则引擎', 'Rules') }}</span>
    <svg class="rp-entry-arrow" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
  </div>

  <!-- Modal -->
  <div v-if="showModal" class="rp-overlay" @click.self="closeModal">
    <div class="rp-modal">
      <div class="rp-head">
        <h3>{{ label('规则引擎', 'Rule Engine') }}</h3>
        <button class="rp-close" @click="closeModal">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <!-- Tabs -->
      <div class="rp-tabs">
        <button :class="['rp-tab', { active: modalTab === 'aliases' }]" @click="modalTab = 'aliases'">{{ label('别名', 'Aliases') }}</button>
        <button :class="['rp-tab', { active: modalTab === 'stopwords' }]" @click="modalTab = 'stopwords'">{{ label('虚词', 'Stopwords') }}</button>
        <button :class="['rp-tab', { active: modalTab === 'l1_policy' }]" @click="modalTab = 'l1_policy'">{{ label('L1 反射', 'L1 Reflex') }}</button>
        <button :class="['rp-tab', { active: modalTab === 'workflows' }]" @click="modalTab = 'workflows'">{{ label('工作流', 'Workflows') }}</button>
      </div>

      <!-- Aliases tab -->
      <div v-if="modalTab === 'aliases'" class="rp-body">
        <!-- Device picker -->
        <div class="rp-device-bar">
          <select v-model="selectedDeviceId" class="rp-device-select" @change="onDeviceChange">
            <option v-for="d in devices" :key="d.id" :value="d.id">
              {{ deviceIcon(d.device_type) }} {{ d.name }}
            </option>
          </select>
          <button class="rp-add-btn" @click="openAddAlias">+ {{ label('添加', 'Add') }}</button>
        </div>

        <!-- Add alias form -->
        <div v-if="showAddAlias" class="rp-add-form">
          <select v-model="newAliasCap" class="rp-input">
            <option value="" disabled>{{ label('选择能力', 'Capability') }}</option>
            <option v-for="c in capabilities" :key="c.name" :value="c.name">{{ c.name }}</option>
          </select>
          <input v-model="newAliasIrKey" class="rp-input" placeholder="IR Key (可选)" />
          <input v-model="newAliasWord" class="rp-input" placeholder="{{ label('别名，如: 开', 'Alias') }}" />
          <div class="rp-add-actions">
            <button class="rp-btn-sm" @click="showAddAlias = false">{{ label('取消', 'Cancel') }}</button>
            <button class="rp-btn-sm primary" @click="saveAlias">{{ label('保存', 'Save') }}</button>
          </div>
        </div>

        <!-- Alias list grouped -->
        <div class="rp-alias-list">
          <div v-if="aliases.length === 0" class="rp-empty">{{ label('暂无别名', 'No aliases') }}</div>
          <div v-for="(items, group) in groupedAliases" :key="group" class="rp-alias-group">
            <div class="rp-group-title">{{ group }} <span v-if="items.some(a => a.device_id == null)" class="rp-template-badge">模板</span></div>
            <div class="rp-alias-tags">
              <span v-for="a in items" :key="a.id" :class="['rp-tag', { custom: a.is_custom, override: a.device_id != null }]">
                {{ a.alias }}
                <button v-if="a.is_custom || a.device_id != null" class="rp-tag-x" @click="removeAlias(a.id)">&times;</button>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Stopwords tab -->
      <div v-if="modalTab === 'stopwords'" class="rp-body">
        <div class="rp-sw-add">
          <input v-model="newStopword" class="rp-input" :placeholder="label('添加虚词...', 'Add stopword...')" @keydown.enter="addStopword" />
          <button class="rp-btn-sm primary" @click="addStopword">+</button>
        </div>
        <div class="rp-sw-list">
          <span v-for="sw in stopwords" :key="sw.id" :class="['rp-tag', { custom: sw.is_custom }]">
            {{ sw.word }}
            <button v-if="sw.is_custom" class="rp-tag-x" @click="removeStopword(sw.id)">&times;</button>
          </span>
        </div>
      </div>

      <!-- L1 policy tab -->
      <div v-if="modalTab === 'l1_policy'" class="rp-body">
        <div v-if="!l1Policy" class="rp-empty">{{ label('L1 策略加载失败', 'Failed to load L1 policy') }}</div>
        <template v-else>
          <div class="rp-policy-summary">
            <div>
              <span>{{ label('定位', 'Role') }}</span>
              <p>{{ label('L1 只处理极短、明确、命令式的反射动作。复杂句、问句和否定句会直接交给模型。', 'L1 only handles very short imperative reflex actions.') }}</p>
            </div>
            <strong>{{ l1Policy.max_compact_length }}</strong>
          </div>

          <div class="rp-l1-probe">
            <input v-model="l1ProbeInput" class="rp-input" :placeholder="label('试一句话，比如：打开电视吗？', 'Try an utterance')" @keydown.enter="checkL1Probe" />
            <button class="rp-btn-sm primary" @click="checkL1Probe">{{ label('检查', 'Check') }}</button>
          </div>
          <div v-if="l1ProbeResult" :class="['rp-probe-result', { allowed: l1ProbeResult.allowed }]">
            <strong>{{ l1ProbeResult.allowed ? label('允许进入 L1', 'Allowed') : label('跳过 L1', 'Skipped') }}</strong>
            <span>{{ l1ProbeResult.reason }}</span>
          </div>

          <div class="rp-policy-groups">
            <section v-for="group in l1RuleGroups(l1Policy)" :key="group.key" class="rp-policy-group">
              <h4>{{ group.title }}</h4>
              <article v-for="item in group.items" :key="item.id" class="rp-policy-item">
                <div>
                  <strong>{{ item.label }}</strong>
                  <p>{{ item.description }}</p>
                </div>
                <div class="rp-policy-examples">
                  <span v-for="example in item.examples" :key="example">{{ example }}</span>
                </div>
              </article>
            </section>
          </div>
        </template>
      </div>

      <!-- Workflows placeholder -->
      <div v-if="modalTab === 'workflows'" class="rp-body">
        <div class="rp-coming">
          <p>{{ label('即将推出', 'Coming soon') }}</p>
          <span>{{ label('工作流可在规则动作中触发', 'Workflows can be triggered as rule actions') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rp-entry {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; margin: 0 8px 8px; border-radius: 10px;
  cursor: pointer; transition: all 0.15s; user-select: none;
  border: 1px solid rgba(229, 231, 235, 0.3);
}
.rp-entry:hover { background: rgba(16, 185, 129, 0.06); border-color: rgba(16, 185, 129, 0.2); }
.rp-entry-icon { color: #10b981; flex-shrink: 0; }
.rp-entry-label { flex: 1; font-size: 13px; font-weight: 700; color: var(--text-primary); }
.rp-entry-arrow { color: var(--text-tertiary); flex-shrink: 0; }

.rp-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.25); z-index: 500;
  display: flex; align-items: center; justify-content: center;
}
.rp-modal {
  background: #fff; border-radius: 20px; width: 520px; max-width: 90vw; max-height: 80vh;
  box-shadow: 0 24px 64px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden;
}
.rp-head { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 12px; }
.rp-head h3 { font-size: 17px; font-weight: 800; color: var(--text-primary); margin: 0; }
.rp-close { width: 32px; height: 32px; border: none; border-radius: 8px; background: none; cursor: pointer; color: var(--text-tertiary); display: flex; align-items: center; justify-content: center; }
.rp-close:hover { background: rgba(239, 68, 68, 0.08); color: #ef4444; }

.rp-tabs { display: flex; border-bottom: 1px solid rgba(229, 231, 235, 0.4); padding: 0 24px; }
.rp-tab { padding: 10px 16px; border: none; background: none; font-size: 13px; font-weight: 800; color: var(--text-tertiary); cursor: pointer; position: relative; }
.rp-tab:hover { color: var(--text-primary); }
.rp-tab.active { color: #10b981; }
.rp-tab.active::after { content: ''; position: absolute; bottom: -1px; left: 16px; right: 16px; height: 2px; background: #10b981; border-radius: 2px; }

.rp-body { flex: 1; overflow-y: auto; padding: 16px 24px; }

/* Device bar */
.rp-device-bar { display: flex; gap: 8px; margin-bottom: 16px; }
.rp-device-select {
  flex: 1; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 10px;
  font-size: 14px; font-weight: 700; color: var(--text-primary); background: #fff; cursor: pointer; outline: none;
}
.rp-device-select:focus { border-color: #10b981; }
.rp-add-btn {
  padding: 8px 14px; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 10px;
  background: rgba(16, 185, 129, 0.06); color: #10b981; font-size: 13px; font-weight: 800; cursor: pointer;
}
.rp-add-btn:hover { background: #10b981; color: #fff; border-color: #10b981; }

/* Add form */
.rp-add-form { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; padding: 12px; background: rgba(0,0,0,0.02); border-radius: 12px; }
.rp-add-form .rp-input { flex: 1; min-width: 100px; }
.rp-add-actions { display: flex; gap: 6px; width: 100%; }

/* Alias list */
.rp-alias-list { }
.rp-empty { padding: 32px; text-align: center; color: var(--text-tertiary); font-size: 14px; font-weight: 600; }
.rp-alias-group { margin-bottom: 14px; }
.rp-group-title {
  font-size: 11px; font-weight: 900; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px;
  display: flex; align-items: center; gap: 6px;
}
.rp-template-badge {
  font-size: 9px; font-weight: 900; padding: 1px 6px; border-radius: 4px;
  background: rgba(245, 158, 11, 0.08); color: #d97706;
}
.rp-alias-tags { display: flex; flex-wrap: wrap; gap: 6px; }

/* Tags */
.rp-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 8px; font-size: 13px; font-weight: 600;
  background: rgba(0,0,0,0.04); color: var(--text-primary);
}
.rp-tag.custom { background: rgba(16, 185, 129, 0.08); color: #059669; }
.rp-tag.override { background: rgba(245, 158, 11, 0.08); color: #d97706; }
.rp-tag-x {
  border: none; background: none; cursor: pointer; font-size: 15px; line-height: 1;
  color: var(--text-tertiary); padding: 0 2px;
}
.rp-tag-x:hover { color: #ef4444; }

/* Stopwords */
.rp-sw-add { display: flex; gap: 8px; margin-bottom: 12px; }
.rp-sw-add .rp-input { flex: 1; }
.rp-sw-list { display: flex; flex-wrap: wrap; gap: 6px; }

/* L1 policy */
.rp-policy-summary {
  display: grid; grid-template-columns: 1fr 72px; gap: 12px; align-items: center;
  padding: 14px; margin-bottom: 14px; border: 1px solid rgba(16, 185, 129, 0.18);
  border-radius: 12px; background: rgba(16, 185, 129, 0.05);
}
.rp-policy-summary span,
.rp-policy-group h4 {
  font-size: 11px; font-weight: 900; color: #059669; letter-spacing: 0.08em; text-transform: uppercase;
}
.rp-policy-summary p { margin: 4px 0 0; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
.rp-policy-summary strong {
  width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;
  border-radius: 12px; background: #10b981; color: #fff; font-size: 22px; font-weight: 900;
}
.rp-l1-probe { display: flex; gap: 8px; margin-bottom: 10px; }
.rp-l1-probe .rp-input { flex: 1; }
.rp-probe-result {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 9px 10px; margin-bottom: 14px; border-radius: 10px;
  background: rgba(239, 68, 68, 0.07); color: #b91c1c; font-size: 12px; font-weight: 700;
}
.rp-probe-result.allowed { background: rgba(16, 185, 129, 0.08); color: #047857; }
.rp-probe-result span { color: inherit; opacity: 0.78; text-align: right; }
.rp-policy-groups { display: grid; gap: 14px; }
.rp-policy-group h4 { margin: 0 0 8px; color: var(--text-tertiary); }
.rp-policy-item {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(130px, 0.72fr); gap: 12px;
  padding: 11px 0; border-top: 1px solid rgba(229, 231, 235, 0.8);
}
.rp-policy-item strong { font-size: 13px; color: var(--text-primary); }
.rp-policy-item p { margin: 4px 0 0; font-size: 12px; line-height: 1.45; color: var(--text-secondary); }
.rp-policy-examples { display: flex; flex-wrap: wrap; gap: 5px; align-content: flex-start; justify-content: flex-end; }
.rp-policy-examples span {
  padding: 3px 7px; border-radius: 7px; background: rgba(0,0,0,0.04);
  font-size: 11px; font-weight: 700; color: var(--text-secondary);
}

/* Shared */
.rp-input {
  padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 10px;
  font-size: 13px; font-weight: 600; color: var(--text-primary); background: #fff; outline: none; font-family: inherit;
}
.rp-input:focus { border-color: #10b981; }
.rp-btn-sm {
  padding: 7px 14px; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 700; cursor: pointer; background: rgba(0,0,0,0.04); color: var(--text-secondary);
}
.rp-btn-sm:hover { background: rgba(0,0,0,0.08); }
.rp-btn-sm.primary { background: #10b981; color: #fff; }
.rp-btn-sm.primary:hover { background: #059669; }

.rp-coming { display: flex; flex-direction: column; align-items: center; padding: 48px; gap: 8px; }
.rp-coming p { font-size: 15px; font-weight: 800; color: var(--text-tertiary); margin: 0; }
.rp-coming span { font-size: 12px; color: var(--text-tertiary); opacity: 0.6; }
</style>
