<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api, type AuthStatus, type DiscoverResult } from '@/api'
import { useLocale } from '@/composables/useLocale'

type Manifest = Awaited<ReturnType<typeof api.manifests.list>>['manifests'][number]
type Kind = Manifest['kind']

interface DiagnosticsStep {
  key: string
  label: string
  status: 'success' | 'error' | 'skipped' | string
  duration_ms: number
  message?: string
}

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

const manifests = ref<Manifest[]>([])
const manifestSummary = ref<Awaited<ReturnType<typeof api.manifests.list>>['summary'] | null>(null)
const manifestLoading = ref(false)
const manifestError = ref('')
const selectedId = ref('cli.mi-cli')
const kindFilter = ref<Kind | 'all'>('all')
const search = ref('')
const invokeBodyText = ref('{}')
const invokeResult = ref<unknown>(null)
const invokeError = ref('')
const invokeBusy = ref(false)

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
const rawResult = ref<unknown>(null)

const sceneName = ref('')
const sceneId = ref('')
const homeId = ref('')
const parentDid = ref('')
const controllerId = ref('')
const adbKeyword = ref('bilibili')
const adbPackage = ref('com.xiaodianshi.tv.yst')
const adbInitialWaitSeconds = ref(0)
const adbMaxAttempts = ref(3)
const adbBackoffSeconds = ref(1)
const adbWaitSeconds = ref(1)
const adbResult = ref<unknown>(null)
const biliTitle = ref('HomeSense Studio demo')
const biliSourcePath = ref('./exports/homesense-demo.mp4')
const biliDescription = ref('')
const biliTags = ref('HomeSense,AI Agent,Smart Home')
const biliVisibility = ref('private')
const biliDraftStatus = ref('')
const biliDraftId = ref('')
const biliDryRun = ref(true)
const biliResult = ref<unknown>(null)

const KIND_ORDER: Kind[] = ['cli', 'agent', 'a2a', 'service', 'channel']
const KIND_COLORS: Record<Kind, string> = {
  cli: '#0f766e',
  agent: '#1f7a4f',
  a2a: '#2563eb',
  service: '#7c3aed',
  channel: '#b45309',
}
const MAINLINE_CLI_IDS = new Set(['cli.mi-cli', 'cli.adb-cli', 'cli.bilibili-cli'])

const authData = computed(() => auth.value?.data)
const loggedIn = computed(() => Boolean(authData.value?.logged_in))
const qrLink = computed(() => authData.value?.qr?.login_url || authData.value?.qr_url || '')
const steps = computed<DiagnosticsStep[]>(() =>
  Array.isArray(diagnostics.value?.steps)
    ? diagnostics.value.steps as DiagnosticsStep[]
    : [],
)
const scenes = computed(() =>
  Array.isArray(scenesResult.value?.scenes)
    ? scenesResult.value.scenes as Array<Record<string, unknown>>
    : [],
)
const speakers = computed(() =>
  Array.isArray(speakersResult.value?.speakers)
    ? speakersResult.value.speakers as Array<Record<string, unknown>>
    : [],
)
const devices = computed(() => discoverResult.value?.devices ?? [])

const filteredManifests = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return manifests.value.filter((manifest) => {
    if (kindFilter.value !== 'all' && manifest.kind !== kindFilter.value) return false
    if (!keyword) return true
    return [
      manifest.id,
      manifest.display_name,
      manifest.description,
      manifest.kind,
      manifest.transport,
      manifest.protocol,
      ...manifest.capabilities,
      ...manifest.actions.map((action) => action.name),
    ].join(' ').toLowerCase().includes(keyword)
  })
})

const selectedManifest = computed(() =>
  manifests.value.find((manifest) => manifest.id === selectedId.value)
  ?? filteredManifests.value[0]
  ?? manifests.value[0]
  ?? null,
)

const miManifest = computed(() => manifests.value.find((manifest) => manifest.id === 'cli.mi-cli') ?? null)
const isMiCliSelected = computed(() => selectedManifest.value?.id === 'cli.mi-cli')
const isAdbCliSelected = computed(() => selectedManifest.value?.id === 'cli.adb-cli')
const isBilibiliCliSelected = computed(() => selectedManifest.value?.id === 'cli.bilibili-cli')
const isThinCliSelected = computed(() =>
  selectedManifest.value?.kind === 'cli' && !MAINLINE_CLI_IDS.has(selectedManifest.value.id),
)
const cliCount = computed(() => manifestSummary.value?.by_kind?.cli ?? manifests.value.filter((manifest) => manifest.kind === 'cli').length)
const configuredCount = computed(() => manifestSummary.value?.configured ?? manifests.value.filter((manifest) => manifest.configured).length)
const thinExecutorExample = computed(() => JSON.stringify({
  name: 'example-cli',
  executable: './runner.mjs',
  protocol: 'in_process_module',
  cwd: '.',
  args: [],
  timeout_ms: 30000,
  actions: {
    prepare_task: {
      description: 'Prepare a dry-run task.',
      params_schema: {
        title: 'string',
        dry_run: 'boolean?',
        tags: 'string[]?',
      },
    },
  },
}, null, 2))
const thinInvokeExample = computed(() => JSON.stringify({
  action: selectedManifest.value?.kind === 'cli'
    ? selectedManifest.value.actions[0]?.name ?? 'prepare_task'
    : 'prepare_task',
  params: {
    title: 'HomeSense demo task',
    dry_run: true,
  },
}, null, 2))
const thinSkillExample = computed(() => [
  '---',
  'name: example-cli',
  'description: "A manifest-based external CLI integration."',
  '---',
  '',
  '# example-cli',
  '',
  'Use this CLI for structured local automation tasks.',
].join('\n'))

