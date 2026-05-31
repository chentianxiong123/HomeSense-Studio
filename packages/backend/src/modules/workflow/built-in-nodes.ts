import { WorkflowNodeBase, type NodeExecutionContext } from './node-base.js'
import type { NodeTrace, WorkflowNodeRunOutcome } from './types.js'

const MAX_SUBFLOW_CALL_DEPTH = 6

export class StartWorkflowNode extends WorkflowNodeBase {
  protected runInternal(context: NodeExecutionContext): WorkflowNodeRunOutcome {
    const inputs = context.node.config.inputs
    if (inputs && typeof inputs === 'object') {
      for (const [key, value] of Object.entries(inputs as Record<string, unknown>)) {
        const variableKey = `input.${key}`
        if (!context.variables.has(variableKey)) {
          context.variables.set(variableKey, value)
        }
      }
    }
    return { status: 'succeeded', outputs: { trigger: true } }
  }
}

export class DeviceControlWorkflowNode extends WorkflowNodeBase {
  protected async runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> {
    const config = context.node.config
    const did = context.resolveValue(config.did) as string
    const siid = Number(context.resolveValue(config.siid))
    const piid = config.piid != null ? Number(context.resolveValue(config.piid)) : undefined
    const aiid = config.aiid != null ? Number(context.resolveValue(config.aiid)) : undefined
    const value = config.value != null ? context.resolveValue(config.value) : undefined
    const params = config.params as unknown[] | undefined

    let cliResult
    if (aiid != null) {
      cliResult = await this.deps.cliBridge.run('mi-cli', 'run_action', { did, siid, aiid, params: params ?? [] })
    } else if (piid != null && value !== undefined) {
      cliResult = await this.deps.cliBridge.run('mi-cli', 'set_prop', { did, siid, piid, value })
    } else if (piid != null) {
      cliResult = await this.deps.cliBridge.run('mi-cli', 'get_prop', { did, siid, piid })
    } else {
      return { status: 'failed', outputs: {}, error: 'Invalid device_control config' }
    }

    context.variables.set(`node.${context.node.id}.result`, cliResult)
    const success = cliResult.status === 'success'
    return {
      status: success ? 'succeeded' : 'failed',
      outputs: { result: success ? (cliResult as any).data : cliResult, trigger: success },
      error: success ? undefined : (cliResult as any).error,
    }
  }
}

export class XiaoAiWorkflowNode extends WorkflowNodeBase {
  protected async runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> {
    const config = context.node.config
    const text = context.resolveTemplate(String(config.text ?? ''))
    const mode = String(context.resolveValue(config.mode ?? 'execute'))
    const silent = config.silent === true
    const did = config.did != null ? String(context.resolveValue(config.did)) : undefined
    const cliResult = mode === 'play'
      ? await this.deps.cliBridge.run('mi-cli', 'speaker_play', { text, ...(did ? { did } : {}) })
      : await this.deps.cliBridge.run('mi-cli', 'speaker_execute', { text, silent, ...(did ? { did } : {}) })
    context.variables.set(`node.${context.node.id}.result`, cliResult)
    const success = cliResult.status === 'success'
    return {
      status: success ? 'succeeded' : 'failed',
      outputs: { result: success ? (cliResult as any).data : cliResult, trigger: success },
      error: success ? undefined : (cliResult as any).error,
    }
  }
}

export class IRControlWorkflowNode extends WorkflowNodeBase {
  protected async runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> {
    const config = context.node.config
    const controllerId = context.resolveValue(config.controller_id) as string
    const keyId = context.resolveValue(config.key_id) as string
    const cliResult = await this.deps.cliBridge.run('mi-cli', 'ir_press_key', { controller_id: controllerId, key_id: keyId })
    context.variables.set(`node.${context.node.id}.result`, cliResult)
    const success = cliResult.status === 'success'
    return {
      status: success ? 'succeeded' : 'failed',
      outputs: { result: success ? (cliResult as any).data : cliResult, trigger: success },
      error: success ? undefined : (cliResult as any).error,
    }
  }
}

