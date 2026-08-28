export type WorkflowNodeEventType =
  | 'node_started'
  | 'node_completed'
  | 'node_failed'
  | 'node_skipped'

export interface WorkflowNodeEvent {
  type: WorkflowNodeEventType
  node_id: string
  node_type: string
  timestamp: string
  inputs?: Record<string, unknown>
  outputs?: Record<string, unknown>
  duration_ms?: number
  error?: string
}
