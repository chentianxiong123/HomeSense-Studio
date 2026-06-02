import { StateGraph, START, END, Annotation } from '@langchain/langgraph'
import { llmService } from '../llm-provider/service.js'
import { executorGateway } from '../executor-gateway/index.js'
import type { ExecutorInvokeResult } from '../executor-gateway/index.js'
import { intentRouter, type IntentRouterResult } from '../intent/index.js'
import { approvalRegistry, isHighRiskCliCall } from '../approval/index.js'
import { matchCommand } from '../integration/command.routes.js'
import { shouldAttemptL1Reflex } from '../integration/command.l1-reflex-policy.js'
import {
  DEVICE_AGENT_TOOL_DEFINITIONS,
  executeDeviceAgentTool,
  isDeviceAgentTool,
} from '../device/device-agent-tools.js'
import { getDb } from '../../db/index.js'
import {
  buildDeviceCardProjection,
  type DeviceCardRow,
} from '../device/device-card-projection.js'
import { buildDeviceRuntimeManifest } from '../device/device-runtime-manifest.js'
import {
  WORKFLOW_AGENT_TOOL_DEFINITIONS,
  executeWorkflowAgentTool,
  isWorkflowAgentTool,
} from '../workflow/workflow-agent-tools.js'
import {
  SYSTEM_AGENT_TOOL_DEFINITIONS,
  executeSystemAgentTool,
  isSystemAgentTool,
} from '../system-tools/index.js'
import { getL3Agent, type L3Agent } from './l3/index.js'
import {
  classifyL3ToolPolicy,
  describeToolPolicy,
  filterToolDefinitionsForPolicy,
  isToolAllowedByPolicy,
  type L3ToolPolicyKind,
} from './l3/tool-policy.js'
import type { CandidatePlan } from '../candidate-plan/index.js'
import type { PlanStepDefinition } from '../plan-library/index.js'
import type { RuleAction } from '../rule/index.js'
import type { RuntimeContextWindow } from '../runtime/index.js'

export interface RuntimeTraceEvent {
  stage: 'runtime.intent' | 'runtime.context' | 'runtime.l1.command' | 'runtime.l1.rule' | 'runtime.l2.candidates' | 'runtime.decision' | 'runtime.l3.llm' | 'runtime.execution'
  status: 'hit' | 'miss' | 'skipped' | 'execute' | 'fallback' | 'success' | 'error' | 'approval_required'
  title: string
  detail?: string
  confidence?: number
  data?: Record<string, unknown>
}

type PromptMode = 'unified'
type LightIntentKind = 'chat' | 'device_control' | 'device_query' | 'ambiguous_device_action' | 'memory_note' | 'meta'
type PromptContextPolicy = 'current_only' | 'light_recent' | 'recent' | 'device_focused'

interface LightIntent {
  kind: LightIntentKind
  prompt_mode: PromptMode
  context_policy: PromptContextPolicy
  allow_tools: boolean
  l1_allowed?: boolean
  tool_policy?: L3ToolPolicyKind
  tool_policy_reason?: string
  confidence: number
  reason: string
}

interface DeviceInventoryItem {
  id: number
  name: string
  device_type: string
  room: string | null
  room_id: number | null
  online: boolean | null
  online_checked: boolean
  ping_target: string | null
  bindings: {
    mi: boolean
    adb: boolean
    ip: boolean
  }
  sources: string[]
}

// ── State ──
export const ChatReActState = Annotation.Root({
  messages: Annotation<any[]>({
    default: () => [],
    reducer: (curr, next) => [...curr, ...next],
  }),
  input: Annotation<string>({
    default: () => '',
    reducer: (_, next) => next,
  }),
  conversationId: Annotation<number>({
    default: () => 0,
    reducer: (_, next) => next,
  }),
  currentToolCall: Annotation<any>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
  pendingToolCalls: Annotation<any[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),
  isComplete: Annotation<boolean>({
    default: () => false,
    reducer: (_, next) => next,
  }),
  finalResponse: Annotation<string>({
    default: () => '',
    reducer: (_, next) => next,
  }),
  runtimeRoute: Annotation<IntentRouterResult | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
  l1Command: Annotation<CommandMatch | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
  runtimeTrace: Annotation<RuntimeTraceEvent[]>({
    default: () => [],
    reducer: (curr, next) => [...curr, ...next],
  }),
  runtimeContext: Annotation<RuntimeContextWindow | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
  lightIntent: Annotation<LightIntent | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
  deviceInventory: Annotation<DeviceInventoryItem[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),
  error: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
})

type State = typeof ChatReActState.State

type CommandMatch = NonNullable<ReturnType<typeof matchCommand>>

type ExecutablePlan =
  | { kind: 'matched_plan'; title: string; confidence: number; steps: PlanStepDefinition[]; planId: string }
  | { kind: 'candidate'; title: string; confidence: number; steps: PlanStepDefinition[]; planId?: string; candidateId: string }
  | { kind: 'matched_rule'; title: string; confidence: number; steps: PlanStepDefinition[]; ruleId: number }

interface ResolvedExecutionStep {
  order: number
  tool: string
  action: string
  params: Record<string, unknown>
  executorName: string
  invokeParams: Record<string, unknown>
}

const L2_DIRECT_EXECUTION_THRESHOLD = 0.84
const CHAT_AGENT_TOOL_DEFINITIONS = [
  ...DEVICE_AGENT_TOOL_DEFINITIONS,
  ...WORKFLOW_AGENT_TOOL_DEFINITIONS,
  ...SYSTEM_AGENT_TOOL_DEFINITIONS,
]

async function lightIntentNode(state: State): Promise<Partial<State>> {
  const baseIntent = classifyLightIntent(state.input, state.runtimeContext)
  const toolPolicy = classifyL3ToolPolicy(state.input, state.runtimeContext)
  const intent: LightIntent = {
    ...baseIntent,
    allow_tools: toolPolicy.kind !== 'none',
    l1_allowed: toolPolicy.l1_reflex_allowed,
    tool_policy: toolPolicy.kind,
    tool_policy_reason: toolPolicy.reason,
  }
  const deviceInventory = await buildDeviceInventorySnapshot()
  const runtimeTrace: RuntimeTraceEvent[] = [
    {
      stage: 'runtime.intent',
      status: intent.allow_tools ? 'execute' : 'skipped',
      title: `Intent: ${intent.kind}`,
      detail: intent.reason,
      confidence: intent.confidence,
      data: {
        prompt_mode: intent.prompt_mode,
        context_policy: intent.context_policy,
        allow_tools: intent.allow_tools,
        l1_allowed: intent.l1_allowed,
        tool_policy: intent.tool_policy,
        tool_policy_reason: intent.tool_policy_reason,
      },
    },
  ]

  runtimeTrace.push({
    stage: 'runtime.context',
    status: 'success',
    title: '设备清单已读取',
    detail: `已读取 ${deviceInventory.length} 个设备；当前位置和当前设备上下文会作为模型感知提供。`,
    data: {
      disclosure: 'device_inventory_only',
      tools_available: intent.allow_tools,
      tool_policy: intent.tool_policy,
      l1_allowed: intent.l1_allowed,
      context_usage: state.runtimeContext?.context_usage,
      max_turns: state.runtimeContext?.max_turns,
      ttl_ms: state.runtimeContext?.ttl_ms,
      retrieval_limit: state.runtimeContext?.retrieval_limit,
      retrieval_hit_count: state.runtimeContext?.retrieval_hits.length ?? 0,
      session_active: state.runtimeContext?.session_active,
      expires_at: state.runtimeContext?.expires_at,
      devices: deviceInventory,
    },
  })

  return {
    lightIntent: intent,
    deviceInventory,
    runtimeTrace,
  }
}