watch(filteredManifests, (items) => {
  if (selectedId.value && items.some((manifest) => manifest.id === selectedId.value)) return
  selectedId.value = items[0]?.id ?? ''
})

watch(selectedManifest, (manifest) => {
  invokeResult.value = null
  invokeError.value = ''
  invokeBodyText.value = manifest ? JSON.stringify(buildSampleBody(manifest), null, 2) : '{}'
})

onMounted(async () => {
  await Promise.all([loadManifests(), refreshStatus()])
})

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

function kindLabel(kind: Kind) {
  const labels: Record<Kind, string> = {
    cli: label('CLI 工具', 'CLI Tools'),
    agent: label('Agent', 'Agents'),
    a2a: label('A2A', 'A2A'),
    service: label('服务', 'Services'),
    channel: label('渠道', 'Channels'),
  }
  return labels[kind]
}

function statusLabel(status: Manifest['status']) {
  if (status === 'ready') return label('就绪', 'Ready')
  if (status === 'dry_run') return label('干跑', 'Dry run')
  if (status === 'planned') return label('规划中', 'Planned')
  return label('禁用', 'Disabled')
}

function statusText(status?: string) {
  if (status === 'success') return label('成功', 'Success')
  if (status === 'error') return label('失败', 'Failed')
  if (status === 'skipped') return label('跳过', 'Skipped')
  return label('未知', 'Unknown')
}

function integrationSubtitle(manifest: Manifest) {
  if (manifest.id === 'cli.mi-cli') return label('米家、小爱、红外和场景控制核心', 'Mi Home, XiaoAi, IR, and scene control core')
  if (manifest.id === 'cli.adb-cli') return label('Android TV / 手机 ADB 操控适配器', 'Android TV / mobile ADB adapter')
  if (manifest.id === 'cli.bilibili-cli') return label('B 站生产力演示 CLI 适配器', 'Bilibili productivity demo CLI')
  if (manifest.kind === 'channel') return label('远程消息入口与通知渠道', 'Remote message and notification channel')
  if (manifest.kind === 'a2a') return label('A2A 多智能体协作入口', 'A2A multi-agent entry')
  return manifest.description
}

