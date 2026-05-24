<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, type AuthStatus } from '@/api'
import { useLocale } from '@/composables/useLocale'
import { computed } from 'vue'

const router = useRouter()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

const loading = ref('')
const errorMessage = ref('')
const auth = ref<AuthStatus | null>(null)

const authData = computed(() => auth.value?.data)
const loggedIn = computed(() => Boolean(authData.value?.logged_in))
const qrLink = computed(() => authData.value?.qr?.login_url || authData.value?.qr_url || '')

// Password login + OTP
const username = ref('')
const password = ref('')
const loginStatus = ref('')
const userId = ref('')
const needVerify = ref(false)
const verifyUrl = ref('')
const ticket = ref('')
const loginLoading = ref(false)
const loginError = ref('')
const verifyLoading = ref(false)
const verifyError = ref('')

// Device discovery
const devices = ref<any[]>([])
const discoverLoading = ref(false)
const discoverError = ref('')

onMounted(async () => {
  await refreshStatus()
})

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

async function run<T>(key: string, task: () => Promise<T>, assign: (value: T) => void) {
  loading.value = key
  errorMessage.value = ''
  try {
    const result = await task()
    assign(result)
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    loading.value = ''
  }
}

async function refreshStatus() {
  await run('status', api.auth.status, (result) => { auth.value = result })
}

async function prepareLogin() {
  await run('login', api.auth.login, (result) => { auth.value = result })
}

async function doPasswordLogin() {
  if (!username.value || !password.value) {
    loginError.value = label('请输入用户名和密码', 'Username and password required')
    return
  }
  loginLoading.value = true
  loginError.value = ''
  loginStatus.value = ''
  needVerify.value = false
  verifyError.value = ''
  try {
    const j = await api.auth.passwordLogin(username.value, password.value)
    if (j.status === 'success' && j.data) {
      if (j.data.logged_in) {
        auth.value = j
        userId.value = j.data.user_id || ''
        loginStatus.value = j.data.message || label('已登录', 'Logged in')
        password.value = ''
        needVerify.value = false
      } else {
        loginError.value = j.message || label('登录返回异常', 'Login returned unexpected state')
      }
    } else if (j.error === 'NEED_VERIFY') {
      needVerify.value = true
      verifyUrl.value = j.data?.qr?.login_url || j.data?.qr_url || ''
      loginStatus.value = label('需要身份验证，请查看手机短信或邮箱获取验证码', 'Verification required, check SMS or email')
    } else {
      loginError.value = j.message || j.error || label('登录失败', 'Login failed')
    }
  } catch (e: any) {
    loginError.value = e.message
  } finally {
    loginLoading.value = false
  }
}

async function doVerify() {
  if (!ticket.value) {
    verifyError.value = label('请输入验证码', 'Verification code required')
    return
  }
  verifyLoading.value = true
  verifyError.value = ''
  try {
    const j = await api.auth.verifyTicket(ticket.value, username.value, password.value)
    if (j.status === 'success' && j.data) {
      auth.value = j
      userId.value = j.data.user_id || ''
      loginStatus.value = j.data.message || label('已登录', 'Logged in')
      needVerify.value = false
      if (j.data.logged_in) password.value = ''
    } else {
      verifyError.value = j.message || j.error || label('验证失败', 'Verification failed')
    }
  } catch (e: any) {
    verifyError.value = e.message
  } finally {
    verifyLoading.value = false
  }
}

async function doLogout() {
  loginLoading.value = true
  try {
    await api.auth.logout()
    auth.value = null
    userId.value = ''
    loginStatus.value = label('已退出登录', 'Logged out')
    username.value = ''
    password.value = ''
    needVerify.value = false
    ticket.value = ''
    devices.value = []
  } catch (e: any) {
    loginError.value = e.message
  } finally {
    loginLoading.value = false
  }
}

