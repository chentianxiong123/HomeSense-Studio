const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  return response.json()
}

export interface SkillRecord {
  name: string
  description: string
  prompt_template: string
  allowed_tools_json: string
  action_schema_json: string
  context_mode: 'inline' | 'fork'
  source: 'builtin' | 'disk' | 'converted'
  skill_root: string
  enabled: boolean
}

export interface SkillSectionRecord {
  id: string
  title: string
  level: number
  body: string
}

export const skillApi = {
  list: () => request<{ skills: SkillRecord[] }>('/api/skills'),
  get: (name: string) => request<{ skill: SkillRecord }>(`/api/skills/${encodeURIComponent(name)}`),
  getFull: (name: string) => request<{ prompt_template: string }>(`/api/skills/${encodeURIComponent(name)}/full`),
  getSections: (name: string) => request<{ sections: SkillSectionRecord[] }>(`/api/skills/${encodeURIComponent(name)}/sections`),
}
