<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLocale } from '@/composables/useLocale'

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

const API = ''

// Login state
const username = ref('')
const password = ref('')
const loginStatus = ref('')
const userId = ref('')
const loggedIn = ref(false)
const loginLoading = ref(false)
const loginError = ref('')

// Verify state
const needVerify = ref(false)
const verifyUrl = ref('')
const ticket = ref('')
const verifyLoading = ref(false)
const verifyError = ref('')

// Auto-poll status on mount
checkStatus()

async function doLogin() {
  if (!username.value || !password.value) {
    loginError.value = '请输入用户名和密码'
    return
  }
  loginLoading.value = true
  loginError.value = ''
  loginStatus.value = ''
  needVerify.value = false
  verifyError.value = ''
  try {
    const r = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: password.value }),
    })
    const j = await r.json()
    if (j.status === 'success' && j.data) {
      loggedIn.value = Boolean(j.data.logged_in)
      userId.value = j.data.user_id || ''
      loginStatus.value = j.data.message || ''
      if (loggedIn.value) {
        password.value = ''
        needVerify.value = false
      }
    } else if (j.error === 'NEED_VERIFY') {
      needVerify.value = true
      verifyUrl.value = j.data?.verify_url || ''
      loginError.value = ''
      loginStatus.value = '需要身份验证，请查看手机短信或邮箱获取验证码'
    } else {
      loginError.value = j.message || j.error || '登录失败'
      loginStatus.value = ''
    }
  } catch (e: any) {
    loginError.value = e.message
  } finally {
    loginLoading.value = false
  }
}

