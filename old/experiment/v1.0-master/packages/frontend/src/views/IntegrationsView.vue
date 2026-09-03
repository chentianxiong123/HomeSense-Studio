<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useLocale } from '@/composables/useLocale'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { externalIntegrationApi, type ExternalIntegrationRecord } from '@/api/externalIntegrations'

const router = useRouter()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

type CliId = 'mi-cli' | 'adb-cli'

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

const cards: { id: CliId; name: string; subtitle: string; icon: string; route: string }[] = [
  { id: 'mi-cli', name: 'mi-cli', subtitle: '米家扫码登录与认证', icon: '🔑', route: '/integrations/mi-cli' },
  { id: 'adb-cli', name: 'adb-cli', subtitle: 'Android ADB 电视调试', icon: '📺', route: '/integrations/adb-cli' },
]

const integrations = ref<ExternalIntegrationRecord[]>([])
const loading = ref(false)
const showForm = ref(false)
const formName = ref('')
const formKind = ref<'http' | 'cli' | 'local_service' | 'webhook'>('http')
const formEndpoint = ref('')
const formDescription = ref('')
const formCapabilities = ref('')

const speakerStatus = ref<'unknown' | 'logged_in' | 'logged_out' | 'loading'>('loading')
const speakerUser = ref('')
const speakerQrUrl = ref('')
const speakerQrPolling = ref(false)
let qrPollTimer: ReturnType<typeof setInterval> | null = null

function goTo(route: string) {
  router.push(route)
}

const kindLabels: Record<string, string> = {
  http: 'HTTP',
  cli: 'CLI',
  local_service: label('本地服务', 'Local'),
  webhook: 'Webhook',
}

async function loadIntegrations() {
  loading.value = true
  try {
    const res = await externalIntegrationApi.list()
    integrations.value = res.integrations ?? []
  } catch {} finally {
    loading.value = false
  }
}

async function registerIntegration() {
  if (!formName.value.trim()) return
  const capabilities = formCapabilities.value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  try {
    await externalIntegrationApi.register({
      name: formName.value.trim(),
      kind: formKind.value,
      endpoint: formEndpoint.value.trim(),
      description: formDescription.value.trim(),
      capabilities,
    })
    formName.value = ''
    formEndpoint.value = ''
    formDescription.value = ''
    formCapabilities.value = ''
    showForm.value = false
    await loadIntegrations()
  } catch {}
}

async function removeIntegration(id: number) {
  try {
    await externalIntegrationApi.remove(id)
    await loadIntegrations()
  } catch {}
}

async function checkSpeakerStatus() {
  speakerStatus.value = 'loading'
  try {
    const res = await fetch('/api/auth/status')
    const data = await res.json()
    if (data?.status === 'success' && data?.data?.logged_in) {
      speakerStatus.value = 'logged_in'
      speakerUser.value = data.data.user_id || data.data.username || ''
    } else {
      speakerStatus.value = 'logged_out'
      speakerUser.value = ''
    }
  } catch {
    speakerStatus.value = 'unknown'
  }
}

async function startQrLogin() {
  speakerQrUrl.value = ''
  try {
    const res = await fetch('/api/auth/qr/start', { method: 'POST' })
    const data = await res.json()
    speakerQrUrl.value = data?.data?.qr_url || data?.data?.url || ''
    if (speakerQrUrl.value) {
      speakerQrPolling.value = true
      qrPollTimer = setInterval(pollQrStatus, 2000)
    }
  } catch {}
}

async function pollQrStatus() {
  try {
    const res = await fetch('/api/auth/qr/status')
    const data = await res.json()
    const status = data?.data?.status || data?.status
    if (status === 'confirmed' || status === 'success' || data?.data?.logged_in) {
      stopQrPolling()
      speakerStatus.value = 'logged_in'
      speakerUser.value = data.data?.user_id || ''
      speakerQrUrl.value = ''
    } else if (status === 'expired' || status === 'error') {
      stopQrPolling()
      speakerQrUrl.value = ''
    }
  } catch {
    stopQrPolling()
  }
}

function stopQrPolling() {
  speakerQrPolling.value = false
  if (qrPollTimer) {
    clearInterval(qrPollTimer)
    qrPollTimer = null
  }
}

async function speakerLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' })
    speakerStatus.value = 'logged_out'
    speakerUser.value = ''
  } catch {}
}

onMounted(() => {
  loadIntegrations()
  checkSpeakerStatus()
})

onUnmounted(() => {
  stopQrPolling()
})
</script>

