import { VariablePool } from './variable-pool.js'
import { GraphRuntimeState } from './runtime-state.js'
import type { NodeResult, WorkflowNode, WorkflowNodeRunOutcome } from './types.js'

export interface NodeExecutionContext {
  node: WorkflowNode
  runtime_state: GraphRuntimeState
  variables: VariablePool
  resolveValue(value: unknown): unknown
  resolveTemplate(template: string): string
}

export abstract class WorkflowNodeBase {
  constructor(protected readonly node: WorkflowNode) {}

  async run(runtimeState: GraphRuntimeState): Promise<NodeResult> {
    const startedAt = Date.now()
    const context = this.createContext(runtimeState)

    runtimeState.recordEvent({
      type: 'node_started',
      node_id: this.node.id,
      node_type: this.node.type,
      timestamp: new Date().toISOString(),
      inputs: this.node.config,
    })

    try {
      const outcome = await this.runInternal(context)
      const result: NodeResult = {
        node_id: this.node.id,
        status: outcome.status,
        outputs: outcome.outputs,
        duration_ms: Date.now() - startedAt,
        error: outcome.error,
      }

      runtimeState.recordEvent({
        type: outcome.status === 'failed' ? 'node_failed' : outcome.status === 'skipped' ? 'node_skipped' : 'node_completed',
        node_id: this.node.id,
        node_type: this.node.type,
        timestamp: new Date().toISOString(),
        outputs: result.outputs,
        duration_ms: result.duration_ms,
        error: result.error,
      })

      return result
    } catch (err) {
      const result: NodeResult = {
        node_id: this.node.id,
        status: 'failed',
        outputs: {},
        duration_ms: Date.now() - startedAt,
        error: (err as Error).message,
      }

      runtimeState.recordEvent({
        type: 'node_failed',
        node_id: this.node.id,
        node_type: this.node.type,
        timestamp: new Date().toISOString(),
        duration_ms: result.duration_ms,
        error: result.error,
      })

      return result
    }
  }

  protected abstract runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> | WorkflowNodeRunOutcome

  private createContext(runtimeState: GraphRuntimeState): NodeExecutionContext {
    const variables = runtimeState.variable_pool
    return {
      node: this.node,
      runtime_state: runtimeState,
      variables,
      resolveValue: (value) => resolveNodeValue(value, variables),
      resolveTemplate: (template) => variables.resolve(template),
    }
  }
}

export class UnknownWorkflowNode extends WorkflowNodeBase {
  protected runInternal(): WorkflowNodeRunOutcome {
    return {
      status: 'failed',
      outputs: {},
      error: `Unknown node type: ${this.node.type}`,
    }
  }
}

export function resolveNodeValue(value: unknown, variables: VariablePool): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('{{') && value.endsWith('}}')) {
      const key = value.slice(2, -2).trim()
      return variables.get(key)
    }
    return variables.resolve(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveNodeValue(item, variables))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, childValue]) => [
        key,
        resolveNodeValue(childValue, variables),
      ]),
    )
  }
  return value
}