async function doDiscover() {
  discoverLoading.value = true
  discoverError.value = ''
  try {
    const j = await api.devices.discover()
    if (j.status === 'success' && j.data) {
      devices.value = j.devices || j.data.devices || []
    } else if (j.devices) {
      devices.value = j.devices
    } else {
      discoverError.value = j.error || j.message || label('发现失败', 'Discovery failed')
    }
  } catch (e: any) {
    discoverError.value = e.message
  } finally {
    discoverLoading.value = false
  }
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2)
}
</script>

<template>
  <div class="detail-page">
    <header class="page-head glass-panel">
      <button class="back-btn" @click="router.push('/integrations')">← {{ label('返回', 'Back') }}</button>
      <div class="header-main">
        <span class="eyebrow">mi-cli</span>
        <h1>{{ label('mi-cli 登录与发现', 'mi-cli Auth & Discovery') }}</h1>
        <p>{{ label('米家账户授权、设备发现。', 'Mi Home account auth and device discovery.') }}</p>
      </div>
      <div class="btn-group">
        <button class="secondary-btn" @click="prepareLogin" :disabled="loading === 'login'">{{ label('生成二维码', 'Prepare QR') }}</button>
        <button class="secondary-btn" @click="refreshStatus" :disabled="loading === 'status'">{{ label('检查登录', 'Check') }}</button>
        <button v-if="loggedIn" class="primary-btn" @click="doDiscover" :disabled="discoverLoading">{{ label('发现设备', 'Discover') }}</button>
        <button class="secondary-btn danger" @click="doLogout" :disabled="loginLoading">{{ label('退出', 'Logout') }}</button>
      </div>
    </header>

    <section v-if="errorMessage" class="error-line">{{ errorMessage }}</section>

    <!-- QR link -->
    <div v-if="qrLink" class="qr-line glass-card">
      <label class="eyebrow">{{ label('二维码链接', 'QR link') }}</label>
      <a :href="qrLink" target="_blank" rel="noreferrer">{{ qrLink }}</a>
    </div>

    <!-- Password Login -->
    <section class="section-card glass-panel">
      <div class="section-head">
        <h3>{{ label('密码登录', 'Password Login') }}</h3>
        <span v-if="loggedIn" class="status-chip success">{{ label('已登录', 'Logged In') }}</span>
        <span v-else-if="needVerify" class="status-chip warning">{{ label('待验证', 'Verify Required') }}</span>
        <span v-else class="status-chip">{{ label('未登录', 'Not Logged In') }}</span>
      </div>

      <template v-if="!loggedIn">
        <template v-if="!needVerify">
          <div class="form-grid">
            <div class="input-row">
              <label class="eyebrow">{{ label('小米账号', 'Mi Account') }}</label>
              <input v-model="username" class="styled-input" type="text" :placeholder="label('手机号 / 邮箱', 'Phone / Email')" />
            </div>
            <div class="input-row">
              <label class="eyebrow">{{ label('密码', 'Password') }}</label>
              <input v-model="password" class="styled-input" type="password" :placeholder="label('密码', 'Password')" @keyup.enter="doPasswordLogin" />
            </div>
          </div>
          <div class="btn-row">
            <button class="primary-btn" @click="doPasswordLogin" :disabled="loginLoading">
              {{ loginLoading ? label('登录中...', 'Logging in...') : label('开始登录', 'Begin Login') }}
            </button>
          </div>
        </template>
        <template v-else>
          <div class="alert warning">
            {{ label('小米要求身份验证，请查看手机短信或邮箱获取验证码。', 'Xiaomi requires authentication. Please check your SMS or email for the OTP.') }}
            <small v-if="verifyUrl">{{ label('验证页面', 'Verify URL') }}: {{ verifyUrl }}</small>
          </div>
          <div class="form-grid single">
            <div class="input-row">
              <label class="eyebrow">{{ label('验证码', 'OTP') }}</label>
              <input v-model="ticket" class="styled-input" type="text" :placeholder="label('输入验证码', 'Enter code')" @keyup.enter="doVerify" />
            </div>
          </div>
          <div class="btn-row">
            <button class="primary-btn" @click="doVerify" :disabled="verifyLoading">
              {{ verifyLoading ? label('验证中...', 'Verifying...') : label('提交验证码', 'Submit Code') }}
            </button>
            <button class="secondary-btn" @click="needVerify = false; ticket = ''">{{ label('返回', 'Back') }}</button>
          </div>
        </template>
      </template>
      <div v-else class="meta-grid">
        <div><label>{{ label('用户 ID', 'User ID') }}</label><span>{{ userId || '-' }}</span></div>
        <div><label>{{ label('状态', 'Status') }}</label><span>{{ loginStatus || label('在线', 'Online') }}</span></div>
      </div>

      <div v-if="loginError || verifyError" class="error-line-inline">{{ loginError || verifyError }}</div>
    </section>

    <!-- Device Discovery -->
    <section v-if="loggedIn" class="section-card glass-panel">
      <div class="section-head">
        <h3>{{ label('设备发现', 'Device Discovery') }}</h3>
        <span v-if="devices.length" class="status-chip success">{{ devices.length }} {{ label('个设备', 'Devices') }}</span>
      </div>

      <div v-if="!devices.length && !discoverError" class="empty-action">
        <p>{{ label('点击上方"发现设备"按钮扫描米家账户下的物理设备。', 'Click the "Discover" button above to scan devices.') }}</p>
      </div>

      <div v-if="discoverError" class="error-line-inline">{{ discoverError }}</div>

      <div v-if="devices.length" class="table-container">
        <table>
          <thead>
            <tr>
              <th>{{ label('名称', 'Name') }}</th>
              <th>{{ label('型号', 'Model') }}</th>
              <th>DID</th>
              <th>{{ label('连接', 'Connection') }}</th>
              <th>{{ label('房间', 'Room') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in devices" :key="d.did">
              <td><strong>{{ d.name }}</strong></td>
              <td><code>{{ d.model }}</code></td>
              <td><small>{{ d.did }}</small></td>
              <td><span class="type-pill">{{ d.connection_type }}</span></td>
              <td>{{ d.room_name || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Raw JSON -->
    <section class="section-card glass-panel">
      <div class="section-head">
        <h3>{{ label('原始数据', 'Raw Data') }}</h3>
      </div>
      <pre class="result-pre">{{ safeJson(authData) }}</pre>
      <pre v-if="devices.length" class="result-pre">{{ safeJson(devices) }}</pre>
    </section>
  </div>
</template>

<style scoped>
.detail-page {
  height: 100%;
  overflow-y: auto;
  padding: 40px;
  background: #f7f9fa;
  display: flex;
  flex-direction: column;
  gap: 32px;
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
  padding: 32px;
}

.page-head {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 40px;
}

.back-btn {
  align-self: flex-start;
  padding: 8px 20px;
  height: 40px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-primary);
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 12px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.back-btn:hover {
  border-color: #10b981;
  color: #10b981;
  background: #fff;
  transform: translateY(-2px);
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
  margin-bottom: 16px;
}

h1 {
  margin: 0;
  font-size: 36px;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: var(--text-primary);
  line-height: 1.1;
}

h3 {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--text-tertiary);
  opacity: 0.6;
  margin: 0;
}

.page-head p {
  color: var(--text-secondary);
  font-size: 17px;
  line-height: 1.7;
  font-weight: 600;
  max-width: 800px;
  letter-spacing: -0.01em;
}

.section-card {
  padding: 40px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
}

.status-chip {
  background: rgba(0, 0, 0, 0.05);
  padding: 4px 14px;
  border-radius: 99px;
  font-size: 10px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.status-chip.success {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.status-chip.warning {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
  margin-bottom: 24px;
}

.form-grid.single {
  grid-template-columns: 1fr;
  max-width: 400px;
}

.input-row label {
  display: block;
  font-size: 9px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  margin-bottom: 14px;
  opacity: 0.6;
}

.styled-input {
  width: 100%;
  min-height: 48px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.8);
  padding: 0 24px;
  font-size: 14px;
  font-weight: 800;
  color: var(--text-primary);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  outline: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
}

.styled-input:focus {
  border-color: #10b981;
  background: #fff;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.12);
  transform: translateY(-2px);
}

.btn-row {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 16px;
}

.btn-group {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.primary-btn {
  padding: 0 32px;
  height: 48px;
  background: #10b981;
  color: #fff;
  border: none;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 900;
  cursor: pointer;
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.25);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.primary-btn:hover:not(:disabled) {
  background: #059669;
  transform: translateY(-4px);
  box-shadow: 0 16px 48px rgba(16, 185, 129, 0.35);
  color: #fff;
}

.secondary-btn {
  padding: 0 24px;
  height: 48px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-primary);
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 14px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
}

.secondary-btn:hover:not(:disabled) {
  border-color: #10b981;
  color: #10b981;
  transform: translateY(-2px);
  background: #fff;
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.12);
}

.secondary-btn.danger {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.3);
}

.secondary-btn.danger:hover {
  background: #ef4444;
  border-color: #ef4444;
  color: #fff;
}

.alert {
  padding: 24px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.6;
  margin-bottom: 32px;
}

.alert.warning {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.2);
  color: #d97706;
}

.alert small {
  display: block;
  margin-top: 12px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  opacity: 0.8;
  word-break: break-all;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}

.meta-grid > div {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 20px;
  padding: 24px;
  background: rgba(255, 255, 255, 0.3);
}

.meta-grid label {
  display: block;
  color: var(--text-tertiary);
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  opacity: 0.6;
}

.meta-grid span {
  display: block;
  margin-top: 12px;
  font-size: 17px;
  font-weight: 800;
  color: var(--text-primary);
}

.empty-action p {
  margin: 0 auto 24px;
  color: var(--text-tertiary);
  font-size: 15px;
  font-weight: 600;
  text-align: center;
}

.error-line {
  color: #ef4444;
  font-size: 15px;
  font-weight: 900;
  padding: 24px 32px;
  background: rgba(254, 242, 242, 0.8);
  border-radius: 24px;
  backdrop-filter: blur(24px);
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 8px 32px rgba(239, 68, 68, 0.1);
}

.error-line-inline {
  margin-top: 24px;
  padding: 20px 32px;
  border: 1px solid rgba(239, 68, 68, 0.15);
  border-radius: 20px;
  background: rgba(254, 242, 242, 0.8);
  backdrop-filter: blur(16px);
  color: #ef4444;
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 12px;
}

.qr-line {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.qr-line a {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 14px;
  color: #10b981;
  word-break: break-all;
  text-decoration: none;
  font-weight: 800;
}

.qr-line a:hover {
  text-decoration: underline;
}

.table-container {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 20px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.2);
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  padding: 20px 24px;
  text-align: left;
  background: rgba(0, 0, 0, 0.02);
  color: var(--text-tertiary);
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

td {
  padding: 20px 24px;
  border-top: 1px solid rgba(229, 231, 235, 0.4);
  font-size: 14px;
  color: var(--text-secondary);
}

tr:hover td {
  background: rgba(255, 255, 255, 0.4);
}

td strong {
  color: var(--text-primary);
  font-weight: 800;
}

code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}

.type-pill {
  display: inline-block;
  padding: 2px 10px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 6px;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.result-pre {
  margin-top: 24px;
  padding: 32px;
  background: #1e293b;
  color: #e2e8f0;
  border-radius: 24px;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  overflow: auto;
  line-height: 1.8;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
</style>