function selectManifest(manifest: Manifest) {
  selectedId.value = manifest.id
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

async function loadManifests() {
  manifestLoading.value = true
  manifestError.value = ''
  try {
    const result = await api.manifests.list()
    manifests.value = result.manifests
    manifestSummary.value = result.summary
    selectedId.value = result.manifests.some((manifest) => manifest.id === selectedId.value)
      ? selectedId.value
      : result.manifests[0]?.id ?? ''
  } catch (error) {
    manifestError.value = (error as Error).message || String(error)
  } finally {
    manifestLoading.value = false
  }
}

async function invokeSelectedManifest() {
  if (!selectedManifest.value) return
  invokeBusy.value = true
  invokeError.value = ''
  invokeResult.value = null
  try {
    const body = JSON.parse(invokeBodyText.value) as Record<string, unknown>
    const response = await api.manifests.invoke(selectedManifest.value.id, body)
    if (response.status === 'success') {
      invokeResult.value = response.data
    } else {
      invokeError.value = response.message || response.error || label('调用失败', 'Invoke failed')
    }
  } catch (error) {
    invokeError.value = (error as Error).message || String(error)
  } finally {
    invokeBusy.value = false
  }
}

async function run<T>(key: string, task: () => Promise<T>, assign: (value: T) => void) {
  loading.value = key
  errorMessage.value = ''
  try {
    const result = await task()
    assign(result)
    rawResult.value = result
  } catch (error) {
    errorMessage.value = (error as Error).message || String(error)
  } finally {
    loading.value = ''
  }
}

async function invokeCliPanel(
  key: string,
  manifestId: string,
  action: string,
  params: Record<string, unknown>,
  assign: (value: unknown) => void,
) {
  await run(key, () => api.manifests.invoke(manifestId, { action, params }), (result) => {
    assign(result)
    if (result.status === 'error') {
      errorMessage.value = result.message || result.error || label('调用失败', 'Invoke failed')
    }
  })
}

function optionalText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function splitTags(value: string) {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function applyThinInvokeExample() {
  invokeBodyText.value = thinInvokeExample.value
  invokeResult.value = null
  invokeError.value = ''
}

async function ensureAdbConnected() {
  await invokeCliPanel('adbEnsure', 'cli.adb-cli', 'ensure_connected', {
    initial_wait_seconds: adbInitialWaitSeconds.value,
    max_attempts: adbMaxAttempts.value,
    backoff_seconds: adbBackoffSeconds.value,
  }, (result) => { adbResult.value = result })
}

async function listAdbPackages() {
  await invokeCliPanel('adbPackages', 'cli.adb-cli', 'list_packages', {
    keyword: optionalText(adbKeyword.value),
  }, (result) => { adbResult.value = result })
}

async function launchAdbApp() {
  if (!adbPackage.value.trim()) {
    errorMessage.value = label('需要填写 Android 包名。', 'Android package is required.')
    return
  }
  await invokeCliPanel('adbLaunch', 'cli.adb-cli', 'launch_app', {
    package: adbPackage.value.trim(),
  }, (result) => { adbResult.value = result })
}

async function waitAdbRuntime() {
  await invokeCliPanel('adbWait', 'cli.adb-cli', 'wait', {
    seconds: adbWaitSeconds.value,
  }, (result) => { adbResult.value = result })
}

async function checkBilibiliHealth() {
  await invokeCliPanel('biliHealth', 'cli.bilibili-cli', 'health', {}, (result) => { biliResult.value = result })
}

async function listBilibiliDrafts() {
  await invokeCliPanel('biliDrafts', 'cli.bilibili-cli', 'list_drafts', {
    status: optionalText(biliDraftStatus.value),
  }, (result) => { biliResult.value = result })
}

async function prepareBilibiliUpload() {
  if (!biliTitle.value.trim()) {
    errorMessage.value = label('需要填写视频标题。', 'Video title is required.')
    return
  }
  await invokeCliPanel('biliPrepare', 'cli.bilibili-cli', 'prepare_upload', {
    title: biliTitle.value.trim(),
    source_path: optionalText(biliSourcePath.value),
    description: optionalText(biliDescription.value),
    tags: splitTags(biliTags.value),
    visibility: optionalText(biliVisibility.value),
    dry_run: biliDryRun.value,
  }, (result) => { biliResult.value = result })
}

async function submitBilibiliDraft() {
  if (!biliDraftId.value.trim()) {
    errorMessage.value = label('需要填写草稿 ID。', 'Draft ID is required.')
    return
  }
  await invokeCliPanel('biliSubmit', 'cli.bilibili-cli', 'submit_upload', {
    draft_id: biliDraftId.value.trim(),
    dry_run: biliDryRun.value,
  }, (result) => { biliResult.value = result })
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
  <div class="integrations-page">
    <header class="page-head glass-panel">
      <div class="header-main">
        <span class="eyebrow">{{ label('插件与集成中枢', 'Plugin & Integration Hub') }}</span>
        <h1>{{ label('CLI 与集成管理', 'CLI & Integrations') }}</h1>
        <p>{{ label('扫码登录、CLI 配置、第三方工具、A2A 和渠道接入都放在这里；设备实体统一进入设备管理。', 'QR auth, CLI configuration, third-party tools, A2A, and channels live here; device entities stay in Device Management.') }}</p>
      </div>
      <div class="btn-group">
        <button class="secondary-btn" @click="loadManifests" :disabled="manifestLoading">{{ label('刷新集成', 'Refresh Integrations') }}</button>
        <button class="primary-btn" @click="runDiagnostics" :disabled="loading === 'diagnostics'">{{ label('米家诊断', 'Mi Diagnostics') }}</button>
      </div>
    </header>

    <section class="summary-grid">
      <article class="summary-card glass-card">
        <label class="summary-label">{{ label('集成', 'Integrations') }}</label>
        <strong class="summary-value">{{ manifestSummary?.total ?? manifests.length }}</strong>
      </article>
      <article class="summary-card glass-card">
        <label class="summary-label">{{ label('已配置', 'Configured') }}</label>
        <strong class="summary-value">{{ configuredCount }}</strong>
      </article>
      <article class="summary-card glass-card">
        <label class="summary-label">{{ label('CLI', 'CLI') }}</label>
        <strong class="summary-value">{{ cliCount }}</strong>
      </article>
      <article class="summary-card glass-card">
        <label class="summary-label">{{ label('mi-cli', 'mi-cli') }}</label>
        <strong class="summary-value" :class="{ ok: loggedIn }">
          {{ loggedIn ? label('已登录', 'Logged in') : label('未登录', 'Logged out') }}
        </strong>
      </article>
    </section>

    <section v-if="manifestError || errorMessage" class="error-line">
      {{ manifestError || errorMessage }}
    </section>

    <section class="workspace-grid">
      <aside class="catalog-panel glass-panel custom-scrollbar">
        <header class="catalog-head">
          <div class="search-bar">
            <select v-model="kindFilter" class="styled-select">
              <option value="all">{{ label('全部类型', 'All kinds') }}</option>
              <option v-for="kind in KIND_ORDER" :key="kind" :value="kind">{{ kindLabel(kind) }}</option>
            </select>
            <input v-model="search" class="styled-input" :placeholder="label('搜索集成、action、能力', 'Search integration, action, capability')" />
          </div>
        </header>

        <nav class="kind-tabs">
          <button
            :class="['kind-tab', { active: kindFilter === 'all' }]"
            @click="kindFilter = 'all'"
          >{{ label('全部', 'All') }}</button>
          <button
            v-for="kind in KIND_ORDER"
            :key="kind"
            :class="['kind-tab', { active: kindFilter === kind }]"
            :style="kindFilter === kind ? { background: KIND_COLORS[kind], borderColor: KIND_COLORS[kind], color: '#fff' } : {}"
            @click="kindFilter = kind"
          >{{ kindLabel(kind) }}</button>
        </nav>

        <div v-if="manifestLoading" class="empty">{{ label('加载集成中...', 'Loading integrations...') }}</div>
        <div v-else-if="filteredManifests.length === 0" class="empty">{{ label('暂无匹配集成。', 'No matching integrations.') }}</div>

        <button
          v-for="manifest in filteredManifests"
          :key="manifest.id"
          :class="['integration-item', { active: selectedId === manifest.id }]"
          @click="selectManifest(manifest)"
        >
          <div class="integration-info">
            <strong>{{ manifest.display_name }}</strong>
            <span>{{ integrationSubtitle(manifest) }}</span>
          </div>
          <span class="kind-badge" :style="{ color: KIND_COLORS[manifest.kind], background: KIND_COLORS[manifest.kind] + '15' }">
            {{ kindLabel(manifest.kind) }}
          </span>
        </button>
      </aside>

      <main class="detail-column">
        <section v-if="selectedManifest" class="panel glass-panel">
          <header class="panel-head">
            <div class="panel-title">
              <span class="eyebrow" :style="{ color: KIND_COLORS[selectedManifest.kind], background: KIND_COLORS[selectedManifest.kind] + '15' }">
                {{ kindLabel(selectedManifest.kind) }}
              </span>
              <h2>{{ selectedManifest.display_name }}</h2>
              <p>{{ integrationSubtitle(selectedManifest) }}</p>
            </div>
            <span :class="['status-chip', selectedManifest.status]">{{ statusLabel(selectedManifest.status) }}</span>
          </header>

          <div class="meta-info-grid">
            <article class="meta-item glass-card">
              <label>ID</label>
              <span>{{ selectedManifest.id }}</span>
            </article>
            <article class="meta-item glass-card">
              <label>{{ label('传输', 'Transport') }}</label>
              <span>{{ selectedManifest.transport }}</span>
            </article>
            <article class="meta-item glass-card">
              <label>{{ label('协议', 'Protocol') }}</label>
              <span>{{ selectedManifest.protocol }}</span>
            </article>
            <article class="meta-item glass-card">
              <label>{{ label('超时', 'Timeout') }}</label>
              <span>{{ selectedManifest.timeout_ms ?? '-' }}ms</span>
            </article>
          </div>

          <div class="content-section">
            <div class="section-title">
              <h3>{{ label('动作与能力', 'Actions & Capabilities') }}</h3>
              <span class="eyebrow">{{ selectedManifest.actions.length }} actions</span>
            </div>
            <div class="chip-row">
              <span v-for="capability in selectedManifest.capabilities" :key="capability" class="cap-chip">{{ capability }}</span>
              <span v-if="selectedManifest.capabilities.length === 0" class="muted">{{ label('未声明额外 capability。', 'No extra capabilities declared.') }}</span>
            </div>
            <div class="action-cards">
              <div v-for="action in selectedManifest.actions" :key="action.name" class="action-card glass-card">
                <strong>{{ action.name }}</strong>
                <p>{{ action.description || label('无描述', 'No description') }}</p>
              </div>
            </div>
          </div>

          <div class="content-section">
            <div class="section-title">
              <h3>{{ label('通用调用', 'Generic Invoke') }}</h3>
              <button class="primary-btn" @click="invokeSelectedManifest" :disabled="invokeBusy">
                {{ invokeBusy ? label('调用中', 'Invoking') : label('运行', 'Run') }}
              </button>
            </div>
            <div class="form-box">
              <textarea v-model="invokeBodyText" class="styled-textarea" spellcheck="false" rows="8" />
              <div v-if="invokeError" class="error-line">{{ invokeError }}</div>
              <pre v-if="invokeResult !== null" class="result-pre">{{ safeJson(invokeResult) }}</pre>
            </div>
          </div>
        </section>

        <section v-if="isMiCliSelected" class="panel glass-panel">
          <header class="panel-head">
            <div class="panel-title">
              <h2>{{ label('mi-cli 登录', 'mi-cli Auth') }}</h2>
              <p>{{ label('这里负责米家 App 扫码、登录态检查和退出，不进入设备页。', 'Mi Home QR login, auth polling, and logout live here, not in Devices.') }}</p>
            </div>
            <div class="btn-group">
              <button class="secondary-btn" @click="prepareLogin" :disabled="loading === 'login'">{{ label('生成二维码', 'Prepare QR') }}</button>
              <button class="secondary-btn" @click="refreshStatus" :disabled="loading === 'status'">{{ label('检查登录', 'Check') }}</button>
              <button class="secondary-btn danger" @click="logout" :disabled="loading === 'logout'">{{ label('退出', 'Logout') }}</button>
            </div>
          </header>

          <div v-if="qrLink" class="qr-line glass-card">
            <label class="eyebrow">{{ label('二维码链接', 'QR link') }}</label>
            <a :href="qrLink" target="_blank" rel="noreferrer">{{ qrLink }}</a>
          </div>
          <pre class="result-pre">{{ safeJson(authData) }}</pre>
        </section>

        <section v-if="isMiCliSelected" class="panel glass-panel">
          <header class="panel-head">
            <div class="panel-title">
              <h2>{{ label('米家资源发现', 'Mi Home Inventory') }}</h2>
              <p>{{ label('发现结果会写入本地设备注册表，之后在设备管理里以统一实体查看。', 'Discovery persists into the local device registry for unified inspection in Devices.') }}</p>
            </div>
            <div class="btn-group">
              <button class="primary-btn" @click="discoverDevices" :disabled="loading === 'discover'">{{ label('发现设备', 'Discover') }}</button>
              <button class="secondary-btn" @click="loadScenes" :disabled="loading === 'scenes'">{{ label('加载场景', 'Scenes') }}</button>
              <button class="secondary-btn" @click="loadSpeakers" :disabled="loading === 'speakers'">{{ label('加载小爱', 'Speakers') }}</button>
            </div>
          </header>

          <div class="form-box">
            <div class="input-row narrow">
              <label class="eyebrow">{{ label('Home ID', 'Home ID') }}</label>
              <input v-model="homeId" class="styled-input" :placeholder="label('可选，用于筛选场景', 'Optional scene filter')" />
            </div>
          </div>

          <div class="asset-grid">
            <div class="mini-list glass-card">
              <h3 class="eyebrow">{{ label('设备', 'Devices') }}</h3>
              <div v-if="devices.length === 0" class="empty small">{{ label('暂无设备结果', 'No device results.') }}</div>
              <button v-for="device in devices.slice(0, 12)" :key="device.did" class="list-item" @click="parentDid = device.did">
                <strong>{{ device.name || device.did }}</strong>
                <span>{{ device.model }} · {{ device.connection_type }}</span>
              </button>
            </div>
            <div class="mini-list glass-card">
              <h3 class="eyebrow">{{ label('场景', 'Scenes') }}</h3>
              <div v-if="scenes.length === 0" class="empty small">{{ label('暂无场景结果', 'No scene results.') }}</div>
              <button v-for="scene in scenes.slice(0, 12)" :key="String(scene.scene_id ?? scene.id)" class="list-item" @click="pickScene(scene)">
                <strong>{{ scene.name || scene.scene_id }}</strong>
                <span>{{ scene.home_name || scene.home_id }}</span>
              </button>
            </div>
            <div class="mini-list glass-card">
              <h3 class="eyebrow">{{ label('小爱', 'XiaoAi') }}</h3>
              <div v-if="speakers.length === 0" class="empty small">{{ label('暂无小爱音箱结果', 'No XiaoAi speakers.') }}</div>
              <button v-for="speaker in speakers.slice(0, 12)" :key="String(speaker.did)" class="list-item" @click="parentDid = String(speaker.did ?? '')">
                <strong>{{ speaker.name || speaker.did }}</strong>
                <span>{{ speaker.model }} · {{ speaker.room_name || speaker.home_name }}</span>
              </button>
            </div>
          </div>
        </section>

        <section v-if="isMiCliSelected" class="panel glass-panel">
          <header class="panel-head">
            <div class="panel-title">
              <h2>{{ label('米家实测动作', 'Mi Home Live Actions') }}</h2>
              <p>{{ label('会触发真实场景或查询真实红外资源，适合下一步实测。', 'These controls hit real scenes or real IR resources for upcoming smoke tests.') }}</p>
            </div>
          </header>

          <div class="form-box">
            <div class="form-grid">
              <div class="input-row">
                <label class="eyebrow">{{ label('Scene ID', 'Scene ID') }}</label>
                <input v-model="sceneId" class="styled-input" :placeholder="label('优先使用 ID', 'Prefer ID')" />
              </div>
              <div class="input-row">
                <label class="eyebrow">{{ label('Scene Name', 'Scene Name') }}</label>
                <input v-model="sceneName" class="styled-input" :placeholder="label('或填写精确场景名', 'Or exact scene name')" />
              </div>
              <button class="primary-btn form-button" @click="executeScene" :disabled="loading === 'executeScene'">{{ label('执行场景', 'Execute Scene') }}</button>
            </div>

            <div class="form-grid">
              <div class="input-row">
                <label class="eyebrow">{{ label('Parent DID', 'Parent DID') }}</label>
                <input v-model="parentDid" class="styled-input" :placeholder="label('小爱红外版或红外中枢 DID', 'XiaoAi IR hub or parent DID')" />
              </div>
              <button class="secondary-btn form-button" @click="loadIrControllers" :disabled="loading === 'irControllers'">{{ label('查红外控制器', 'IR Controllers') }}</button>
              <div class="input-row">
                <label class="eyebrow">{{ label('Controller ID', 'Controller ID') }}</label>
                <input v-model="controllerId" class="styled-input" :placeholder="label('红外遥控器 ID', 'IR controller ID')" />
              </div>
              <button class="secondary-btn form-button" @click="loadIrKeys" :disabled="loading === 'irKeys'">{{ label('查按键', 'IR Keys') }}</button>
            </div>
          </div>
        </section>

        <section v-if="isAdbCliSelected" class="panel glass-panel">
          <header class="panel-head">
            <div class="panel-title">
              <h2>{{ label('adb-cli 电视调试', 'adb-cli TV Debug') }}</h2>
              <p>{{ label('内置 ADB 适配器做厚一点，专门服务“打开电视上的 B 站”演示链。', 'The built-in ADB adapter gets a richer panel for the TV Bilibili demo chain.') }}</p>
            </div>
            <div class="btn-group">
              <button class="primary-btn" @click="ensureAdbConnected" :disabled="loading === 'adbEnsure'">{{ label('确保连接', 'Ensure Connected') }}</button>
              <button class="secondary-btn" @click="waitAdbRuntime" :disabled="loading === 'adbWait'">{{ label('等待', 'Wait') }}</button>
            </div>
          </header>

          <div class="form-box">
            <div class="form-grid">
              <div class="input-row">
                <label class="eyebrow">{{ label('初始等待秒数', 'Initial Wait') }}</label>
                <input v-model.number="adbInitialWaitSeconds" class="styled-input" type="number" min="0" />
              </div>
              <div class="input-row">
                <label class="eyebrow">{{ label('最大尝试次数', 'Max Attempts') }}</label>
                <input v-model.number="adbMaxAttempts" class="styled-input" type="number" min="1" />
              </div>
              <div class="input-row">
                <label class="eyebrow">{{ label('退避秒数', 'Backoff Seconds') }}</label>
                <input v-model.number="adbBackoffSeconds" class="styled-input" type="number" min="0" />
              </div>
            </div>

            <div class="form-grid">
              <div class="input-row">
                <label class="eyebrow">{{ label('包名关键词', 'Package Keyword') }}</label>
                <input v-model="adbKeyword" class="styled-input" :placeholder="label('例如 bilibili', 'e.g. bilibili')" />
              </div>
              <button class="secondary-btn form-button" @click="listAdbPackages" :disabled="loading === 'adbPackages'">{{ label('查包名', 'List Packages') }}</button>
              <div class="input-row">
                <label class="eyebrow">{{ label('等待秒数', 'Wait Seconds') }}</label>
                <input v-model.number="adbWaitSeconds" class="styled-input" type="number" min="0" />
              </div>
            </div>

            <div class="form-grid">
              <div class="input-row span-2">
                <label class="eyebrow">{{ label('Android 包名', 'Android Package') }}</label>
                <input v-model="adbPackage" class="styled-input" :placeholder="label('小电视包名', 'Bilibili TV package')" />
              </div>
              <button class="primary-btn form-button" @click="launchAdbApp" :disabled="loading === 'adbLaunch'">{{ label('打开应用', 'Launch App') }}</button>
            </div>
          </div>

          <pre class="result-pre">{{ safeJson(adbResult) }}</pre>
        </section>

        <section v-if="isBilibiliCliSelected" class="panel glass-panel">
          <header class="panel-head">
            <div class="panel-title">
              <h2>{{ label('bilibili-cli 生产力演示', 'bilibili-cli Productivity Demo') }}</h2>
              <p>{{ label('内置 B 站 CLI 做成 dry-run 工作台，用来证明 Workflow 可以包装非家居生产力工具。', 'The built-in Bilibili CLI is a dry-run workbench proving Workflow can wrap non-home productivity tools.') }}</p>
            </div>
            <div class="btn-group">
              <button class="primary-btn" @click="checkBilibiliHealth" :disabled="loading === 'biliHealth'">{{ label('健康检查', 'Health') }}</button>
              <button class="secondary-btn" @click="listBilibiliDrafts" :disabled="loading === 'biliDrafts'">{{ label('列出草稿', 'Drafts') }}</button>
            </div>
          </header>

          <div class="form-box">
            <div class="form-grid">
              <div class="input-row span-2">
                <label class="eyebrow">{{ label('标题', 'Title') }}</label>
                <input v-model="biliTitle" class="styled-input" />
              </div>
              <div class="input-row">
                <label class="eyebrow">{{ label('可见性', 'Visibility') }}</label>
                <select v-model="biliVisibility" class="styled-select">
                  <option value="private">{{ label('私密', 'Private') }}</option>
                  <option value="public">{{ label('公开', 'Public') }}</option>
                </select>
              </div>
            </div>

            <div class="form-grid">
              <div class="input-row">
                <label class="eyebrow">{{ label('源文件路径', 'Source Path') }}</label>
                <input v-model="biliSourcePath" class="styled-input" />
              </div>
              <div class="input-row">
                <label class="eyebrow">{{ label('标签', 'Tags') }}</label>
                <input v-model="biliTags" class="styled-input" :placeholder="label('逗号分隔', 'Comma separated')" />
              </div>
              <label class="check-row">
                <input v-model="biliDryRun" type="checkbox" />
                <span class="eyebrow">{{ label('Dry-run', 'Dry-run') }}</span>
              </label>
            </div>

            <div class="input-row">
              <label class="eyebrow">{{ label('简介', 'Description') }}</label>
              <textarea v-model="biliDescription" class="styled-textarea" rows="4" :placeholder="label('可选', 'Optional')" />
            </div>

            <div class="form-grid">
              <button class="primary-btn form-button" @click="prepareBilibiliUpload" :disabled="loading === 'biliPrepare'">{{ label('准备上传草稿', 'Prepare Draft') }}</button>
              <div class="input-row">
                <label class="eyebrow">{{ label('草稿状态筛选', 'Draft Status') }}</label>
                <input v-model="biliDraftStatus" class="styled-input" :placeholder="label('可选', 'Optional')" />
              </div>
              <div class="input-row">
                <label class="eyebrow">{{ label('草稿 ID', 'Draft ID') }}</label>
                <input v-model="biliDraftId" class="styled-input" :placeholder="label('submit_upload 使用', 'For submit_upload')" />
              </div>
              <button class="secondary-btn form-button" @click="submitBilibiliDraft" :disabled="loading === 'biliSubmit'">{{ label('提交草稿', 'Submit Draft') }}</button>
            </div>
          </div>

          <pre class="result-pre">{{ safeJson(biliResult) }}</pre>
        </section>

        <section v-if="!isMiCliSelected && !isAdbCliSelected && !isBilibiliCliSelected" class="panel glass-panel quiet">
          <div class="panel-title">
            <h2>{{ label('薄接入合同', 'Thin Integration Contract') }}</h2>
            <p>{{ label('陌生 CLI 不做厚控制台，只要求 manifest 化：声明 action、参数 schema、协议、超时和标准 JSON 输出。这样外部能力能快速进入 Studio 与 Workflow，专属厚面板只留给系统内置主线 CLI。', 'Unknown CLIs do not get rich consoles. They only need a manifest with actions, param schemas, protocol, timeout, and standard JSON output. External capabilities can enter Studio and Workflow quickly; rich panels stay reserved for built-in mainline CLIs.') }}</p>
          </div>
        </section>
      </main>

      <aside class="side-column">
        <section class="side-panel glass-panel compact">
          <header class="panel-head">
            <div class="panel-title">
              <h2>{{ label('外部 CLI 接入', 'External CLI Onboarding') }}</h2>
              <p>{{ label('陌生 CLI 走薄合同；主线 CLI 才做厚面板。', 'Unknown CLIs use a thin contract; only mainline CLIs get rich panels.') }}</p>
            </div>
          </header>

          <div class="onboarding-steps">
            <article class="onboarding-step glass-card">
              <strong>{{ label('1. 放入 skills/<name>', '1. Place under skills/<name>') }}</strong>
              <span>{{ label('准备 SKILL.md、EXECUTOR.json 和可执行入口。', 'Prepare SKILL.md, EXECUTOR.json, and an executable entry.') }}</span>
            </article>
            <article class="onboarding-step glass-card">
              <strong>{{ label('2. 声明 action/schema', '2. Declare actions/schema') }}</strong>
              <span>{{ label('参数只用 string、number、boolean、object、array 和数组类型。', 'Use string, number, boolean, object, array, and array primitives.') }}</span>
            </article>
            <article class="onboarding-step glass-card">
              <strong>{{ label('3. 返回标准 JSON', '3. Return standard JSON') }}</strong>
              <span>{{ label('成功返回 status/data，失败返回 status/error/message。', 'Success returns status/data; failure returns status/error/message.') }}</span>
            </article>
          </div>

          <div v-if="isThinCliSelected" class="thin-selected-hint eyebrow">
            {{ label('当前选中的是薄 CLI：使用通用调用和 Workflow 节点，不需要专属控制台。', 'The selected CLI is thin: use generic invoke and Workflow nodes, no dedicated console required.') }}
          </div>

          <div class="guide-block">
            <header class="guide-head">
              <h3 class="eyebrow">EXECUTOR.json</h3>
              <button class="secondary-btn small" @click="applyThinInvokeExample">{{ label('套用调用示例', 'Use Invoke Sample') }}</button>
            </header>
            <pre class="result-pre">{{ thinExecutorExample }}</pre>
          </div>

          <div class="guide-block">
            <h3 class="eyebrow">{{ label('调用体', 'Invoke Body') }}</h3>
            <pre class="result-pre">{{ thinInvokeExample }}</pre>
          </div>

          <div class="guide-block">
            <h3 class="eyebrow">SKILL.md</h3>
            <pre class="result-pre">{{ thinSkillExample }}</pre>
          </div>
        </section>

        <section class="side-panel glass-panel compact">
          <header class="panel-head">
            <div class="panel-title">
              <h2>{{ label('mi-cli 诊断', 'mi-cli Diagnostics') }}</h2>
              <p>{{ label('只检查登录、发现、场景和小爱列表，不执行场景。', 'Checks auth, discovery, scenes, and speakers without executing scenes.') }}</p>
            </div>
          </header>
          <div v-if="steps.length === 0" class="empty-state tall">{{ label('点击米家诊断查看序列。', 'Run Mi diagnostics to inspect the sequence.') }}</div>
          <div v-else class="diagnostics-list">
            <div v-for="step in steps" :key="step.key" class="diagnostic-item glass-card">
              <span :class="['status-dot', String(step.status)]"></span>
              <div class="diag-info">
                <strong>{{ step.label }}</strong>
                <small>{{ statusText(String(step.status)) }} · {{ step.duration_ms }}ms</small>
                <em v-if="step.message">{{ step.message }}</em>
              </div>
            </div>
          </div>
        </section>

        <section class="side-panel glass-panel compact">
          <h2 class="eyebrow">{{ label('最近结果', 'Latest Result') }}</h2>
          <pre class="result-pre">{{ safeJson(rawResult || sceneExecuteResult || irControllersResult || irKeysResult || adbResult || biliResult || miManifest) }}</pre>
        </section>
      </aside>
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

/* Glass Utility Classes */
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

.glass-card:hover {
  background: rgba(255, 255, 255, 0.85);
  transform: translateY(-4px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.08);
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
  font-size: 9px;
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

h2 {
  font-size: 28px;
  font-weight: 900;
  letter-spacing: -0.03em;
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

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
}

.summary-card {
  padding: 40px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.summary-label {
  font-size: 9px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.6;
}

.summary-value {
  font-size: 44px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.05em;
  line-height: 1;
}

.summary-value.ok {
  color: #10b981;
}

.workspace-grid {
  display: grid;
  grid-template-columns: 420px 1fr 460px;
  gap: 32px;
  align-items: start;
}

.catalog-panel {
  padding: 40px;
  max-height: 1200px;
  overflow-y: auto;
  position: sticky;
  top: 40px;
}

.catalog-panel::-webkit-scrollbar {
  width: 6px;
}

.catalog-panel::-webkit-scrollbar-track {
  background: transparent;
}

.catalog-panel::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 10px;
}

.catalog-panel::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.1);
}

.catalog-head {
  margin-bottom: 40px;
}

.search-bar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.styled-select, .styled-input, .styled-textarea {
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

.styled-select:focus, .styled-input:focus, .styled-textarea:focus {
  border-color: #10b981;
  background: #fff;
  box-shadow: 0 8px 24px rgba(16, 185, 129, 0.12);
  transform: translateY(-2px);
}

.kind-tabs {
  display: flex;
  gap: 8px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 18px;
  margin-bottom: 40px;
  flex-wrap: wrap;
}

.kind-tab {
  padding: 10px 18px;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  border-radius: 12px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.kind-tab.active {
  background: #fff;
  color: var(--text-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

.integration-item {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 32px;
  margin-bottom: 12px;
  border-radius: 24px;
  border: 1px solid rgba(0, 0, 0, 0.03);
  background: rgba(255, 255, 255, 0.3);
  text-align: left;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.integration-item:hover {
  background: rgba(255, 255, 255, 0.8);
  transform: translateX(12px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.04);
}

.integration-item.active {
  background: #fff;
  border-color: #10b981;
  box-shadow: 0 16px 48px rgba(16, 185, 129, 0.15);
  transform: translateX(16px);
}

.integration-info strong {
  display: block;
  font-size: 17px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.03em;
}

.integration-info span {
  display: block;
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 8px;
  line-height: 1.6;
  font-weight: 700;
  opacity: 0.8;
}

.kind-badge {
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  padding: 4px 12px;
  border-radius: 99px;
  letter-spacing: 0.08em;
}

.detail-column {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.panel {
  padding: 48px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 48px;
  padding-bottom: 40px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.8);
}

.panel-title h2 {
  margin: 0;
  font-size: 36px;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: var(--text-primary);
  line-height: 1.1;
}

.panel-title p {
  margin-top: 16px;
  font-size: 17px;
  color: var(--text-secondary);
  font-weight: 600;
  line-height: 1.7;
  letter-spacing: -0.01em;
}

.status-chip {
  padding: 6px 18px;
  border-radius: 99px;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.status-chip.ready { background: rgba(16, 185, 129, 0.1); color: #10b981; }
.status-chip.dry_run { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
.status-chip.planned { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
.status-chip.disabled { background: rgba(0, 0, 0, 0.05); color: #64748b; }

.meta-info-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
  margin-bottom: 48px;
}

.meta-item {
  padding: 24px;
}

.meta-item label {
  font-size: 9px;
  font-weight: 900;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  margin-bottom: 14px;
  opacity: 0.6;
}

.meta-item span {
  display: block;
  font-size: 15px;
  font-weight: 900;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.content-section {
  margin-bottom: 48px;
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
}

.section-title h3 {
  margin: 0;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--text-tertiary);
  opacity: 0.6;
}

.action-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
}

.action-card {
  padding: 32px;
}

.action-card strong {
  display: block;
  font-size: 16px;
  font-weight: 900;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: -0.02em;
}

.action-card p {
  margin-top: 12px;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.7;
  font-weight: 600;
}

.form-box {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.styled-textarea {
  min-height: 240px;
  padding: 32px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px;
  line-height: 1.8;
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

.side-column {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.side-panel {
  padding: 40px;
}

.onboarding-steps {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.onboarding-step {
  padding: 32px;
}

.onboarding-step strong {
  display: block;
  font-size: 16px;
  font-weight: 900;
  color: var(--text-primary);
  margin-bottom: 12px;
  letter-spacing: -0.02em;
}

.onboarding-step span {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.7;
  font-weight: 600;
}

.diagnostics-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.diagnostic-item {
  display: flex;
  gap: 20px;
  padding: 24px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 20px;
}

.status-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
  background: #cbd5e1;
}

.status-dot.success { background: #10b981; box-shadow: 0 0 16px rgba(16, 185, 129, 0.5); }
.status-dot.error { background: #ef4444; box-shadow: 0 0 16px rgba(239, 68, 68, 0.5); }
.status-dot.skipped { background: #f59e0b; }

.diag-info strong {
  display: block;
  font-size: 16px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.diag-info small {
  display: block;
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-top: 6px;
  letter-spacing: 0.12em;
  opacity: 0.6;
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

.btn-group {
  display: flex;
  gap: 16px;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  margin-top: 40px;
}

.mini-list {
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 280px;
}

.mini-list h3 {
  margin-bottom: 12px;
}

.list-item {
  width: 100%;
  padding: 20px 24px;
  background: rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 20px;
  text-align: left;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.list-item:hover {
  background: #fff;
  border-color: #10b981;
  transform: translateX(8px);
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.08);
}

.list-item strong {
  display: block;
  font-size: 15px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.list-item span {
  display: block;
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 8px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.8;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
  margin-bottom: 40px;
}

.span-2 {
  grid-column: span 2;
}

.form-button {
  height: 48px;
  width: 100%;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.check-row input {
  width: 20px;
  height: 20px;
  accent-color: #10b981;
}

.thin-selected-hint {
  margin: 32px 0;
  color: var(--text-secondary);
  background: rgba(16, 185, 129, 0.05);
  padding: 16px 20px;
  border-radius: 14px;
  line-height: 1.7;
  font-weight: 600;
}

.guide-block {
  margin-top: 40px;
}

.guide-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.secondary-btn.small {
  height: 36px;
  padding: 0 16px;
  font-size: 10px;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  color: var(--text-tertiary);
  font-weight: 900;
  font-size: 15px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.5;
  text-align: center;
}

.empty-state.tall {
  min-height: 400px;
}

.qr-line {
  margin-bottom: 40px;
  padding: 32px;
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

.error-line {
  color: #ef4444;
  font-size: 15px;
  font-weight: 900;
  margin-bottom: 24px;
  padding: 24px 32px;
  background: rgba(254, 242, 242, 0.8);
  border-radius: 24px;
  backdrop-filter: blur(24px);
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 8px 32px rgba(239, 68, 68, 0.1);
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

.muted {
  font-size: 14px;
  color: var(--text-tertiary);
  font-style: italic;
  opacity: 0.6;
}

.cap-chip {
  display: inline-block;
  font-size: 10px;
  font-weight: 900;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 99px;
  color: var(--text-secondary);
  margin-right: 10px;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: 32px;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.08);
  border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.15);
}

@media (max-width: 1800px) {
  .workspace-grid {
    grid-template-columns: 380px 1fr;
  }
  .side-column {
    grid-column: span 2;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 1440px) {
  .workspace-grid {
    grid-template-columns: 1fr;
  }
  .side-column {
    grid-column: span 1;
    grid-template-columns: 1fr;
  }
  .catalog-panel {
    max-height: auto;
    position: static;
  }
}

@media (max-width: 1024px) {
  .integrations-page { padding: 32px; }
  .summary-grid { grid-template-columns: repeat(2, 1fr); }
  .asset-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 768px) {
  .page-head { flex-direction: column; padding: 32px; align-items: flex-start; }
  .summary-grid { grid-template-columns: 1fr; }
  .asset-grid { grid-template-columns: 1fr; }
  .meta-info-grid { grid-template-columns: repeat(2, 1fr); }
  .action-cards { grid-template-columns: 1fr; }
}
</style>
