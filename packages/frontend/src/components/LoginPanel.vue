<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useLocale } from '../composables/useLocale'

const emit = defineEmits<{ (e: 'logged-in'): void }>()

const { authStatus, loading, checkStatus, startLogin, logout, isLoggedIn } = useAuth()
const qrUrl = ref<string | null>(null)
const qrImage = ref<string | null>(null)
const polling = ref(false)
const { t, locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

let pollTimer: ReturnType<typeof setInterval> | null = null

async function handleLogin() {
  const result = await startLogin()
  if (result?.data?.qr_url) {
    qrUrl.value = result.data.qr_url
    qrImage.value = result.data.qr_image || null
    startPolling()
  } else if (result?.data?.logged_in) {
    emit('logged-in')
  }
}

function startPolling() {
  polling.value = true
  pollTimer = setInterval(async () => {
    const status = await checkStatus()
    if (status?.data?.logged_in) {
      stopPolling()
      emit('logged-in')
    }
  }, 3000)
}

function stopPolling() {
  polling.value = false
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function handleLogout() {
  stopPolling()
  qrUrl.value = null
  qrImage.value = null
  await logout()
}

onMounted(() => {
  checkStatus()
})

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <div class="login-panel">
    <template v-if="isLoggedIn()">
      <div class="logged-in-card glass-panel">
        <div class="user-info">
          <div class="avatar-ring">
            <span class="status-indicator online"></span>
            <div class="avatar-placeholder">MI</div>
          </div>
          <div>
            <strong>{{ t('login.loggedIn') }}</strong>
            <span v-if="authStatus?.data?.user_id" class="user-id">UID: {{ authStatus.data.user_id }}</span>
          </div>
        </div>
        <button class="action-btn danger-hover" @click="handleLogout" :disabled="loading">{{ t('login.logout') }}</button>
      </div>
    </template>
    <template v-else>
      <div class="login-header">
        <span class="eyebrow">{{ label('认证中心', 'Authentication') }}</span>
        <p>{{ t('login.scanHint') }}</p>
      </div>

      <div v-if="!qrUrl" class="empty-qr">
        <button class="primary large full-width" @click="handleLogin" :disabled="loading">
          {{ loading ? t('login.requesting') : t('login.scan') }}
        </button>
      </div>

      <div v-if="qrUrl" class="qr-container">
        <div v-if="qrImage" class="qr-frame">
          <img :src="qrImage" :alt="t('login.qrAlt')" />
          <div v-if="polling" class="polling-overlay">
            <div class="spinner"></div>
            <span>{{ t('login.waiting') }}</span>
          </div>
        </div>
        <div v-else class="qr-fallback">
          <a :href="qrUrl" target="_blank" class="primary-link">{{ t('login.openQr') }}</a>
          <p v-if="polling" class="polling-hint">{{ t('login.waiting') }}</p>
        </div>
        <button class="text-btn" @click="handleLogin" :disabled="loading">{{ label('刷新二维码', 'Refresh QR Code') }}</button>
      </div>
    </template>

  </div>
</template>

<style scoped>
.login-panel {
  padding: 0;
}

.logged-in-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 32px;
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: 24px;
  background: rgba(16, 185, 129, 0.05);
  backdrop-filter: blur(24px);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.logged-in-card:hover {
  background: rgba(16, 185, 129, 0.08);
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.08);
}

.user-info {
  display: flex;
  align-items: center;
  gap: 24px;
}

.avatar-ring {
  position: relative;
  width: 56px;
  height: 56px;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  border-radius: 20px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 900;
  font-size: 15px;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.25);
}

.status-indicator {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.8);
  z-index: 1;
}

.status-indicator.online {
  background: #10b981;
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.4);
}

.user-info strong {
  display: block;
  font-size: 18px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.user-id {
  display: block;
  font-size: 11px;
  font-weight: 900;
  color: var(--text-tertiary);
  margin-top: 6px;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.login-header {
  margin-bottom: 40px;
}

.eyebrow {
  display: inline-block;
  color: #10b981;
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 12px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.login-header p {
  color: var(--text-tertiary);
  font-size: 15px;
  font-weight: 800;
  line-height: 1.6;
  opacity: 0.7;
}

.empty-qr {
  padding: 60px 0;
}

.qr-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
}

.qr-frame {
  position: relative;
  width: 280px;
  height: 280px;
  padding: 16px;
  background: #fff;
  border: 1px solid rgba(229, 231, 235, 0.5);
  border-radius: 32px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.08);
}

.qr-frame img {
  width: 100%;
  height: 100%;
  border-radius: 20px;
}

.polling-overlay {
  position: absolute;
  inset: 16px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  z-index: 2;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 4px solid rgba(16, 185, 129, 0.1);
  border-top-color: #10b981;
  border-radius: 50%;
  animation: spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.polling-overlay span {
  font-size: 12px;
  font-weight: 900;
  color: #10b981;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

.qr-fallback {
  text-align: center;
  padding: 60px;
  border: 2px dashed rgba(229, 231, 235, 0.8);
  border-radius: 32px;
  width: 100%;
}

.primary-link {
  display: inline-block;
  padding: 14px 28px;
  background: #10b981;
  color: #fff;
  border-radius: 14px;
  text-decoration: none;
  font-weight: 900;
  font-size: 14px;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.25);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.primary-link:hover {
  background: #059669;
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.35);
}

.text-btn {
  background: none;
  border: none;
  box-shadow: none;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  padding: 10px 20px;
  opacity: 0.6;
  cursor: pointer;
  transition: all 0.3s ease;
}

.text-btn:hover {
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-primary);
  border-radius: 10px;
  opacity: 1;
}

.danger-hover:hover {
  color: #ef4444 !important;
  border-color: rgba(239, 68, 68, 0.2) !important;
  background: rgba(239, 68, 68, 0.05) !important;
}

.full-width {
  width: 100%;
}

button.large {
  min-height: 60px;
  padding: 0 32px;
  font-size: 16px;
  font-weight: 900;
  border-radius: 18px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
</style>