async function executeContextCommand(match: CommandMatch): Promise<ExecutorInvokeResult> {
  return executeDeviceAgentTool('execute_device_capability', {
    device_id: match.device_id,
    capability: match.capability,
    arguments: match.ir_key ? { key: match.ir_key } : {},
  })
}

async function l1ContextCommandNode(state: State): Promise<Partial<State>> {
  const reflexGate = shouldAttemptL1Reflex(state.input)
  if (!reflexGate.allowed) {
    return {
      runtimeTrace: [
        {
          stage: 'runtime.l1.command',
          status: 'skipped',
          title: 'L1 反射层跳过',
          detail: reflexGate.reason,
          data: { input: state.input },
        },
      ],
    }
  }

  const match = matchCommand(state.input, state.runtimeContext) ?? undefined
  if (!match) {
    return {
      runtimeTrace: [
        {
          stage: 'runtime.l1.command',
          status: 'miss',
          title: '快捷匹配未命中',
          detail: '没有匹配到当前设备或能力别名，交给模型按原文处理。',
        },
      ],
    }
  }
  const device = match.device_id ? buildTraceDevicePayload(match.device_id) : undefined

  return {
    l1Command: match,
    runtimeTrace: [
      {
        stage: 'runtime.l1.command',
        status: match.device_id ? 'hit' : 'miss',
        title: match.device_id ? '快捷匹配命中' : '找到能力别名但缺少设备',
        detail: `${match.alias} -> ${match.capability}${match.ir_key ? ` / ${match.ir_key}` : ''}`,
        confidence: match.device_id ? 1 : 0.6,
        data: {
          device_id: match.device_id,
          capability: match.capability,
          ir_key: match.ir_key,
          stripped_input: match.stripped_input,
          mentioned_device: match.mentioned_device,
          context_device_id: state.runtimeContext?.working_context.current_device,
          device,
        },
      },
    ],
  }
}

function buildTraceDevicePayload(deviceId: number): Record<string, unknown> | undefined {
  try {
    const device = getDb().prepare(`
      SELECT d.*, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.id = ?
    `).get(deviceId) as DeviceCardRow | undefined
    if (!device) return undefined
    const card = buildDeviceCardProjection(device)
    return {
      id: device.id,
      name: device.name,
      device_type: device.device_type,
      room: card.room.name,
      room_id: card.room.id,
      sources: card.sources,
      card,
    }
  } catch {
    return undefined
  }
}

async function l1ContextExecutionNode(state: State): Promise<Partial<State>> {
  const match = state.l1Command
  if (!match?.device_id) {
    return {}
  }

  const executeToolCallId = `l1_execute_${Date.now()}`
  const executeToolName = 'context-command'
  const args = {
    device_id: match.device_id,
    capability: match.capability,
    ir_key: match.ir_key,
  }
  const assistantMsg = {
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: executeToolCallId,
        type: 'function' as const,
        function: {
          name: executeToolName,
          arguments: JSON.stringify(args),
        },
      },
    ],
  }

  const result = await executeContextCommand(match)
  const executeToolMsg = {
    role: 'tool',
    tool_call_id: executeToolCallId,
    name: executeToolName,
    content: result.status === 'success'
      ? JSON.stringify(result.data ?? { status: 'ok' })
      : JSON.stringify({ error: result.message ?? result.error ?? 'Unknown error' }),
  }

  return {
    messages: [assistantMsg, executeToolMsg],
    runtimeTrace: [
      {
        stage: 'runtime.decision',
        status: result.status === 'success' ? 'execute' : 'error',
        title: result.status === 'success' ? '快捷路径已执行' : '快捷路径执行失败',
        detail: `${match.capability}${match.ir_key ? ` / ${match.ir_key}` : ''}`,
        confidence: 1,
        data: args,
      },
      {
        stage: 'runtime.execution',
        status: result.status === 'success' ? 'success' : 'error',
        title: `设备 ${match.device_id}: ${match.capability}`,
        detail: result.status === 'error' ? result.message ?? result.error : undefined,
      },
    ],
    finalResponse: result.status === 'success'
      ? `已执行：${match.capability}${match.ir_key ? `（${match.ir_key}）` : ''}。`
      : `快捷匹配到了「${match.alias}」，但执行失败：${result.message ?? result.error ?? '未知错误'}`,
    isComplete: true,
    currentToolCall: undefined,
  }
}

// ── Node: Runtime route ──
async function runtimeRouteNode(state: State): Promise<Partial<State>> {
  try {
    const route = await intentRouter.route({
      message: state.input,
      working_context: {
        ...state.runtimeContext?.working_context,
        use_original_query: true,
        context_window_max_turns: state.runtimeContext?.max_turns,
      },
      history: (state.runtimeContext?.recent_messages ?? state.messages)
        .filter((message) => typeof message.role === 'string' && typeof message.content === 'string')
        .map((message) => ({ role: message.role, content: message.content })),
    })

    return {
      runtimeRoute: route,
      runtimeTrace: buildRouteTrace(route),
    }
  } catch {
    return {
      runtimeRoute: undefined,
      runtimeTrace: [
        {
          stage: 'runtime.context',
          status: 'error',
          title: 'Runtime route failed',
          detail: 'Intent router threw before producing a route.',
        },
      ],
    }
  }
}

