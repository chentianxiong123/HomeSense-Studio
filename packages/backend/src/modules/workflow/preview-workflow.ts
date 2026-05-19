import { getDb } from '../../db/index.js'
import { resolveNodeValue } from './node-base.js'
import type { WorkflowEdge, WorkflowNode } from './types.js'
import { VariablePool, type VariableValueMode } from './variable-pool.js'

type GetDbFn = () => ReturnType<typeof getDb>

export interface WorkflowPreviewStep {
  node_id: string
  node_type: string
  label: string
  summary: string
  executor_name?: string
  target?: string
  cli_name?: string
  action?: string
  params?: Record<string, unknown>
  risk: 'none' | 'dry_run' | 'device' | 'external'
  resolution_mode: VariableValueMode
  runnable: boolean
  preview_state: 'ready' | 'skipped' | 'blocked'
  active_outputs: string[]
}

export interface WorkflowPreviewResult {
  workflow_id: number
  executable: boolean
  steps: WorkflowPreviewStep[]
  warnings: string[]
}

class WorkflowPreviewService {
  constructor(private readonly getDb: GetDbFn = getDb) {}

  previewWorkflow(workflowId: number, inputs: Record<string, unknown> = {}): WorkflowPreviewResult {
    const workflow = this.getDb().prepare('SELECT id FROM workflows WHERE id = ?').get(workflowId)
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`)

    const { nodes, edges } = this.loadGraph(workflowId)
    const sorted = this.topologicalSort(nodes, this.buildAdjacency(nodes, edges))
    const variables = new VariablePool()
    const warnings: string[] = []
    const steps: WorkflowPreviewStep[] = []
    const stepByNodeId = new Map<string, PreviewNodeEvaluation>()
    const incoming = this.buildIncomingEdges(nodes, edges)

    for (const [key, value] of Object.entries(inputs)) {
      variables.set(`input.${key}`, value, 'static')
    }

    for (const node of sorted) {
      const hasActiveIncoming = this.hasActiveIncomingEdge(node.id, incoming, stepByNodeId)
      if (!hasActiveIncoming) {
        const skipped = this.buildSkippedStep(node)
        steps.push(skipped.step)
        stepByNodeId.set(node.id, skipped)
        continue
      }

      const evaluation = this.previewNode(node, variables)
      steps.push(evaluation.step)
      stepByNodeId.set(node.id, evaluation)
      this.applyPreviewOutputs(node, evaluation.outputs, variables)

      if (evaluation.step.preview_state === 'blocked') {
        warnings.push(`${node.label || node.type}: ${evaluation.step.summary}`)
      }
    }

    return {
      workflow_id: workflowId,
      executable: steps.every((step) => step.preview_state !== 'blocked'),
      steps,
      warnings,
    }
  }

  private loadGraph(workflowId: number): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
    const db = this.getDb()
    const nodeRows = db.prepare('SELECT * FROM workflow_nodes WHERE workflow_id = ?').all(workflowId) as Array<Record<string, unknown>>
    const edgeRows = db.prepare('SELECT * FROM workflow_edges WHERE workflow_id = ?').all(workflowId) as Array<Record<string, unknown>>

    return {
      nodes: nodeRows.map((row) => ({
        id: String(row.id),
        type: String(row.type),
        label: String(row.label ?? ''),
        config: safeParseJson(row.config_json),
        position: safeParseJson(row.position_json) as { x: number; y: number },
      })),
      edges: edgeRows.map((row) => ({
        source_node_id: String(row.source_node_id),
        target_node_id: String(row.target_node_id),
        source_port: row.source_port ? String(row.source_port) : undefined,
        target_port: row.target_port ? String(row.target_port) : undefined,
        condition: safeParseJson(row.condition_json),
      })),
    }
  }

  private previewNode(node: WorkflowNode, variables: VariablePool): PreviewNodeEvaluation {
    if (node.type === 'start') {
      const defaultInputs = asRecord(node.config.inputs)
      const injected: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(defaultInputs)) {
        const variableKey = `input.${key}`
        if (!variables.has(variableKey)) {
          injected[key] = value
        }
      }
      return this.previewResult(node, 'Inject workflow inputs.', 'none', true, {
        trigger: true,
        injected_inputs: injected,
      }, { active_outputs: ['out'], resolution_mode: 'static' })
    }

    if (node.type === 'if_else') {
      const condition = this.evaluateConditionNode(node, variables)
      if (!condition.runnable) {
        return this.previewResult(
          node,
          condition.summary ?? 'Condition depends on unresolved runtime values.',
          'none',
          false,
          {},
          { active_outputs: [], resolution_mode: 'unresolved' },
        )
      }
      const branchLabel = condition.outputs.condition_result ? 'true' : 'false'
      return this.previewResult(
        node,
        `Condition resolves to ${branchLabel} branch.`,
        'none',
        true,
        condition.outputs,
        { active_outputs: [branchLabel], resolution_mode: condition.resolution_mode },
      )
    }

    if (node.type === 'executor_call') {
      return this.previewExecutorNode(node, variables)
    }
    if (node.type === 'subflow') {
      const workflowId = resolveNodeValue(node.config.workflow_id, variables)
      const workflowName = resolveNodeValue(node.config.workflow_name, variables)
      const params = asRecord(resolveNodeValue(node.config.inputs ?? {}, variables))
      const runnable = Boolean(workflowId || workflowName)
      return this.previewResult(
        node,
        `Run child workflow ${workflowId || workflowName || '(unselected)'}`,
        'external',
        runnable,
        { trigger: runnable },
        {
          active_outputs: runnable ? ['out'] : [],
          resolution_mode: runnable ? 'simulated' : 'unresolved',
          executor_name: 'workflow.subflow',
          target: String(workflowId || workflowName || ''),
          params,
        },
      )
    }
    if (node.type === 'code') {
      return this.previewResult(node, 'Resolve variables with inline code.', 'none', true, { trigger: true }, { active_outputs: ['out'], resolution_mode: 'simulated' })
    }
    if (node.type === 'parallel') {
      return this.previewResult(node, 'Fan out downstream branches for concurrent execution.', 'none', true, { trigger: true }, { active_outputs: ['out'], resolution_mode: 'static' })
    }
    if (node.type === 'answer') {
      return this.previewResult(node, 'Produce workflow answer.', 'none', true, {}, { active_outputs: [], resolution_mode: inferPreviewModeForValue(node.config.message, variables) })
    }
    return this.previewResult(node, `Run ${node.type} node.`, inferNodeRisk(node.type), true, { trigger: true }, { active_outputs: ['out'], resolution_mode: 'static' })
  }

  private previewExecutorNode(node: WorkflowNode, variables: VariablePool): PreviewNodeEvaluation {
    const executorName = String(resolveNodeValue(node.config.executor_name, variables) ?? '')
    const params = asRecord(resolveNodeValue(node.config.params ?? {}, variables))

    if (!executorName) {
      return this.previewResult(node, 'Missing executor_name.', 'external', false, {}, {})
    }

    if (executorName === 'cli.invoke') {
      const cliName = String(params.cli_name ?? '')
      const action = String(params.action ?? '')
      const cliParams = asRecord(params.params)
      const runnable = Boolean(cliName && action)
      const outputs = buildPreviewExecutorOutputs(executorName, {
        cli_name: cliName,
        action,
        params: cliParams,
      })
      return this.previewResult(
        node,
        `Invoke ${cliName || '(missing cli)'}:${action || '(missing action)'}`,
        inferCliRisk(cliName, action),
        runnable,
        outputs,
        {
          active_outputs: runnable ? ['out'] : [],
          resolution_mode: runnable ? 'simulated' : 'unresolved',
          executor_name: executorName,
          cli_name: cliName,
          action,
          params: cliParams,
        },
      )
    }

    if (executorName === 'agent.dispatch') {
      const target = String(params.target ?? '')
      const payload = asRecord(params.payload)
      const action = typeof payload.action === 'string' ? payload.action : undefined
      const runnable = Boolean(target && params.task)
      const outputs = buildPreviewExecutorOutputs(executorName, params)
      return this.previewResult(
        node,
        `Dispatch ${target || '(missing target)'}${action ? `:${action}` : ''}`,
        inferAgentRisk(target, payload),
        runnable,
        outputs,
        {
          active_outputs: runnable ? ['out'] : [],
          resolution_mode: runnable ? 'simulated' : 'unresolved',
          executor_name: executorName,
          target,
          action,
          params: payload,
        },
      )
    }

    if (executorName === 'workflow.run') {
      const runnable = params.workflow_id != null
      return this.previewResult(
        node,
        `Run workflow ${String(params.workflow_id ?? '(unselected)')}`,
        'external',
        runnable,
        { trigger: runnable },
        {
          active_outputs: runnable ? ['out'] : [],
          resolution_mode: runnable ? 'simulated' : 'unresolved',
          executor_name: executorName,
          target: String(params.workflow_id ?? ''),
          params: asRecord(params.inputs),
        },
      )
    }

    if (executorName === 'plan.run') {
      const runnable = Boolean(params.plan_id)
      return this.previewResult(
        node,
        `Run compiled plan ${String(params.plan_id ?? '(unselected)')}`,
        'external',
        runnable,
        { trigger: runnable },
        {
          active_outputs: runnable ? ['out'] : [],
          resolution_mode: runnable ? 'simulated' : 'unresolved',
          executor_name: executorName,
          target: String(params.plan_id ?? ''),
          params,
        },
      )
    }

    return this.previewResult(
      node,
      `Invoke ${executorName}`,
      'external',
      true,
      buildPreviewExecutorOutputs(executorName, params),
      {
        active_outputs: ['out'],
        resolution_mode: 'simulated',
        executor_name: executorName,
        params,
      },
    )
  }

  private previewResult(
    node: WorkflowNode,
    summary: string,
    risk: WorkflowPreviewStep['risk'],
    runnable: boolean,
    outputs: Record<string, unknown>,
    extras: Partial<WorkflowPreviewStep> = {},
  ): PreviewNodeEvaluation {
    const preview_state = runnable ? 'ready' : 'blocked'
    return {
      step: {
        node_id: node.id,
        node_type: node.type,
        label: node.label,
        summary,
        risk,
        resolution_mode: extras.resolution_mode ?? (runnable ? 'static' : 'unresolved'),
        runnable,
        preview_state,
        active_outputs: extras.active_outputs ?? [],
        ...extras,
      },
      outputs,
    }
  }

  private buildSkippedStep(node: WorkflowNode): PreviewNodeEvaluation {
    return {
      step: {
        node_id: node.id,
        node_type: node.type,
        label: node.label,
        summary: 'Skipped by branch routing.',
        risk: inferNodeRisk(node.type),
        resolution_mode: 'static',
        runnable: true,
        preview_state: 'skipped',
        active_outputs: [],
      },
      outputs: {},
    }
  }

  private buildAdjacency(nodes: WorkflowNode[], edges: WorkflowEdge[]): Map<string, string[]> {
    const adjacency = new Map<string, string[]>()
    for (const node of nodes) {
      adjacency.set(node.id, [])
    }
    for (const edge of edges) {
      const source = String(edge.source_node_id)
      const target = String(edge.target_node_id)
      if (adjacency.has(source)) {
        adjacency.get(source)!.push(target)
      }
    }
    return adjacency
  }

  private buildIncomingEdges(nodes: WorkflowNode[], edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
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

  private hasActiveIncomingEdge(
    nodeId: string,
    incoming: Map<string, WorkflowEdge[]>,
    stepByNodeId: Map<string, PreviewNodeEvaluation>,
  ): boolean {
    const incomingEdges = incoming.get(nodeId) ?? []
    if (incomingEdges.length === 0) return true

    return incomingEdges.some((edge) => {
      const sourceStep = stepByNodeId.get(String(edge.source_node_id))
      return this.shouldTraverseEdge(edge, sourceStep)
    })
  }

  private shouldTraverseEdge(edge: WorkflowEdge, sourceStep?: PreviewNodeEvaluation): boolean {
    if (!sourceStep || sourceStep.step.preview_state !== 'ready') return false

    const sourcePort = edge.source_port ?? 'out'
    if (sourcePort === 'out' || sourcePort === 'trigger') {
      return sourceStep.outputs.trigger !== false
    }

    if (Object.prototype.hasOwnProperty.call(sourceStep.outputs, sourcePort)) {
      return Boolean(sourceStep.outputs[sourcePort])
    }

    return false
  }

  private applyPreviewOutputs(
    node: WorkflowNode,
    outputs: Record<string, unknown>,
    variables: VariablePool,
  ): void {
    if (node.type === 'start') {
      const injected = asRecord(outputs.injected_inputs)
    for (const [key, value] of Object.entries(injected)) {
      const variableKey = `input.${key}`
      if (!variables.has(variableKey)) {
          variables.set(variableKey, value, 'static')
      }
    }
  }

    const outputMode = inferOutputMode(node, outputs)
    for (const [key, value] of Object.entries(outputs)) {
      variables.set(`node.${node.id}.${key}`, value, outputMode)
    }
  }

  private evaluateConditionNode(
    node: WorkflowNode,
    variables: VariablePool,
  ): { outputs: Record<string, unknown>; runnable: boolean; summary?: string; resolution_mode: VariableValueMode } {
    const left = resolveNodeValue(node.config.left, variables)
    const operator = String(node.config.operator ?? '==')
    const right = resolveNodeValue(node.config.right, variables)
    const resolutionMode = combinePreviewModes(
      inferPreviewModeForValue(node.config.left, variables),
      inferPreviewModeForValue(node.config.right, variables),
    )

    if (isUnresolvedPreviewValue(left) || isUnresolvedPreviewValue(right)) {
      return {
        outputs: {},
        runnable: false,
        summary: 'Condition depends on unresolved runtime values.',
        resolution_mode: 'unresolved',
      }
    }

    let result = false
    switch (operator) {
      case '==': result = left == right; break
      case '!=': result = left != right; break
      case '>': result = Number(left) > Number(right); break
      case '<': result = Number(left) < Number(right); break
      case '>=': result = Number(left) >= Number(right); break
      case '<=': result = Number(left) <= Number(right); break
      case 'contains': result = String(left).includes(String(right)); break
    }

    return {
      outputs: {
        condition_result: result,
        true: result,
        false: !result,
        trigger: true,
      },
      runnable: true,
      resolution_mode: resolutionMode,
    }
  }

  private topologicalSort(nodes: WorkflowNode[], adjacency: Map<string, string[]>): WorkflowNode[] {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]))
    const inDegree = new Map(nodes.map((node) => [node.id, 0]))

    for (const [, targets] of adjacency) {
      for (const target of targets) {
        inDegree.set(target, (inDegree.get(target) ?? 0) + 1)
      }
    }

    const queue: string[] = []
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id)
    }

    const sorted: WorkflowNode[] = []
    while (queue.length > 0) {
      const id = queue.shift()!
      const node = nodeMap.get(id)
      if (node) sorted.push(node)

      for (const target of adjacency.get(id) ?? []) {
        const nextDegree = (inDegree.get(target) ?? 1) - 1
        inDegree.set(target, nextDegree)
        if (nextDegree === 0) queue.push(target)
      }
    }

    return sorted
  }
}

interface PreviewNodeEvaluation {
  step: WorkflowPreviewStep
  outputs: Record<string, unknown>
}

function inferNodeRisk(type: string): WorkflowPreviewStep['risk'] {
  return ['device_control', 'xiaoai', 'ir_control', 'scene_execute'].includes(type) ? 'device' : 'none'
}

function inferCliRisk(cliName: string, action: string): WorkflowPreviewStep['risk'] {
  if (cliName === 'adb-cli' || cliName === 'mi-cli') return 'device'
  if (cliName === 'bilibili-cli' && action !== 'health' && action !== 'list_drafts') return 'dry_run'
  return 'external'
}

function inferAgentRisk(target: string, payload: Record<string, unknown>): WorkflowPreviewStep['risk'] {
  if (target === 'mi_adb') return 'device'
  if (target === 'bilibili_cli') return payload.dry_run === false ? 'external' : 'dry_run'
  if (target.startsWith('a2a_')) return payload.dry_run === false ? 'external' : 'dry_run'
  return 'external'
}

function inferOutputMode(node: WorkflowNode, outputs: Record<string, unknown>): VariableValueMode {
  if (node.type === 'executor_call' || node.type === 'subflow' || node.type === 'code') {
    return 'simulated'
  }
  if (node.type === 'if_else') {
    return inferConditionOutputMode(outputs)
  }
  return 'static'
}

function inferConditionOutputMode(outputs: Record<string, unknown>): VariableValueMode {
  if (Object.keys(outputs).length === 0) return 'unresolved'
  return 'static'
}

function buildPreviewExecutorOutputs(
  executorName: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const trigger = true

  if (executorName === 'cli.invoke') {
    const cliName = String(params.cli_name ?? '')
    const action = String(params.action ?? '')
    const cliParams = asRecord(params.params)

    if (cliName === 'mi-cli' && action === 'scene_execute') {
      return {
        trigger,
        result: {
          status: 'success',
          executor: executorName,
          data: {
            status: 'success',
            data: {
              scene: {
                scene_id: String(cliParams.scene_id ?? 'preview_scene'),
                name: String(cliParams.scene_name ?? 'preview scene'),
                home_id: String(cliParams.home_id ?? 'preview_home'),
              },
              executed: true,
            },
            duration_ms: 0,
          },
        },
      }
    }

    if (cliName === 'mi-cli' && action === 'speaker_execute') {
      return {
        trigger,
        result: {
          status: 'success',
          executor: executorName,
          data: {
            status: 'success',
            data: {
              text: String(cliParams.text ?? ''),
              silent: cliParams.silent !== false,
              control_path: 'miot_action',
            },
            duration_ms: 0,
          },
        },
      }
    }

    if (cliName === 'mi-cli' && action === 'ir_press_key') {
      return {
        trigger,
        result: {
          status: 'success',
          executor: executorName,
          data: {
            status: 'success',
            data: {
              controller_id: String(cliParams.controller_id ?? cliParams.did ?? ''),
              key_id: String(cliParams.key_id ?? ''),
              control_path: 'miot_ir',
            },
            duration_ms: 0,
          },
        },
      }
    }
  }

  if (executorName === 'agent.dispatch') {
    const target = String(params.target ?? '')
    const task = String(params.task ?? '')
    const payload = asRecord(params.payload)
    const executionMode = String(params.execution_mode ?? 'deferred')

    if (target === 'mi_adb') {
      const action = String(payload.action ?? '')
      const adapterData =
        action === 'ensure_connected'
          ? { connected: true, attempts: 1, device_id: 'preview-android-tv' }
          : action === 'list_packages'
            ? { connected: true, packages: previewAdbPackages(), keyword: String(payload.keyword ?? '') }
            : action === 'launch_app'
              ? {
                  connected: true,
                  launched: String(payload.package ?? ''),
                  active_package: String(payload.package ?? ''),
                }
              : {}

      return {
        trigger,
        result: {
          status: 'success',
          executor: executorName,
          data: {
            dispatch_id: 'preview_dispatch',
            status: 'executed',
            target,
            task,
            payload,
            execution_mode: executionMode,
            adapter_result: {
              status: 'success',
              data: adapterData,
              duration_ms: 0,
            },
            accepted_at: 'preview',
          },
        },
      }
    }
  }

  if (executorName === 'service.invoke') {
    const serviceName = String(params.service_name ?? '')
    const serviceParams = asRecord(params.params)
    return {
      trigger,
      result: {
        status: 'success',
        executor: executorName,
        data: {
          protocol: 'channel',
          channel: serviceName,
          status: 'planned',
          request: {
            channel: serviceName,
            params: serviceParams,
          },
          sent_at: 'preview',
        },
      },
    }
  }

  return { trigger }
}

function previewAdbPackages(): string[] {
  return [
    'com.xiaodianshi.tv.yst',
    'tv.danmaku.bili',
    'com.dangbei.tvlauncher',
  ]
}

function isUnresolvedPreviewValue(value: unknown): boolean {
  return typeof value === 'string' && value.includes('{{') && value.includes('}}')
}

function inferPreviewModeForValue(value: unknown, variables: VariablePool): VariableValueMode {
  if (typeof value === 'string') {
    const matches = Array.from(value.matchAll(/\{\{(\w+(?:\.\w+)*)\}\}/g))
    if (matches.length === 0) return 'static'
    return matches
      .map((match) => variables.getMeta(match[1]) ?? 'unresolved')
      .reduce<VariableValueMode>((current, mode) => combinePreviewModes(current, mode), 'static')
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => inferPreviewModeForValue(item, variables))
      .reduce<VariableValueMode>((current, mode) => combinePreviewModes(current, mode), 'static')
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((item) => inferPreviewModeForValue(item, variables))
      .reduce<VariableValueMode>((current, mode) => combinePreviewModes(current, mode), 'static')
  }
  return 'static'
}

function combinePreviewModes(left: VariableValueMode, right: VariableValueMode): VariableValueMode {
  if (left === 'unresolved' || right === 'unresolved') return 'unresolved'
  if (left === 'simulated' || right === 'simulated') return 'simulated'
  return 'static'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeParseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return asRecord(parsed)
  } catch {
    return {}
  }
}

export const workflowPreviewService = new WorkflowPreviewService()