export class SceneExecuteWorkflowNode extends WorkflowNodeBase {
  protected async runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> {
    const config = context.node.config
    const sceneId = String(context.resolveValue(config.scene_id ?? '') ?? '').trim()
    const sceneName = String(context.resolveValue(config.scene_name ?? '') ?? '').trim()
    const homeId = String(context.resolveValue(config.home_id ?? '') ?? '').trim()

    const params: Record<string, unknown> = {}
    if (sceneId) params.scene_id = sceneId
    if (sceneName) params.scene_name = sceneName
    if (homeId) params.home_id = homeId

    if (!params.scene_id && !params.scene_name) {
      return { status: 'failed', outputs: {}, error: 'Scene execute requires scene_id or scene_name' }
    }

    const cliResult = await this.deps.cliBridge.run('mi-cli', 'scene_execute', params)
    context.variables.set(`node.${context.node.id}.result`, cliResult)
    const success = cliResult.status === 'success'
    return {
      status: success ? 'succeeded' : 'failed',
      outputs: { result: success ? (cliResult as any).data : cliResult, trigger: success },
      error: success ? undefined : (cliResult as any).error,
    }
  }
}

export class DeviceCapabilityWorkflowNode extends WorkflowNodeBase {
  protected async runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> {
    const config = context.node.config
    const deviceId = Number(context.resolveValue(config.device_id))
    const capabilityId = String(context.resolveValue(config.capability_id ?? '') ?? '').trim()
    const capability = String(context.resolveValue(config.capability ?? '') ?? '').trim()
    const args = asRecord(context.resolveValue(config.arguments ?? {}))

    if (!Number.isFinite(deviceId) || deviceId <= 0) {
      return { status: 'failed', outputs: {}, error: 'Device capability requires device_id' }
    }
    if (!capabilityId && !capability) {
      return { status: 'failed', outputs: {}, error: 'Device capability requires capability_id or capability' }
    }

    const rehearsal = await this.deps.deviceAgentTools.execute('rehearse_device_capability', {
      device_id: deviceId,
      ...(capabilityId ? { capability_id: capabilityId } : {}),
      ...(capability ? { capability } : {}),
      arguments: args,
    })
    const rehearsalData = rehearsal.data as { ok?: boolean; executable?: boolean } | undefined
    const rehearsalPassed = rehearsal.status === 'success' && rehearsalData?.ok !== false && rehearsalData?.executable !== false
    if (!rehearsalPassed) {
      context.variables.set(`node.${context.node.id}.rehearsal`, rehearsal)
      return {
        status: 'failed',
        outputs: {
          rehearsal,
          trigger: false,
        },
        error: rehearsal.error ?? rehearsal.message ?? 'Device capability rehearsal failed',
      }
    }

    const execution = await this.deps.deviceAgentTools.execute('execute_device_capability', {
      device_id: deviceId,
      ...(capabilityId ? { capability_id: capabilityId } : {}),
      ...(capability ? { capability } : {}),
      arguments: args,
    })

    context.variables.set(`node.${context.node.id}.rehearsal`, rehearsal)
    context.variables.set(`node.${context.node.id}.result`, execution)

    const success = execution.status === 'success'
    return {
      status: success ? 'succeeded' : 'failed',
      outputs: {
        rehearsal,
        result: success ? execution.data : execution,
        trigger: success,
      },
      error: success ? undefined : execution.error ?? execution.message ?? 'Device capability execution failed',
    }
  }
}

export class LLMWorkflowNode extends WorkflowNodeBase {
  protected async runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> {
    const config = context.node.config
    const prompt = context.resolveTemplate(String(config.prompt ?? ''))
    const temperature = config.temperature != null ? Number(config.temperature) : 0.7

    try {
      const result = await this.deps.llmService.chat({ messages: [{ role: 'user', content: prompt }], temperature })
      const response = result.content ?? ''
      context.variables.set(`node.${context.node.id}.response`, response)
      return { status: 'succeeded', outputs: { response, trigger: true } }
    } catch (err) {
      return { status: 'failed', outputs: {}, error: (err as Error).message }
    }
  }
}

