export interface WorkflowGraphSnapshot {
  nodes: Array<{
    id?: number | string
    type: string
    label: string
    position?: { x: number; y: number }
  }>
  edges: Array<{
    source_node_id: number | string
    target_node_id: number | string
    source_port?: string
    target_port?: string
  }>
}
