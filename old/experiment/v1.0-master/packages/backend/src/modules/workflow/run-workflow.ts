import { getDb as defaultGetDb } from '../../db/index.js'
import { eventBus as defaultEventBus, HeartEvent } from '../event-bus/index.js'
import { memoryKernel as defaultMemoryKernel } from '../memory-kernel/index.js'
import { memoryAssetsService as defaultMemoryAssetsService } from '../memory-assets/index.js'
import { executeNode, type NodeResult, type WorkflowNode } from './execute-node.js'
import { resolveNodeValue } from './node-base.js'
import { selfEnhancementService as defaultSelfEnhancement } from '../self-enhancement/index.js'
import { compensationService as defaultCompensationService } from '../compensation/index.js'
import type { RecordExperiencePathInput } from '../memory-assets/index.js'
import type { WorkflowEdge, WorkflowResult, NodeTrace } from './types.js'
import { VariablePool } from './variable-pool.js'
import { GraphRuntimeState } from './runtime-state.js'
import { computeWorkflowGraphHash } from './graph-version.js'

import type { TaskFailure } from '../self-enhancement/index.js'

type GetDbFn = () => ReturnType<typeof defaultGetDb>

interface EventBusInstance {
  fire(event: string, data?: unknown): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

interface MemoryKernelInstance {
  observeOutcome(params: {
    intent: string
    target_device_id?: string
    tool: string
    action: string
    success: boolean
    error?: string
  }): void
}

interface SelfEnhancementInstance {
  processFailureAndEnhance(failure: TaskFailure): void
}

interface CompensationInstance {
  recordWorkflowNodeFailure(params: {
    workflow_id: number
    run_id: number
    node_id: string
    node_type: string
    label?: string
    error?: string
    inputs?: Record<string, unknown>
    resolved_inputs?: Record<string, unknown>
    outputs?: Record<string, unknown>
    triggered_by?: string
    duration_ms?: number
  }): { id: number } | undefined
}

interface MemoryAssetsInstance {
  recordExperiencePath(input: RecordExperiencePathInput): unknown
  recordExperiencePathFailure(input: RecordExperiencePathInput & { error?: string }): unknown
}

interface RunWorkflowOptions {
  parentState?: GraphRuntimeState
  triggeredBy?: 'manual' | 'cron' | 'chat'
}

export class WorkflowRuntime {
  constructor(
    private readonly getDb: GetDbFn = defaultGetDb,
    private readonly eventBus: EventBusInstance = defaultEventBus,
    private readonly memoryKernel: MemoryKernelInstance = defaultMemoryKernel,
    private readonly selfEnhancement: SelfEnhancementInstance = defaultSelfEnhancement,
    private readonly compensation: CompensationInstance = defaultCompensationService,
    private readonly memoryAssets: MemoryAssetsInstance = defaultMemoryAssetsService,
  ) {}