export class IfElseWorkflowNode extends WorkflowNodeBase {
  protected runInternal(context: NodeExecutionContext): WorkflowNodeRunOutcome {
    const config = context.node.config
    const left = context.resolveValue(config.left)
    const operator = (config.operator as string) ?? '=='
    const right = context.resolveValue(config.right)

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

    context.variables.set(`node.${context.node.id}.condition_result`, result)
    return {
      status: 'succeeded',
      outputs: { condition_result: result, true: result, false: !result, trigger: true },
    }
  }
}

export class DelayWorkflowNode extends WorkflowNodeBase {
  protected async runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> {
    const ms = Number(context.node.config.duration ?? 1000)
    await new Promise((resolve) => setTimeout(resolve, ms))
    return { status: 'succeeded', outputs: { trigger: true } }
  }
}

export class ParallelWorkflowNode extends WorkflowNodeBase {
  protected runInternal(): WorkflowNodeRunOutcome {
    return { status: 'succeeded', outputs: { trigger: true } }
  }
}

export class SubflowWorkflowNode extends WorkflowNodeBase {
  protected async runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> {
    const config = context.node.config
    const workflowId = config.workflow_id != null ? Number(context.resolveValue(config.workflow_id)) : undefined
    const workflowName = String(context.resolveValue(config.workflow_name ?? '') ?? '').trim()
    const inputs = asRecord(context.resolveValue(config.inputs ?? {}))
    const outputKey = String(context.resolveValue(config.output_key ?? '') ?? '').trim()
    const hasWorkflowId = Number.isInteger(workflowId) && Number(workflowId) > 0

    if (!hasWorkflowId && !workflowName) {
      return { status: 'failed', outputs: {}, error: 'Subflow requires workflow_id or workflow_name' }
    }
    if (context.runtime_state.run_context.call_depth >= MAX_SUBFLOW_CALL_DEPTH) {
      return {
        status: 'failed',
        outputs: {
          trigger: false,
          subflow: {
            workflow_id: hasWorkflowId ? workflowId : undefined,
            workflow_name: workflowName || undefined,
            status: 'blocked',
            depth: context.runtime_state.run_context.call_depth,
          },
        },
        error: `Subflow call depth exceeded ${MAX_SUBFLOW_CALL_DEPTH}`,
      }
    }

    const childResult = hasWorkflowId
      ? await this.deps.workflowRuntime.runWorkflow(Number(workflowId), inputs, { parentState: context.runtime_state })
      : await this.deps.workflowRuntime.runWorkflowByName(workflowName, inputs, { parentState: context.runtime_state })

    context.variables.set(`node.${context.node.id}.subflow`, childResult)

    const outputs: Record<string, unknown> = {
      subflow: {
        workflow_id: childResult.workflow_id,
        run_id: childResult.run_id,
        status: childResult.status,
        outputs: childResult.outputs,
        trace_count: childResult.trace.length,
        trace: summarizeSubflowTrace(childResult.trace),
      },
      trigger: childResult.status === 'succeeded',
    }

    if (outputKey && childResult.outputs[outputKey] !== undefined) {
      outputs.value = childResult.outputs[outputKey]
      context.variables.set(`node.${context.node.id}.value`, childResult.outputs[outputKey])
    }

    return {
      status: childResult.status === 'succeeded' ? 'succeeded' : 'failed',
      outputs,
      error: childResult.status === 'succeeded' ? undefined : childResult.error ?? 'Subflow failed',
    }
  }
}

export class CodeWorkflowNode extends WorkflowNodeBase {
  protected runInternal(context: NodeExecutionContext): WorkflowNodeRunOutcome {
    const config = context.node.config
    const code = (config.code as string) ?? ''

    try {
      const fn = new Function('inputs', 'variables', code)
      const inputs = (config.inputs as Record<string, unknown>) ?? {}
      const resolvedInputs: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(inputs)) {
        resolvedInputs[key] = context.resolveValue(value)
      }
      const outputs = fn(resolvedInputs, context.variables.toJSON())
      if (outputs && typeof outputs === 'object') {
        for (const [key, value] of Object.entries(outputs as Record<string, unknown>)) {
          context.variables.set(`node.${context.node.id}.${key}`, value)
        }
      }
      return { status: 'succeeded', outputs: { outputs: outputs ?? {}, trigger: true } }
    } catch (err) {
      return { status: 'failed', outputs: {}, error: (err as Error).message }
    }
  }
}

