import { getDb } from '../../db/index.js'
import { cliBridge, type CLIBridge } from '../cli-bridge/index.js'
import { executorGateway } from '../executor-gateway/index.js'
import { intentRouter as defaultIntentRouter, type RoutedCandidatePlan, type RoutedObservation } from '../intent-router/index.js'
import { llmService, type LLMChatResult, type ModelSlotName } from '../llm-provider/service.js'
import { approvalRegistry, isHighRiskCliCall, type ApprovalRecord } from '../approval/index.js'
import { memoryKernel } from '../memory-kernel/index.js'
import type { AgentEvent, AgentStreamContext, MemoryHit } from './events.js'
import type { HistoryItem } from '../conversation/index.js'

interface ApprovalRegistryInstance {
  create(turnId: string, reason: string, payload: unknown): ApprovalRecord
  wait(id: string, timeoutMs: number): Promise<'approved' | 'denied' | 'timeout'>
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

interface ExecutorGatewayInstance {
  runPlan(id: string): Promise<unknown>
  invoke(name: string, params: Record<string, unknown>): Promise<unknown>
}

export type { AgentEvent, AgentStreamContext, MemoryHit } from './events.js'

export interface ConversationContext {
  conversation_id: number
  history: HistoryItem[]
  channel?: string
  user_id?: string
  agent_instance_id?: number | null
  working_context?: Record<string, unknown>
  summary?: string
}

export interface AgentResponse {
  level: 1 | 2 | 3
  content: string
  actions?: Array<{ success: boolean; data?: unknown; error?: string }>
  metadata: {
    processing_time_ms: number
    completed_message?: string
    matched_rule?: number
    matched_plan_id?: string
    recalled_memories?: number
    plan_executable?: boolean
    target_device_id?: string
    tool_calls?: number
    normalized_intent?: string
    route_reason?: string
    candidate_plan_ids?: string[]
  }
}

class AgentRuntime {
  constructor(
    private readonly intentRouter = defaultIntentRouter,
    private readonly cliBridge: CLIBridge = cliBridge,
    private readonly executorGateway: ExecutorGatewayInstance = executorGateway,
    private readonly approvalRegistry: ApprovalRegistryInstance = approvalRegistry,
    private readonly memoryKernel: MemoryKernelInstance = memoryKernel,
  ) {}