// ── Node: Runtime direct execution ──
async function runtimeExecutionNode(state: State): Promise<Partial<State>> {
  const selected = selectExecutablePlan(state.runtimeRoute)
  if (!selected) {
    return {}
  }

  const resolvedSteps = selected.steps.map((step, index) => resolveExecutionStep(step, index + 1))
  if (resolvedSteps.some((step) => step === null)) {
    return {
      finalResponse: '找到了候选路径，但里面有当前运行时还不能安全执行的步骤。',
      isComplete: true,
    }
  }

  const steps = resolvedSteps as ResolvedExecutionStep[]
  const toolCalls = steps.map((step) => ({
    id: `l2_${Date.now()}_${step.order}`,
    type: 'function' as const,
    function: {
      name: step.executorName,
      arguments: JSON.stringify({ action: step.action, params: step.params }),
    },
  }))

  const assistantMsg = {
    role: 'assistant',
    content: '',
    tool_calls: toolCalls,
    runtime: {
      kind: selected.kind,
      title: selected.title,
      confidence: selected.confidence,
      plan_id: selected.kind !== 'matched_rule' ? selected.planId : undefined,
      rule_id: selected.kind === 'matched_rule' ? selected.ruleId : undefined,
    },
  }

  const toolMessages: any[] = []
  const failures: string[] = []
  const turnId = `chat:${state.conversationId}:${Date.now()}`

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    const originalStep = selected.steps[index]

    if (index > 0 && originalStep) {
      if (originalStep.wait_condition) {
        const waitResult = await executeSystemAgentTool('wait_until', {
          device_id: step.params.device_id ?? originalStep.params.device_id,
          condition: originalStep.wait_condition.condition,
          expected: originalStep.wait_condition.expected,
          timeout_ms: originalStep.wait_condition.timeout_ms ?? 5000,
        })
        if (waitResult.status === 'error') {
          failures.push(waitResult.message ?? waitResult.error ?? 'wait_until timeout')
          toolMessages.push({
            role: 'tool',
            tool_call_id: toolCalls[index].id,
            name: step.executorName,
            content: JSON.stringify({ error: waitResult.message ?? waitResult.error ?? 'wait_until timeout' }),
          })
          break
        }
      } else if (originalStep.delay_ms && originalStep.delay_ms > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(originalStep.delay_ms!, 10000)))
      }
    }

    const result = await invokeResolvedStep(step, turnId)
    if (result.status === 'error') {
      failures.push(result.message ?? result.error ?? `${step.executorName}.${step.action} failed`)
    }

    toolMessages.push({
      role: 'tool',
      tool_call_id: toolCalls[index].id,
      name: step.executorName,
      content: result.status === 'success'
        ? JSON.stringify(result.data ?? { status: 'ok' })
        : JSON.stringify({ error: result.message ?? result.error ?? 'Unknown error' }),
    })

    if (result.status === 'error') break
  }

  const selectedLayer = selected.kind === 'matched_rule' ? '固定规则' : '经验路径'
  const finalResponse = failures.length > 0
    ? `${selectedLayer} 命中了「${selected.title}」，但执行失败：${failures[0]}`
    : `${selectedLayer} 命中并执行了「${selected.title}」。`

  return {
    messages: [assistantMsg, ...toolMessages],
    runtimeTrace: [
      {
        stage: 'runtime.decision',
        status: failures.length > 0 ? 'error' : 'execute',
        title: selected.kind === 'matched_rule' ? '固定规则已执行' : '经验路径已执行',
        detail: selected.title,
        confidence: selected.confidence,
        data: {
          kind: selected.kind,
          plan_id: selected.kind !== 'matched_rule' ? selected.planId : undefined,
          rule_id: selected.kind === 'matched_rule' ? selected.ruleId : undefined,
          step_count: steps.length,
        },
      },
      ...steps.map((step, index): RuntimeTraceEvent => ({
        stage: 'runtime.execution',
        status: failures.length > 0 && index === toolMessages.length - 1 ? 'error' : 'success',
        title: `${step.executorName}.${step.action}`,
        data: {
          order: step.order,
          tool: step.tool,
          params: step.params,
        },
      })),
    ],
    finalResponse,
    isComplete: true,
    currentToolCall: undefined,
  }
}

// ── Node: LLM Inference ──
async function currentInferenceNode(state: State): Promise<Partial<State>> {
  const toolPolicy = resolveL3ToolPolicyKind(state)
  const allowedTools = filterToolDefinitionsForPolicy(CHAT_AGENT_TOOL_DEFINITIONS, toolPolicy)
  const allowTools = allowedTools.length > 0
  const messages = await buildInferenceMessages(state)

  try {
    return await runLlmInference(state, messages, allowTools, allowedTools, toolPolicy, false)
  } catch (err) {
    if (isContextOverflowError(err)) {
      try {
        const compressedMessages = await buildCompressedInferenceMessages(state)
        const result = await runLlmInference(state, compressedMessages, allowTools, allowedTools, toolPolicy, true)
        return {
          ...result,
          runtimeTrace: [
            {
              stage: 'runtime.context',
              status: 'success',
              title: '上下文已压缩',
              detail: '模型返回上下文过长，系统压缩较早的会话内容后重试了一次。',
              data: {
                original_message_count: messages.length,
                compressed_message_count: compressedMessages.length,
              },
            },
            ...(result.runtimeTrace ?? []),
          ],
        }
      } catch (retryErr) {
        err = retryErr
      }
    }
    return {
      runtimeTrace: [
        {
          stage: 'runtime.l3.llm',
          status: 'error',
          title: '模型调用失败',
          detail: (err as Error).message,
        },
      ],
      error: (err as Error).message,
      isComplete: true,
    }
  }
}

async function runLlmInference(
  state: State,
  messages: any[],
  allowTools: boolean,
  allowedTools: any[],
  toolPolicy: L3ToolPolicyKind,
  compressedRetry: boolean,
): Promise<Partial<State>> {
  const params: Parameters<typeof llmService.chat>[0] = {
    messages,
  }
  if (allowTools) params.tools = allowedTools
  const result = await llmService.chat(params)
  const content = result.content ?? ''

  if (allowTools && result.tool_calls && result.tool_calls.length > 0) {
    const toolCalls = result.tool_calls.map((tc: any) => ({
      id: tc.id,
      type: 'function' as const,
      function: tc.function,
    }))
    const assistantMsg = {
      role: 'assistant',
      content,
      tool_calls: toolCalls,
    }

    return {
      messages: [assistantMsg],
      runtimeTrace: [
        {
          stage: 'runtime.decision',
          status: 'execute',
          title: compressedRetry ? '压缩后由模型处理' : '模型主导',
          detail: '统一模型处理本轮对话；运行时只决定本轮开放哪些设备工具。',
          data: {
            kind: 'llm_primary',
            allow_tools: allowTools,
            tool_policy: toolPolicy,
            allowed_tool_count: allowedTools.length,
            intent: state.lightIntent?.kind,
            compressed_retry: compressedRetry,
          },
        },
        {
          stage: 'runtime.l3.llm',
          status: 'execute',
          title: '准备调用工具',
          detail: `模型请求了 ${result.tool_calls.length} 个工具调用。`,
          data: {
            tool_calls: result.tool_calls.map((tc: any) => tc.function?.name ?? tc.name).filter(Boolean),
          },
        },
      ],
      currentToolCall: toolCalls[0],
      pendingToolCalls: toolCalls.slice(1),
      isComplete: false,
    }
  }

  return {
    messages: [{ role: 'assistant', content }],
    runtimeTrace: [
      {
        stage: 'runtime.decision',
        status: 'execute',
        title: compressedRetry ? '压缩后由模型处理' : '模型主导',
        detail: '统一模型处理本轮对话；运行时只决定本轮开放哪些设备工具。',
        data: {
          kind: 'llm_primary',
          allow_tools: allowTools,
          tool_policy: toolPolicy,
          allowed_tool_count: allowedTools.length,
          intent: state.lightIntent?.kind,
          compressed_retry: compressedRetry,
        },
      },
      {
        stage: 'runtime.l3.llm',
        status: 'execute',
        title: '直接回答',
        detail: compressedRetry
          ? '系统使用压缩后的上下文重试，并在不执行工具的情况下完成回答。'
          : '本轮不需要执行工具，由模型直接回答。',
      },
    ],
    finalResponse: content,
    isComplete: true,
  }
}

