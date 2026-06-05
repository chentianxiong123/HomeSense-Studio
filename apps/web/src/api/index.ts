export interface ConnectedService {
  id: string
  name: string
  icon: string
  description: string
  connected: boolean
  meta?: Record<string, string>
}

// Mock data — no database, no real API
const mockServices: ConnectedService[] = [
  {
    id: 'xiaomi',
    name: '小米账号',
    icon: '🏠',
    description: '小米智能家居设备管理、米家账号认证',
    connected: false,
    meta: undefined,
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    icon: '📺',
    description: 'Bilibili 音乐、视频资源接入',
    connected: false,
    meta: undefined,
  },
]

const BASE = '/api'

export const api = {
  async connectedServices(): Promise<ConnectedService[]> {
    const res = await fetch(`${BASE}/connected-services`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async loginService(serviceId: string): Promise<ConnectedService> {
    const res = await fetch(`${BASE}/connected-services/${serviceId}/login`, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },

  async logoutService(serviceId: string): Promise<ConnectedService> {
    const res = await fetch(`${BASE}/connected-services/${serviceId}/logout`, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
}
