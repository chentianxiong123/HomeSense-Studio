import { getDb as defaultGetDb } from '../../db/index.js'
import { eventBus } from '../event-bus/index.js'
import { memoryKernel } from '../memory-kernel/index.js'
import { executeNode, type NodeResult, type WorkflowNode } from './execute-node.js'
import { resolveNodeValue } from './node-base.js'
import type { WorkflowEdge, WorkflowResult, NodeTrace } from './types.js'
import { VariablePool } from './variable-pool.js'
import { GraphRuntimeState } from './runtime-state.js'

type GetDbFn = () => ReturnType<typeof defaultGetDb>

interface EventBusInstance {
  fire(event: string, data?: unknown): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

interface MemoryKernelInstance {
  observeOutcome(params: { intent: string; tool: string; action: string; success: boolean; error?: string }): void
}

interface RunWorkflowOptions {
  parentState?: GraphRuntimeState
  triggeredBy?: 'manual' | 'cron' | 'chat'
}

class WorkflowRuntime {
  constructor(
    private readonly getDb: GetDbFn = defaultGetDb,
    private readonly eventBus: EventBusInstance = eventBus,
    private readonly memoryKernel: MemoryKernelInstance = memoryKernel,
  ) {}

  async runWorkflow(
    workflowId: number,
    inputs: Record<string, unknown> = {},
    options: RunWorkflowOptions = {},
  ): Promise<WorkflowResult> {
    const db = this.getDb()

    const workflow = this.getWorkflowRecord(workflowId)
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`)

    const nodes = db.prepare('SELECT * FROM workflow_nodes WHERE workflow_id = ?').all(workflowId) as Array<Record<string, unknown>>
    const edges = db.prepare('SELECT * FROM workflow_edges WHERE workflow_id = ?').all(workflowId) as Array<Record<string, unknown>>
    const triggeredBy = options.triggeredBy ?? options.parentState?.run_context.triggered_by ?? 'manual'

    const runResult = db.prepare(
      `INSERT INTO workflow_runs (workflow_id, status, triggered_by, started_at) VALUES (?, 'running', ?, datetime('now'))`,
    ).run(workflowId, triggeredBy)
    const runId = Number(runResult.lastInsertRowid)

    const trace: NodeTrace[] = []
    const runtimeState = this.createRuntimeState(workflowId, runId, inputs, triggeredBy, options.parentState)

    try {
      const workflowNodes: WorkflowNode[] = nodes.map((n) => ({
        id: String(n.id),
        type: String(n.type),
        label: String(n.label ?? ''),
        config: JSON.parse(String(n.config_json ?? '{}')),
        position: JSON.parse(String(n.position_json ?? '{"x":0,"y":0}')),
      }))

      const workflowEdges = edges.map((edge) => ({
          source_node_id: String(edge.source_node_id),
          target_node_id: String(edge.target_node_id),
          source_port: edge.source_port ? String(edge.source_port) : undefined,
          target_port: edge.target_port ? String(edge.target_port) : undefined,
          condition: this.safeParseJson(edge.condition_json),
        }))

      const nodeMap = new Map(workflowNodes.map((node) => [node.id, node]))
      const adjacency = this.buildAdjacency(workflowNodes, workflowEdges)
      const incoming = this.buildIncomingEdges(workflowNodes, workflowEdges)
      const traceByNodeId = new Map<string, NodeTrace>()
      const pendingCounts = this.buildPendingCounts(workflowNodes, adjacency)
      const readyQueue = workflowNodes
        .filter((node) => (pendingCounts.get(node.id) ?? 0) === 0)
        .map((node) => node.id)

      let failed = false
      while (readyQueue.length > 0) {
        const batchIds = readyQueue.splice(0, readyQueue.length)
        const batchNodes = batchIds
          .map((id) => nodeMap.get(id))
          .filter((node): node is WorkflowNode => Boolean(node))

        const runnableNodes: WorkflowNode[] = []

        for (const node of batchNodes) {
          const hasActiveIncoming = this.hasActiveIncomingEdge(node.id, incoming, traceByNodeId)
          const resolvedInputs = this.resolveNodeInputs(node, runtimeState.variable_pool)
          const upstream = this.buildUpstreamSummary(node.id, incoming, traceByNodeId)
          if (!hasActiveIncoming || (failed && node.type !== 'answer')) {
            const skippedTrace = this.buildSkippedTrace(node, resolvedInputs, upstream)
            trace.push(skippedTrace)
            traceByNodeId.set(node.id, skippedTrace)
            this.recordSkippedEvent(runtimeState, node)
            continue
          }

          runnableNodes.push(node)
        }

        const batchResults = await Promise.all(
          runnableNodes.map(async (node) => {
            this.eventBus.fire('workflow_node_started', { run_id: runId, node_id: node.id })
            const result = await executeNode(node, runtimeState)
            return { node, result }
          }),
        )

        for (const { node, result } of batchResults) {
          const resolvedInputs = this.resolveNodeInputs(node, runtimeState.variable_pool)
          const upstream = this.buildUpstreamSummary(node.id, incoming, traceByNodeId)
          const traceEntry: NodeTrace = {
            node_id: result.node_id,
            node_type: node.type,
            status: result.status,
            inputs: node.config,
            resolved_inputs: resolvedInputs,
            upstream,
            outputs: result.outputs,
            duration_ms: result.duration_ms,
            error: result.error,
          }
          trace.push(traceEntry)
          traceByNodeId.set(node.id, traceEntry)

          if (result.status === 'failed') {
            failed = true
            this.eventBus.fire('workflow_node_failed', { run_id: runId, node_id: node.id, error: result.error })
          } else {
            this.eventBus.fire('workflow_node_completed', { run_id: runId, node_id: node.id, outputs: result.outputs })
          }

          if (node.type === 'executor_call') {
            try {
              const cfg = node.config as Record<string, unknown>
              const executorName = String(cfg.executor_name ?? '')
              const params = (cfg.params as Record<string, unknown>) ?? {}
              let tool = executorName
              let action = ''
              if (executorName === 'cli.invoke') {
                tool = String(params.cli_name ?? 'cli')
                action = String(params.action ?? '')
              } else if (executorName === 'agent.dispatch') {
                tool = String(params.target ?? 'agent')
                action = String(params.execution_mode ?? 'dispatch')
              } else if (executorName === 'service.invoke') {
                tool = String(params.service_name ?? 'service')
                action = 'invoke'
              } else if (executorName === 'workflow.run') {
                tool = 'workflow'
                action = String(params.workflow_id ?? params.workflow_name ?? 'run')
              } else if (executorName === 'plan.run') {
                tool = 'plan'
                action = String(params.plan_id ?? 'run')
              }
              this.memoryKernel.observeOutcome({
                intent: `workflow.node.${node.label || node.type}`,
                tool,
                action,
                success: result.status === 'succeeded',
                error: result.error,
              })
            } catch {}
          }
        }

        for (const node of batchNodes) {
          for (const targetId of adjacency.get(node.id) ?? []) {
            const nextPending = (pendingCounts.get(targetId) ?? 1) - 1
            pendingCounts.set(targetId, nextPending)
            if (nextPending === 0) {
              readyQueue.push(targetId)
            }
          }
        }
      }

      const answerNode = trace.find((t) => t.node_type === 'answer' && t.status === 'succeeded')
      const outputs = answerNode?.outputs ?? {}

      const status = failed ? 'failed' : 'succeeded'
      db.prepare(
        `UPDATE workflow_runs SET status = ?, finished_at = datetime('now'), result_json = ? WHERE id = ?`,
      ).run(status, JSON.stringify(outputs), runId)

      this.eventBus.fire(status === 'succeeded' ? 'workflow_completed' : 'workflow_failed', {
        run_id: runId,
        workflow_id: workflowId,
      })

      return {
        run_id: runId,
        workflow_id: workflowId,
        status,
        outputs,
        trace,
        events: runtimeState.listEvents(),
      }
    } catch (err) {
      db.prepare(
        `UPDATE workflow_runs SET status = 'failed', finished_at = datetime('now'), result_json = ? WHERE id = ?`,
      ).run(JSON.stringify({ error: (err as Error).message }), runId)

      return {
        run_id: runId,
        workflow_id: workflowId,
        status: 'failed',
        outputs: {},
        error: (err as Error).message,
        trace,
        events: runtimeState.listEvents(),
      }
    }
  }

  async runWorkflowByName(
    workflowName: string,
    inputs: Record<string, unknown> = {},
    options: RunWorkflowOptions = {},
  ): Promise<WorkflowResult> {
    const workflow = this.getWorkflowRecordByName(workflowName)
    if (!workflow) throw new Error(`Workflow not found: ${workflowName}`)
    return this.runWorkflow(Number(workflow.id), inputs, options)
  }

  private buildAdjacency(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
  ): Map<string, string[]> {
    const adj = new Map<string, string[]>()
    for (const node of nodes) {
      adj.set(node.id, [])
    }
    for (const edge of edges) {
      const source = String(edge.source_node_id)
      const target = String(edge.target_node_id)
      if (adj.has(source)) {
        adj.get(source)!.push(target)
      }
    }
    return adj
  }

  private buildIncomingEdges(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
  ): Map<string, WorkflowEdge[]> {
    const incoming = new Map<string, WorkflowEdge[]>()
    for (const node of nodes) {
      incoming.set(node.id, [])
    }
    for (const edge of edges) {
      const target = String(edge.target_node_id)
      if (incoming.has(target)) {
        incoming.get(target)!.push(edge)
      }
    }
    return incoming
  }

  private buildPendingCounts(
    nodes: WorkflowNode[],
    adjacency: Map<string, string[]>,
  ): Map<string, number> {
    const pending = new Map(nodes.map((node) => [node.id, 0]))
    for (const [, targets] of adjacency) {
      for (const target of targets) {
        pending.set(target, (pending.get(target) ?? 0) + 1)
      }
    }
    return pending
  }

  private hasActiveIncomingEdge(
    nodeId: string,
    incoming: Map<string, WorkflowEdge[]>,
    traceByNodeId: Map<string, NodeTrace>,
  ): boolean {
    const incomingEdges = incoming.get(nodeId) ?? []
    if (incomingEdges.length === 0) return true

    return incomingEdges.some((edge) => {
      const sourceTrace = traceByNodeId.get(String(edge.source_node_id))
      return this.shouldTraverseEdge(edge, sourceTrace)
    })
  }

  private shouldTraverseEdge(edge: WorkflowEdge, sourceTrace?: NodeTrace): boolean {
    if (!sourceTrace || sourceTrace.status !== 'succeeded') return false

    const sourcePort = edge.source_port ?? 'out'
    if (sourcePort === 'out' || sourcePort === 'trigger') {
      return sourceTrace.outputs.trigger !== false
    }

    if (Object.prototype.hasOwnProperty.call(sourceTrace.outputs, sourcePort)) {
      return Boolean(sourceTrace.outputs[sourcePort])
    }

    return false
  }

  private buildSkippedTrace(
    node: WorkflowNode,
    resolvedInputs: Record<string, unknown>,
    upstream: NodeTrace['upstream'],
  ): NodeTrace {
    return {
      node_id: node.id,
      node_type: node.type,
      status: 'skipped',
      inputs: node.config,
      resolved_inputs: resolvedInputs,
      upstream,
      outputs: {},
      duration_ms: 0,
    }
  }

  private buildUpstreamSummary(
    nodeId: string,
    incoming: Map<string, WorkflowEdge[]>,
    traceByNodeId: Map<string, NodeTrace>,
  ): NonNullable<NodeTrace['upstream']> {
    return (incoming.get(nodeId) ?? [])
      .map((edge) => {
        const sourceTrace = traceByNodeId.get(String(edge.source_node_id))
        if (!sourceTrace) return null
        return {
          node_id: sourceTrace.node_id,
          node_type: sourceTrace.node_type,
          source_port: edge.source_port ?? 'out',
          target_port: edge.target_port ?? 'in',
          status: sourceTrace.status,
          outputs: sourceTrace.outputs,
        }
      })
      .filter((item): item is NonNullable<NodeTrace['upstream']>[number] => Boolean(item))
  }

  private resolveNodeInputs(
    node: WorkflowNode,
    variables: VariablePool,
  ): Record<string, unknown> {
    const resolved = resolveNodeValue(node.config, variables)
    return resolved && typeof resolved === 'object' && !Array.isArray(resolved)
      ? resolved as Record<string, unknown>
      : {}
  }

  private recordSkippedEvent(runtimeState: GraphRuntimeState, node: WorkflowNode): void {
    runtimeState.recordEvent({
      type: 'node_skipped',
      node_id: node.id,
      node_type: node.type,
      timestamp: new Date().toISOString(),
      inputs: node.config,
    })
  }

  private safeParseJson(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string') return {}
    try {
      return JSON.parse(value)
    } catch {
      return {}
    }
  }

  private getWorkflowRecord(workflowId: number): Record<string, unknown> | undefined {
    const db = this.getDb()
    return db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as Record<string, unknown> | undefined
  }

  private getWorkflowRecordByName(workflowName: string): Record<string, unknown> | undefined {
    const db = this.getDb()
    return db.prepare('SELECT * FROM workflows WHERE name = ? LIMIT 1').get(workflowName) as Record<string, unknown> | undefined
  }

  private createRuntimeState(
    workflowId: number,
    runId: number,
    inputs: Record<string, unknown>,
    triggeredBy: 'manual' | 'cron' | 'chat',
    parentState?: GraphRuntimeState,
  ): GraphRuntimeState {
    const startedAt = new Date().toISOString()
    const runtimeState = parentState
      ? parentState.createChildState({
          workflow_id: workflowId,
          run_id: runId,
          triggered_by: triggeredBy,
          started_at: startedAt,
          inputs,
        })
      : new GraphRuntimeState({
          workflow_id: workflowId,
          run_id: runId,
          triggered_by: triggeredBy,
          started_at: startedAt,
          inputs,
          call_depth: 0,
        }, new VariablePool())

    for (const [key, value] of Object.entries(inputs)) {
      runtimeState.variable_pool.set(`input.${key}`, value)
    }

    return runtimeState
  }
}

export const workflowRuntime = new WorkflowRuntime()