// ── Node: Execute Tool Call ──
async function currentToolsExecutionNode(state: State): Promise<Partial<State>> {
  if (!state.currentToolCall) {
    return { isComplete: true, finalResponse: 'No tool call to execute.' }
  }

  const tc = state.currentToolCall
  const fn = tc.function
  let args: Record<string, unknown> & { action?: string; params?: Record<string, unknown> } = {}
  try {
    args = JSON.parse(fn.arguments)
  } catch {}

  const toolName = fn.name
  const action = args.action ?? ''
  const toolParams = args.params ?? {}
  const toolPolicy = resolveL3ToolPolicyKind(state)
  if (!isToolAllowedByPolicy(toolName, toolPolicy)) {
    return {
      messages: [
        {
          role: 'tool',
          tool_call_id: tc.id,
          name: toolName,
          content: JSON.stringify({
            error: 'TOOL_POLICY_BLOCKED',
            message: `Tool ${toolName} is not allowed under ${toolPolicy}.`,
          }),
        },
      ],
      runtimeTrace: [
        {
          stage: 'runtime.execution',
          status: 'error',
          title: '工具策略阻断',
          detail: `当前策略 ${toolPolicy} 不允许调用 ${toolName}。`,
          data: {
            tool: toolName,
            tool_policy: toolPolicy,
          },
        },
      ],
      currentToolCall: undefined,
      pendingToolCalls: [],
      isComplete: false,
    }
  }
  const executionTitle = isWorkflowAgentTool(toolName)
    ? workflowToolTraceTitle(toolName)
    : `${toolName}.${action}`

  let result: ExecutorInvokeResult
  const preExecutionTrace: RuntimeTraceEvent[] = []

  try {
    if (isDeviceAgentTool(toolName)) {
      if (toolName === 'execute_device_capability') {
        const rehearsal = await executeDeviceAgentTool('rehearse_device_capability', args)
        preExecutionTrace.push(buildRehearsalTrace(args, rehearsal))
        if (isRehearsalPassed(rehearsal)) {
          result = await executeDeviceAgentTool(toolName, args)
        } else {
          result = {
            status: 'error',
            executor: toolName,
            error: rehearsal.message ?? rehearsal.error ?? 'SANDBOX_REHEARSAL_FAILED',
            message: rehearsal.status === 'success'
              ? readRehearsalBlockReason(rehearsal.data)
              : rehearsal.message ?? rehearsal.error ?? '沙箱演练失败，已停止真实执行。',
          }
        }
      } else {
        result = await executeDeviceAgentTool(toolName, args)
      }
    } else if (isWorkflowAgentTool(toolName)) {
      result = await executeWorkflowAgentTool(toolName, args)
    } else if (isSystemAgentTool(toolName)) {
      result = await executeSystemAgentTool(toolName, args)
    } else if (toolName.startsWith('mi-cli') || toolName.startsWith('adb')) {
      const cliName = toolName.includes('adb') ? 'adb-cli' : 'mi-cli'
      result = await invokeCliWithApproval({
        cliName,
        action,
        params: toolParams,
        turnId: `chat:${state.conversationId}:${Date.now()}`,
      })
    } else if (toolName.startsWith('service.')) {
      result = await executorGateway.invoke('service.invoke', {
        service_name: toolName.replace('service.', ''),
        params: toolParams,
      })
    } else {
      // Generic fallback to CLI
      result = await executorGateway.invoke('cli.invoke', {
        cli_name: toolName,
        action,
        params: toolParams,
      })
    }
  } catch (err) {
    result = {
      status: 'error',
      executor: toolName,
      error: (err as Error).message,
    }
  }

  const toolMsg = {
    role: 'tool',
    tool_call_id: tc.id,
    name: toolName,
    content: result.status === 'success'
      ? JSON.stringify(result.data ?? { status: 'ok' })
      : JSON.stringify({ error: result.error ?? result.message ?? 'Unknown error' }),
  }
  const pendingToolCalls = Array.isArray(state.pendingToolCalls) ? state.pendingToolCalls : []
  const nextToolCall = pendingToolCalls[0]

  return {
    messages: [toolMsg],
    runtimeTrace: [
      ...preExecutionTrace,
      {
        stage: 'runtime.execution',
        status: result.status === 'success' ? 'success' : 'error',
        title: executionTitle,
        detail: result.status === 'error' ? result.message ?? result.error : undefined,
        data: {
          tool: toolName,
          action: isDeviceAgentTool(toolName) || isWorkflowAgentTool(toolName) ? undefined : action,
          params: isDeviceAgentTool(toolName) || isWorkflowAgentTool(toolName) ? args : toolParams,
          workflow_tool: isWorkflowAgentTool(toolName)
            ? {
                name: toolName,
                args,
                status: result.status,
                result: result.status === 'success' ? result.data : undefined,
                error: result.status === 'error' ? result.message ?? result.error : undefined,
              }
            : undefined,
        },
      },
    ],
    currentToolCall: nextToolCall,
    pendingToolCalls: pendingToolCalls.slice(1),
    isComplete: false,
  }
}

const currentL3Agent: L3Agent = {
  name: 'current',
  inference: currentInferenceNode,
  executeTool: currentToolsExecutionNode,
}

async function inferenceNode(state: State): Promise<Partial<State>> {
  return getL3Agent(currentL3Agent).inference(state)
}

async function toolsExecutionNode(state: State): Promise<Partial<State>> {
  return getL3Agent(currentL3Agent).executeTool(state)
}

function isRehearsalPassed(result: ExecutorInvokeResult): boolean {
  const data = result.data as { ok?: boolean; executable?: boolean } | undefined
  return result.status === 'success' && data?.ok !== false && data?.executable !== false
}

function readRehearsalBlockReason(data: unknown): string {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>
    if (typeof record.next_step === 'string' && record.next_step.trim()) return record.next_step
    if (typeof record.reason === 'string' && record.reason.trim()) return record.reason
  }
  return '沙箱演练未通过，已停止真实执行。'
}

function buildRehearsalTrace(
  args: Record<string, unknown>,
  rehearsal: ExecutorInvokeResult,
): RuntimeTraceEvent {
  return {
    stage: 'runtime.execution',
    status: rehearsalTraceStatus(rehearsal),
    title: '沙箱演练',
    detail: rehearsalTraceDetail(rehearsal),
    data: {
      ...args,
      rehearsal: rehearsal.status === 'success' ? rehearsal.data : undefined,
    },
  }
}

function rehearsalTraceStatus(rehearsal: ExecutorInvokeResult): RuntimeTraceEvent['status'] {
  if (rehearsal.status !== 'success') return 'error'
  return isRehearsalPassed(rehearsal) ? 'success' : 'skipped'
}

