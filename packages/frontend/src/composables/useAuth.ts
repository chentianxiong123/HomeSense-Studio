import { ref } from 'vue'
import { api, type AuthStatus } from '../api'

const authStatus = ref<AuthStatus | null>(null)
const loading = ref(false)

export function useAuth() {
  async function checkStatus() {
    loading.value = true
    try {
      authStatus.value = await api.auth.status()
    } finally {
      loading.value = false
    }
    return authStatus.value
  }

  async function startLogin() {
    loading.value = true
    try {
      authStatus.value = await api.auth.login()
    } finally {
      loading.value = false
    }
    return authStatus.value
  }

  async function logout() {
    loading.value = true
    try {
      authStatus.value = await api.auth.logout()
    } finally {
      loading.value = false
    }
    return authStatus.value
  }

  const isLoggedIn = () => authStatus.value?.data?.logged_in === true

  return {
    authStatus,
    loading,
    checkStatus,
    startLogin,
    logout,
    isLoggedIn,
  }
}
