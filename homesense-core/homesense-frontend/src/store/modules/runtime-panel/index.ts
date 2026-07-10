import { defineStore } from 'pinia'

export interface RuntimePathCandidate {
  id?: string | null
  name?: string | null
  score?: number | null
  successRate?: number | null
  isFailurePath?: boolean | null
}

export interface RuntimeCommandSummaryItem {
  commandId?: string | null
  capability?: string | null
  preferredTool?: string | null
  action?: string | null
  riskLevel?: string | null
  input?: Record<string, any>
}

export interface RuntimeResolutionMeta {
  resolutionSource?: string | null
  outcomeType?: string | null
  completedInput?: string | null
  currentCompletionDevice?: string | null
  matched?: boolean | null
  matchedTrigger?: string | null
  matchedPathName?: string | null
  matchedPathCandidates?: RuntimePathCandidate[]
  deepMatchedPathName?: string | null
  deepTopCandidateNames?: string[]
  deepCandidateCount?: number | null
  gatingReason?: string | null
  writeBackRecordType?: string | null
  commandSummary?: RuntimeCommandSummaryItem[]
}

export interface RuntimePanelState {
  latestText: string
  latestAt: string
  trace: Array<{ stage: string; ok: boolean; next: string }>
  resolutionMeta: RuntimeResolutionMeta | null
}

function defaultState(): RuntimePanelState {
  return {
    latestText: '',
    latestAt: '',
    trace: [],
    resolutionMeta: null,
  }
}

export const useRuntimePanelStore = defineStore('runtime-panel-store', {
  state: (): RuntimePanelState => defaultState(),
  actions: {
    setLatestRuntime(payload: Partial<RuntimePanelState>) {
      this.latestText = payload.latestText ?? this.latestText
      this.latestAt = payload.latestAt ?? this.latestAt
      this.trace = Array.isArray(payload.trace) ? payload.trace : this.trace
      this.resolutionMeta = payload.resolutionMeta ?? this.resolutionMeta
    },
    clearRuntime() {
      this.$state = defaultState()
    },
  },
})
