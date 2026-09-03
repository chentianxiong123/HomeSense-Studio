<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, type AuthStatus, type DiscoverResult } from '@/api'
import { useLocale } from '@/composables/useLocale'

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

const loading = ref('')
const errorMessage = ref('')
const auth = ref<AuthStatus | null>(null)
const diagnostics = ref<Record<string, unknown> | null>(null)
const discoverResult = ref<DiscoverResult | null>(null)
const scenesResult = ref<Record<string, unknown> | null>(null)
const speakersResult = ref<Record<string, unknown> | null>(null)
const irControllersResult = ref<Record<string, unknown> | null>(null)
const irKeysResult = ref<Record<string, unknown> | null>(null)
const sceneExecuteResult = ref<Record<string, unknown> | null>(null)
const rawResult = ref<Record<string, unknown> | null>(null)

const sceneName = ref('')
const sceneId = ref('')
const homeId = ref('')
const parentDid = ref('')
const controllerId = ref('')

const authData = computed(() => auth.value?.data)
const loggedIn = computed(() => Boolean(authData.value?.logged_in))
const qrLink = computed(() => authData.value?.qr?.login_url || authData.value?.qr_url || '')
const steps = computed(() => Array.isArray(diagnostics.value?.steps) ? diagnostics.value.steps as Array<Record<string, unknown>> : [])
const scenes = computed(() => Array.isArray(scenesResult.value?.scenes) ? scenesResult.value.scenes as Array<Record<string, unknown>> : [])
const speakers = computed(() => Array.isArray(speakersResult.value?.speakers) ? speakersResult.value.speakers as Array<Record<string, unknown>> : [])
const devices = computed(() => discoverResult.value?.devices ?? [])

onMounted(async () => {
  await refreshStatus()
})

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

function statusText(status?: string) {
  if (status === 'success') return label('成功', 'Success')
  if (status === 'error') return label('失败', 'Failed')
  if (status === 'skipped') return label('跳过', 'Skipped')
  return label('未知', 'Unknown')
}

