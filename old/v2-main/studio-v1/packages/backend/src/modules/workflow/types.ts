import type { WorkflowNodeEvent } from './node-events.js'

export interface WorkflowNode {
  id: string
  type: string
  label: string
  config: Record<string, unknown>
  position: { x: number; y: number }
}

export interface WorkflowEdge {
  source_node_id: string
  target_node_id: string
  source_port?: string
  target_port?: string
  condition?: Record<string, unknown>
}

export type NodeStatus = 'succeeded' | 'failed' | 'skipped'

export interface WorkflowNodeRunOutcome {
  status: NodeStatus
  outputs: Record<string, unknown>
  error?: string
}

export interface NodeResult extends WorkflowNodeRunOutcome {
  node_id: string
  duration_ms: number
  attempts?: number
  retry_errors?: string[]
}

export interface NodeTrace {
  node_id: string
  node_type: string
  status: NodeStatus
  inputs: Record<string, unknown>
  resolved_inputs?: Record<string, unknown>
  upstream?: Array<{
    node_id: string
    node_type: string
    source_port: string
    target_port: string
    status: NodeStatus
    outputs: Record<string, unknown>
  }>
  outputs: Record<string, unknown>
  duration_ms: number
  error?: string
  compensation_task_id?: number
  attempts?: number
  retry_errors?: string[]
}

export interface WorkflowResult {
  run_id: number
  workflow_id: number
  graph_hash: string
  status: 'succeeded' | 'failed'
  outputs: Record<string, unknown>
  error?: string
  trace: NodeTrace[]
  events: WorkflowNodeEvent[]
}