  async *processMessageStream(
    message: string,
    context: AgentStreamContext,
  ): AsyncGenerator<AgentEvent, void, void> {
    const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const start = Date.now()
    yield { type: 'turn.start', turn_id: turnId, message, timestamp: start }

    const route = await this.intentRouter.route({
      message,
      history: context.history,
      working_context: context.working_context,
    })
    const routingMessage = route.routing_message
    const targetDeviceId = route.completion.target_device_id

    const contextPatch: Record<string, unknown> = {
      normalized_intent: route.normalized_intent,
      route_level: route.route_level,
      route_reason: route.reason,
      route_confidence: route.confidence,
      candidate_plan_ids: this.toCandidatePlanRefs(route.candidate_plans),
    }
    if (targetDeviceId) {
      contextPatch.target_device_id = targetDeviceId
    }
    if (route.matched_plan?.id) {
      contextPatch.matched_plan_id = route.matched_plan.id
    }
    yield { type: 'context.patch', turn_id: turnId, patch: contextPatch }
    yield {
      type: 'route.preview',
      turn_id: turnId,
      normalized_intent: route.normalized_intent,
      route_level: route.route_level,
      reason: route.reason,
      confidence: route.confidence,
      allow_tool_calls: route.allow_tool_calls,
      evidence: route.evidence.slice(0, 8),
      observations: route.observations.slice(0, 5).map((item) => ({
        id: item.id,
        name: item.name,
        score: item.score,
        last_action: item.last_action,
        last_error: item.last_error,
      })),
      search_hits: route.search_hits.slice(0, 5).map((item) => ({
        id: item.id,
        type: item.type,
        source: item.source,
        score: item.score,
      })),
      candidate_plans: route.candidate_plans.slice(0, 5).map((plan) => ({
        id: plan.id,
        title: plan.title,
        source: plan.source,
        candidate_kind: plan.candidate_kind,
        confidence: plan.confidence,
        goal: plan.goal,
        entities: plan.entities,
        assumptions: plan.assumptions,
        risks: plan.risks,
        evidence: plan.evidence,
        plan_id: plan.plan_id,
        compiled_knowledge_id: plan.compiled_knowledge_id,
      })),
    }

    if (route.route_level === 1) {
      if (route.matched_plan) {
        const planResult = await this.executorGateway.runPlan(route.matched_plan.id)
        for (const stepResult of planResult.results) {
          yield {
            type: 'plan.step.start',
            turn_id: turnId,
            plan_id: route.matched_plan.id,
            step_order: stepResult.order,
            tool: stepResult.tool,
            action: stepResult.action,
          }
          yield {
            type: 'plan.step.end',
            turn_id: turnId,
            plan_id: route.matched_plan.id,
            step_order: stepResult.order,
            status: stepResult.status === 'success' ? 'success' : 'error',
            result: stepResult.result,
            error: stepResult.error,
          }
        }
        const failedStep = planResult.results.find((result) => result.status === 'error')
        const successCount = planResult.results.filter((result) => result.status === 'success').length
        const finalStep = planResult.results[planResult.results.length - 1]
        const launchedPackage = this.extractLaunchedPackage(finalStep?.result)
        const content = failedStep
          ? `Compiled plan failed at step ${failedStep.order}: ${failedStep.tool}.${failedStep.action}.`
          : launchedPackage
            ? `Bilibili is ready on Toshiba TV. Ran ${successCount} compiled steps and launched ${launchedPackage}.`
            : `Compiled plan ${route.matched_plan.name} ran ${successCount} steps.`
        yield { type: 'assistant.final', turn_id: turnId, content }
        yield { type: 'turn.end', turn_id: turnId, duration_ms: Date.now() - start, level: 1 }
        return
      }

      if (route.matched_rule) {
        for (const action of route.matched_rule.actions.sort((left, right) => left.order - right.order)) {
          const callId = `call_${turnId}_rule_${action.order}`
          yield {
            type: 'tool.call.start',
            turn_id: turnId,
            call_id: callId,
            kind: 'service',
            name: `rule.${action.order}`,
            args: action,
          }
          const stepStart = Date.now()
          const result = await this.executorGateway.invoke('service.invoke', {
            service_name: `${action.tool}.${action.action}`,
            params: action.params,
          })
          yield {
            type: 'tool.call.end',
            turn_id: turnId,
            call_id: callId,
            status: result.status === 'success' ? 'success' : 'error',
            result: result.status === 'success' ? result.data : undefined,
            error: result.status === 'error' ? (result.message ?? result.error) : undefined,
            duration_ms: Date.now() - stepStart,
          }
          if (result.status === 'error') break
        }
        yield {
          type: 'assistant.final',
          turn_id: turnId,
          content: `Action completed via rule ${route.matched_rule.rule_id}.`,
        }
        yield { type: 'turn.end', turn_id: turnId, duration_ms: Date.now() - start, level: 1 }
        return
      }

      if (route.matched_skill) {
        yield { type: 'assistant.final', turn_id: turnId, content: `Matched skill: ${route.matched_skill}` }
        yield { type: 'turn.end', turn_id: turnId, duration_ms: Date.now() - start, level: 1 }
        return
      }
    }

    const hits = this.buildMemoryHits(route.observations, route.search_hits, route.candidate_plans)
    if (hits.length > 0) {
      yield { type: 'memory.recall', turn_id: turnId, query: routingMessage, hits }
    }

    const slot: ModelSlotName = route.route_level === 2 ? 'fast' : 'planner'
    yield* this.llmInferStream(
      turnId,
      routingMessage,
      context,
      start,
      targetDeviceId,
      hits,
      route.candidate_plans,
      slot,
      route.normalized_intent,
      route.allow_tool_calls,
    )
    yield {
      type: 'turn.end',
      turn_id: turnId,
      duration_ms: Date.now() - start,
      level: route.route_level === 2 ? 2 : 3,
    }
  }

