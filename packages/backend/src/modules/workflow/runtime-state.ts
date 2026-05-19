import { VariablePool } from './variable-pool.js'
import type { WorkflowNodeEvent } from './node-events.js'

export interface WorkflowRunContext {
  workflow_id: number
  run_id: number
  triggered_by: 'manual' | 'cron' | 'chat'
  started_at: string
  inputs: Record<string, unknown>
  call_depth: number
}

export class GraphRuntimeState {
  readonly variable_pool: VariablePool
  private readonly events: WorkflowNodeEvent[] = []

  constructor(
    readonly run_context: WorkflowRunContext,
    variablePool?: VariablePool,
  ) {
    this.variable_pool = variablePool ?? new VariablePool()
  }

  recordEvent(event: WorkflowNodeEvent): void {
    this.events.push(event)
  }

  listEvents(): WorkflowNodeEvent[] {
    return [...this.events]
  }

  createChildState(
    overrides: Partial<WorkflowRunContext> = {},
    variablePool?: VariablePool,
  ): GraphRuntimeState {
    return new GraphRuntimeState(
      {
        ...this.run_context,
        ...overrides,
        call_depth: overrides.call_depth ?? this.run_context.call_depth + 1,
      },
      variablePool ?? this.variable_pool.createChildScope(),
    )
  }
}
