import { describe, expect, it } from 'vitest'
import { computeWorkflowGraphHash } from './graph-version.js'

describe('workflow graph version', () => {
  it('keeps a stable hash when only persisted node ids change', () => {
    const left = JSON.stringify({
      nodes: [
        { id: 11, type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { inputs: { intent: 'watch' } } },
        { id: 12, type: 'answer', label: 'Done', position: { x: 200, y: 0 }, config: { message: 'done' } },
      ],
      edges: [
        { source_node_id: 11, target_node_id: 12, source_port: 'out', target_port: 'in', condition: {} },
      ],
    })
    const right = JSON.stringify({
      nodes: [
        { id: 21, type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: { inputs: { intent: 'watch' } } },
        { id: 22, type: 'answer', label: 'Done', position: { x: 200, y: 0 }, config: { message: 'done' } },
      ],
      edges: [
        { source_node_id: 21, target_node_id: 22, source_port: 'out', target_port: 'in', condition: {} },
      ],
    })

    expect(computeWorkflowGraphHash(left)).toBe(computeWorkflowGraphHash(right))
  })

  it('changes the hash when executable config changes', () => {
    const left = JSON.stringify({
      nodes: [{ id: 1, type: 'answer', label: 'Done', config: { message: 'done' } }],
      edges: [],
    })
    const right = JSON.stringify({
      nodes: [{ id: 1, type: 'answer', label: 'Done', config: { message: 'changed' } }],
      edges: [],
    })

    expect(computeWorkflowGraphHash(left)).not.toBe(computeWorkflowGraphHash(right))
  })
})
