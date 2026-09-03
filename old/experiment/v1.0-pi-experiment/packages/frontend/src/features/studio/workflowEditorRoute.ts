export type WorkflowStudioSection = 'overview' | 'editor' | 'runs'

const WORKFLOW_ROUTE_PATTERN = /^\/studio\/workflows\/[^/]+\/(overview|editor|runs)$/

export function parseWorkflowRouteId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) return null
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function buildWorkflowRoute(id: number, section: WorkflowStudioSection = 'editor'): string {
  return `/studio/workflows/${id}/${section}`
}

export function replaceWorkflowRouteId(path: string, id: number): string {
  if (!WORKFLOW_ROUTE_PATTERN.test(path)) {
    return buildWorkflowRoute(id, 'editor')
  }
  return path.replace(/\/studio\/workflows\/[^/]+\//, `/studio/workflows/${id}/`)
}