function rehearsalTraceDetail(rehearsal: ExecutorInvokeResult): string | undefined {
  if (rehearsal.status !== 'success') return rehearsal.message ?? rehearsal.error
  if (isRehearsalPassed(rehearsal)) return '真实执行前已在沙箱家庭演练。'
  return readRehearsalBlockReason(rehearsal.data)
}

function workflowToolTraceTitle(toolName: string): string {
  if (toolName === 'list_workflows') return '读取工作流'
  if (toolName === 'preview_workflow') return '预演工作流'
  if (toolName === 'run_workflow') return '执行工作流'
  return '工作流工具'
}

function resolveL3ToolPolicyKind(state: State): L3ToolPolicyKind {
  if (state.lightIntent?.tool_policy) return state.lightIntent.tool_policy
  return state.lightIntent?.allow_tools ? 'execute_allowed' : 'none'
}

// ── Router ──
function routeAfterRuntime(state: State): 'runtime_execute' | 'inference' {
  return selectDirectRuntimePlan(state.runtimeRoute) ? 'runtime_execute' : 'inference'
}

function routeAfterLightIntent(state: State): 'l1_context_command' | 'inference' {
  const allowL1 = state.lightIntent?.l1_allowed ?? state.lightIntent?.allow_tools ?? false
  return allowL1 ? 'l1_context_command' : 'inference'
}

function routeAfterL1(state: State): 'l1_execute' | 'runtime_route' {
  return state.l1Command?.device_id ? 'l1_execute' : 'runtime_route'
}

function shouldContinue(state: State): 'tools' | 'end' {
  if (state.isComplete || state.error) return 'end'
  if (state.currentToolCall) return 'tools'
  return 'end'
}

function routeAfterToolExecution(state: State): 'tools' | 'inference' {
  return state.currentToolCall ? 'tools' : 'inference'
}

function selectExecutablePlan(route: IntentRouterResult | undefined): ExecutablePlan | null {
  if (!route?.allow_tool_calls) return null

  if (route.matched_rule && route.matched_rule.actions.length > 0) {
    const steps = route.matched_rule.actions
      .sort((left, right) => left.order - right.order)
      .map(ruleActionToStep)
    if (isRunnableStepList(steps)) {
      return {
        kind: 'matched_rule',
        title: route.matched_rule.trigger_pattern,
        confidence: route.matched_rule.confidence,
        steps,
        ruleId: route.matched_rule.rule_id,
      }
    }
  }

  if (route.matched_plan && isRunnableStepList(route.matched_plan.steps)) {
    return {
      kind: 'matched_plan',
      title: route.matched_plan.name,
      confidence: route.confidence,
      steps: route.matched_plan.steps,
      planId: route.matched_plan.id,
    }
  }

  const candidate = route.candidate_plans.find((item) => isExecutableCandidate(item))
  if (!candidate) return null

  return {
    kind: 'candidate',
    title: candidate.title,
    confidence: candidate.confidence,
    steps: candidate.steps,
    planId: candidate.plan_id,
    candidateId: candidate.id,
  }
}

function selectDirectRuntimePlan(route: IntentRouterResult | undefined): ExecutablePlan | null {
  const selected = selectExecutablePlan(route)
  return selected?.kind === 'matched_rule' ? selected : null
}

function isExecutableCandidate(candidate: CandidatePlan): boolean {
  if (candidate.confidence < L2_DIRECT_EXECUTION_THRESHOLD) return false
  return isRunnableStepList(candidate.steps)
}

function isRunnableStepList(steps: PlanStepDefinition[]): boolean {
  return steps.length > 0 && steps.every((step, index) => resolveExecutionStep(step, index + 1) !== null)
}

function resolveExecutionStep(step: PlanStepDefinition, order: number): ResolvedExecutionStep | null {
  const tool = step.tool.trim()
  const action = step.action.trim()
  if (!tool || !action) return null

  if (tool === 'adb' || tool === 'adb-cli') {
    return {
      order,
      tool,
      action,
      params: step.params,
      executorName: 'adb',
      invokeParams: {
        cli_name: 'adb-cli',
        action,
        params: step.params,
      },
    }
  }

  if (tool === 'mi-cli') {
    return {
      order,
      tool,
      action,
      params: step.params,
      executorName: 'mi-cli',
      invokeParams: {
        cli_name: 'mi-cli',
        action,
        params: step.params,
      },
    }
  }

  if (tool === 'device_agent' && action === 'execute_device_capability') {
    return {
      order,
      tool,
      action,
      params: step.params,
      executorName: 'execute_device_capability',
      invokeParams: step.params,
    }
  }

  if (tool === 'workflow' && action === 'run_workflow') {
    return {
      order,
      tool,
      action,
      params: step.params,
      executorName: 'run_workflow',
      invokeParams: step.params,
    }
  }

  return null
}

