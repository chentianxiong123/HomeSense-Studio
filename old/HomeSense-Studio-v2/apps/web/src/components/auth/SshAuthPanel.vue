<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '@/api'

type LabelFn = (zh: string, en: string) => string

type TerminalTarget = {
  id: number
  name: string
  kind: 'local' | 'ssh' | 'adb'
  target: Record<string, unknown>
  created_at: string
  updated_at: string
}

const props = defineProps<{
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'count-change', value: number): void
  (event: 'error', value: string): void
  (event: 'success', value: string): void
}>()

const sshTargets = ref<TerminalTarget[]>([])
const sshForm = ref({
  name: '',
  host: '',
  port: 22,
  user: '',
  auth: 'key' as 'key' | 'password',
  keyName: 'n8n_watchdog',
  password: '',
})
const sshEditingId = ref<number | null>(null)
const sshTestingId = ref<number | null>(null)
const sshTestResult = ref<{ id: number; ok: boolean; message: string } | null>(null)
const busy = ref<Record<string, boolean>>({})
const errorMessage = ref('')

const sshTargetCount = computed(() => sshTargets.value.length)

function label(zh: string, en: string) {
  return props.label(zh, en)
}

function setBusy(key: string, value: boolean) {
  const next = { ...busy.value }
  if (value) next[key] = true
  else delete next[key]
  busy.value = next
}

function isBusy(key: string) {
  return Boolean(busy.value[key])
}

async function refresh() {
  await loadSshTargets()
}

async function loadSshTargets() {
  try {
    const res = await api.terminal.listTargets()
    sshTargets.value = res.data.filter((target) => target.kind === 'ssh')
    emit('count-change', sshTargets.value.length)
  } catch (error) {
    console.warn('failed to load ssh targets', error)
    emit('error', (error as Error).message || String(error))
  }
}

async function saveSshTarget() {
  if (!sshForm.value.name || !sshForm.value.host || !sshForm.value.user) {
    errorMessage.value = label('名称 / 主机 / 用户必填', 'name / host / user required')
    emit('error', errorMessage.value)
    return
  }
  setBusy('ssh-save', true)
  errorMessage.value = ''
  try {
    const target: Record<string, unknown> = {
      host: sshForm.value.host,
      port: sshForm.value.port,
      user: sshForm.value.user,
      auth: sshForm.value.auth,
    }
    if (sshForm.value.auth === 'key') {
      target.keyName = sshForm.value.keyName
    } else {
      target.password = sshForm.value.password
    }
    if (sshEditingId.value) {
      await api.terminal.updateTarget(sshEditingId.value, { name: sshForm.value.name, target })
    } else {
      await api.terminal.createTarget({ name: sshForm.value.name, kind: 'ssh', target })
    }
    await loadSshTargets()
    resetSshForm()
    emit('success', label('已保存', 'Saved'))
  } catch (error) {
    errorMessage.value = (error as Error).message
    emit('error', errorMessage.value)
  } finally {
    setBusy('ssh-save', false)
  }
}

function resetSshForm() {
  sshForm.value = { name: '', host: '', port: 22, user: '', auth: 'key', keyName: 'n8n_watchdog', password: '' }
  sshEditingId.value = null
}

function editSshTarget(target: TerminalTarget) {
  const sshTarget = target.target as Record<string, unknown>
  sshForm.value = {
    name: target.name,
    host: String(sshTarget.host ?? ''),
    port: Number(sshTarget.port ?? 22),
    user: String(sshTarget.user ?? ''),
    auth: sshTarget.auth === 'password' ? 'password' : 'key',
    keyName: String(sshTarget.keyName ?? 'n8n_watchdog'),
    password: String(sshTarget.password ?? ''),
  }
  sshEditingId.value = target.id
}

async function removeSshTarget(id: number) {
  if (!confirm(label('确认删除?', 'Confirm delete?'))) return
  await api.terminal.removeTarget(id)
  await loadSshTargets()
  if (sshEditingId.value === id) resetSshForm()
}

async function testSshTarget(id: number) {
  sshTestingId.value = id
  sshTestResult.value = null
  try {
    const res = await api.terminal.testTarget(id)
    sshTestResult.value = { id, ...res.data }
  } catch (error) {
    sshTestResult.value = { id, ok: false, message: (error as Error).message }
  } finally {
    sshTestingId.value = null
  }
}

function targetField(target: TerminalTarget, key: string, fallback = '') {
  return String(target.target[key] ?? fallback)
}

onMounted(() => {
  void loadSshTargets()
})

defineExpose({ refresh })
</script>

