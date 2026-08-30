import { ref } from 'vue'
import { api, type DeviceInfo } from '../api'

const devices = ref<DeviceInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

export function useDevices() {
  async function discover() {
    loading.value = true
    error.value = null
    try {
      const result = await api.devices.discover()
      devices.value = result.devices ?? []
      if (result.error) {
        error.value = result.message || result.error
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
    return devices.value
  }

  async function list() {
    loading.value = true
    error.value = null
    try {
      const result = await api.devices.list()
      devices.value = result.devices ?? []
      if (result.error) {
        error.value = result.message || result.error
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
    return devices.value
  }

  async function control(did: string, body: Record<string, unknown>) {
    return api.devices.control(did, body)
  }

  return {
    devices,
    loading,
    error,
    discover,
    list,
    control,
  }
}
