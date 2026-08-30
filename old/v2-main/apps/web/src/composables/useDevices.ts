import { ref } from 'vue'
import { api, type UserDevice } from '../api'

const devices = ref<UserDevice[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

export function useDevices() {
  async function list() {
    loading.value = true
    error.value = null
    try {
      const result = await api.userDevices.list()
      devices.value = result.devices ?? []
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
    return devices.value
  }

  return {
    devices,
    loading,
    error,
    list,
  }
}
