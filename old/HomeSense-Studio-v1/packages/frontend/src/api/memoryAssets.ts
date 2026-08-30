const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  })
  return response.json()
}

export type MemoryAssetKind =
  | 'experience_path'
  | 'user_feedback'
  | 'device_preference'
  | 'spatial_map'
  | 'long_term_knowledge'

export interface MemorySkillRef {
  kind: 'device_skill' | 'general_skill'
  id: string
  label?: string
}

export interface MemoryAssetRecord {
  id: string
  kind: MemoryAssetKind
  title: string
  summary: string
  status: 'active' | 'planned' | 'legacy'
  source: 'manifest' | 'plan' | 'runtime' | 'user' | 'imported' | 'system' | 'placeholder'
  retrieval_hint: string
  skill_refs: MemorySkillRef[]
  device_refs: string[]
  metadata: Record<string, unknown>
}

export interface RecordExperiencePathInput {
  id?: string
  title: string
  summary?: string
  intent_pattern?: string
  preconditions?: Record<string, unknown>
  steps: Array<{
    tool: string
    action: string
    params?: Record<string, unknown>
    params_schema?: Record<string, unknown>
  }>
  skill_refs?: MemorySkillRef[]
  device_refs?: string[]
  success_criteria?: Record<string, unknown>
  failure_recovery?: unknown[]
  origin_trace_id?: string
  conversation_id?: number
  source?: 'runtime' | 'user' | 'imported' | 'system'
  status?: 'active' | 'draft'
  confidence?: number
  priority?: number
  metadata?: Record<string, unknown>
}

export interface MemoryAssetSummary {
  total: number
  by_kind: Record<MemoryAssetKind, number>
  migrated_legacy_count: number
}

export const memoryAssetsApi = {
  list: () => request<{ assets: MemoryAssetRecord[]; summary: MemoryAssetSummary }>('/api/assets/memory'),
  get: (id: string) =>
    request<{ asset: MemoryAssetRecord }>(`/api/assets/memory/${encodeURIComponent(id)}`),
  recordExperiencePath: (body: RecordExperiencePathInput) =>
    request<{ status: 'success' | 'error'; asset?: MemoryAssetRecord; message?: string }>(
      '/api/assets/memory/experience-paths',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),
}