function classifyLightIntent(input: string, context: RuntimeContextWindow | undefined): LightIntent {
  const text = input.trim()
  const normalized = text.toLowerCase()
  const compact = normalized.replace(/\s+/g, '')
  const hasActiveDevice = Boolean(context?.working_context.current_device)

  if (/^(你好|您好|hello|hi|嗨|在吗|你在吗|hey)[!！。？?\s]*$/i.test(text)) {
    return {
      kind: 'chat',
      prompt_mode: 'unified',
      context_policy: 'light_recent',
      allow_tools: false,
      confidence: 0.96,
      reason: 'greeting without device-action intent',
    }
  }

  if (/(你是谁|你能做什么|帮助|help|怎么用)/i.test(text)) {
    return {
      kind: 'meta',
      prompt_mode: 'unified',
      context_policy: 'recent',
      allow_tools: false,
      confidence: 0.86,
      reason: 'assistant-meta or help intent',
    }
  }

  if (/(记住|以后|我喜欢|我不喜欢|偏好|习惯)/.test(text)) {
    return {
      kind: 'memory_note',
      prompt_mode: 'unified',
      context_policy: 'recent',
      allow_tools: false,
      confidence: 0.78,
      reason: 'memory-oriented conversational intent',
    }
  }

  const deviceWords = ['电视', '机顶盒', '盒子', '音箱', '小爱', '空调', '灯', '插座', '手机', '平板', '电脑', '遥控']
  const workflowWords = ['工作流', '流程', '自动化', '执行清单', '路径', '场景', '模式', '例程']
  const actionWords = ['打开', '关闭', '开', '关', '播放', '暂停', '继续', '看', '听', '放', '音量', '大声', '小声', '返回', '主页', '确认', '确定', '上', '下', '左', '右', '运行', '执行', '启动']
  const queryWords = ['状态', '现在', '当前', '是不是', '有没有', '在哪', '谁在']

  const mentionsDevice = deviceWords.some((word) => text.includes(word))
  const mentionsWorkflow = workflowWords.some((word) => text.includes(word))
  const mentionsAction = actionWords.some((word) => text.includes(word))
  const mentionsQuery = queryWords.some((word) => text.includes(word))

  if (hasExplicitNoExecutionIntent(text) && (mentionsDevice || mentionsWorkflow || mentionsAction)) {
    return {
      kind: 'chat',
      prompt_mode: 'unified',
      context_policy: mentionsDevice || mentionsWorkflow ? 'device_focused' : 'recent',
      allow_tools: false,
      confidence: 0.9,
      reason: 'user explicitly asked not to execute device or workflow actions',
    }
  }

  if (isCasualFollowUp(text)) {
    return {
      kind: 'chat',
      prompt_mode: 'unified',
      context_policy: 'light_recent',
      allow_tools: false,
      confidence: 0.72,
      reason: 'casual follow-up without clear device-action intent',
    }
  }

  if (mentionsWorkflow && (mentionsAction || mentionsDevice)) {
    return {
      kind: 'device_control',
      prompt_mode: 'unified',
      context_policy: 'device_focused',
      allow_tools: true,
      confidence: 0.82,
      reason: 'workflow keyword with action or device context',
    }
  }

  if ((mentionsDevice && mentionsAction) || (hasActiveDevice && mentionsAction)) {
    return {
      kind: 'device_control',
      prompt_mode: 'unified',
      context_policy: 'device_focused',
      allow_tools: true,
      confidence: mentionsDevice ? 0.88 : 0.74,
      reason: mentionsDevice ? 'device and action keywords present' : 'action keyword with active device context',
    }
  }

  if (mentionsAction) {
    return {
      kind: 'ambiguous_device_action',
      prompt_mode: 'unified',
      context_policy: 'current_only',
      allow_tools: false,
      confidence: 0.62,
      reason: 'action keyword present but no active target device context',
    }
  }

  if (mentionsDevice && mentionsQuery) {
    return {
      kind: 'device_query',
      prompt_mode: 'unified',
      context_policy: 'device_focused',
      allow_tools: true,
      confidence: 0.78,
      reason: 'device query keywords present',
    }
  }

  if (compact.length <= 2 && hasActiveDevice && mentionsAction) {
    return {
      kind: 'device_control',
      prompt_mode: 'unified',
      context_policy: 'device_focused',
      allow_tools: true,
      confidence: 0.7,
      reason: 'short remote-control utterance with active device context',
    }
  }

  return {
    kind: 'chat',
    prompt_mode: 'unified',
    context_policy: 'recent',
    allow_tools: false,
    confidence: 0.55,
    reason: 'no clear device-action intent',
  }
}

function hasExplicitNoExecutionIntent(text: string): boolean {
  const patterns = [
    /(?:先别|别|不要|不需要|不用|先不).{0,6}(?:执行|操作|运行|打开|关闭|控制|动)/,
    /(?:先别|别|不要|不需要|不用).{0,6}真的.{0,6}(?:执行|操作|运行|打开|关闭|控制|动)/,
    /(?:只是|只是想|只是先|我只是想|我只是).{0,8}(?:了解|确认|看看|问|咨询|知道|学习)/,
    /(?:只是|只是想|只是先|我只是想|我只是).{0,8}不(?:用|需要).{0,4}真的.{0,6}(?:执行|操作|运行|打开|关闭|控制|动)/,
    /不(?:要|用|需要).{0,6}真的.{0,6}(?:执行|操作|运行|打开|关闭|控制|动)/,
    /不(?:要|用|需要).{0,6}(?:执行|操作|运行|打开|关闭|控制|动)/,
  ]
  return patterns.some((pattern) => pattern.test(text))
}

function isCasualFollowUp(text: string): boolean {
  const compact = text
    .trim()
    .toLowerCase()
    .replace(/[!！。？?\s,.，、~～]+/g, '')

  if (!compact) return false

  return [
    '继续',
    '接着',
    '然后',
    '再来',
    '算了',
    '行',
    '可以',
    '好',
    '好的',
    '嗯',
    '嗯嗯',
    '哦',
    '哦哦',
    '哈哈',
    '哈哈哈',
    '呵呵',
    '谢谢',
    '辛苦了',
    'thanks',
    'thankyou',
    'thankyouverymuch',
    'ok',
    'okay',
    'gotit',
    'sure',
  ].includes(compact)
    || /^(hello|hi|hey)(there|buddy|friend)?$/.test(compact)
    || /^(你好|您好|早|早啊|早上好|晚上好|晚安|在吗|你在吗)$/.test(compact)
}

async function buildInferenceMessages(state: State): Promise<any[]> {
  const system = {
    role: 'system',
    content: await buildSystemPrompt(state),
  }
  const policy = state.lightIntent?.context_policy ?? 'recent'
  const currentTurn = getCurrentTurnMessages(state.messages, state.input)

  const maxMessages = policy === 'device_focused'
    ? 8
    : policy === 'light_recent'
      ? 2
    : policy === 'recent'
      ? 6
      : 0
  const allRecent = maxMessages > 0
    ? normalizePromptMessages(state.runtimeContext?.recent_messages ?? state.messages)
    : []
  const currentTurnKey = new Set(currentTurn.map(messageKey))
  const recentWithoutCurrentTurn = allRecent
    .filter((message) => !currentTurnKey.has(messageKey(message)))
    .slice(-maxMessages)

  return [system, ...recentWithoutCurrentTurn, ...currentTurn]
}

function getCurrentTurnMessages(messages: any[], input: string): any[] {
  const normalized = normalizePromptMessages(messages)
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index]
    if (message.role === 'user' && message.content === input) {
      return normalized.slice(index)
    }
  }
  return [{ role: 'user', content: input }]
}

function normalizePromptMessages(messages: any[]): any[] {
  return messages
    .filter((message) => typeof message?.role === 'string')
    .filter((message) => {
      if (typeof message.content === 'string' && message.content.trim()) return true
      return Array.isArray(message.tool_calls) || typeof message.tool_call_id === 'string'
    })
    .map((message) => {
      const normalized: any = { role: message.role, content: message.content ?? '' }
      if (Array.isArray(message.tool_calls)) normalized.tool_calls = message.tool_calls
      if (typeof message.tool_call_id === 'string') normalized.tool_call_id = message.tool_call_id
      if (typeof message.name === 'string') normalized.name = message.name
      return normalized
    })
}

function messageKey(message: any): string {
  return `${message.role}:${message.tool_call_id ?? ''}:${message.content ?? ''}`
}

async function buildCompressedInferenceMessages(state: State): Promise<any[]> {
  const system = {
    role: 'system',
    content: `${await buildSystemPrompt(state)}\nThe conversation context below has been compressed because the model rejected the full context window.`,
  }
  const normalized = normalizePromptMessages(state.runtimeContext?.recent_messages ?? state.messages)
  const currentTurn = getCurrentTurnMessages(state.messages, state.input)
  const currentTurnKey = new Set(currentTurn.map(messageKey))
  const history = normalized.filter((message) => !currentTurnKey.has(messageKey(message)))
  const keepTail = history.slice(-4)
  const older = history.slice(0, Math.max(0, history.length - keepTail.length))
  const summary = summarizeMessagesForRetry(older)

  return [
    system,
    ...(summary ? [{ role: 'system', content: `Compressed earlier conversation summary:\n${summary}` }] : []),
    ...keepTail,
    ...currentTurn,
  ]
}