export class AnswerWorkflowNode extends WorkflowNodeBase {
  protected runInternal(context: NodeExecutionContext): WorkflowNodeRunOutcome {
    const message = context.resolveTemplate(String(context.node.config.message ?? ''))
    context.variables.set(`node.${context.node.id}.answer`, message)
    return { status: 'succeeded', outputs: { answer: message } }
  }
}

export class ExecutorCallWorkflowNode extends WorkflowNodeBase {
  protected async runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> {
    const config = context.node.config
    const executorName = String(context.resolveValue(config.executor_name) ?? '')
    if (!executorName) {
      return { status: 'failed', outputs: {}, error: 'Missing executor_name' }
    }

    const params = (context.resolveValue(config.params ?? {}) as Record<string, unknown>) ?? {}
    const result = await this.deps.executorGateway.invoke(executorName, params)
    context.variables.set(`node.${context.node.id}.result`, result)

    if (result.status === 'error') {
      return {
        status: 'failed',
        outputs: { result },
        error: result.message ?? result.error,
      }
    }

    const nestedResult = asRecord(result.data)
    if (nestedResult.status === 'error') {
      return {
        status: 'failed',
        outputs: { result: result.data, gateway_result: result },
        error: String(nestedResult.message ?? nestedResult.error ?? 'Executor returned an error'),
      }
    }

    return {
      status: 'succeeded',
      outputs: { result: result.data, trigger: true },
    }
  }
}

export class KnowledgeRetrieveWorkflowNode extends WorkflowNodeBase {
  protected async runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> {
    const config = context.node.config
    const query = String(context.resolveValue(config.query) ?? '').trim()
    const limit = Math.max(1, Number(context.resolveValue(config.limit ?? 5) ?? 5))
    const source = String(context.resolveValue(config.source ?? 'search'))

    let hits: unknown[] = []
    if (source === 'compiled_plan') {
      hits = this.deps.memoryKernel.listCompiledKnowledge({ kind: 'compiled_plan', limit })
    } else if (source === 'compiled') {
      hits = this.deps.memoryKernel.listCompiledKnowledge({ limit })
    } else if (source === 'semantic' && query) {
      hits = await this.deps.memoryKernel.semanticSearch(query, limit)
    } else if (query) {
      hits = this.deps.memoryKernel.search(query).slice(0, limit)
    }

    context.variables.set(`node.${context.node.id}.hits`, hits)
    return {
      status: 'succeeded',
      outputs: { hits, trigger: true },
    }
  }
}

export class CandidatePlanResolveWorkflowNode extends WorkflowNodeBase {
  protected async runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> {
    const config = context.node.config
    const query = String(context.resolveValue(config.query) ?? '').trim()
    const outputKey = String(context.resolveValue(config.output_key ?? '') ?? '').trim()

    if (!query) {
      return { status: 'failed', outputs: {}, error: 'Missing candidate plan query' }
    }

    const candidates = await this.deps.candidatePlanService.resolve({ query })
    const candidatePlan = candidates[0] ?? null

    context.variables.set(`node.${context.node.id}.candidate_plans`, candidates)
    context.variables.set(`node.${context.node.id}.candidate_plan`, candidatePlan)

    const outputs: Record<string, unknown> = {
      candidate_plan: candidatePlan,
      candidate_plans: candidates,
      trigger: candidatePlan !== null,
    }

    if (candidatePlan && outputKey && typeof candidatePlan === 'object' && outputKey in (candidatePlan as Record<string, unknown>)) {
      outputs.value = (candidatePlan as Record<string, unknown>)[outputKey]
      context.variables.set(`node.${context.node.id}.value`, outputs.value)
    }

    return {
      status: candidatePlan ? 'succeeded' : 'failed',
      outputs,
      error: candidatePlan ? undefined : 'No candidate plans resolved',
    }
  }
}

