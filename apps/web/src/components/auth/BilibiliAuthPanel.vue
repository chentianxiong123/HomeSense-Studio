<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { mediaApi, type BilibiliAuthStatus } from '@/api/media'

type LabelFn = (zh: string, en: string) => string

const props = defineProps<{
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'status-change', value: { loggedIn: boolean; userName: string }): void
  (event: 'error', value: string): void
  (event: 'success', value: string): void
}>()

const status = ref<BilibiliAuthStatus | null>(null)
const loading = ref(false)
const cookieText = ref('')
const qrUrl = ref('')
const qrSvg = ref('')
const qrKey = ref('')
const qrMessage = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

const qrSvgDataUrl = computed(() => {
  if (!qrSvg.value) return ''
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg.value)}`
})

function label(zh: string, en: string) {
  return props.label(zh, en)
}

function notifyStatus(next: BilibiliAuthStatus | null) {
  emit('status-change', {
    loggedIn: Boolean(next?.authenticated),
    userName: next?.user?.uname ? String(next.user.uname) : '',
  })
}

async function refresh() {
  loading.value = true
  try {
    const result = await mediaApi.bilibiliStatus()
    if (result.status !== 'success' || !result.data) throw new Error(result.message || result.error || 'Bilibili status failed')
    status.value = result.data
    notifyStatus(result.data)
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}

async function importCookie() {
  const cookie = cookieText.value.trim()
  if (!cookie) return
  loading.value = true
  try {
    const result = await mediaApi.bilibiliImportCookie(cookie)
    if (result.status !== 'success' || !result.data) throw new Error(result.message || result.error || 'Bilibili cookie import failed')
    status.value = result.data
    cookieText.value = ''
    notifyStatus(result.data)
    emit('success', label('Bilibili 登录已保存', 'Bilibili login saved'))
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}

async function importBrowserCookie() {
  loading.value = true
  try {
    const result = await mediaApi.bilibiliBrowserImport()
    if (result.status !== 'success' || !result.data) throw new Error(result.message || result.error || 'No browser cookie found')
    status.value = result.data
    notifyStatus(result.data)
    emit('success', label('已从浏览器导入 Bilibili 登录', 'Imported Bilibili login from browser'))
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}

async function startQr() {
  stopPolling()
  loading.value = true
  qrMessage.value = ''
  try {
    const result = await mediaApi.bilibiliQrStart()
    if (result.status !== 'success' || !result.data?.url || !result.data.qrcode_key) {
      throw new Error(result.message || result.error || 'Bilibili QR start failed')
    }
    qrUrl.value = result.data.url
    qrSvg.value = result.data.qr_svg || ''
    qrKey.value = result.data.qrcode_key
    pollTimer = setInterval(() => void pollQr(), 2500)
    qrMessage.value = label('请用 Bilibili App 扫码确认。', 'Scan with the Bilibili app and confirm.')
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}

async function pollQr() {
  if (!qrKey.value) return
  try {
    const result = await mediaApi.bilibiliQrPoll(qrKey.value)
    if (result.status !== 'success' || !result.data) throw new Error(result.message || result.error || 'Bilibili QR poll failed')
    if (result.data.authenticated) {
      status.value = result.data
      notifyStatus(result.data)
      stopPolling()
      qrUrl.value = ''
      qrSvg.value = ''
      qrKey.value = ''
      qrMessage.value = label('Bilibili 登录完成。', 'Bilibili login complete.')
      emit('success', qrMessage.value)
      return
    }
    if (result.data.qr_status === 'expired') {
      stopPolling()
      qrMessage.value = label('二维码已过期，请重新生成。', 'QR code expired. Start again.')
      return
    }
    qrMessage.value = result.data.qr_status === 'waiting_confirm'
      ? label('已扫码，等待确认。', 'Scanned, waiting for confirmation.')
      : label('等待扫码。', 'Waiting for scan.')
  } catch (error) {
    stopPolling()
    emit('error', error instanceof Error ? error.message : String(error))
  }
}

async function logout() {
  loading.value = true
  try {
    await mediaApi.bilibiliLogout()
    status.value = { authenticated: false, has_saved_login: false }
    notifyStatus(status.value)
    emit('success', label('Bilibili 登录已退出', 'Bilibili login removed'))
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

onMounted(refresh)
onUnmounted(stopPolling)

defineExpose({ refresh })
</script>

<template>
  <section class="detail-surface">
    <div class="detail-head">
      <div>
        <span class="eyebrow">{{ label('外部账号', 'External') }}</span>
        <h2>Bilibili</h2>
      </div>
      <span :class="['pill', status?.authenticated ? 'ok' : 'muted']">
        {{ status?.authenticated ? label('已登录', 'Logged in') : label('未登录', 'Logged out') }}
      </span>
    </div>

    <div class="account-card">
      <img v-if="status?.user?.face" :src="String(status.user.face)" alt="" referrerpolicy="no-referrer" />
      <div>
        <strong>{{ status?.user?.uname || label('未连接 Bilibili', 'Bilibili not connected') }}</strong>
        <small>{{ status?.source || label('扫码或 Cookie 登录后可读取收藏夹。', 'Login with QR or cookie to read favorite folders.') }}</small>
      </div>
    </div>

    <div class="actions">
      <button class="primary-btn" :disabled="loading" @click="startQr">{{ label('扫码登录', 'QR Login') }}</button>
      <button class="plain-btn" :disabled="loading" @click="importBrowserCookie">{{ label('导入浏览器 Cookie', 'Import Browser Cookie') }}</button>
      <button class="plain-btn" :disabled="loading" @click="refresh">{{ label('刷新状态', 'Refresh') }}</button>
      <button class="danger-btn" :disabled="loading || !status?.has_saved_login" @click="logout">{{ label('退出', 'Logout') }}</button>
    </div>

    <div v-if="qrUrl" class="qr-box">
      <img :src="qrSvgDataUrl || qrUrl" alt="Bilibili QR" />
      <div>
        <strong>{{ label('Bilibili 扫码登录', 'Bilibili QR Login') }}</strong>
        <small>{{ qrMessage }}</small>
      </div>
    </div>

    <label class="cookie-field">
      <span>Cookie</span>
      <textarea v-model="cookieText" spellcheck="false" placeholder="SESSDATA=...; bili_jct=..."></textarea>
    </label>
    <button class="primary-btn self-start" :disabled="loading || !cookieText.trim()" @click="importCookie">
      {{ label('保存 Cookie', 'Save Cookie') }}
    </button>
  </section>
</template>

<style scoped>
.detail-surface {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 22px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-head,
.actions,
.account-card,
.qr-box {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.detail-head {
  justify-content: space-between;
}

.eyebrow {
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
}

h2 {
  margin: 5px 0 0;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 900;
}

.pill {
  min-height: 26px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 900;
  display: inline-flex;
  align-items: center;
}

.pill.ok { background: #dcfce7; color: #047857; }
.pill.muted { background: #f4f4f5; color: #71717a; }

.account-card,
.qr-box {
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.account-card img,
.qr-box img {
  width: 52px;
  height: 52px;
  border-radius: 8px;
  object-fit: cover;
}

.qr-box img {
  width: 180px;
  height: 180px;
}

.account-card div,
.qr-box div,
.cookie-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.account-card strong,
.qr-box strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
}

.account-card small,
.qr-box small,
.cookie-field span {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 750;
}

.cookie-field textarea {
  min-height: 110px;
  resize: vertical;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 10px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
}

.plain-btn,
.primary-btn,
.danger-btn {
  min-height: 34px;
  border-radius: 7px;
  padding: 0 12px;
  font: inherit;
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;
}

.plain-btn {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #334155;
}

.primary-btn {
  border: 1px solid #0f766e;
  background: #0f766e;
  color: #fff;
}

.danger-btn {
  border: 1px solid #fecaca;
  background: #fff;
  color: #b91c1c;
}

.self-start {
  align-self: flex-start;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