<template>
  <div class="integrations-page">
    <header class="page-head glass-panel">
      <div class="header-main">
        <span class="eyebrow">{{ label('集成', 'Integrations') }}</span>
        <h1>{{ label('能力来源', 'Capability Sources') }}</h1>
        <p>{{ label('管理 CLI 集成和外部能力源。', 'Manage CLI integrations and external capability sources.') }}</p>
      </div>
    </header>

    <section class="section-block">
      <div class="section-header">
        <h2>{{ label('CLI 集成', 'CLI Integrations') }}</h2>
        <small>{{ label('本地内置 CLI', 'Built-in local CLIs') }}</small>
      </div>
      <div class="card-grid">
        <button
          v-for="card in cards"
          :key="card.id"
          class="cli-card glass-card"
          @click="goTo(card.route)"
        >
          <span class="cli-icon">{{ card.icon }}</span>
          <strong class="cli-name">{{ card.name }}</strong>
          <span class="cli-subtitle">{{ card.subtitle }}</span>
          <span class="expand-hint">→</span>
        </button>
      </div>
    </section>

    <section class="section-block">
      <div class="section-header">
        <h2>{{ label('小米账号 / 音箱', 'Xiaomi Account / Speaker') }}</h2>
        <small>{{ label('登录后可控制小爱音箱', 'Login to control Xiaomi speakers') }}</small>
      </div>
      <div class="speaker-panel glass-panel">
        <div v-if="speakerStatus === 'loading'" class="speaker-state">
          {{ label('检查登录状态...', 'Checking login status...') }}
        </div>
        <div v-else-if="speakerStatus === 'logged_in'" class="speaker-state logged-in">
          <span class="speaker-dot online"></span>
          <span>{{ label('已登录', 'Logged in') }}</span>
          <span v-if="speakerUser" class="speaker-user">{{ speakerUser }}</span>
          <button class="speaker-logout-btn" @click="speakerLogout">{{ label('退出', 'Logout') }}</button>
        </div>
        <div v-else class="speaker-login-area">
          <div class="speaker-state logged-out">
            <span class="speaker-dot offline"></span>
            <span>{{ label('未登录小米账号', 'Not logged in') }}</span>
          </div>
          <div v-if="speakerQrUrl" class="qr-area">
            <img :src="speakerQrUrl" alt="QR Code" class="qr-image" />
            <p class="qr-hint">{{ label('使用米家 App 扫码登录', 'Scan with Mi Home app') }}</p>
            <span v-if="speakerQrPolling" class="qr-polling">{{ label('等待扫码...', 'Waiting for scan...') }}</span>
          </div>
          <button v-if="!speakerQrUrl" class="speaker-login-btn" @click="startQrLogin">
            {{ label('扫码登录小米账号', 'Login with QR Code') }}
          </button>
        </div>
      </div>
    </section>

    <section class="section-block">
      <div class="section-header">
        <h2>{{ label('外部能力源', 'External Capability Sources') }}</h2>
        <button class="add-btn" @click="showForm = !showForm">
          {{ showForm ? label('取消', 'Cancel') : label('登记新来源', 'Register Source') }}
        </button>
      </div>

      <div v-if="showForm" class="register-form glass-panel">
        <div class="form-row">
          <label>{{ label('名称', 'Name') }}</label>
          <input v-model="formName" :placeholder="label('例如 bilibili-music', 'e.g. bilibili-music')" />
        </div>
        <div class="form-row">
          <label>{{ label('类型', 'Kind') }}</label>
          <select v-model="formKind">
            <option value="http">HTTP</option>
            <option value="cli">CLI</option>
            <option value="local_service">{{ label('本地服务', 'Local Service') }}</option>
            <option value="webhook">Webhook</option>
          </select>
        </div>
        <div class="form-row">
          <label>{{ label('端点', 'Endpoint') }}</label>
          <input v-model="formEndpoint" placeholder="http://127.0.0.1:28974" />
        </div>
        <div class="form-row">
          <label>{{ label('说明', 'Description') }}</label>
          <input v-model="formDescription" :placeholder="label('能力来源说明', 'Capability source description')" />
        </div>
        <div class="form-row">
          <label>{{ label('能力 ID', 'Capability IDs') }}</label>
          <textarea v-model="formCapabilities" :placeholder="label('media.dlna.cast, media.speaker.play', 'media.dlna.cast, media.speaker.play')" rows="2"></textarea>
        </div>
        <button class="submit-btn" @click="registerIntegration">
          {{ label('登记', 'Register') }}
        </button>
      </div>

      <div v-if="loading" class="empty-line">{{ label('加载中...', 'Loading...') }}</div>
      <div v-else-if="integrations.length === 0" class="empty-line">
        {{ label('还没有外部能力源。', 'No external capability sources yet.') }}
      </div>
      <div v-else class="integration-grid">
        <article v-for="item in integrations" :key="item.id" class="integration-card glass-card">
          <div class="integration-head">
            <span class="kind-badge">{{ kindLabels[item.kind] ?? item.kind }}</span>
            <span :class="['status-dot', { active: item.enabled }]"></span>
            <button class="remove-btn" @click="removeIntegration(item.id)">×</button>
          </div>
          <strong>{{ item.name }}</strong>
          <p v-if="item.description">{{ item.description }}</p>
          <div v-if="item.endpoint" class="endpoint-line">{{ item.endpoint }}</div>
          <div v-if="item.capability_ids.length > 0" class="caps-line">
            <span v-for="cap in item.capability_ids.slice(0, 4)" :key="cap" class="cap-tag">{{ cap }}</span>
            <span v-if="item.capability_ids.length > 4" class="cap-tag more">+{{ item.capability_ids.length - 4 }}</span>
          </div>
          <div v-if="item.actions.length > 0" class="actions-line">
            {{ label('动作', 'Actions') }}: {{ item.actions.map((a) => a.name).slice(0, 5).join(', ') }}{{ item.actions.length > 5 ? ' ...' : '' }}
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.integrations-page {
  height: 100%;
  overflow-y: auto;
  padding: 40px;
  background: #f7f9fa;
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.glass-panel {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.glass-panel:hover {
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.05);
}

.glass-card {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(16px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 32px;
  padding: 48px;
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
}

h1 {
  margin: 0;
  font-size: 40px;
  font-weight: 900;
  letter-spacing: -0.05em;
  color: var(--text-primary);
  line-height: 1.1;
}

.page-head p {
  margin-top: 16px;
  color: var(--text-secondary);
  font-size: 17px;
  line-height: 1.7;
  font-weight: 600;
  max-width: 800px;
  letter-spacing: -0.01em;
}

.section-block {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.section-header h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.section-header small {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
}

.add-btn {
  padding: 8px 20px;
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 10px;
  background: rgba(16, 185, 129, 0.08);
  color: #059669;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s;
}

.add-btn:hover {
  background: rgba(16, 185, 129, 0.15);
  border-color: #10b981;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}

.cli-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 32px;
  text-align: center;
  cursor: pointer;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.4);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.cli-card:hover {
  background: rgba(255, 255, 255, 0.85);
  transform: translateY(-6px);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.08);
}

.cli-icon {
  font-size: 40px;
}

.cli-name {
  font-size: 22px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.03em;
}

.cli-subtitle {
  font-size: 15px;
  color: var(--text-secondary);
  font-weight: 700;
  line-height: 1.6;
}

.expand-hint {
  font-size: 18px;
  color: #10b981;
  font-weight: 900;
  margin-top: 4px;
}

.register-form {
  padding: 28px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 12px;
  align-items: center;
}

.form-row label {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.form-row input,
.form-row select,
.form-row textarea {
  padding: 10px 14px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  background: #fff;
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.2s;
}

.form-row input:focus,
.form-row select:focus,
.form-row textarea:focus {
  border-color: #10b981;
}

.submit-btn {
  align-self: flex-end;
  padding: 10px 28px;
  border: none;
  border-radius: 10px;
  background: #10b981;
  color: #fff;
  font-size: 14px;
  font-weight: 900;
  cursor: pointer;
  transition: all 0.2s;
}

.submit-btn:hover {
  background: #059669;
  transform: translateY(-1px);
}

.empty-line {
  padding: 32px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 14px;
  font-weight: 700;
}

.integration-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.integration-card {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.integration-card:hover {
  background: rgba(255, 255, 255, 0.75);
  transform: translateY(-3px);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.06);
}

.integration-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.kind-badge {
  padding: 3px 10px;
  border-radius: 6px;
  background: rgba(37, 99, 235, 0.08);
  color: #2563eb;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #94a3b8;
}

.status-dot.active {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
}

.remove-btn {
  margin-left: auto;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 8px;
  background: transparent;
  color: #ef4444;
  font-size: 16px;
  font-weight: 900;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  opacity: 0;
}

.integration-card:hover .remove-btn {
  opacity: 1;
}

.remove-btn:hover {
  background: rgba(239, 68, 68, 0.08);
  border-color: #ef4444;
}

.integration-card strong {
  font-size: 18px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.integration-card p {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}

.endpoint-line {
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  padding: 6px 10px;
  background: rgba(241, 245, 249, 0.8);
  border-radius: 6px;
}

.caps-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cap-tag {
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(16, 185, 129, 0.08);
  color: #059669;
  font-size: 11px;
  font-weight: 800;
}

.cap-tag.more {
  background: rgba(100, 116, 139, 0.08);
  color: #64748b;
}

.actions-line {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-tertiary);
}

.speaker-panel {
  padding: 24px;
}
.speaker-state {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-secondary);
}
.speaker-state.logged-in { color: #059669; }
.speaker-state.logged-out { color: var(--text-tertiary); }
.speaker-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.speaker-dot.online { background: #10b981; }
.speaker-dot.offline { background: #94a3b8; }
.speaker-user {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  color: var(--text-tertiary);
}
.speaker-login-area {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.speaker-login-btn,
.speaker-logout-btn {
  padding: 8px 20px;
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 10px;
  background: rgba(59, 130, 246, 0.08);
  color: #2563eb;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s;
}
.speaker-login-btn:hover,
.speaker-logout-btn:hover {
  background: rgba(59, 130, 246, 0.15);
  border-color: #3b82f6;
}
.speaker-logout-btn {
  margin-left: auto;
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
  color: #dc2626;
}
.speaker-logout-btn:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: #ef4444;
}
.qr-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.qr-image {
  width: 200px;
  height: 200px;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.06);
}
.qr-hint {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  margin: 0;
}
.qr-polling {
  font-size: 12px;
  font-weight: 800;
  color: #2563eb;
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
