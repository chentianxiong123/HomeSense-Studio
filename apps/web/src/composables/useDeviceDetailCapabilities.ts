import { computed, ref, type Ref } from 'vue'
import { api, type UserDevice } from '@/api'
import { cliApi } from '@/api/cli'
import type { DeviceCapability, DeviceExecutionHistoryEntry, DeviceIrKey } from '@/types/deviceCapabilities'
import { formatChinaTime } from '@/utils/chinaTime'

type LabelFn = (zh: string, en: string) => string
type PropStringFn = (device: UserDevice | null, key: string) => string

export function useDeviceDetailCapabilities(options: {
  deviceId: number
  device: Ref<UserDevice | null>
  label: LabelFn
  propString: PropStringFn
}) {
  const capabilities = ref<DeviceCapability[]>([])
  const capsLoading = ref(false)
  const capsError = ref('')
  const executingCap = ref('')
  const execResult = ref('')
  const execError = ref('')
  const textInputs = ref<Record<string, string>>({})
  const execHistory = ref<DeviceExecutionHistoryEntry[]>([])
  const irKeys = ref<DeviceIrKey[]>([])
  const irKeysLoading = ref(false)
  const irControllerName = ref('')
  const miNameMap = ref<Record<string, string>>({})

  function miDidOf(device: UserDevice | null): string {
    return options.propString(device, 'mi_did')
  }

  function adbIpOf(device: UserDevice | null): string {
    return options.propString(device, 'adb_ip')
  }

  function deviceTypeOf(device: UserDevice | null): string {
    return options.propString(device, 'device_type') || 'other'
  }

  function miNameFor(did: string): string {
    if (!did) return ''
    return miNameMap.value[did] || did
  }

  async function persistCapabilities(newCaps: unknown[]): Promise<void> {
    if (!options.device.value) return
    const newProps = { ...options.device.value.props, capabilities: newCaps }
    try {
      await api.userDevices.update(options.device.value.id, { props: newProps })
      options.device.value = { ...options.device.value, props: newProps }
    } catch (e) {
      console.error('Failed to persist capabilities snapshot', e)
    }
  }

  async function ensureMiNames(): Promise<void> {
    if (Object.keys(miNameMap.value).length > 0) return
    try {
      const result = await cliApi.run<{ summary: Array<{ did: string; name?: string; model?: string }> }>('mi-cli', {
        action: 'discover',
        params: { summary_only: true },
        ttl_ms: 60_000,
      })
      if (result.status === 'success' && result.data?.summary) {
        const next: Record<string, string> = {}
        for (const item of result.data.summary) {
          if (item.did) next[item.did] = item.name || item.model || item.did
        }
        miNameMap.value = next
      }
    } catch {}
  }

  async function refreshCapabilities(): Promise<void> {
    if (!options.device.value) return
    const collected: DeviceCapability[] = []
    const miDid = miDidOf(options.device.value)
    if (miDid) {
      const resp = await cliApi.run<{ capabilities: DeviceCapability[] }>('mi-cli', {
        action: 'device_capabilities',
        params: { did: miDid },
        ttl_ms: 60_000,
      })
      if (resp.status === 'success' && resp.data?.capabilities) {
        for (const cap of resp.data.capabilities) collected.push({ ...cap, source: 'mi' })
      }
    }
    const adbIp = adbIpOf(options.device.value)
    if (adbIp) {
      const resp = await cliApi.run<{ capabilities: DeviceCapability[] }>('adb-cli', {
        action: 'capabilities',
        params: { device_type: deviceTypeOf(options.device.value) },
        ttl_ms: 60_000,
      })
      if (resp.status === 'success' && resp.data?.capabilities) {
        for (const cap of resp.data.capabilities) collected.push(cap)
      }
    }
    if (collected.length === 0) return
    capabilities.value = collected
    await persistCapabilities(collected)
  }

  async function loadHistory() {
    try {
      const result = await api.userDevices.capabilityHistory(options.deviceId)
      if (result.history) {
        execHistory.value = result.history.map((entry: { time: string; deviceId: string; capability: string; params: string; status: string; result?: string }) => ({
          capability: entry.capability,
          params: entry.params,
          result: entry.status === 'ok' ? (entry.result || options.label('成功', 'Success')) : options.label('失败: ', 'Failed: ') + entry.status,
          time: formatChinaTime(entry.time),
        })).reverse()
      }
    } catch {
      // silent
    }
  }

  async function loadIrKeys() {
    irKeysLoading.value = true
    try {
      const miDid = miDidOf(options.device.value)
      if (!miDid) {
        irKeys.value = []
        return
      }
      const resp = await cliApi.run<{ keys: Array<{ key_id: string | number; name: string; type?: string }>; name: string }>('mi-cli', {
        action: 'device_ir_keys',
        params: { did: miDid },
        ttl_ms: 60_000,
      })
      if (resp.status === 'success' && resp.data) {
        irKeys.value = (resp.data.keys ?? []).map((key) => ({
          key_id: String(key.key_id),
          name: key.name,
          type: key.type,
        }))
        irControllerName.value = resp.data.name
      } else {
        irKeys.value = []
      }
    } catch {
      irKeys.value = []
    } finally {
      irKeysLoading.value = false
    }
  }

  async function executeIrKey(keyId: string) {
    if (executingCap.value) return
    executingCap.value = 'ir_press'
    execResult.value = ''
    execError.value = ''
    try {
      const miDid = miDidOf(options.device.value)
      const resp = await cliApi.run('mi-cli', {
        action: 'device_ir_press',
        params: { did: miDid, key_id: keyId },
        ttl_ms: 0,
        bypass_cache: true,
      })
      if (resp.status === 'success') {
        execResult.value = options.label('按键已发送', 'Key sent')
        logUsage('mi', 'ir_press', keyId, 'ok')
      } else {
        execError.value = resp.message || resp.error || options.label('发送失败', 'Failed')
      }
    } catch (e) {
      execError.value = (e as Error).message || String(e)
    } finally {
      executingCap.value = ''
    }
  }

  async function executeCapability(cap: DeviceCapability) {
    if (executingCap.value) return
    const params = textInputs.value[cap.name]
    if (cap.type === 'string' && !params && cap.name !== '播放音乐' && cap.name !== 'Play Music') {
      execError.value = options.label('请输入文本', 'Please enter text')
      return
    }
    executingCap.value = cap.name
    execResult.value = ''
    execError.value = ''
    try {
      const source = cap.source ?? 'mi'
      const cli = source === 'adb' ? 'adb-cli' : 'mi-cli'
      const action = resolveAdbAction(cap) ?? resolveMiAction(cap) ?? ''
      if (!action) {
        execError.value = options.label('无法识别的能力', 'Unrecognized capability')
        return
      }
      const cliParams = buildCliParams(cap, params)
      const resp = await cliApi.run(cli, {
        action,
        params: cliParams,
        ttl_ms: 0,
        bypass_cache: true,
      })
      if (resp.status === 'success') {
        execResult.value = options.label('已发送: ', 'Sent: ') + cap.name
        textInputs.value[cap.name] = ''
      } else {
        execError.value = resp.message || resp.error || options.label('执行失败', 'Execution failed')
      }
      logUsage(source, action, params || '', resp.status === 'success' ? 'ok' : (resp.error || 'error'))
      loadHistory()
    } catch (e) {
      execError.value = (e as Error).message || String(e)
      loadHistory()
    } finally {
      executingCap.value = ''
    }
  }

  function resolveAdbAction(cap: DeviceCapability): string | null {
    return typeof cap.capability_id === 'string' && cap.capability_id.startsWith('adb.')
      ? cap.capability_id.slice(4)
      : null
  }

  function resolveMiAction(cap: DeviceCapability): string | null {
    if (typeof cap.capability_id === 'string' && cap.capability_id.startsWith('mi.')) {
      return cap.capability_id.slice(3)
    }
    return null
  }

  function buildCliParams(cap: DeviceCapability, rawValue?: string): Record<string, unknown> {
    const text = rawValue?.trim()
    if (!text) return {}
    const properties = readSchemaProperties(cap.input_schema)
    if (properties.package) return { package: text }
    if (properties.index || (properties.index && properties.text)) {
      if (text.startsWith('index:')) return { index: Number(text.slice(6).trim()) }
      const index = Number(text)
      return Number.isFinite(index) ? { index } : { text }
    }
    if (properties.x && properties.y) {
      const [x, y] = text.split(',').map((item) => Number(item.trim()))
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { value: text }
    }
    if (properties.start_x && properties.start_y && properties.end_x && properties.end_y) {
      const [start_x, start_y, end_x, end_y, duration] = text.split(',').map((item) => Number(item.trim()))
      if ([start_x, start_y, end_x, end_y].every(Number.isFinite)) {
        return {
          start_x,
          start_y,
          end_x,
          end_y,
          ...(Number.isFinite(duration) ? { duration } : {}),
        }
      }
      return { value: text }
    }
    if (properties.text) return { text }
    if (properties.value) return { value: coerceCapabilityValue(text) }
    if (cap.capability_id === 'mi.ir_key' || cap.name === '遥控按键') return { key_id: text }
    return { value: coerceCapabilityValue(text) }
  }

  function logUsage(source: string, capability: string, params: string, status: string): void {
    fetch('/api/command/usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: options.deviceId, source, capability, params, status }),
    }).catch(() => {})
  }

  function readSchemaProperties(schema: Record<string, unknown> | undefined): Record<string, unknown> {
    const properties = schema?.properties
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {}
    return properties as Record<string, unknown>
  }

  function coerceCapabilityValue(value: string): unknown {
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
    if (value === 'true') return true
    if (value === 'false') return false
    return value
  }

  const miActionCaps = computed(() => capabilities.value.filter(cap => cap.source === 'mi' && cap.kind === 'action' && cap.name !== '遥控按键' && cap.name !== 'Remote Keys'))
  const miPropertyCaps = computed(() => capabilities.value.filter(cap => cap.source === 'mi' && cap.kind === 'property'))
  const adbCaps = computed(() => capabilities.value.filter(cap => cap.source === 'adb'))
  const isIrDevice = computed(() => capabilities.value.some(cap => cap.name === '遥控按键' || cap.name === 'Remote Keys'))
  const isAdbDevice = computed(() => capabilities.value.some(cap => cap.source === 'adb'))

  function setTextInput(capabilityName: string, value: string): void {
    textInputs.value = { ...textInputs.value, [capabilityName]: value }
  }

  return {
    capabilities,
    capsLoading,
    capsError,
    executingCap,
    execResult,
    execError,
    textInputs,
    execHistory,
    irKeys,
    irKeysLoading,
    irControllerName,
    miActionCaps,
    miPropertyCaps,
    adbCaps,
    isIrDevice,
    isAdbDevice,
    miDidOf,
    adbIpOf,
    miNameFor,
    ensureMiNames,
    refreshCapabilities,
    loadHistory,
    loadIrKeys,
    executeIrKey,
    executeCapability,
    setTextInput,
  }
}