  private async *llmInferStream(
    turnId: string,
    message: string,
    context: AgentStreamContext,
    start: number,
    targetDeviceId: string | undefined,
    memoryHits: MemoryHit[],
    candidatePlans: RoutedCandidatePlan[],
    slot: ModelSlotName,
    normalizedIntent: string,
    allowToolCalls: boolean,
  ): AsyncGenerator<AgentEvent, void, void> {
    const messages = this.buildInferenceMessages({
      message,
      context,
      targetDeviceId,
      memoryHits,
      candidatePlans,
      normalizedIntent,
      allowToolCalls,
    })
    const tools = allowToolCalls ? this.buildLLMTools() : undefined
    const MAX_TOOL_ROUNDS = 6
    let round = 0
    let lastContent = ''

    try {
      while (round < MAX_TOOL_ROUNDS) {
        round += 1

        // --- Streaming pass ---
        let accContent = ''
        let accToolCalls: LLMChatResult['tool_calls'] = []

        for await (const delta of llmService.chatStream({
          slot,
          messages: messages as Array<{ role: string; content: string }>,
          tools,
        })) {
          if (delta.delta != null) {
            accContent += delta.delta
            yield {
              type: 'assistant.message',
              turn_id: turnId,
              delta: delta.delta,
              content: accContent,
            }
          }
          if (delta.tool_calls && delta.tool_calls.length > 0) {
            accToolCalls = delta.tool_calls
          }
          if (delta.tool_calls && delta.tool_calls.length > 0) {
            accToolCalls = delta.tool_calls
          }
        }

        lastContent = accContent

        if (accToolCalls.length === 0) {
          yield {
            type: 'assistant.final',
            turn_id: turnId,
            content: lastContent || 'No response generated.',
          }
          return
        }

        // Emit complete assistant message with tool_calls (needed for downstream persistence)
        yield {
          type: 'assistant.message',
          turn_id: turnId,
          delta: null,
          content: accContent,
          tool_calls: accToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        }

        // Build the assistant message with tool calls for the history
        const assistantMsg = {
          role: 'assistant' as const,
          content: accContent,
          tool_calls: accToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        }
        messages.push(assistantMsg)

        for (const toolCall of accToolCalls) {
          const callId = toolCall.id
          let parsedArgs: { action?: string; params?: Record<string, unknown> } = {}
          try {
            parsedArgs = JSON.parse(toolCall.function.arguments)
          } catch {}

          const action = parsedArgs.action ?? ''
          if (isHighRiskCliCall('mi-cli', action)) {
            const approval = this.approvalRegistry.create(
              turnId,
              `High-risk device action: mi-cli.${action}`,
              { cli: 'mi-cli', action, params: parsedArgs.params },
            )
            yield {
              type: 'approval.request',
              turn_id: turnId,
              approval_id: approval.id,
              reason: approval.reason,
              payload: approval.payload,
            }
            const decision = await this.approvalRegistry.wait(approval.id, 60_000)
            if (decision !== 'approved') {
              yield {
                type: 'tool.call.start',
                turn_id: turnId,
                call_id: callId,
                kind: 'cli',
                name: toolCall.function.name,
                args: parsedArgs,
              }
              yield {
                type: 'tool.call.end',
                turn_id: turnId,
                call_id: callId,
                status: 'error',
                error: `Approval ${decision} by user.`,
                duration_ms: 0,
              }
              messages.push({
                role: 'tool',
                tool_call_id: callId,
                name: toolCall.function.name,
                content: JSON.stringify({ error: `approval_${decision}` }),
              })
              continue
            }
          }

          yield {
            type: 'tool.call.start',
            turn_id: turnId,
            call_id: callId,
            kind: 'cli',
            name: toolCall.function.name,
            args: parsedArgs,
          }

          const stepStart = Date.now()
          const cliResult = await this.cliBridge.run('mi-cli', parsedArgs.action ?? '', parsedArgs.params ?? {})

          yield {
            type: 'tool.call.end',
            turn_id: turnId,
            call_id: callId,
            status: cliResult.status === 'success' ? 'success' : 'error',
            result: cliResult.status === 'success' ? cliResult.data : undefined,
            error: cliResult.status === 'error' ? cliResult.error : undefined,
            duration_ms: Date.now() - stepStart,
          }

          try {
            this.memoryKernel.observeOutcome({
              intent: normalizedIntent,
              target_device_id: targetDeviceId,
              tool: 'mi-cli',
              action: parsedArgs.action ?? '',
              success: cliResult.status === 'success',
              error: cliResult.status === 'error' ? cliResult.error : undefined,
            })
          } catch {}

          messages.push({
            role: 'tool',
            tool_call_id: callId,
            name: toolCall.function.name,
            content: JSON.stringify(
              cliResult.status === 'success' ? cliResult.data : { error: cliResult.error },
            ),
          })
        }
      }

      yield {
        type: 'assistant.final',
        turn_id: turnId,
        content: `Max rounds (${MAX_TOOL_ROUNDS}) reached.`,
      }
    } catch (error) {
      yield {
        type: 'error',
        turn_id: turnId,
        message: (error as Error).message,
      }
    }
  }