  async runWorkflow(
    workflowId: number,
    inputs: Record<string, unknown> = {},
    options: RunWorkflowOptions = {},
  ): Promise<WorkflowResult> {
    const db = this.getDb()

    const workflow = this.getWorkflowRecord(workflowId)
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`)
    const workflowGraphHash = this.ensureWorkflowGraphHash(workflowId, workflow)

    const nodes = db.prepare('SELECT * FROM workflow_nodes WHERE workflow_id = ?').all(workflowId) as Array<Record<string, unknown>>
    const edges = db.prepare('SELECT * FROM workflow_edges WHERE workflow_id = ?').all(workflowId) as Array<Record<string, unknown>>
    const triggeredBy = options.triggeredBy ?? options.parentState?.run_context.triggered_by ?? 'manual'

    const runResult = db.prepare(
      `INSERT INTO workflow_runs (workflow_id, status, triggered_by, started_at, inputs_json, graph_hash) VALUES (?, 'running', ?, datetime('now'), ?, ?)`,
    ).run(workflowId, triggeredBy, JSON.stringify(inputs), workflowGraphHash)
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
      const failedNodeIds: string[] = []
      const compensationTaskIds: number[] = []
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
            this.eventBus.fire(HeartEvent.WORKFLOW_NODE_STARTED, {
              run_id: runId,
              workflow_id: workflowId,
              node_id: node.id,
              node_type: node.type,
              label: node.label,
            })
            const result = await this.executeNodeWithRetry(node, runtimeState)
            return { node, result }
          }),
        )

        for (const { node, result } of batchResults) {
          const resolvedInputs = this.resolveNodeInputs(node, runtimeState.variable_pool)
          const upstream = this.buildUpstreamSummary(node.id, incoming, traceByNodeId)
          const compensationTaskId = result.status === 'failed'
            ? this.recordWorkflowNodeFailure({
                workflow_id: workflowId,
                run_id: runId,
                node_id: node.id,
                node_type: node.type,
                label: node.label,
                error: result.error,
                inputs: node.config,
                resolved_inputs: resolvedInputs,
                outputs: result.outputs,
                triggered_by: triggeredBy,
                duration_ms: result.duration_ms,
              })
            : undefined
          if (compensationTaskId != null) {
            compensationTaskIds.push(compensationTaskId)
          }
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
            compensation_task_id: compensationTaskId,
            attempts: result.attempts,
            retry_errors: result.retry_errors,
          }
          trace.push(traceEntry)
          traceByNodeId.set(node.id, traceEntry)

          if (result.status === 'failed') {
            failed = true
            failedNodeIds.push(node.id)
            this.eventBus.fire(HeartEvent.WORKFLOW_NODE_FAILED, {
              run_id: runId,
              workflow_id: workflowId,
              node_id: node.id,
              node_type: node.type,
              label: node.label,
              outputs: result.outputs,
              duration_ms: result.duration_ms,
              error: result.error,
              compensation_task_id: compensationTaskId,
              attempts: result.attempts,
              retry_errors: result.retry_errors,
            })
          } else {
            this.eventBus.fire(HeartEvent.WORKFLOW_NODE_COMPLETED, {
              run_id: runId,
              workflow_id: workflowId,
              node_id: node.id,
              node_type: node.type,
              label: node.label,
              outputs: result.outputs,
              duration_ms: result.duration_ms,
              attempts: result.attempts,
              retry_errors: result.retry_errors,
            })
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
              if (result.status === 'failed') {
                this.selfEnhancement.processFailureAndEnhance({
                  task_type: 'workflow_executor_call',
                  input: JSON.stringify({ executorName, params }),
                  expected: 'executor call succeeds',
                  actual: result.error ?? 'failed',
                  error: result.error ?? 'unknown executor call error',
                  trace: [{ step: `${tool}.${action}`, result: 'failed', duration_ms: result.duration_ms ?? 0 }],
                })
              }
            } catch {}
          }

          if (node.type === 'device_capability') {
            try {
              const resolved = resolvedInputs ?? {}
              const capabilityId = String(resolved.capability_id ?? '').trim()
              const capability = String(resolved.capability ?? '').trim()
              const deviceId = readDeviceId(resolved, result.outputs)
              this.memoryKernel.observeOutcome({
                intent: buildDeviceCapabilityObservationIntent(node.label || node.type, capabilityId || capability),
                target_device_id: deviceId,
                tool: 'device_agent',
                action: 'execute_device_capability',
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
      const failureError = failed
        ? trace.find((step) => step.status === 'failed')?.error
        : undefined
      const events = runtimeState.listEvents()
      db.prepare(
        `UPDATE workflow_runs SET status = ?, finished_at = datetime('now'), result_json = ?, trace_json = ?, events_json = ? WHERE id = ?`,
      ).run(status, JSON.stringify(outputs), JSON.stringify(trace), JSON.stringify(events), runId)

      if (status === 'succeeded') {
        this.recordWorkflowExperiencePath(workflowId, workflow, trace, runId, triggeredBy, inputs)
        this.eventBus.fire(HeartEvent.WORKFLOW_COMPLETED, {
          run_id: runId,
          workflow_id: workflowId,
        })
      } else {
        this.recordWorkflowFailurePath(workflowId, workflow, trace, runId, triggeredBy, inputs, outputs, failedNodeIds)
        this.eventBus.fire(HeartEvent.WORKFLOW_FAILED, {
          run_id: runId,
          workflow_id: workflowId,
          failed_node_ids: failedNodeIds,
          compensation_task_ids: compensationTaskIds,
        })
      }

      return {
        run_id: runId,
        workflow_id: workflowId,
        graph_hash: workflowGraphHash,
        status,
        outputs,
        error: failureError,
        trace,
        events,
      }
    } catch (err) {
      const events = runtimeState.listEvents()
      db.prepare(
        `UPDATE workflow_runs SET status = 'failed', finished_at = datetime('now'), result_json = ?, trace_json = ?, events_json = ? WHERE id = ?`,
      ).run(JSON.stringify({ error: (err as Error).message }), JSON.stringify(trace), JSON.stringify(events), runId)

      this.eventBus.fire(HeartEvent.WORKFLOW_FAILED, {
        run_id: runId,
        workflow_id: workflowId,
        error: (err as Error).message,
      })

      try {
        this.recordWorkflowFailurePath(workflowId, workflow, trace, runId, triggeredBy, inputs, { error: (err as Error).message }, [])
      } catch {}

      return {
        run_id: runId,
        workflow_id: workflowId,
        graph_hash: workflowGraphHash,
        status: 'failed',
        outputs: {},
        error: (err as Error).message,
        trace,
        events,
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

  private async executeNodeWithRetry(node: WorkflowNode, runtimeState: GraphRuntimeState): Promise<NodeResult> {
    const policy = readRetryPolicy(node.config)
    const startedAt = Date.now()
    const retryErrors: string[] = []
    let lastResult: NodeResult | null = null

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      const result = await executeNode(node, runtimeState)
      lastResult = result

      if (result.status !== 'failed' || attempt === policy.maxAttempts) {
        return {
          ...result,
          duration_ms: Date.now() - startedAt,
          attempts: attempt,
          retry_errors: retryErrors.length > 0 ? retryErrors : undefined,
        }
      }

      retryErrors.push(result.error ?? `Attempt ${attempt} failed`)
      if (policy.delayMs > 0) {
        await sleep(policy.delayMs)
      }
    }

    return {
      ...(lastResult ?? { node_id: node.id, status: 'failed' as const, outputs: {}, error: 'Node failed before execution', duration_ms: 0 }),
      duration_ms: Date.now() - startedAt,
      attempts: policy.maxAttempts,
      retry_errors: retryErrors.length > 0 ? retryErrors : undefined,
    }
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

  private recordWorkflowNodeFailure(params: Parameters<CompensationInstance['recordWorkflowNodeFailure']>[0]): number | undefined {
    try {
      return this.compensation.recordWorkflowNodeFailure(params)?.id
    } catch {
      return undefined
    }
  }

  private recordWorkflowExperiencePath(
    workflowId: number,
    workflow: Record<string, unknown>,
    trace: NodeTrace[],
    runId: number,
    triggeredBy: 'manual' | 'cron' | 'chat',
    workflowInputs: Record<string, unknown>,
  ): void {
    const path = this.buildWorkflowExperiencePath(workflowId, workflow, trace, runId, triggeredBy, workflowInputs, false)
    if (!path || path.steps.length === 0) return
    try {
      this.memoryAssets.recordExperiencePath(path)
    } catch {}
  }

  private recordWorkflowFailurePath(
    workflowId: number,
    workflow: Record<string, unknown>,
    trace: NodeTrace[],
    runId: number,
    triggeredBy: 'manual' | 'cron' | 'chat',
    workflowInputs: Record<string, unknown>,
    outputs: Record<string, unknown>,
    failedNodeIds: string[],
  ): void {
    const path = this.buildWorkflowExperiencePath(workflowId, workflow, trace, runId, triggeredBy, workflowInputs, true, outputs, failedNodeIds)
    if (!path || path.steps.length === 0) return
    try {
      this.memoryAssets.recordExperiencePathFailure({
        ...path,
        error: String(outputs.error ?? 'workflow failed'),
      })
    } catch {}
  }

  private buildWorkflowExperiencePath(
    workflowId: number,
    workflow: Record<string, unknown>,
    trace: NodeTrace[],
    runId: number,
    triggeredBy: 'manual' | 'cron' | 'chat',
    workflowInputs: Record<string, unknown>,
    includeFailed: boolean,
    outputs: Record<string, unknown> = {},
    failedNodeIds: string[] = [],
  ): RecordExperiencePathInput | null {
    const executableSteps = trace
      .filter((step) => step.status === 'succeeded' || (includeFailed && step.status === 'failed' && failedNodeIds.includes(step.node_id)))
      .map((step) => workflowTraceToExperienceStep(step))
      .filter((step): step is NonNullable<ReturnType<typeof workflowTraceToExperienceStep>> => Boolean(step))

    if (executableSteps.length === 0) return null

    const workflowName = String(workflow.name ?? `Workflow ${workflowId}`).trim()
    const workflowDescription = String(workflow.description ?? '').trim()
    const workflowGraphHash = String(workflow.graph_hash ?? '').trim()
    const summaryBase = workflowDescription || workflowName
    return {
      id: `memory.experience_path.workflow.${workflowId}`,
      title: workflowName,
      summary: includeFailed
        ? `Workflow failure path: ${summaryBase}`
        : `Workflow success path: ${summaryBase}`,
      intent_pattern: `${workflowName} ${workflowDescription}`.trim(),
      source: 'runtime',
      status: includeFailed ? 'draft' : 'active',
      origin_trace_id: `workflow.${workflowId}.run.${runId}`,
      steps: executableSteps,
      skill_refs: inferWorkflowSkillRefs(executableSteps),
      device_refs: inferWorkflowDeviceRefs(trace, includeFailed, failedNodeIds),
      success_criteria: { all_steps_complete: true },
      failure_recovery: includeFailed ? [{ run_id: runId, triggered_by: triggeredBy, error: String(outputs.error ?? '') }] : [],
      confidence: includeFailed ? 0.45 : 0.82,
      priority: includeFailed ? 0.4 : 0.75,
      metadata: {
        saved_from: includeFailed ? 'workflow_failure' : 'workflow_success',
        run_status: includeFailed ? 'failed' : 'succeeded',
        workflow_id: workflowId,
        workflow_name: workflowName,
        workflow_graph_hash: workflowGraphHash,
        workflow_run_id: runId,
        workflow_inputs: workflowInputs,
        triggered_by: triggeredBy,
        trace_count: trace.length,
        failed_node_ids: failedNodeIds,
        error: outputs.error ?? null,
      },
    }
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

  private ensureWorkflowGraphHash(workflowId: number, workflow: Record<string, unknown>): string {
    const existing = String(workflow.graph_hash ?? '').trim()
    if (existing) return existing

    const graphHash = computeWorkflowGraphHash(String(workflow.graph_json ?? '{}'))
    this.getDb().prepare('UPDATE workflows SET graph_hash = ? WHERE id = ?').run(graphHash, workflowId)
    workflow.graph_hash = graphHash
    return graphHash
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

function buildDeviceCapabilityObservationIntent(label: string, capability: string): string {
  const parts = ['workflow.device_capability', label, capability]
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.join('.')
}

function readDeviceId(
  resolvedInputs: Record<string, unknown>,
  outputs: Record<string, unknown>,
): string | undefined {
  const direct = normalizeDeviceId(resolvedInputs.device_id)
  if (direct) return direct

  const result = asRecord(outputs.result)
  const rehearsal = asRecord(outputs.rehearsal)
  const resultData = asRecord(result.data ?? result)
  const rehearsalData = asRecord(rehearsal.data ?? rehearsal)
  return normalizeDeviceId(
    resultData.device_id
      ?? asRecord(resultData.device).id
      ?? rehearsalData.device_id
      ?? asRecord(rehearsalData.device).id,
  )
}

function workflowTraceToExperienceStep(trace: NodeTrace): RecordExperiencePathInput['steps'][number] | null {
  const resolved = asRecord(trace.resolved_inputs ?? trace.inputs)
  if (trace.node_type === 'device_capability') {
    return {
      tool: 'device_agent',
      action: 'execute_device_capability',
      params: {
        device_id: resolved.device_id,
        capability_id: resolved.capability_id,
        capability: resolved.capability,
        arguments: asRecord(resolved.arguments),
      },
    }
  }

  if (trace.node_type === 'executor_call') {
    const executorName = String(resolved.executor_name ?? '').trim()
    if (!executorName) return null
    const params = asRecord(resolved.params)
    if (executorName === 'workflow.run') {
      return {
        tool: 'workflow',
        action: 'run_workflow',
        params: {
          workflow_id: params.workflow_id,
          workflow_name: params.workflow_name,
          inputs: asRecord(params.inputs),
        },
      }
    }
    return {
      tool: 'executor',
      action: executorName,
      params,
    }
  }

  if (trace.node_type === 'subflow') {
    const inputs = asRecord(resolved.inputs)
    return {
      tool: 'workflow',
      action: 'run_workflow',
      params: {
        workflow_id: resolved.workflow_id,
        workflow_name: resolved.workflow_name,
        inputs,
      },
    }
  }

  if (trace.node_type === 'scene_execute') {
    return {
      tool: 'mi-cli',
      action: 'scene_execute',
      params: {
        scene_id: resolved.scene_id,
        scene_name: resolved.scene_name,
        home_id: resolved.home_id,
      },
    }
  }

  if (trace.node_type === 'device_control') {
    return {
      tool: 'mi-cli',
      action: String(resolved.action ?? 'device_control'),
      params: resolved,
    }
  }

  if (trace.node_type === 'xiaoai') {
    return {
      tool: 'mi-cli',
      action: String(resolved.mode ?? 'speaker_execute'),
      params: {
        text: resolved.text,
        silent: resolved.silent,
        did: resolved.did,
      },
    }
  }

  return null
}

function inferWorkflowSkillRefs(steps: Array<RecordExperiencePathInput['steps'][number]>): Array<{ kind: 'device_skill' | 'general_skill'; id: string; label?: string }> {
  const refs = new Map<string, { kind: 'device_skill' | 'general_skill'; id: string; label?: string }>()
  for (const step of steps) {
    const text = `${step.tool} ${step.action} ${JSON.stringify(step.params ?? {})}`.toLowerCase()
    if (text.includes('adb')) refs.set('general_skill:adb-cli', { kind: 'general_skill', id: 'adb-cli', label: 'ADB CLI' })
    if (text.includes('mi') || text.includes('xiaoai')) refs.set('general_skill:mi-cli', { kind: 'general_skill', id: 'mi-cli', label: 'Mi CLI' })
  }
  return Array.from(refs.values())
}

function inferWorkflowDeviceRefs(
  trace: NodeTrace[],
  includeFailed: boolean,
  failedNodeIds: string[],
): string[] {
  const refs = new Set<string>()
  for (const step of trace) {
    if (step.status !== 'succeeded' && !(includeFailed && step.status === 'failed' && failedNodeIds.includes(step.node_id))) continue
    const resolved = asRecord(step.resolved_inputs ?? step.inputs)
    const deviceId = normalizeDeviceId(resolved.device_id)
    if (deviceId) refs.add(`device:${deviceId}`)
  }
  return Array.from(refs)
}

function normalizeDeviceId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readRetryPolicy(config: Record<string, unknown>): { maxAttempts: number; delayMs: number } {
  const retry = asRecord(config.retry)
  const rawMaxAttempts = Number(
    retry.max_attempts
      ?? retry.maxAttempts
      ?? config.max_attempts
      ?? config.maxAttempts
      ?? 1,
  )
  const rawDelayMs = Number(
    retry.delay_ms
      ?? retry.delayMs
      ?? retry.backoff_ms
      ?? retry.backoffMs
      ?? config.retry_delay_ms
      ?? config.retryDelayMs
      ?? 0,
  )

  return {
    maxAttempts: clampInteger(rawMaxAttempts, 1, 5, 1),
    delayMs: clampInteger(rawDelayMs, 0, 30_000, 0),
  }
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const workflowRuntime = new WorkflowRuntime()