async function doVerify() {
  if (!ticket.value) {
    verifyError.value = '请输入验证码'
    return
  }
  verifyLoading.value = true
  verifyError.value = ''
  try {
    const r = await fetch(`${API}/api/auth/verify-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticket: ticket.value,
        username: username.value,
        password: password.value,
      }),
    })
    const j = await r.json()
    if (j.status === 'success' && j.data) {
      loggedIn.value = Boolean(j.data.logged_in)
      userId.value = j.data.user_id || ''
      loginStatus.value = j.data.message || ''
      needVerify.value = false
      if (loggedIn.value) password.value = ''
    } else {
      verifyError.value = j.message || j.error || '验证失败'
    }
  } catch (e: any) {
    verifyError.value = e.message
  } finally {
    verifyLoading.value = false
  }
}

async function checkStatus() {
  try {
    const r = await fetch(`${API}/api/auth/status`)
    const j = await r.json()
    if (j.status === 'success' && j.data) {
      loggedIn.value = Boolean(j.data.logged_in)
      userId.value = j.data.user_id || ''
      loginStatus.value = j.data.message || (loggedIn.value ? '已登录' : '未登录')
    }
  } catch {
    // ignore
  }
}

async function doLogout() {
  loginLoading.value = true
  try {
    await fetch(`${API}/api/auth/logout`, { method: 'POST' })
    loggedIn.value = false
    userId.value = ''
    loginStatus.value = '已退出登录'
    username.value = ''
    password.value = ''
    needVerify.value = false
    ticket.value = ''
  } catch (e: any) {
    loginError.value = e.message
  } finally {
    loginLoading.value = false
  }
}

// Device discovery
const devices = ref<any[]>([])
const discoverLoading = ref(false)
const discoverError = ref('')

async function doDiscover() {
  discoverLoading.value = true
  discoverError.value = ''
  try {
    const r = await fetch(`${API}/api/devices/discover`, { method: 'POST' })
    const j = await r.json()
    if (j.status === 'success' && j.data) {
      devices.value = j.data.devices || j.data || []
    } else if (j.devices) {
      devices.value = j.devices
    } else {
      discoverError.value = j.error || j.message || '发现失败'
    }
  } catch (e: any) {
    discoverError.value = e.message
  } finally {
    discoverLoading.value = false
  }
}
</script>

<template>
  <div class="test-page">
    <section class="page-head">
      <div>
        <span class="eyebrow">{{ label('调试终端', 'Debug Terminal') }}</span>
        <h1>{{ label('米家登录 & 设备发现', 'Mi Home Auth & Discovery') }}</h1>
        <p>{{ label('测试环境下的米家账户授权流程与设备列表拉取，用于诊断集成状态。', 'Verify Mi Home account authorization and device fetching in test environment.') }}</p>
      </div>
      <div class="actions">
        <button v-if="loggedIn" @click="doLogout" :disabled="loginLoading">{{ label('退出登录', 'Logout') }}</button>
        <button v-if="loggedIn" class="primary" @click="doDiscover" :disabled="discoverLoading">{{ label('发现设备', 'Discover') }}</button>
      </div>
    </section>

    <!-- Step 1: Login -->
    <section class="section-card">
      <div class="section-head">
        <h3>{{ label('第1步：账户授权', 'Step 1: Account Auth') }}</h3>
        <span v-if="loggedIn" class="status-chip success">{{ label('已登录', 'Logged In') }}</span>
        <span v-else-if="needVerify" class="status-chip warning">{{ label('待验证', 'Verify Required') }}</span>
        <span v-else class="status-chip">{{ label('未登录', 'Not Logged In') }}</span>
      </div>

      <template v-if="!loggedIn">
        <template v-if="!needVerify">
          <div class="form-grid">
            <div class="input-group">
              <label>{{ label('账号', 'Account') }}</label>
              <input v-model="username" type="text" :placeholder="label('小米账号 / 手机号 / 邮箱', 'Mi Account / Phone / Email')" />
            </div>
            <div class="input-group">
              <label>{{ label('密码', 'Password') }}</label>
              <input v-model="password" type="password" :placeholder="label('密码', 'Password')" @keyup.enter="doLogin" />
            </div>
          </div>
          <div class="btn-row">
            <button class="primary large" @click="doLogin" :disabled="loginLoading">
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
            <div class="input-group">
              <label>{{ label('验证码 (OTP)', 'One-Time Password') }}</label>
              <input v-model="ticket" type="text" :placeholder="label('输入验证码', 'Enter code')" @keyup.enter="doVerify" />
            </div>
          </div>
          <div class="btn-row">
            <button class="primary large" @click="doVerify" :disabled="verifyLoading">
              {{ verifyLoading ? label('验证中...', 'Verifying...') : label('提交验证码', 'Submit Code') }}
            </button>
            <button @click="needVerify = false; ticket = ''">{{ label('返回', 'Back') }}</button>
          </div>
        </template>
      </template>
      <div v-else class="meta-grid">
        <div><label>{{ label('用户 ID', 'User ID') }}</label><span>{{ userId || '-' }}</span></div>
        <div><label>{{ label('登录状态', 'Status') }}</label><span>{{ loginStatus || label('在线', 'Online') }}</span></div>
      </div>

      <div v-if="loginError || verifyError" class="error-line">{{ loginError || verifyError }}</div>
    </section>

    <!-- Step 2: Discover -->
    <section v-if="loggedIn" class="section-card">
      <div class="section-head">
        <h3>{{ label('第2步：资产扫描', 'Step 2: Asset Scanning') }}</h3>
        <span v-if="devices.length" class="status-chip success">{{ devices.length }} {{ label('个设备', 'Devices') }}</span>
      </div>

      <div v-if="!devices.length" class="empty-action">
        <p>{{ label('点击下方按钮扫描您米家账户下的所有物理设备。', 'Click the button below to scan all physical devices in your Mi Home account.') }}</p>
        <button class="primary large" @click="doDiscover" :disabled="discoverLoading">
          {{ discoverLoading ? label('扫描中...', 'Scanning...') : label('开始扫描设备', 'Start Device Scan') }}
        </button>
      </div>

      <div v-if="discoverError" class="error-line">{{ discoverError }}</div>

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
    <section v-if="devices.length" class="section-card">
      <div class="section-head">
        <h3>{{ label('原始数据', 'Raw Data') }}</h3>
      </div>
      <pre>{{ JSON.stringify(devices, null, 2) }}</pre>
    </section>
  </div>
</template>

<style scoped>
.test-page {
  height: 100%;
  overflow-y: auto;
  padding: 40px;
  background: #f8fafc;
}

.page-head,
.section-card {
  border: 1px solid rgba(229, 231, 235, 0.5);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.03);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.page-head {
  display: flex;
  justify-content: space-between;
  gap: 32px;
  padding: 40px;
  margin-bottom: 32px;
}

.page-head:hover {
  background: rgba(255, 255, 255, 0.8);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.08);
  border-color: rgba(16, 185, 129, 0.25);
  transform: translateY(-4px);
}

.eyebrow {
  display: inline-block;
  color: #10b981;
  font-size: 9px;
  font-weight: 800;
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
  font-weight: 800;
  letter-spacing: -0.04em;
  color: var(--text-primary);
  background: linear-gradient(135deg, #1e293b 0%, #64748b 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

h3 {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--text-tertiary);
  opacity: 0.6;
}

p {
  margin-top: 12px;
  color: var(--text-tertiary);
  font-size: 17px;
  line-height: 1.7;
  font-weight: 600;
  max-width: 800px;
}

.actions {
  display: flex;
  gap: 16px;
  align-items: center;
}

button,
input {
  min-height: 44px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
  padding: 0 24px;
  font-size: 13px;
  font-weight: 800;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
  color: var(--text-primary);
}

button {
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

button:hover:not(:disabled) {
  border-color: #10b981;
  color: #10b981;
  background: #fff;
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.1);
}

button.primary {
  background: #10b981;
  color: #fff;
  border: none;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.25);
}

button.primary:hover:not(:disabled) {
  background: #059669;
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.35);
  color: #fff;
}

button.large {
  padding: 0 40px;
  height: 56px;
  font-size: 15px;
}

.section-card {
  margin-bottom: 32px;
  padding: 40px;
}

.section-card:hover {
  background: rgba(255, 255, 255, 0.8);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.08);
  border-color: rgba(16, 185, 129, 0.25);
  transform: translateY(-4px);
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
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 32px;
}

.form-grid.single {
  grid-template-columns: 1fr;
  max-width: 400px;
}

.input-group label {
  display: block;
  color: var(--text-tertiary);
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  opacity: 0.6;
  margin-bottom: 12px;
  padding-left: 4px;
}

.input-group input {
  width: 100%;
}

.btn-row {
  display: flex;
  gap: 16px;
  align-items: center;
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

.error-line {
  margin-top: 32px;
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

.error-line::before { content: '⚠️'; }

.empty-action {
  text-align: center;
  padding: 40px 0;
}

.empty-action p {
  margin: 0 auto 32px;
}

.table-container {
  margin-top: 32px;
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

pre {
  margin: 0;
  padding: 32px;
  border-radius: 20px;
  background: #1e293b;
  border: 1px solid rgba(255, 255, 255, 0.1);
  overflow: auto;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: #e2e8f0;
  line-height: 1.7;
  max-height: 600px;
}

@media (max-width: 768px) {
  .page-head { flex-direction: column; padding: 24px; }
  .form-grid { grid-template-columns: 1fr; }
  .meta-grid { grid-template-columns: 1fr; }
  .table-container { overflow-x: auto; }
}
</style>