  /**
   * Direct LLM path: skips intent router, builds a simple system prompt,
   * and streams directly through the LLM with tool access.
   * Supports multi-turn conversation via context.history.
   */
  async *processDirectStream(
    message: string,
    context: AgentStreamContext,
  ): AsyncGenerator<AgentEvent, void, void> {
    const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const start = Date.now()
    yield { type: 'turn.start', turn_id: turnId, message, timestamp: start }

    const db = getDb()
    const devices = db
      .prepare('SELECT did, name, model, connection_type FROM devices ORDER BY last_seen DESC LIMIT 20')
      .all() as Array<{ did: string; name: string; model: string; connection_type: string }>
    const entities = db
      .prepare('SELECT entity_id, device_did, domain, capability, name FROM entities WHERE enabled = 1 LIMIT 50')
      .all() as Array<{ entity_id: string; device_did: string; domain: string; capability: string; name: string }>

    const systemPrompt = [
      'You are the HomeSense control agent.',
      'You can control smart home devices and answer questions.',
      'Use the mi-cli tool when the user asks to control devices.',
      'If the user is just chatting or asking questions, respond conversationally without calling tools.',
      'Known devices:',
      ...devices.map((d) => `- ${d.name} (${d.model}, ${d.connection_type})`),
      'Known entities:',
      ...entities.map((e) => `- ${e.entity_id}: ${e.name} [${e.domain}.${e.capability}]`),
    ].join('\n')

    const messages: Array<{
      role: string
      content: string
      tool_calls?: unknown
      tool_call_id?: string
      name?: string
    }> = [
      { role: 'system', content: systemPrompt },
      ...context.history.slice(-10).map((item) => ({
        role: item.role,
        content: item.content,
        ...(item.tool_calls ? { tool_calls: item.tool_calls } : {}),
        ...(item.tool_call_id ? { tool_call_id: item.tool_call_id } : {}),
        ...(item.name ? { name: item.name } : {}),
      })),
      { role: 'user', content: message },
    ]

    const MAX_ROUNDS = 6
    let round = 0

    try {
      while (round < MAX_ROUNDS) {
        round += 1
        let accContent = ''
        let accToolCalls: LLMChatResult['tool_calls'] = []

        for await (const delta of llmService.chatStream({
          slot: 'planner',
          messages: messages as Array<{ role: string; content: string }>,
          tools: this.buildLLMTools(),
        })) {
          if (delta.delta != null) {
            accContent += delta.delta
            yield { type: 'assistant.message', turn_id: turnId, delta: delta.delta, content: accContent }
          }
          if (delta.tool_calls && delta.tool_calls.length > 0) {
            accToolCalls = delta.tool_calls
          }
        }

        if (accToolCalls.length === 0) {
          yield { type: 'assistant.final', turn_id: turnId, content: accContent || 'No response generated.' }
          yield { type: 'turn.end', turn_id: turnId, duration_ms: Date.now() - start, level: 3 }
          return
        }

        // Emit complete assistant message with tool_calls (needed for downstream persistence)
        yield {
          type: 'assistant.message',
          turn_id: turnId,
          delta: null,
          content: accContent,
          tool_calls: accToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        }

        const assistantMsg: Record<string, unknown> = {
          role: 'assistant',
          content: accContent,
          tool_calls: accToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        }
        messages.push(assistantMsg as typeof messages[0])

        for (const toolCall of accToolCalls) {
          const callId = toolCall.id
          let parsedArgs: { action?: string; params?: Record<string, unknown> } = {}
          try { parsedArgs = JSON.parse(toolCall.function.arguments) } catch {}

          const action = parsedArgs.action ?? ''
          if (isHighRiskCliCall('mi-cli', action)) {
            const approval = this.approvalRegistry.create(
              turnId, `High-risk device action: mi-cli.${action}`,
              { cli: 'mi-cli', action, params: parsedArgs.params },
            )
            yield { type: 'approval.request', turn_id: turnId, approval_id: approval.id, reason: approval.reason, payload: approval.payload }
            const decision = await this.approvalRegistry.wait(approval.id, 60_000)
            if (decision !== 'approved') {
              yield { type: 'tool.call.start', turn_id: turnId, call_id: callId, kind: 'cli', name: toolCall.function.name, args: parsedArgs }
              yield { type: 'tool.call.end', turn_id: turnId, call_id: callId, status: 'error', error: `Approval ${decision} by user.`, duration_ms: 0 }
              messages.push({ role: 'tool', tool_call_id: callId, name: toolCall.function.name, content: JSON.stringify({ error: `approval_${decision}` }) } as typeof messages[0])
              continue
            }
          }

          yield { type: 'tool.call.start', turn_id: turnId, call_id: callId, kind: 'cli', name: toolCall.function.name, args: parsedArgs }
          const stepStart = Date.now()
          const cliResult = await this.cliBridge.run('mi-cli', parsedArgs.action ?? '', parsedArgs.params ?? {})
          yield { type: 'tool.call.end', turn_id: turnId, call_id: callId, status: cliResult.status === 'success' ? 'success' : 'error', result: cliResult.status === 'success' ? cliResult.data : undefined, error: cliResult.status === 'error' ? cliResult.error : undefined, duration_ms: Date.now() - stepStart }

          messages.push({ role: 'tool', tool_call_id: callId, name: toolCall.function.name, content: JSON.stringify(cliResult.status === 'success' ? cliResult.data : { error: cliResult.error }) } as typeof messages[0])
        }
      }

      yield { type: 'assistant.final', turn_id: turnId, content: `Max rounds (${MAX_ROUNDS}) reached.` }
    } catch (error) {
      yield { type: 'error', turn_id: turnId, message: (error as Error).message }
    }

    yield { type: 'turn.end', turn_id: turnId, duration_ms: Date.now() - start, level: 3 }
  }

