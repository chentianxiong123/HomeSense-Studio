import { workflowNodeFactory } from './node-factory.js'
import type { GraphRuntimeState } from './runtime-state.js'
import type { NodeResult, WorkflowNode } from './types.js'

export async function executeNode(
  node: WorkflowNode,
  runtimeState: GraphRuntimeState,
): Promise<NodeResult> {
  return workflowNodeFactory.create(node).run(runtimeState)
}

export type { NodeResult, WorkflowNode }