export class RerankScoreWorkflowNode extends WorkflowNodeBase {
  protected async runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> {
    const config = context.node.config
    const query = String(context.resolveValue(config.query) ?? '').trim()
    const rawDocuments = context.resolveValue(config.documents ?? [])
    const documents: Array<{
      id: string
      text: string
      base_score?: number
      metadata?: Record<string, unknown>
    }> = []

    if (Array.isArray(rawDocuments)) {
      for (const [index, item] of rawDocuments.entries()) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        documents.push({
          id: String(record.id ?? `doc_${index}`),
          text: String(record.text ?? record.content ?? ''),
          base_score: record.base_score == null ? undefined : Number(record.base_score),
          metadata: record.metadata && typeof record.metadata === 'object'
            ? record.metadata as Record<string, unknown>
            : undefined,
        })
      }
    }

    if (!query || documents.length === 0) {
      return { status: 'failed', outputs: {}, error: 'Rerank node requires query and documents' }
    }

    let ranked: Array<{
      id: string
      text: string
      base_score?: number
      metadata?: Record<string, unknown>
      score: number
      lexical_score: number
    }>

    try {
      const providerResult = await this.deps.llmService.rerank({
        query,
        documents: documents.map((document) => document.text),
      })
      ranked = documents
        .map((document, index) => {
          const result = providerResult.results.find((item) => item.index === index)
          return {
            ...document,
            score: Number(result?.relevance_score ?? 0),
            lexical_score: Number(result?.relevance_score ?? 0),
          }
        })
        .sort((left, right) => right.score - left.score)
    } catch {
      ranked = await this.deps.rerankService.rankDocuments({ query, documents })
    }

    context.variables.set(`node.${context.node.id}.ranked`, ranked)
    return {
      status: 'succeeded',
      outputs: { ranked, trigger: true },
    }
  }
}

export class AgentDispatchWorkflowNode extends WorkflowNodeBase {
  protected async runInternal(context: NodeExecutionContext): Promise<WorkflowNodeRunOutcome> {
    const config = context.node.config
    const target = String(context.resolveValue(config.target) ?? '').trim()
    const task = String(context.resolveValue(config.task) ?? '').trim()
    const payload = asRecord(context.resolveValue(config.payload ?? {}))
    const executionMode = String(context.resolveValue(config.execution_mode ?? 'deferred'))

    if (!target || !task) {
      return { status: 'failed', outputs: {}, error: 'Agent dispatch requires target and task' }
    }

    const result = await this.deps.executorGateway.invoke('agent.dispatch', {
      target,
      task,
      payload,
      execution_mode: executionMode,
    })
    context.variables.set(`node.${context.node.id}.result`, result)

    if (result.status === 'error') {
      return {
        status: 'failed',
        outputs: { result },
        error: result.message ?? result.error,
      }
    }

    return {
      status: 'succeeded',
      outputs: { result: result.data, trigger: true },
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function summarizeSubflowTrace(trace: NodeTrace[]): Array<Record<string, unknown>> {
  return trace.map((step) => ({
    node_id: step.node_id,
    node_type: step.node_type,
    status: step.status,
    duration_ms: step.duration_ms,
    error: step.error,
    outputs: summarizeTraceOutputs(step.outputs),
  }))
}

function summarizeTraceOutputs(outputs: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  if (Object.prototype.hasOwnProperty.call(outputs, 'answer')) summary.answer = outputs.answer
  if (Object.prototype.hasOwnProperty.call(outputs, 'value')) summary.value = outputs.value
  if (Object.prototype.hasOwnProperty.call(outputs, 'trigger')) summary.trigger = outputs.trigger

  const result = asRecord(outputs.result)
  if (result.status) summary.result_status = result.status
  if (result.capability_id) summary.capability_id = result.capability_id
  if (result.capability) summary.capability = result.capability

  const subflow = asRecord(outputs.subflow)
  if (Object.keys(subflow).length > 0) {
    summary.subflow = {
      workflow_id: subflow.workflow_id,
      run_id: subflow.run_id,
      status: subflow.status,
      trace_count: subflow.trace_count,
    }
  }

  return summary
}