async function run<T>(key: string, task: () => Promise<T>, assign: (value: T) => void) {
  loading.value = key
  errorMessage.value = ''
  try {
    const result = await task()
    assign(result)
    rawResult.value = result as Record<string, unknown>
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

async function logout() {
  await run('logout', api.auth.logout, (result) => {
    auth.value = result
    diagnostics.value = null
    discoverResult.value = null
    scenesResult.value = null
    speakersResult.value = null
  })
}

async function runDiagnostics() {
  await run('diagnostics', api.devices.diagnostics, (result) => { diagnostics.value = result })
}

async function discoverDevices() {
  await run('discover', api.devices.discover, (result) => { discoverResult.value = result })
}

async function loadScenes() {
  await run('scenes', () => api.devices.scenes(homeId.value.trim() || undefined), (result) => { scenesResult.value = result })
}

async function loadSpeakers() {
  await run('speakers', api.devices.speakers, (result) => { speakersResult.value = result })
}

async function executeScene() {
  const body: { scene_id?: string; scene_name?: string; home_id?: string } = {}
  if (sceneId.value.trim()) body.scene_id = sceneId.value.trim()
  if (sceneName.value.trim()) body.scene_name = sceneName.value.trim()
  if (homeId.value.trim()) body.home_id = homeId.value.trim()
  await run('executeScene', () => api.devices.executeScene(body), (result) => { sceneExecuteResult.value = result })
}

async function loadIrControllers() {
  if (!parentDid.value.trim()) {
    errorMessage.value = label('需要填写红外中枢 parent DID。', 'Parent DID is required.')
    return
  }
  await run('irControllers', () => api.devices.irControllers(parentDid.value.trim()), (result) => { irControllersResult.value = result })
}

async function loadIrKeys() {
  if (!controllerId.value.trim()) {
    errorMessage.value = label('需要填写 controller ID。', 'Controller ID is required.')
    return
  }
  await run('irKeys', () => api.devices.irKeys(controllerId.value.trim()), (result) => { irKeysResult.value = result })
}

function pickScene(scene: Record<string, unknown>) {
  sceneId.value = String(scene.scene_id ?? scene.id ?? '')
  sceneName.value = String(scene.name ?? '')
  homeId.value = String(scene.home_id ?? homeId.value)
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2)
}
</script>

<template>
  <div class="mi-page">
    <section class="mi-header">
      <div>
        <span class="eyebrow">{{ label('米家主线', 'Mi Home Mainline') }}</span>
        <h1>{{ label('Xiaomi 控制台', 'Xiaomi Control Console') }}</h1>
        <p>{{ label('用于实测登录、设备发现、场景、小爱音箱与红外控制路径。', 'A focused surface for auth, discovery, scenes, XiaoAi, and IR checks.') }}</p>
      </div>
      <div class="header-actions">
        <button @click="refreshStatus" :disabled="loading === 'status'">{{ label('刷新状态', 'Refresh') }}</button>
        <button class="primary" @click="runDiagnostics" :disabled="loading === 'diagnostics'">{{ label('运行诊断', 'Diagnostics') }}</button>
      </div>
    </section>

    <section class="status-grid">
      <div class="status-card">
        <label>{{ label('登录', 'Auth') }}</label>
        <strong :class="{ ok: loggedIn }">{{ loggedIn ? label('已登录', 'Logged in') : label('未登录', 'Logged out') }}</strong>
        <span>{{ authData?.message || label('等待检查', 'Waiting for status') }}</span>
      </div>
      <div class="status-card">
        <label>{{ label('用户', 'User') }}</label>
        <strong>{{ authData?.user_id || '-' }}</strong>
        <span>{{ authData?.token_valid ? label('Token 有效', 'Token valid') : label('Token 未确认', 'Token unknown') }}</span>
      </div>
      <div class="status-card">
        <label>{{ label('设备', 'Devices') }}</label>
        <strong>{{ devices.length }}</strong>
        <span>{{ label('本次发现结果', 'Current discovery') }}</span>
      </div>
      <div class="status-card">
        <label>{{ label('场景 / 小爱', 'Scenes / XiaoAi') }}</label>
        <strong>{{ scenes.length }} / {{ speakers.length }}</strong>
        <span>{{ label('当前缓存结果', 'Current cache') }}</span>
      </div>
    </section>

    <section v-if="errorMessage" class="error-line">{{ errorMessage }}</section>

    <section class="mi-layout">
      <main class="main-column">
        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>{{ label('登录状态', 'Auth State') }}</h2>
              <p>{{ label('二维码登录和状态轮询都走 mi-cli。', 'QR login and polling are backed by mi-cli.') }}</p>
            </div>
            <div class="button-row">
              <button @click="prepareLogin" :disabled="loading === 'login'">{{ label('生成二维码', 'Prepare QR') }}</button>
              <button @click="refreshStatus" :disabled="loading === 'status'">{{ label('检查登录', 'Check') }}</button>
              <button @click="logout" :disabled="loading === 'logout'">{{ label('退出', 'Logout') }}</button>
            </div>
          </div>

          <div v-if="qrLink" class="qr-line">
            <span>{{ label('二维码链接', 'QR link') }}</span>
            <a :href="qrLink" target="_blank" rel="noreferrer">{{ qrLink }}</a>
          </div>
          <pre>{{ safeJson(authData) }}</pre>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>{{ label('资产发现', 'Inventory') }}</h2>
              <p>{{ label('发现设备会写入本地 SQLite 设备表。', 'Discovery also persists devices into SQLite.') }}</p>
            </div>
            <div class="button-row">
              <button class="primary" @click="discoverDevices" :disabled="loading === 'discover'">{{ label('发现设备', 'Discover') }}</button>
              <button @click="loadScenes" :disabled="loading === 'scenes'">{{ label('加载场景', 'Scenes') }}</button>
              <button @click="loadSpeakers" :disabled="loading === 'speakers'">{{ label('加载小爱', 'Speakers') }}</button>
            </div>
          </div>

          <div class="input-row">
            <label>{{ label('Home ID', 'Home ID') }}</label>
            <input v-model="homeId" :placeholder="label('可选，用于筛选场景', 'Optional scene filter')" />
          </div>

          <div class="asset-grid">
            <div class="mini-list">
              <h3>{{ label('设备', 'Devices') }}</h3>
              <div v-if="devices.length === 0" class="empty">{{ label('暂无设备结果', 'No device results.') }}</div>
              <button v-for="device in devices.slice(0, 16)" :key="device.did" class="list-item" @click="parentDid = device.did">
                <strong>{{ device.name || device.did }}</strong>
                <span>{{ device.model }} · {{ device.connection_type }}</span>
              </button>
            </div>
            <div class="mini-list">
              <h3>{{ label('场景', 'Scenes') }}</h3>
              <div v-if="scenes.length === 0" class="empty">{{ label('暂无场景结果', 'No scene results.') }}</div>
              <button v-for="scene in scenes.slice(0, 16)" :key="String(scene.scene_id ?? scene.id)" class="list-item" @click="pickScene(scene)">
                <strong>{{ scene.name || scene.scene_id }}</strong>
                <span>{{ scene.home_name || scene.home_id }}</span>
              </button>
            </div>
            <div class="mini-list">
              <h3>{{ label('小爱', 'XiaoAi') }}</h3>
              <div v-if="speakers.length === 0" class="empty">{{ label('暂无小爱音箱结果', 'No XiaoAi speakers.') }}</div>
              <button v-for="speaker in speakers.slice(0, 16)" :key="String(speaker.did)" class="list-item" @click="parentDid = String(speaker.did ?? '')">
                <strong>{{ speaker.name || speaker.did }}</strong>
                <span>{{ speaker.model }} · {{ speaker.room_name || speaker.home_name }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <div>
              <h2>{{ label('实测动作', 'Live Actions') }}</h2>
              <p>{{ label('这里会触发真实米家场景或查询真实红外资源。', 'These controls hit real Mijia scene or IR APIs.') }}</p>
            </div>
          </div>

          <div class="form-grid">
            <div class="input-row">
              <label>{{ label('Scene ID', 'Scene ID') }}</label>
              <input v-model="sceneId" :placeholder="label('优先使用 ID', 'Prefer ID')" />
            </div>
            <div class="input-row">
              <label>{{ label('Scene Name', 'Scene Name') }}</label>
              <input v-model="sceneName" :placeholder="label('或填写精确场景名', 'Or exact scene name')" />
            </div>
            <button class="primary form-button" @click="executeScene" :disabled="loading === 'executeScene'">{{ label('执行场景', 'Execute Scene') }}</button>
          </div>

          <div class="form-grid">
            <div class="input-row">
              <label>{{ label('Parent DID', 'Parent DID') }}</label>
              <input v-model="parentDid" :placeholder="label('小爱红外版或红外中枢 DID', 'XiaoAi IR hub or parent DID')" />
            </div>
            <button class="form-button" @click="loadIrControllers" :disabled="loading === 'irControllers'">{{ label('查红外控制器', 'IR Controllers') }}</button>
            <div class="input-row">
              <label>{{ label('Controller ID', 'Controller ID') }}</label>
              <input v-model="controllerId" :placeholder="label('红外遥控器 ID', 'IR controller ID')" />
            </div>
            <button class="form-button" @click="loadIrKeys" :disabled="loading === 'irKeys'">{{ label('查按键', 'IR Keys') }}</button>
          </div>
        </div>
      </main>

      <aside class="side-column">
        <div class="panel compact">
          <div class="panel-head">
            <div>
              <h2>{{ label('诊断序列', 'Diagnostics') }}</h2>
              <p>{{ label('不执行场景，只检查登录、发现、场景、小爱列表。', 'No scene execution; checks auth, discovery, scenes, and speakers.') }}</p>
            </div>
          </div>
          <div v-if="steps.length === 0" class="empty tall">{{ label('点击运行诊断查看序列。', 'Run diagnostics to inspect the sequence.') }}</div>
          <div v-else class="steps">
            <div v-for="step in steps" :key="String(step.key)" class="step-row">
              <span :class="['dot', String(step.status)]"></span>
              <div>
                <strong>{{ step.label }}</strong>
                <small>{{ statusText(String(step.status)) }} · {{ step.duration_ms }}ms</small>
                <em v-if="step.message">{{ step.message }}</em>
              </div>
            </div>
          </div>
        </div>

        <div class="panel compact">
          <h2>{{ label('最近结果', 'Latest Result') }}</h2>
          <pre>{{ safeJson(rawResult || sceneExecuteResult || irControllersResult || irKeysResult) }}</pre>
        </div>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.mi-page {
  height: 100%;
  overflow: auto;
  padding: 40px;
  background: #f8fafc;
  color: var(--text-primary);
}

.mi-header,
.panel,
.status-card {
  border: 1px solid rgba(229, 231, 235, 0.5);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.03);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.mi-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: 40px;
}

.mi-header:hover {
  background: rgba(255, 255, 255, 0.8);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.08);
  border-color: rgba(16, 185, 129, 0.25);
  transform: translateY(-4px);
}