  async processMessage(message: string, context: ConversationContext): Promise<AgentResponse> {
    const start = Date.now()
    const route = await this.intentRouter.route({
      message,
      history: context.history,
      working_context: context.working_context,
    })
    const routingMessage = route.routing_message
    const targetDeviceId = route.completion.target_device_id
    const metadataBase = {
      processing_time_ms: Date.now() - start,
      completed_message: routingMessage,
      target_device_id: targetDeviceId,
      normalized_intent: route.normalized_intent,
      route_reason: route.reason,
      candidate_plan_ids: this.toCandidatePlanRefs(route.candidate_plans),
    }

    if (route.route_level === 1) {
      if (route.matched_plan) {
        const planResult = await this.executorGateway.runPlan(route.matched_plan.id)
        const successCount = planResult.results.filter((result) => result.status === 'success').length
        const failedStep = planResult.results.find((result) => result.status === 'error')
        const finalStep = planResult.results[planResult.results.length - 1]
        const launchedPackage = this.extractLaunchedPackage(finalStep?.result)

        return {
          level: 1,
          content: failedStep
            ? `Compiled plan failed at step ${failedStep.order}: ${failedStep.tool}.${failedStep.action}.`
            : launchedPackage
              ? `Bilibili is ready on Toshiba TV. Ran ${successCount} compiled steps and launched ${launchedPackage}.`
              : `Compiled plan ${route.matched_plan.name} ran ${successCount} steps.`,
          actions: planResult.results.map((result) => ({
            success: result.status === 'success',
            data: result.result,
            error: result.error,
          })),
          metadata: {
            ...metadataBase,
            processing_time_ms: Date.now() - start,
            matched_plan_id: route.matched_plan.id,
            plan_executable: planResult.executable,
          },
        }
      }

      if (route.matched_rule) {
        const results: Array<{ success: boolean; data?: unknown; error?: string }> = []
        for (const action of route.matched_rule.actions.sort((left, right) => left.order - right.order)) {
          const result = await this.executorGateway.invoke('service.invoke', {
            service_name: `${action.tool}.${action.action}`,
            params: action.params,
          })
          if (result.status === 'success') {
            results.push({ success: true, data: result.data })
          } else {
            results.push({ success: false, error: result.message ?? result.error })
            break
          }
        }

        return {
          level: 1,
          content: results.every((result) => result.success) ? 'Action completed.' : 'Action partially failed.',
          actions: results,
          metadata: {
            ...metadataBase,
            processing_time_ms: Date.now() - start,
            matched_rule: route.matched_rule.rule_id,
          },
        }
      }

      if (route.matched_skill) {
        return {
          level: 1,
          content: `Matched skill: ${route.matched_skill}`,
          metadata: {
            ...metadataBase,
            processing_time_ms: Date.now() - start,
          },
        }
      }
    }

    const hits = this.buildMemoryHits(route.observations, route.search_hits, route.candidate_plans)
    return this.llmInfer(
      routingMessage,
      context,
      start,
      route.route_level === 2 ? 2 : 3,
      targetDeviceId,
      hits,
      route.candidate_plans,
      route.route_level === 2 ? 'fast' : 'planner',
      route.normalized_intent,
      route.reason,
      route.allow_tool_calls,
    )
  }

