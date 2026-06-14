import { computed, ref, type Ref } from 'vue'
import { cliApi } from '@/api/cli'

type LabelFn = (zh: string, en: string) => string

type AdbApp = { package: string; name: string }
type AdbScreenshot = { base64?: string; mime?: string; width?: number; height?: number; size_bytes?: number }
type AdbUiNode = { index: number; text: string; bounds?: number[]; center?: number[]; clickable?: boolean; resource_id?: string; class_name?: string }
type CurrentApp = { current_app?: string; activity?: string; raw_line?: string }
type DeviceOverview = {
  name?: string
  manufacturer?: string
  brand?: string
  model?: string
  android_version?: string
  sdk_version?: string
  serialno?: string
  abi?: string
  screen?: { resolution?: string; density?: string }
  memory?: { total?: number; used?: number; available?: number }
  storage?: { total?: number; used?: number; available?: number }
  battery?: { level?: number; temperature_c?: number; voltage_mv?: number; status?: string }
  network?: { ip?: string; mac?: string }
  current_app?: CurrentApp | null
}

export function useAdbDeviceActions(options: {
  adbIp: () => string
  label: LabelFn
  statusMessage: Ref<string>
  errorMessage: Ref<string>
}) {
  const busy = ref('')
  const apps = ref<AdbApp[]>([])
  const appsLoaded = ref(false)
  const appSearch = ref('')
  const textInput = ref('')
  const tapInput = ref('')
  const screenshotLoading = ref(false)
  const screenshot = ref<AdbScreenshot | null>(null)
  const uiTree = ref<AdbUiNode[]>([])
  const currentApp = ref<CurrentApp | null>(null)
  const overviewLoading = ref(false)
  const overview = ref<DeviceOverview | null>(null)

  const filteredApps = computed(() => {
    const q = appSearch.value.trim().toLowerCase()
    if (!q) return apps.value
    return apps.value.filter((app) => app.name.toLowerCase().includes(q) || app.package.toLowerCase().includes(q))
  })

  const screenshotSrc = computed(() => {
    if (!screenshot.value?.base64) return ''
    return `data:${screenshot.value.mime || 'image/jpeg'};base64,${screenshot.value.base64}`
  })

  function setBusy(key: string, value: boolean) {
    busy.value = value ? key : ''
  }

  function params(extra: Record<string, unknown> = {}) {
    return { device: options.adbIp(), ...extra }
  }

  async function runAdb<T>(key: string, action: string, extra: Record<string, unknown> = {}, success?: string): Promise<T | null> {
    if (busy.value) return null
    setBusy(key, true)
    options.statusMessage.value = ''
    options.errorMessage.value = ''
    try {
      const result = await cliApi.run<T>('adb-cli', {
        action,
        params: params(extra),
        ttl_ms: 0,
        bypass_cache: true,
      })
      if (result.status === 'success') {
        options.statusMessage.value = success || options.label('命令已执行', 'Command executed')
        return result.data ?? null
      }
      options.errorMessage.value = result.message || result.error || options.label('执行失败', 'Execution failed')
      return null
    } catch (e) {
      options.errorMessage.value = (e as Error).message || String(e)
      return null
    } finally {
      setBusy(key, false)
    }
  }

  async function ensureConnected() {
    await runAdb('connect', 'ensure_connected', {}, options.label('ADB 连接可用', 'ADB connection is ready'))
  }

  async function loadOverview(refresh = false) {
    if (overviewLoading.value) return
    overviewLoading.value = true
    if (refresh) {
      options.statusMessage.value = ''
      options.errorMessage.value = ''
    }
    try {
      const result = await cliApi.run<DeviceOverview | null>('adb-cli', {
        action: 'overview',
        params: params(),
        ttl_ms: refresh ? 0 : 30_000,
        bypass_cache: refresh,
      })
      if (result.status !== 'success') {
        if (refresh) options.errorMessage.value = result.message || result.error || options.label('设备概览读取失败', 'Failed to load device overview')
        return
      }
      overview.value = result.data ?? null
      currentApp.value = overview.value?.current_app ?? null
      if (refresh) options.statusMessage.value = options.label('设备概览已刷新', 'Device overview refreshed')
    } catch (e) {
      if (refresh) options.errorMessage.value = (e as Error).message || String(e)
    } finally {
      overviewLoading.value = false
    }
  }

  async function quickKey(action: string, label: string) {
    await runAdb(`key-${action}`, action, {}, label)
  }

  async function sendText() {
    const text = textInput.value.trim()
    if (!text) return
    const ok = await runAdb('input-text', 'input_text', { text }, options.label('文本已输入', 'Text sent'))
    if (ok !== null) textInput.value = ''
  }

  async function tapPoint() {
    const [x, y] = tapInput.value.split(',').map((item) => Number(item.trim()))
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      options.errorMessage.value = options.label('请输入坐标，例如 540,960', 'Enter coordinates like 540,960')
      return
    }
    const ok = await runAdb('tap', 'tap', { x, y }, options.label('点击已发送', 'Tap sent'))
    if (ok !== null) tapInput.value = ''
  }

  async function refreshScreenshot() {
    if (screenshotLoading.value) return
    screenshotLoading.value = true
    options.statusMessage.value = ''
    options.errorMessage.value = ''
    try {
      const result = await cliApi.run<AdbScreenshot | null>('adb-cli', {
        action: 'screenshot',
        params: params({ include_base64: true }),
        ttl_ms: 0,
        bypass_cache: true,
      })
      if (result.status !== 'success') {
        options.errorMessage.value = result.message || result.error || options.label('截图失败', 'Screenshot failed')
        return
      }
      screenshot.value = result.data ?? null
      options.statusMessage.value = options.label('截图已刷新', 'Screenshot refreshed')
    } catch (e) {
      options.errorMessage.value = (e as Error).message || String(e)
    } finally {
      screenshotLoading.value = false
    }
  }

  async function tapScreenshot(event: MouseEvent) {
    if (!screenshot.value?.width || !screenshot.value?.height) return
    const target = event.currentTarget as HTMLImageElement
    const rect = target.getBoundingClientRect()
    const x = Math.round(((event.clientX - rect.left) / rect.width) * screenshot.value.width)
    const y = Math.round(((event.clientY - rect.top) / rect.height) * screenshot.value.height)
    await runAdb('tap-screenshot', 'tap', { x, y }, options.label('截图点击已发送', 'Screenshot tap sent'))
  }

  async function loadApps(refresh = false) {
    if (busy.value) return
    setBusy('apps', true)
    options.statusMessage.value = ''
    options.errorMessage.value = ''
    try {
      const result = await cliApi.run<{ packages?: string[]; apps?: Array<string | { package: string; name?: string }> }>('adb-cli', {
        action: 'list_packages',
        params: params(),
        ttl_ms: refresh ? 0 : 60_000,
        bypass_cache: refresh,
      })
      if (result.status !== 'success' || !result.data) {
        options.errorMessage.value = result.message || result.error || options.label('应用列表加载失败', 'Failed to load apps')
        return
      }
      const raw = result.data.apps ?? result.data.packages ?? []
      apps.value = raw.map((item) => {
        if (typeof item === 'string') return { package: item, name: item.split('.').pop() || item }
        return { package: item.package, name: item.name || item.package.split('.').pop() || item.package }
      })
      appsLoaded.value = true
      options.statusMessage.value = options.label('应用列表已更新', 'Apps updated')
    } catch (e) {
      options.errorMessage.value = (e as Error).message || String(e)
    } finally {
      setBusy('apps', false)
    }
  }

  async function launchApp(packageName: string) {
    await runAdb(`launch-${packageName}`, 'launch_app', { package: packageName }, options.label('应用已启动', 'App launched'))
  }

  async function refreshCurrentApp() {
    const data = await runAdb<CurrentApp>('current-app', 'current_app', {}, options.label('当前应用已刷新', 'Current app refreshed'))
    if (data) currentApp.value = data
  }

  async function refreshUiTree() {
    const data = await runAdb<{ elements?: AdbUiNode[] }>('ui-tree', 'ui_tree', {}, options.label('界面元素已刷新', 'UI elements refreshed'))
    uiTree.value = data?.elements ?? []
  }

  async function tapElement(index: number) {
    await runAdb(`tap-element-${index}`, 'tap_element', { index }, options.label('元素点击已发送', 'Element tap sent'))
  }

  return {
    busy,
    appsLoaded,
    appSearch,
    textInput,
    tapInput,
    screenshotLoading,
    screenshot,
    screenshotSrc,
    uiTree,
    currentApp,
    overviewLoading,
    overview,
    filteredApps,
    ensureConnected,
    loadOverview,
    quickKey,
    sendText,
    tapPoint,
    refreshScreenshot,
    tapScreenshot,
    loadApps,
    launchApp,
    refreshCurrentApp,
    refreshUiTree,
    tapElement,
  }
}