function summarizeMessagesForRetry(messages: any[]): string {
  if (messages.length === 0) return ''
  return messages
    .filter((message) => typeof message.content === 'string' && message.content.trim())
    .slice(-12)
    .map((message) => `${message.role}: ${message.content.slice(0, 180)}`)
    .join('\n')
}

function isContextOverflowError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error).toLowerCase()
  return [
    'context length',
    'maximum context',
    'token limit',
    'too many tokens',
    'context_length_exceeded',
    'context window',
    'maximum number of tokens',
  ].some((pattern) => message.includes(pattern))
}

async function buildSystemPrompt(state: State): Promise<string> {
  const runtimeContext = JSON.stringify(state.runtimeContext?.working_context ?? {})
  const retrievedContext = JSON.stringify(state.runtimeContext?.retrieval_hits ?? [])
  const deviceInventory = JSON.stringify(state.deviceInventory ?? [])
  const runtimeCandidates = JSON.stringify(buildRuntimeCandidateSnapshot(state.runtimeRoute))
  const toolPolicy = resolveL3ToolPolicyKind(state)
  return [
    'You are HomeSense, one unified smart-home assistant inside a smart-home studio.',
    'You can chat naturally and you can operate devices when the user clearly asks for a device action.',
    `Current lightweight intent hint: ${state.lightIntent?.kind ?? 'unknown'}. Treat it as a routing hint, not as the user intent itself.`,
    `Current L3 tool policy: ${toolPolicy}. ${describeToolPolicy(toolPolicy)}`,
    'Always answer the latest user message first. Do not summarize or replay unrelated historical messages.',
    'For greetings and small talk, reply briefly and naturally.',
    'Active runtime context, location, current device and device inventory are always awareness, not commands. Do not turn ordinary chat into a device command because context exists.',
    'Use only the provided device-management and workflow tools. Do not call or invent mi-cli, adb-cli, shell, or legacy runtime tools.',
    'Every turn receives a lightweight device inventory first: id, name, type, room, bindings, and online status only.',
    'Small retrieved context may include remembered experience paths. Treat them as candidates only: validate the current device, room, capability, and arguments before using them.',
    'Do not assume a device capability from the inventory alone. For multi-step device operations, first load the device-type SKILL.md with get_device_type_skill, then load concrete capabilities with get_device_capabilities for the chosen device.',
    'For reusable multi-step routines, use list_workflows to discover candidates, preview_workflow to validate inputs and device steps, then run_workflow only when the preview is executable and the user request is clear.',
    'If Runtime candidate paths contains a workflow_candidate with workflow_id, prefer preview_workflow with that workflow_id and its suggested workflow_inputs, then run_workflow only after preview passes. Do not rebuild that workflow from low-level device steps unless preview is blocked and the user request is still clear.',
    'When unsure about the effect of a device action, use rehearse_device_capability first; it simulates the action without touching the real device.',
    'When device-management tools are provided and the target device, capability, and required arguments are clear, perform ordinary reversible smart-home actions directly.',
    'When device-management tools are not provided, or when the target device, capability, or required argument is ambiguous, ask one short clarification instead of pretending the action was done.',
    'If there is no active target device in runtime context and the user only says an action such as open, play, return, up, or OK, ask which device to use.',
    'If the user gives a memory or preference, acknowledge it briefly; persistent memory writing is handled by a separate system.',
    'After executing a device action that cannot be verified programmatically (e.g. screen change, audio playback), use confirm_outcome to ask the user a short yes/no question like "电视画面切到B站了吗？". When the user responds, use report_outcome to record success or failure. This feedback loop strengthens future recall.',
    'You have set_timer for delayed actions and remember for writing user preferences to long-term memory. Use them when appropriate.',
    'If a device action fails, do not give up immediately. Analyze the error, consider alternative approaches (different capability, different arguments, check device state), and try again. Only stop after two failed attempts or if the user says to stop.',
    `Active runtime context: ${runtimeContext}`,
    `Small retrieved context for the latest user input: ${retrievedContext}`,
    `Runtime candidate paths: ${runtimeCandidates}`,
    `Device inventory snapshot: ${deviceInventory}`,
  ].join('\n')
}

function buildRuntimeCandidateSnapshot(route: IntentRouterResult | undefined): Array<Record<string, unknown>> {
  if (!route?.candidate_plans?.length) return []
  return route.candidate_plans.slice(0, 3).map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    kind: candidate.candidate_kind,
    source: candidate.source,
    confidence: Number(candidate.confidence.toFixed(3)),
    workflow_id: candidate.workflow_id,
    workflow_inputs: candidate.workflow_inputs ?? {},
    workflow_graph_hash: candidate.workflow_graph_hash,
    success_count: candidate.success_count ?? 0,
    failure_count: candidate.failure_count ?? 0,
    evidence_status: candidate.evidence_status,
    reuse_score: candidate.reuse_score,
    goal: candidate.goal,
    device_refs: candidate.device_refs ?? [],
    skill_refs: candidate.skill_refs ?? [],
    steps: candidate.steps.slice(0, 4).map((step) => ({
      tool: step.tool,
      action: step.action,
      params: step.params,
    })),
  }))
}

async function buildDeviceInventorySnapshot(): Promise<DeviceInventoryItem[]> {
  try {
    const manifest = await buildDeviceRuntimeManifest({ online: true, includeCapabilities: 'none', limit: 20 }, getDb)
    return manifest.devices.map((card) => ({
      id: card.id,
      name: card.name,
      device_type: card.device_type,
      room: card.room.name || null,
      room_id: card.room.id,
      online: card.network.online,
      online_checked: card.network.checked,
      ping_target: card.network.ping_target,
      bindings: {
        mi: Boolean(card.bindings.mi_did),
        adb: Boolean(card.bindings.adb_ip),
        ip: Boolean(card.bindings.ip_address),
      },
      sources: card.sources,
    }))
  } catch {
    return []
  }
}

