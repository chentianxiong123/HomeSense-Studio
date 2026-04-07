import type { AxiosProgressEvent, GenericAbortSignal } from 'axios'
import { post, get, put } from '@/utils/request'

export function fetchChatAPI<T = any>(
  prompt: string,
  _options?: { conversationId?: string; parentMessageId?: string },
  signal?: GenericAbortSignal,
) {
  return post<T>({
    url: '/api/chat',
    data: { text: prompt },
    signal,
  })
}

export function fetchChatConfig<T = any>() {
  return get<T>({
    url: '/api/tools',
  })
}

export function fetchChatAPIProcess<T = any>(
  params: {
    prompt: string
    options?: { conversationId?: string; parentMessageId?: string }
    signal?: GenericAbortSignal
    onDownloadProgress?: (progressEvent: AxiosProgressEvent) => void },
) {
  return post<T>({
    url: '/api/chat',
    data: { text: params.prompt },
    signal: params.signal,
    onDownloadProgress: params.onDownloadProgress,
  })
}

export function fetchSession<T>() {
  return get<T>({
    url: '/health',
  })
}

export function fetchMessages<T = any>(limit: number, offset: number) {
  return get<T>({
    url: `/api/messages?limit=${limit}&offset=${offset}`,
  })
}

export function fetchTools<T = any>() {
  return get<T>({
    url: '/api/tools',
  })
}

export function fetchToolConfig<T = any>(name: string) {
  return get<T>({
    url: `/api/tools/${name}/config`,
  })
}

export function updateToolConfig<T = any>(name: string, config: any) {
  return put<T>({
    url: `/api/tools/${name}/config`,
    data: config,
  })
}

export function fetchDevices<T = any>() {
  return get<T>({
    url: '/api/devices',
  })
}

export function fetchExperiencePaths<T = any>() {
  return get<T>({
    url: '/api/experience-paths',
  })
}

export function repairExperiencePathSkills<T = any>() {
  return post<T>({
    url: '/api/experience-paths/repair-skills',
  })
}

export function normalizeExperiencePathData<T = any>() {
  return post<T>({
    url: '/api/experience-paths/normalize-data',
  })
}

export function fetchExperiencePathClusters<T = any>() {
  return get<T>({
    url: '/api/experience-paths/clusters',
  })
}

export function mergeExperiencePathCluster<T = any>(payload: { primaryId: string, mergeIds: string[] }) {
  return post<T>({
    url: '/api/experience-paths/merge-cluster',
    data: payload,
  })
}

export function fetchStrongClusterMergePreview<T = any>() {
  return get<T>({
    url: '/api/experience-paths/merge-strong-clusters/preview',
  })
}

export function fetchWeakClusterMergePreview<T = any>() {
  return get<T>({
    url: '/api/experience-paths/merge-weak-clusters/preview',
  })
}

export function mergeStrongExperiencePathClusters<T = any>() {
  return post<T>({
    url: '/api/experience-paths/merge-strong-clusters',
  })
}

export function mergeWeakExperiencePathClusters<T = any>() {
  return post<T>({
    url: '/api/experience-paths/merge-weak-clusters',
  })
}

export function fetchExperiencePathMergeAudit<T = any>(mode?: string) {
  const query = mode ? `?mode=${encodeURIComponent(mode)}` : ''
  return get<T>({
    url: `/api/experience-paths/merge-audit${query}`,
  })
}

export function clearExperiencePathMergeAudit<T = any>() {
  return post<T>({
    url: '/api/experience-paths/merge-audit/clear',
  })
}

export function fetchRuleCandidates<T = any>() {
  return get<T>({
    url: '/api/rule-candidates',
  })
}

export function fetchRules<T = any>() {
  return get<T>({
    url: '/api/rules',
  })
}

export function fetchToolSkills<T = any>(name: string, section = 'index') {
  return get<T>({
    url: `/api/tools/${name}/skills/${section}`,
  })
}

export function fetchToolSkillSections<T = any>(name: string) {
  return get<T>({
    url: `/api/tools/${name}/skills-sections`,
  })
}

export function fetchToolSkillsPolicy<T = any>(name: string, input = '', intent?: string) {
  const params = new URLSearchParams()
  if (input) params.set('input', input)
  if (intent) params.set('intent', intent)
  const query = params.toString()
  return get<T>({
    url: `/api/tools/${name}/skills-policy${query ? `?${query}` : ''}`,
  })
}

export function disableRule<T = any>(payload: { trigger: string }) {
  return post<T>({
    url: '/api/rules/disable',
    data: payload,
  })
}

export function enableRule<T = any>(payload: { trigger: string }) {
  return post<T>({
    url: '/api/rules/enable',
    data: payload,
  })
}

export function rollbackRule<T = any>(payload: { trigger: string, sourcePathId?: string }) {
  return post<T>({
    url: '/api/rules/rollback',
    data: payload,
  })
}

export function promoteRuleCandidate<T = any>(payload: { trigger: string, intent: string, actions?: Array<Record<string, any>>, sourcePathId?: string }) {
  return post<T>({
    url: '/api/rule-candidates/promote',
    data: payload,
  })
}

export function fetchVerify<T = any>(token: string) {
  return post<T>({
    url: '/verify',
    data: { token },
  })
}