  private buildMemoryHits(
    observations: RoutedObservation[],
    searchHits: Array<{ id: string; content: string; type: string; source: string; score: number }>,
    candidatePlans: RoutedCandidatePlan[],
  ): MemoryHit[] {
    const hits: MemoryHit[] = []

    for (const observation of observations) {
      const total = observation.success_count + observation.failure_count
      const rate = total > 0 ? Math.round((observation.success_count / total) * 100) : 0
      hits.push({
        id: observation.id,
        name: observation.name,
        type: 'observation',
        snippet: `${observation.success_count} ok / ${observation.failure_count} fail (${rate}% over ${total} runs)${observation.last_action ? ` | last: ${observation.last_action}` : ''}${observation.last_error ? ` | err: ${observation.last_error}` : ''}`,
      })
    }

    for (const hit of searchHits.slice(0, 5)) {
      hits.push({
        id: hit.id,
        name: hit.content.slice(0, 80),
        type: hit.type,
        snippet: `${hit.source} | score ${hit.score.toFixed(2)}`,
      })
    }

    for (const plan of candidatePlans.slice(0, 3)) {
      hits.push({
        id: `candidate:${plan.id}`,
        name: plan.title,
        type: 'candidate_plan',
        snippet: `${plan.source} | confidence ${plan.confidence.toFixed(2)}`,
      })
    }

    return hits
  }