<template>
  <section class="detail-surface">
    <div class="detail-head">
      <div>
        <span class="eyebrow">{{ label('局域网账号', 'Local Network') }}</span>
        <h2>SSH</h2>
      </div>
      <span class="pill" :class="sshTargetCount > 0 ? 'ok' : 'muted'">
        {{ sshTargetCount > 0 ? label('已配置', 'Configured') : label('待接入', 'Pending') }}
      </span>
    </div>

    <div class="ssh-grid">
      <div class="ssh-form">
        <h3 class="form-title">
          {{ sshEditingId ? label('编辑接入', 'Edit target') : label('新增接入', 'Add target') }}
        </h3>
        <label class="form-row">
          <span>{{ label('名称', 'Name') }}</span>
          <input v-model="sshForm.name" :placeholder="label('客厅 Linux', 'Living-room Linux')" />
        </label>
        <div class="form-row form-row--split">
          <label class="form-col">
            <span>{{ label('主机', 'Host') }}</span>
            <input v-model="sshForm.host" placeholder="192.168.1.10" />
          </label>
          <label class="form-col form-col--port">
            <span>{{ label('端口', 'Port') }}</span>
            <input v-model.number="sshForm.port" type="number" min="1" max="65535" />
          </label>
        </div>
        <label class="form-row">
          <span>{{ label('用户', 'User') }}</span>
          <input v-model="sshForm.user" placeholder="root" />
        </label>
        <div class="form-row form-row--split">
          <label class="form-col">
            <span>{{ label('认证', 'Auth') }}</span>
            <select v-model="sshForm.auth">
              <option value="key">SSH Key</option>
              <option value="password">Password</option>
            </select>
          </label>
          <label v-if="sshForm.auth === 'key'" class="form-col">
            <span>{{ label('私钥文件', 'Key file') }}</span>
            <input v-model="sshForm.keyName" placeholder="n8n_watchdog" />
          </label>
          <label v-else class="form-col">
            <span>{{ label('密码', 'Password') }}</span>
            <input v-model="sshForm.password" type="password" />
          </label>
        </div>
        <div class="form-actions">
          <button class="btn-primary" :disabled="isBusy('ssh-save')" @click="saveSshTarget">
            {{ sshEditingId ? label('保存', 'Save') : label('新增', 'Add') }}
          </button>
          <button v-if="sshEditingId" class="btn-secondary" @click="resetSshForm">
            {{ label('取消', 'Cancel') }}
          </button>
        </div>
        <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
      </div>

      <div class="ssh-list">
        <h3 class="form-title">
          {{ label('已配置', 'Configured') }} · {{ sshTargets.length }}
        </h3>
        <div v-if="sshTargets.length === 0" class="empty-line">
          {{ label('还没有接入项', 'No targets yet') }}
        </div>
        <div v-for="target in sshTargets" :key="target.id" class="ssh-row" :class="{ active: sshEditingId === target.id }">
          <div class="ssh-row__main">
            <div class="ssh-row__name">{{ target.name }}</div>
            <div class="ssh-row__detail monospace">
              {{ targetField(target, 'user') }}@{{ targetField(target, 'host') }}:{{ targetField(target, 'port', '22') }}
            </div>
            <div class="ssh-row__auth">
              {{ target.target.auth === 'key' ? `key: ${targetField(target, 'keyName')}` : 'password' }}
            </div>
            <div v-if="sshTestResult?.id === target.id" class="ssh-row__test" :class="sshTestResult.ok ? 'ok' : 'bad'">
              {{ sshTestResult.message }}
            </div>
          </div>
          <div class="ssh-row__actions">
            <button class="btn-ghost" :disabled="sshTestingId === target.id" @click="testSshTarget(target.id)">
              {{ sshTestingId === target.id ? label('测试中...', 'Testing...') : label('测试', 'Test') }}
            </button>
            <button class="btn-ghost" @click="editSshTarget(target)">{{ label('编辑', 'Edit') }}</button>
            <button class="btn-ghost danger" @click="removeSshTarget(target.id)">{{ label('删除', 'Delete') }}</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.detail-surface {
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  border-radius: 8px;
  padding: 22px;
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.eyebrow {
  display: inline-flex;
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
}

h2 {
  margin: 5px 0 0;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 900;
  letter-spacing: 0;
}

.pill {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 900;
}

.pill.ok { background: #dcfce7; color: #047857; }
.pill.muted { background: #f4f4f5; color: #71717a; }

.ssh-grid {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(0, 1.4fr);
  gap: 24px;
  align-items: start;
}

.ssh-form,
.ssh-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-title {
  margin: 0 0 4px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
}

.form-row,
.form-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-row > span,
.form-col > span {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.form-row input,
.form-row select,
.form-col input,
.form-col select {
  padding: 8px 10px;
  border: 1px solid var(--border-soft, #d4d4d8);
  border-radius: 6px;
  background: #fff;
  color: var(--text-primary, #18181b);
  font-family: inherit;
  font-size: 13px;
}

.form-row--split {
  display: grid;
  grid-template-columns: 1fr 110px;
  gap: 10px;
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.btn-primary,
.btn-secondary,
.btn-ghost {
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 6px 14px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.btn-primary {
  background: #10b981;
  color: #fff;
}

.btn-primary:hover:not(:disabled) { background: #059669; }
.btn-primary:disabled { cursor: not-allowed; opacity: 0.5; }

.btn-secondary {
  border-color: var(--border-soft, #d4d4d8);
  background: transparent;
  color: var(--text-secondary, #52525b);
}

.btn-secondary:hover, .btn-ghost:hover { background: #f4f4f5; }

.btn-ghost {
  padding: 4px 8px;
  background: transparent;
  color: var(--text-secondary, #52525b);
}

.btn-ghost.danger { color: #b91c1c; }
.btn-ghost.danger:hover { background: #fef2f2; }

.form-error {
  margin: 4px 0 0;
  color: #b91c1c;
  font-size: 12px;
}

.empty-line {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.monospace {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.ssh-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-soft, #e4e4e7);
  border-radius: 8px;
  background: #fff;
}

.ssh-row.active {
  border-color: #10b981;
  background: #ecfdf5;
}

.ssh-row__main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.ssh-row__name {
  color: var(--text-primary, #18181b);
  font-size: 13px;
  font-weight: 700;
}

.ssh-row__detail {
  color: var(--text-tertiary, #71717a);
  font-size: 12px;
}

.ssh-row__auth {
  color: var(--text-tertiary, #71717a);
  font-size: 11px;
}

.ssh-row__test {
  margin-top: 2px;
  font-size: 11px;
}

.ssh-row__test.ok { color: #047857; }
.ssh-row__test.bad { color: #b91c1c; }

.ssh-row__actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}

@media (max-width: 720px) {
  .ssh-grid {
    grid-template-columns: 1fr;
  }
}
</style>
