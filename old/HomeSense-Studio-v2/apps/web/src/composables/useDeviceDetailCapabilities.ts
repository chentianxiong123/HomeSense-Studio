import { computed, ref, type Ref } from 'vue'
import { api, type UserDevice } from '@/api'
import type { DeviceCapability, DeviceExecutionHistoryEntry, DeviceIrKey, DeviceIrRemoteProfile } from '@/types/deviceCapabilities'
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

  function miDidOf(device: UserDevice | null): string {
    return options.propString(device, 'mi_did')
  }

  function adbIpOf(device: UserDevice | null): string {
    return options.propString(device, 'adb_ip')
  }

  function miNameFor(did: string): string {
    return did || ''
  }

  function hydrateIrRemoteProfile(): void {
    const profile = readIrRemoteProfile(options.device.value?.props?.ir_remote_profile)
    irKeys.value = profile?.keys ?? []
    irControllerName.value = profile?.name ?? ''
  }

  async function refreshCapabilities(refresh = true): Promise<void> {
    if (!options.device.value) return
    capsLoading.value = true
    capsError.value = ''
    try {
      const resp = await api.userDevices.capabilities(options.device.value.id, refresh)
      if (resp.status === 'success' && resp.data?.capabilities) {
        capabilities.value = resp.data.capabilities
        const newProps = { ...options.device.value.props, capabilities: resp.data.capabilities }
        options.device.value = { ...options.device.value, props: newProps }
      } else if (resp.status === 'error') {
        capsError.value = resp.message || resp.error || options.label('能力读取失败', 'Failed to load capabilities')
      } else if (!capsError.value) {
        capabilities.value = []
      }
    } catch (e) {
      capsError.value = (e as Error).message || String(e)
    } finally {
      capsLoading.value = false
    }
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

  async function loadIrKeys(refresh = false) {
    irKeysLoading.value = true
    try {
      if (!miDidOf(options.device.value)) {
        irKeys.value = []
        return
      }
      const resp = await api.userDevices.irKeys(options.deviceId, refresh)
      if (resp.status === 'success' && resp.data) {
        irKeys.value = normalizeIrKeys(resp.data.keys ?? [])
        irControllerName.value = resp.data.name
        const currentDevice = options.device.value
        if (currentDevice) {
          const newProps = { ...currentDevice.props, ir_remote_profile: { ...resp.data, keys: irKeys.value } }
          options.device.value = { ...currentDevice, props: newProps }
        }
      } else {
        hydrateIrRemoteProfile()
      }
    } catch {
      hydrateIrRemoteProfile()
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
      const resp = await api.userDevices.irPress(options.deviceId, keyId)
      if (resp.status === 'success') {
        execResult.value = options.label('按键已发送', 'Key sent')
        loadHistory()
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
      const capabilityId = cap.capability_id ?? ''
      if (!capabilityId && !cap.name) {
        execError.value = options.label('无法识别的能力', 'Unrecognized capability')
        return
      }
      const argumentsPayload = buildCliParams(cap, params)
      const resp = await api.userDevices.executeCapability(options.deviceId, {
        capability_id: capabilityId,
        capability: cap.name,
        params: params || '',
        arguments: argumentsPayload,
      })
      if (resp.status === 'success') {
        execResult.value = options.label('已发送: ', 'Sent: ') + cap.name
        textInputs.value[cap.name] = ''
      } else {
        execError.value = resp.message || resp.error || options.label('执行失败', 'Execution failed')
      }
      loadHistory()
    } catch (e) {
      execError.value = (e as Error).message || String(e)
      loadHistory()
    } finally {
      executingCap.value = ''
    }
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

  function readIrRemoteProfile(value: unknown): DeviceIrRemoteProfile | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const profile = value as Partial<DeviceIrRemoteProfile>
    if (!Array.isArray(profile.keys)) return null
    return { ...profile, keys: normalizeIrKeys(profile.keys) }
  }

  function normalizeIrKeys(keys: unknown[]): DeviceIrKey[] {
    return keys
      .filter((key): key is Record<string, unknown> => Boolean(key) && typeof key === 'object' && !Array.isArray(key))
      .map((key) => ({
        key_id: String(key.key_id ?? ''),
        name: String(key.name ?? ''),
        raw_name: typeof key.raw_name === 'string' ? key.raw_name : undefined,
        type: typeof key.type === 'string' ? key.type : undefined,
        normalized: typeof key.normalized === 'string' ? key.normalized : undefined,
        zone: typeof key.zone === 'string' ? key.zone : undefined,
        position: typeof key.position === 'string' ? key.position : undefined,
      }))
      .filter((key) => key.key_id && key.name)
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
    miActionCaps,
    miPropertyCaps,
    adbCaps,
    isIrDevice,
    isAdbDevice,
    miDidOf,
    adbIpOf,
    miNameFor,
    hydrateIrRemoteProfile,
    refreshCapabilities,
    loadHistory,
    loadIrKeys,
    executeIrKey,
    executeCapability,
    setTextInput,
  }
}