  private buildInferenceMessages(params: {
    message: string
    context: ConversationContext | AgentStreamContext
    targetDeviceId?: string
    memoryHits: MemoryHit[]
    candidatePlans: RoutedCandidatePlan[]
    normalizedIntent: string
    allowToolCalls?: boolean
  }): Array<{
    role: string
    content: string
    tool_calls?: unknown
    tool_call_id?: string
    name?: string
  }> {
    const db = getDb()
    const devices = db
      .prepare('SELECT did, name, model, connection_type FROM devices ORDER BY last_seen DESC LIMIT 20')
      .all() as Array<{ did: string; name: string; model: string; connection_type: string }>
    const entities = db
      .prepare('SELECT entity_id, device_did, domain, capability, name FROM entities WHERE enabled = 1 LIMIT 50')
      .all() as Array<{ entity_id: string; device_did: string; domain: string; capability: string; name: string }>

    const systemPrompt = [
      'You are the HomeSense control agent.',
      'Prefer deterministic device control and tool calls over free-form guesses.',
      'Do not invent devices, apps, services, or platforms that are not explicitly present in the known devices, known entities, recalled memory, or compiled candidate plans.',
      'Executor names and CLI names are implementation details, not end-user app names. Never present them as user-facing applications unless the source data explicitly says so.',
      `Channel: ${params.context.channel ?? 'web'}`,
      `User: ${params.context.user_id ?? 'local'}`,
      `Normalized intent: ${params.normalizedIntent}`,
      params.allowToolCalls === false
        ? 'Mode: explain_only. This turn is informational or exploratory. Do not claim that actions have been executed. Do not emit action steps unless the user explicitly asks to perform them.'
        : 'Mode: act_or_plan. Prefer deterministic execution when the user clearly asks to do something.',
      params.context.summary ? `Conversation summary: ${params.context.summary}` : '',
      params.targetDeviceId ? `Resolved target device: ${params.targetDeviceId}` : '',
      params.candidatePlans.length > 0 ? 'Compiled candidate plans:' : '',
      ...params.candidatePlans.slice(0, 3).map((plan) =>
        `- ${plan.title} [${plan.source}] confidence=${plan.confidence.toFixed(2)}${plan.steps.length > 0 ? ` steps=${plan.steps.slice(0, 4).map((step) => `${step.tool}.${step.action}`).join(' -> ')}` : ''}`,
      ),
      params.memoryHits.length > 0 ? 'Recalled memory:' : '',
      ...params.memoryHits.slice(0, 8).map((hit) => `- [${hit.type}] ${hit.name}${hit.snippet ? ` | ${hit.snippet}` : ''}`),
      'Known devices:',
      ...devices.map((device) => `- ${device.name} (${device.model}, ${device.connection_type})`),
      'Known entities:',
      ...entities.map((entity) => `- ${entity.entity_id}: ${entity.name} [${entity.domain}.${entity.capability}]`),
    ]
      .filter(Boolean)
      .join('\n')

    return [
      { role: 'system', content: systemPrompt },
      ...params.context.history.slice(-10).map((item) => ({
        role: item.role,
        content: item.content,
        ...(item.tool_calls ? { tool_calls: item.tool_calls } : {}),
        ...(item.tool_call_id ? { tool_call_id: item.tool_call_id } : {}),
        ...(item.name ? { name: item.name } : {}),
      })),
      { role: 'user', content: params.message },
    ]
  }