.eyebrow {
  display: inline-block;
  color: #10b981;
  font-size: 13px;
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
  background: linear-gradient(135deg, #1e293b 0%, #64748b 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

h2 {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin: 0;
}

h3 {
  font-size: 14px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--text-tertiary);
  opacity: 0.6;
  margin: 0;
}

p {
  margin-top: 12px;
  color: var(--text-tertiary);
  font-size: 16px;
  line-height: 1.6;
  font-weight: 600;
}

.header-actions,
.button-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

button {
  min-height: 44px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
  padding: 0 24px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 15px;
  font-weight: 800;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
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
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.35);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 24px;
  margin-top: 32px;
}

.status-card {
  padding: 32px;
}

.status-card:hover {
  transform: translateY(-8px);
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.1);
  border-color: rgba(16, 185, 129, 0.25);
}

.status-card label,
.input-row label {
  display: block;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  opacity: 0.6;
}

.status-card strong {
  display: block;
  margin-top: 16px;
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.status-card strong.ok {
  color: #10b981;
}

.status-card span {
  display: block;
  margin-top: 12px;
  color: var(--text-tertiary);
  font-size: 15px;
  font-weight: 600;
}

.error-line {
  margin-top: 32px;
  padding: 20px 32px;
  border: 1px solid rgba(239, 68, 68, 0.15);
  border-radius: 20px;
  background: rgba(254, 242, 242, 0.8);
  backdrop-filter: blur(16px);
  color: #ef4444;
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 12px;
}

.error-line::before { content: '⚠️'; }

.mi-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
  gap: 32px;
  margin-top: 32px;
}

