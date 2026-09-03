import { createHash } from 'crypto'

export function canonicalWorkflowGraphSignature(raw: string): string {
  const graph = readJsonishObject(raw)
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : []

  const nodeIndexById = new Map<string, number>()
  const nodes = rawNodes.map((node, index) => {
    const row = readJsonishObject(node)
    if (row.id != null) nodeIndexById.set(String(row.id), index)
    return {
      type: String(row.type ?? ''),
      label: String(row.label ?? ''),
      position: normalizeValue(readJsonish(row.position ?? row.position_json)),
      config: normalizeValue(readJsonish(row.config ?? row.config_json)),
    }
  })

  const edges = rawEdges.map((edge) => {
    const row = readJsonishObject(edge)
    const sourceId = row.source_node_id ?? row.sourceIndex ?? row.source_node_index
    const targetId = row.target_node_id ?? row.targetIndex ?? row.target_node_index
    return {
      source_index: normalizeNodeRef(sourceId, nodeIndexById),
      target_index: normalizeNodeRef(targetId, nodeIndexById),
      source_port: String(row.source_port ?? 'out'),
      target_port: String(row.target_port ?? 'in'),
      condition: normalizeValue(readJsonish(row.condition ?? row.condition_json)),
    }
  })

  return JSON.stringify({ nodes, edges })
}

export function computeWorkflowGraphHash(raw: string): string {
  return createHash('sha256')
    .update(canonicalWorkflowGraphSignature(raw))
    .digest('hex')
}

function normalizeNodeRef(value: unknown, nodeIndexById: Map<string, number>): number {
  if (value != null && nodeIndexById.has(String(value))) return nodeIndexById.get(String(value)) ?? -1
  const numeric = Number(value)
  return Number.isInteger(numeric) ? numeric : -1
}

function readJsonishObject(value: unknown): Record<string, unknown> {
  const parsed = readJsonish(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
}

function readJsonish(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, normalizeValue((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}
