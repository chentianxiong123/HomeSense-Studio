import { describe, expect, it } from 'vitest'
import {
  buildWorkflowRoute,
  parseWorkflowRouteId,
  replaceWorkflowRouteId,
} from './workflowEditorRoute'

describe('parseWorkflowRouteId', () => {
  it('returns a numeric workflow id from route params and rejects invalid values', () => {
    expect(parseWorkflowRouteId('9')).toBe(9)
    expect(parseWorkflowRouteId(['12'])).toBe(12)
    expect(parseWorkflowRouteId('abc')).toBeNull()
    expect(parseWorkflowRouteId(undefined)).toBeNull()
  })
})

describe('buildWorkflowRoute', () => {
  it('builds stable workflow detail routes for each Studio tab', () => {
    expect(buildWorkflowRoute(3, 'overview')).toBe('/studio/workflows/3/overview')
    expect(buildWorkflowRoute(3, 'editor')).toBe('/studio/workflows/3/editor')
    expect(buildWorkflowRoute(3, 'runs')).toBe('/studio/workflows/3/runs')
  })
})

describe('replaceWorkflowRouteId', () => {
  it('preserves the current workflow detail tab when switching to another workflow', () => {
    expect(replaceWorkflowRouteId('/studio/workflows/9/editor', 21)).toBe('/studio/workflows/21/editor')
    expect(replaceWorkflowRouteId('/studio/workflows/9/overview', 21)).toBe('/studio/workflows/21/overview')
    expect(replaceWorkflowRouteId('/studio/workflows/9/runs', 21)).toBe('/studio/workflows/21/runs')
  })

  it('falls back to the editor route when the current path is not a workflow detail page', () => {
    expect(replaceWorkflowRouteId('/studio', 21)).toBe('/studio/workflows/21/editor')
  })
})
