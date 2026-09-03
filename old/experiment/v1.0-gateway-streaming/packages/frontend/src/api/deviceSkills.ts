const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  })
  return response.json()
}

export interface DeviceTypeSkillAsset {
  id: string
  asset_type: 'device_skill'
  device_type: 'computer' | 'tv_box' | 'phone' | 'speaker'
  title: string
  summary: string
  status: 'active' | 'draft'
  load_policy: 'on_device_type_match'
  when_to_load: string[]
  preferred_tools: string[]
  common_paths: Array<{ intent: string; steps: string[] }>
  argument_rules: Record<string, string>
  failure_recovery: string[]
}

export const deviceSkillApi = {
  list: () => request<{ skills: DeviceTypeSkillAsset[] }>('/api/assets/device-skills'),
  get: (id: string) => request<{ skill: DeviceTypeSkillAsset }>(`/api/assets/device-skills/${encodeURIComponent(id)}`),
}