function buildRouteTrace(route: IntentRouterResult): RuntimeTraceEvent[] {
  const selected = selectDirectRuntimePlan(route)
  const topCandidate = route.candidate_plans[0]
  const l1Status = route.matched_rule ? 'hit' : 'miss'
  const l2Status = route.candidate_plans.length > 0 || route.matched_plan ? 'hit' : 'miss'
  const graphHits = route.search_hits.filter((hit) => hit.source === 'graph')
  const semanticHits = route.search_hits.filter((hit) => hit.source === 'semantic')
  const lexicalHits = route.search_hits.filter((hit) => hit.source === 'compiled' || hit.source === 'fts')
  const hasL2Recall = Boolean(route.matched_plan || route.candidate_plans.length > 0 || route.search_hits.length > 0)
  const decisionStatus = selected ? 'execute' : 'fallback'
  const fallbackReason = route.allow_tool_calls
    ? hasL2Recall
      ? '召回到候选路径；统一模型会继续校验设备、能力和参数。'
      : '没有候选路径达到可直接执行的阈值。'
    : '当前输入不被视为直接设备动作。'

  return [
    {
      stage: 'runtime.context',
      status: 'success',
      title: '上下文已准备',
      detail: route.routing_message,
      confidence: route.confidence,
      data: {
        normalized_intent: route.normalized_intent,
        route_level: route.route_level,
        allow_tool_calls: route.allow_tool_calls,
        target_device_id: route.completion.target_device_id,
        matched_media_app: route.completion.matched_media_app,
      },
    },
    {
      stage: 'runtime.l1.rule',
      status: l1Status,
      title: route.matched_rule ? `固定规则 #${route.matched_rule.rule_id}` : '没有命中固定规则',
      detail: route.matched_rule?.trigger_pattern,
      confidence: route.matched_rule?.confidence,
      data: route.matched_rule
        ? {
            rule_id: route.matched_rule.rule_id,
            action_count: route.matched_rule.actions.length,
          }
        : undefined,
    },
    {
      stage: 'runtime.l2.candidates',
      status: l2Status,
      title: topCandidate?.title ?? route.matched_plan?.name ?? '没有找到可复用路径',
      detail: route.reason,
      confidence: topCandidate?.confidence ?? (route.matched_plan ? route.confidence : undefined),
      data: {
        matched_plan_id: route.matched_plan?.id,
        candidate_count: route.candidate_plans.length,
        lexical_hit_count: lexicalHits.length,
        semantic_hit_count: semanticHits.length,
        graph_hit_count: graphHits.length,
        graph_hits: graphHits.slice(0, 5).map((hit) => ({
          id: hit.id,
          type: hit.type,
          score: hit.score,
          content: hit.content,
        })),
        candidates: route.candidate_plans.slice(0, 5).map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          source: candidate.source,
          kind: candidate.candidate_kind,
          confidence: candidate.confidence,
          workflow_id: candidate.workflow_id,
          workflow_inputs: candidate.workflow_inputs ?? {},
          workflow_graph_hash: candidate.workflow_graph_hash,
          success_count: candidate.success_count ?? 0,
          failure_count: candidate.failure_count ?? 0,
          evidence_status: candidate.evidence_status,
          reuse_score: candidate.reuse_score,
          executable: isExecutableCandidate(candidate),
          goal: candidate.goal,
          entities: candidate.entities,
          device_refs: candidate.device_refs ?? [],
          skill_refs: candidate.skill_refs ?? [],
          steps: candidate.steps.slice(0, 5).map((step) => ({
            tool: step.tool,
            action: step.action,
          })),
        })),
      },
    },
    {
      stage: 'runtime.decision',
      status: decisionStatus,
      title: selected ? '已选择可执行路径' : hasL2Recall ? '模型校验候选路径' : '交给模型回答',
      detail: selected?.title ?? fallbackReason,
      confidence: selected?.confidence ?? route.confidence,
      data: {
        threshold: L2_DIRECT_EXECUTION_THRESHOLD,
        route_level: route.route_level,
      },
    },
    {
      stage: 'runtime.l3.llm',
      status: selected ? 'skipped' : 'fallback',
      title: selected ? '模型无需接管' : '模型继续回答',
      detail: selected ? '已经选择可执行路径。' : fallbackReason,
    },
  ]
}

function ruleActionToStep(action: RuleAction): PlanStepDefinition {
  return {
    tool: action.tool,
    action: action.action,
    params: action.params,
  }
}

async function invokeResolvedStep(step: ResolvedExecutionStep, turnId: string): Promise<ExecutorInvokeResult> {
  if (step.executorName === 'execute_device_capability') {
    const rehearsal = await executeDeviceAgentTool('rehearse_device_capability', step.invokeParams)
    if (!isRehearsalPassed(rehearsal)) {
      return {
        status: 'error',
        executor: step.executorName,
        error: rehearsal.message ?? rehearsal.error ?? 'SANDBOX_REHEARSAL_FAILED',
        message: rehearsal.status === 'success'
          ? readRehearsalBlockReason(rehearsal.data)
          : rehearsal.message ?? rehearsal.error ?? '沙箱演练未通过。',
      }
    }
    return executeDeviceAgentTool('execute_device_capability', step.invokeParams)
  }

  if (step.executorName === 'run_workflow') {
    return executeWorkflowAgentTool('run_workflow', step.invokeParams)
  }

  return invokeResolvedStepWithApproval(step, turnId)
}

async function invokeResolvedStepWithApproval(step: ResolvedExecutionStep, turnId: string): Promise<ExecutorInvokeResult> {
  const cliName = String(step.invokeParams.cli_name ?? '')
  return invokeCliWithApproval({
    cliName,
    action: step.action,
    params: step.params,
    turnId,
  })
}

async function invokeCliWithApproval(params: {
  cliName: string
  action: string
  params: Record<string, unknown>
  turnId: string
}): Promise<ExecutorInvokeResult> {
  if (isHighRiskCliCall(params.cliName, params.action)) {
    const approval = approvalRegistry.create(
      params.turnId,
      `High-risk device action: ${params.cliName}.${params.action}`,
      { cli: params.cliName, action: params.action, params: params.params },
    )
    const decision = await approvalRegistry.wait(approval.id, 60_000)
    if (decision !== 'approved') {
      return {
        status: 'error',
        executor: 'cli.invoke',
        error: `approval_${decision}`,
        message: `Approval ${decision} by user.`,
      }
    }
  }

  return executorGateway.invoke('cli.invoke', {
    cli_name: params.cliName,
    action: params.action,
    params: params.params,
  })
}

// ── Build Graph ──
export function createReActGraph() {
  const workflow = new StateGraph(ChatReActState)
    .addNode('light_intent', lightIntentNode)
    .addNode('l1_context_command', l1ContextCommandNode)
    .addNode('l1_context_execute', l1ContextExecutionNode)
    .addNode('runtime_route', runtimeRouteNode)
    .addNode('runtime_execute', runtimeExecutionNode)
    .addNode('inference', inferenceNode)
    .addNode('tools_execution', toolsExecutionNode)
    .addEdge(START, 'light_intent')
    .addConditionalEdges('light_intent', routeAfterLightIntent, {
      l1_context_command: 'l1_context_command',
      inference: 'inference',
    })
    .addConditionalEdges('l1_context_command', routeAfterL1, {
      l1_execute: 'l1_context_execute',
      runtime_route: 'runtime_route',
    })
    .addConditionalEdges('runtime_route', routeAfterRuntime, {
      runtime_execute: 'runtime_execute',
      inference: 'inference',
    })
    .addEdge('l1_context_execute', END)
    .addEdge('runtime_execute', END)
    .addConditionalEdges('inference', shouldContinue, {
      tools: 'tools_execution',
      end: END,
    })
    .addConditionalEdges('tools_execution', routeAfterToolExecution, {
      tools: 'tools_execution',
      inference: 'inference',
    })

  return workflow.compile()
}

export const reactGraph = createReActGraph()
