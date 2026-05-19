import { VariablePool } from './variable-pool.js'
import { GraphRuntimeState } from './runtime-state.js'
import type { NodeResult, WorkflowNode, WorkflowNodeRunOutcome } from './types.js'

export interface WorkflowNodeCliBridge {
  run(cliName: string, action: string, params: Record<string, unknown>): Promise<{ status: string; data?: unknown; error?: string }>
}

export interface WorkflowNodeExecutorGateway {
  invoke(
    name: string,
    params: Record<string, unknown>,
  ): Promise<{ status: 'success' | 'error'; executor: string; data?: unknown; error?: string; message?: string }>
}

export interface WorkflowNodeLLMService {
  chat(opts: { messages: Array<{ role: string; content: string }>; temperature?: number }): Promise<{ content?: string | null }>
  rerank(opts: { query: string; documents: string[] }): Promise<{ results: Array<{ index: number; relevance_score: number }> }>
}

export interface WorkflowNodeMemoryKernel {
  listCompiledKnowledge(opts: { kind?: 'wiki_page' | 'compiled_plan' | 'experience_note' | 'skill_candidate' | 'rule_candidate' | 'workflow_candidate'; limit?: number }): unknown[]
  search(query: string): unknown[]
  semanticSearch(query: string, limit: number): Promise<unknown[]>
}

export interface WorkflowNodeCandidatePlanService {
  resolve(opts: { query: string }): Promise<unknown[]>
}

export interface WorkflowNodeRerankService {
  rankDocuments(opts: {
    query: string
    documents: Array<{ id: string; text: string; base_score?: number; metadata?: Record<string, unknown> }>
  }): Promise<Array<{
    id: string
    text: string
    base_score?: number
    metadata?: Record<string, unknown>
    score: number
    lexical_score: number
  }>>
}

export interface WorkflowNodeDependencies {
  cliBridge: WorkflowNodeCliBridge
  executorGateway: WorkflowNodeExecutorGateway
  llmService: WorkflowNodeLLMService
  memoryKernel: WorkflowNodeMemoryKernel
  candidatePlanService: WorkflowNodeCandidatePlanService
  rerankService: WorkflowNodeRerankService
}

export interface NodeExecutionContext {
  node: WorkflowNode
  runtime_state: GraphRuntimeState
  variables: VariablePool
  resolveValue(value: unknown): unknown
  resolveTemplate(template: string): string
}

export abstract class WorkflowNodeBase {
  constructor(
    protected readonly node: WorkflowNode,
    protected readonly deps: WorkflowNodeDependencies,
  ) {}

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