  private buildLLMTools() {
    return [
      {
        type: 'function' as const,
        function: {
          name: 'mi-cli',
          description: 'Control Xiaomi and related HomeSense device actions. Use device_action for executing device capabilities (turn_on, volume_up, etc.) and device_prop for reading/writing properties (power, brightness, etc.).',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['device_action', 'device_prop', 'discover', 'get_prop', 'set_prop', 'run_action', 'login_qr', 'login_status'],
                description: 'Preferred: device_action (control by capability name), device_prop (read/write property by name), discover (list devices). Low-level: run_action, get_prop, set_prop (require raw MIoT IDs).',
              },
              params: {
                type: 'object',
                description: 'For device_action: {did, capability, params?}. For device_prop: {did, capability, value?}. For discover: {renew? true} (slow, use sparingly).',
              },
            },
            required: ['action'],
          },
        },
      },
    ]
  }

  private async llmInfer(
    message: string,
    context: ConversationContext,
    start: number,
    level: 2 | 3,
    targetDeviceId: string | undefined,
    memoryHits: MemoryHit[],
    candidatePlans: RoutedCandidatePlan[],
    slot: ModelSlotName,
    normalizedIntent: string,
    routeReason: string,
    allowToolCalls: boolean,
  ): Promise<AgentResponse> {
    const messages = this.buildInferenceMessages({
      message,
      context,
      targetDeviceId,
      memoryHits,
      candidatePlans,
      normalizedIntent,
      allowToolCalls,
    })
    const tools = allowToolCalls ? this.buildLLMTools() : undefined

    let toolCallCount = 0

    try {
      const result = await llmService.chat({ slot, messages, tools })

      if (result.tool_calls && result.tool_calls.length > 0) {
        const actionResults: Array<{ success: boolean; data?: unknown; error?: string }> = []
        for (const toolCall of result.tool_calls) {
          const args = JSON.parse(toolCall.function.arguments) as {
            action: string
            params?: Record<string, unknown>
          }
          const cliResult = await this.cliBridge.run('mi-cli', args.action, args.params ?? {})
          toolCallCount += 1

          try {
            this.memoryKernel.observeOutcome({
              intent: normalizedIntent,
              target_device_id: targetDeviceId,
              tool: 'mi-cli',
              action: args.action,
              success: cliResult.status === 'success',
              error: cliResult.status === 'error' ? cliResult.error : undefined,
            })
          } catch {}

          if (cliResult.status === 'success') {
            actionResults.push({ success: true, data: cliResult.data })
          } else {
            actionResults.push({ success: false, error: cliResult.error })
          }
        }

        return {
          level,
          content: actionResults.every((resultItem) => resultItem.success)
            ? 'Device actions completed.'
            : 'Some device actions failed.',
          actions: actionResults,
          metadata: {
            processing_time_ms: Date.now() - start,
            completed_message: message,
            target_device_id: targetDeviceId,
            tool_calls: toolCallCount,
            recalled_memories: memoryHits.length,
            normalized_intent: normalizedIntent,
            route_reason: routeReason,
            candidate_plan_ids: this.toCandidatePlanRefs(candidatePlans),
          },
        }
      }

      return {
        level,
        content: result.content ?? 'No response generated.',
        metadata: {
          processing_time_ms: Date.now() - start,
          completed_message: message,
          target_device_id: targetDeviceId,
          tool_calls: toolCallCount,
          recalled_memories: memoryHits.length,
          normalized_intent: normalizedIntent,
          route_reason: routeReason,
          candidate_plan_ids: this.toCandidatePlanRefs(candidatePlans),
        },
      }
    } catch (error) {
      return {
        level,
        content: `LLM call failed: ${(error as Error).message}`,
        metadata: {
          processing_time_ms: Date.now() - start,
          completed_message: message,
          target_device_id: targetDeviceId,
          tool_calls: toolCallCount,
          recalled_memories: memoryHits.length,
          normalized_intent: normalizedIntent,
          route_reason: routeReason,
          candidate_plan_ids: this.toCandidatePlanRefs(candidatePlans),
        },
      }
    }
  }

  private toCandidatePlanRefs(plans: RoutedCandidatePlan[]): string[] {
    return Array.from(new Set(plans.map((plan) => this.toCandidatePlanRef(plan))))
  }

  private toCandidatePlanRef(plan: RoutedCandidatePlan): string {
    if (plan.plan_id) return plan.plan_id
    if (plan.compiled_knowledge_id != null) return `compiled:${plan.compiled_knowledge_id}`
    return plan.id
  }

  private extractLaunchedPackage(result: unknown): string | undefined {
    if (!result || typeof result !== 'object') return undefined
    const cliResult = result as { data?: { launched?: string } }
    return cliResult.data?.launched
  }
}

export const agentRuntime = new AgentRuntime()
