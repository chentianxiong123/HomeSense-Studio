export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  created_at: string
}

export type ToolCallKind = 'cli' | 'service' | 'a2a' | 'plan_step'

export interface MemoryHit {
  id: number | string
  name: string
  type: string
  snippet?: string
}

export interface CandidatePlanPreview {
  id: string
  title: string
  source: string
  candidate_kind: 'compiled_plan' | 'workflow_candidate'
  confidence: number
  goal: string
  entities: string[]
  assumptions: string[]
  risks: string[]
  evidence: Array<{ source: string; ref: string; score?: number; note?: string }>
  plan_id?: string
  compiled_knowledge_id?: number
}

export interface RouteEvidencePreview {
  source: string
  ref: string
  score?: number
  note?: string
}

export interface RouteObservationPreview {
  id: string
  name: string
  score: number
  last_action?: string
  last_error?: string
}

export interface RouteSearchHitPreview {
  id: string
  type: string
  source: string
  score: number
}

export type AgentEvent =
  | { type: 'turn.start'; turn_id: string; message: string; timestamp: number }
  | { type: 'turn.end'; turn_id: string; duration_ms: number; level: 1 | 2 | 3 }
  | {
      type: 'route.preview'
      turn_id: string
      normalized_intent: string
      route_level: 1 | 2 | 3
      reason: string
      confidence: number
      allow_tool_calls: boolean
      evidence: RouteEvidencePreview[]
      observations: RouteObservationPreview[]
      search_hits: RouteSearchHitPreview[]
      candidate_plans: CandidatePlanPreview[]
    }
  | { type: 'assistant.delta'; turn_id: string; delta: string }
  | { type: 'assistant.message'; turn_id: string; delta: string | null; content: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { type: 'assistant.final'; turn_id: string; content: string }
  | { type: 'tool.call.start'; turn_id: string; call_id: string; kind: ToolCallKind; name: string; args: unknown }
  | { type: 'tool.call.end'; turn_id: string; call_id: string; status: 'success' | 'error'; result?: unknown; error?: string; duration_ms: number }
  | { type: 'memory.recall'; turn_id: string; query: string; hits: MemoryHit[] }
  | { type: 'plan.step.start'; turn_id: string; plan_id: string; step_order: number; tool: string; action: string }
  | { type: 'plan.step.end'; turn_id: string; plan_id: string; step_order: number; status: 'success' | 'error'; result?: unknown; error?: string }
  | { type: 'approval.request'; turn_id: string; approval_id: string; reason: string; payload: unknown }
  | { type: 'a2a.dispatch.start'; turn_id: string; dispatch_id: string; adapter: string; task: string }
  | { type: 'a2a.dispatch.end'; turn_id: string; dispatch_id: string; status: 'success' | 'error'; result?: unknown; error?: string }
  | { type: 'context.patch'; turn_id: string; patch: Record<string, unknown> }
  | { type: 'error'; turn_id: string; message: string }

export interface ToolCallCard {
  call_id: string
  kind: ToolCallKind
  name: string
  args: unknown
  status: 'running' | 'success' | 'error'
  result?: unknown
  error?: string
  duration_ms?: number
  started_at: number
}

export interface PlanStep {
  plan_id: string
  step_order: number
  tool: string
  action: string
  status: 'running' | 'success' | 'error'
  result?: unknown
  error?: string
}

export interface A2ADispatch {
  dispatch_id: string
  adapter: string
  task: string
  status: 'running' | 'success' | 'error'
  result?: unknown
  error?: string
}

export interface ApprovalRequest {
  approval_id: string
  reason: string
  payload: unknown
  resolved?: 'approved' | 'denied'
}

export interface DisplayMessage {
  id: string
  turn_id?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  status: 'streaming' | 'final' | 'error' | 'in_progress' | 'completed'
  level?: 1 | 2 | 3
  timestamp: Date
  toolCalls: ToolCallCard[]
  memoryHits: MemoryHit[]
  candidatePlans: CandidatePlanPreview[]
  planSteps: PlanStep[]
  approvals: ApprovalRequest[]
  a2aDispatches: A2ADispatch[]
  contextPatch?: Record<string, unknown>
  routePreview?: {
    normalized_intent: string
    route_level: 1 | 2 | 3
    reason: string
    confidence: number
    allow_tool_calls: boolean
    evidence: RouteEvidencePreview[]
    observations: RouteObservationPreview[]
    search_hits: RouteSearchHitPreview[]
  }
  durationMs?: number
}