.main-column,
.side-column {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.panel {
  padding: 40px;
}

.panel.compact {
  padding: 32px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.6);
}

.qr-line {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
  padding: 24px;
  background: rgba(16, 185, 129, 0.05);
  border-radius: 16px;
}

.qr-line span {
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #10b981;
}

.qr-line a {
  color: #10b981;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  text-decoration: none;
  word-break: break-all;
}

.qr-line a:hover { text-decoration: underline; }

pre {
  margin: 0;
  padding: 24px;
  overflow: auto;
  border-radius: 20px;
  background: #1e293b;
  color: #e2e8f0;
  font-size: 15px;
  line-height: 1.7;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.input-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

input {
  height: 44px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 12px;
  padding: 0 20px;
  background: rgba(255, 255, 255, 0.8);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  outline: none;
  transition: all 0.3s;
}

input:focus {
  border-color: #10b981;
  background: #fff;
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.1);
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  margin-top: 24px;
}

.mini-list {
  min-height: 300px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 20px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.3);
}

.mini-list h3 {
  margin-bottom: 16px;
}

.list-item {
  width: 100%;
  height: auto;
  display: block;
  padding: 16px;
  margin-bottom: 12px;
  text-align: left;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(0, 0, 0, 0.03);
  border-radius: 14px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.list-item:hover {
  background: #fff;
  border-color: #10b981;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
}

.list-item strong {
  display: block;
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.list-item span {
  display: block;
  margin-top: 6px;
  color: var(--text-tertiary);
  font-size: 14px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.empty {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 15px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  opacity: 0.5;
  text-align: center;
}

.empty.tall {
  min-height: 320px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  align-items: end;
  margin-bottom: 24px;
}

.form-grid:last-child { margin-bottom: 0; }

.form-button {
  height: 44px;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.step-row {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  padding: 20px;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.4);
  transition: all 0.3s ease;
}

.step-row:hover { background: rgba(255, 255, 255, 0.7); transform: translateX(4px); }

.dot {
  width: 12px;
  height: 12px;
  margin-top: 4px;
  border-radius: 50%;
  background: #cbd5e1;
}

.dot.success { background: #10b981; box-shadow: 0 0 12px rgba(16, 185, 129, 0.4); }
.dot.error { background: #ef4444; box-shadow: 0 0 12px rgba(239, 68, 68, 0.4); }
.dot.skipped { background: #f59e0b; }

.step-row strong {
  display: block;
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
}

.step-row small {
  display: block;
  margin-top: 4px;
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-tertiary);
}

.step-row em {
  display: block;
  margin-top: 8px;
  color: #f59e0b;
  font-size: 16px;
  font-style: normal;
  font-weight: 600;
  line-height: 1.5;
}

@media (max-width: 1600px) {
  .mi-layout { grid-template-columns: 1fr; }
  .side-column { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; }
}

@media (max-width: 1200px) {
  .status-grid { grid-template-columns: repeat(2, 1fr); }
  .asset-grid { grid-template-columns: 1fr; }
  .form-grid { grid-template-columns: 1fr; }
  .side-column { grid-template-columns: 1fr; }
}

@media (max-width: 768px) {
  .mi-header { flex-direction: column; align-items: flex-start; padding: 24px; }
  .status-grid { grid-template-columns: 1fr; }
  .panel { padding: 24px; }
}
</style>
