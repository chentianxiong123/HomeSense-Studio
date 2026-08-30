import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core'
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Message,
  type Model,
  type Tool,
  type Usage,
} from '@earendil-works/pi-ai'
import { llmService } from '../../llm-provider/service.js'
import {
  DEVICE_AGENT_TOOL_DEFINITIONS,
  executeDeviceAgentTool,
  isDeviceAgentTool,
} from '../../device/device-agent-tools.js'
import {
  WORKFLOW_AGENT_TOOL_DEFINITIONS,
  executeWorkflowAgentTool,
  isWorkflowAgentTool,
} from '../../workflow/workflow-agent-tools.js'
import {
  SYSTEM_AGENT_TOOL_DEFINITIONS,
  executeSystemAgentTool,
  isSystemAgentTool,
} from '../../system-tools/index.js'
import type { L3Agent, ChatGraphState } from './types.js'
import type { RuntimeTraceEvent } from '../graph.js'

type GraphMessage = {
  role: 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export class PiL3Agent implements L3Agent {
  readonly name = 'pi'

  async inference(state: ChatGraphState): Promise<Partial<ChatGraphState>> {
    const runtimeTrace: RuntimeTraceEvent[] = []
    const priorMessages = buildPriorAgentMessages(state)
    const agentTools = buildPiAgentTools()
    const agent = new Agent({
      initialState: {
        systemPrompt: buildPiSystemPrompt(state),
        messages: priorMessages,
        tools: agentTools,
      },
      streamFn: homesensePiStream as any,
      toolExecution: 'parallel',
    })

    agent.subscribe((event) => {
      runtimeTrace.push(...buildPiTraceEvents(event))
    })

    const initialCount = agent.state.messages.length
    await agent.prompt(state.input)

    const newAgentMessages = agent.state.messages.slice(initialCount)
    const graphMessages = convertAgentMessagesToGraphMessages(newAgentMessages)
    const finalAssistant = [...graphMessages].reverse().find((message) => message.role === 'assistant')
    const finalResponse = finalAssistant?.content ?? ''

    return {
      messages: graphMessages,
      runtimeTrace: runtimeTrace.length > 0
        ? runtimeTrace
        : [
            {
              stage: 'runtime.l3.llm',
              status: 'execute',
              title: 'Pi L3 完成',
              detail: finalResponse || 'Pi Agent Core completed the turn.',
              data: {
                input: state.input,
                message_count: graphMessages.length,
              },
            },
          ],
      finalResponse,
      isComplete: true,
    }
  }

  async executeTool(): Promise<Partial<ChatGraphState>> {
    return {
      runtimeTrace: [
        {
          stage: 'runtime.l3.llm',
          status: 'skipped',
          title: 'Pi L3 工具执行',
          detail: 'Tool execution is handled inside the Pi agent loop.',
        },
      ],
      isComplete: true,
    }
  }
}

export const piL3Agent = new PiL3Agent()

function buildPiSystemPrompt(state: ChatGraphState): string {
  return [
    'You are HomeSense, one unified smart-home assistant inside a smart-home studio.',
    'Answer the latest user message first. Keep greetings and small talk brief.',
    `Lightweight intent hint: ${state.lightIntent?.kind ?? 'unknown'}. Treat it as a routing hint, not as the user intent itself.`,
    'Use only the provided device-management, workflow, and system tools. Do not invent shell or file-system tools.',
    'For ordinary reversible smart-home actions, use the device tools directly when the target is clear.',
    'When a device action is uncertain, first rehearse it before attempting the real action.',
    'For reusable multi-step routines, prefer list_workflows -> preview_workflow -> run_workflow.',
    `Active runtime context: ${JSON.stringify(state.runtimeContext?.working_context ?? {})}`,
    `Small retrieved context: ${JSON.stringify(state.runtimeContext?.retrieval_hits ?? [])}`,
    `Device inventory snapshot: ${JSON.stringify(state.deviceInventory ?? [])}`,
  ].join('\n')
}

function buildPriorAgentMessages(state: ChatGraphState): AgentMessage[] {
  const recent = Array.isArray(state.runtimeContext?.recent_messages)
    ? state.runtimeContext?.recent_messages ?? []
    : []
  const beforeCurrentInput = trimMessagesBeforeCurrentInput(recent, state.input)
  return beforeCurrentInput
    .map((message): AgentMessage | null => {
      if (message.role === 'user') {
        return {
          role: 'user',
          content: message.content,
          timestamp: Date.now(),
        }
      }
      if (message.role === 'assistant') {
        return {
          role: 'assistant',
          content: [{ type: 'text', text: message.content }],
          api: piModel.api,
          provider: piModel.provider,
          model: piModel.id,
          usage: piUsage(0, 0),
          stopReason: 'stop',
          timestamp: Date.now(),
        }
      }
      return null
    })
    .filter((message): message is AgentMessage => Boolean(message))
}

function trimMessagesBeforeCurrentInput(
  messages: Array<{ role: string; content: string }>,
  input: string,
): Array<{ role: string; content: string }> {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    if (message.content === input) {
      return messages.slice(0, index)
    }
  }
  return messages
}

function buildPiAgentTools(): any[] {
  return [
    ...DEVICE_AGENT_TOOL_DEFINITIONS,
    ...WORKFLOW_AGENT_TOOL_DEFINITIONS,
    ...SYSTEM_AGENT_TOOL_DEFINITIONS,
  ].map((definition) => {
    const name = definition.function.name
    return {
      name,
      label: name,
      description: definition.function.description,
      parameters: definition.function.parameters,
      executionMode: 'parallel' as const,
      execute: async (_toolCallId: string, params: Record<string, unknown>) => {
        const result = await executeHomesenseTool(name, params)
        if (result.status !== 'success') {
          throw new Error(result.message ?? result.error ?? `Tool ${name} failed`)
        }
        return {
          content: [{ type: 'text', text: stringifyToolResult(result.data) }],
          details: result.data ?? {},
        }
      },
    }
  })
}

async function executeHomesenseTool(name: string, params: Record<string, unknown>) {
  if (isDeviceAgentTool(name)) return executeDeviceToolWithRehearsal(name, params)
  if (isWorkflowAgentTool(name)) return executeWorkflowAgentTool(name, params)
  if (isSystemAgentTool(name)) return executeSystemAgentTool(name, params)
  return {
    status: 'error' as const,
    executor: name,
    error: 'UNKNOWN_TOOL',
    message: `Unknown HomeSense tool: ${name}`,
  }
}

async function executeDeviceToolWithRehearsal(name: string, params: Record<string, unknown>) {
  if (name !== 'execute_device_capability') return executeDeviceAgentTool(name, params)

  const rehearsal = await executeDeviceAgentTool('rehearse_device_capability', params)
  const rehearsalData = rehearsal.data as { ok?: boolean; executable?: boolean } | undefined
  const rehearsalPassed = rehearsal.status === 'success'
    && rehearsalData?.ok !== false
    && rehearsalData?.executable !== false

  if (!rehearsalPassed) {
    return {
      status: 'error' as const,
      executor: name,
      error: rehearsal.message ?? rehearsal.error ?? 'SANDBOX_REHEARSAL_FAILED',
      message: '沙箱演练未通过，已停止真实执行。',
      data: { rehearsal: rehearsal.status === 'success' ? rehearsal.data : undefined },
    }
  }

  const execution = await executeDeviceAgentTool(name, params)
  if (execution.status !== 'success') return execution

  return {
    status: 'success' as const,
    executor: name,
    data: {
      rehearsal: rehearsal.data,
      execution: execution.data,
    },
  }
}

function stringifyToolResult(value: unknown): string {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return String(value ?? '')
  }
}

function convertAgentMessagesToGraphMessages(messages: AgentMessage[]): GraphMessage[] {
  const graphMessages: GraphMessage[] = []
  for (const message of messages) {
    if (message.role === 'assistant') {
      const content = assistantContentToText(message.content)
      const toolCalls = assistantContentToToolCalls(message.content)
      graphMessages.push({
        role: 'assistant',
        content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      continue
    }
    if (message.role === 'toolResult') {
      graphMessages.push({
        role: 'tool',
        tool_call_id: String(message.toolCallId ?? ''),
        name: String(message.toolName ?? ''),
        content: stringifyToolResult(message.content),
      })
    }
  }
  return graphMessages
}

function assistantContentToText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return stripHiddenReasoning(content
    .filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text')
    .map((item) => String((item as Record<string, unknown>).text ?? ''))
    .join(''))
}

function stripHiddenReasoning(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*/g, '').trim()
}

function assistantContentToToolCalls(content: unknown): NonNullable<GraphMessage['tool_calls']> {
  if (!Array.isArray(content)) return []
  return content
    .filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'toolCall')
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        id: String(record.id ?? ''),
        type: 'function' as const,
        function: {
          name: String(record.name ?? ''),
          arguments: stringifyToolResult(record.arguments ?? {}),
        },
      }
    })
}

function buildPiTraceEvents(event: { type: string; [key: string]: unknown }): RuntimeTraceEvent[] {
  if (event.type === 'message_end') {
    const message = event.message as AssistantMessage
    if (message.role !== 'assistant') return []
    const toolCalls = message.content.filter((item) => item.type === 'toolCall')
    if (toolCalls.length > 0) {
      return [
        {
          stage: 'runtime.l3.llm',
          status: 'execute',
          title: '准备调用工具',
          detail: `模型请求了 ${toolCalls.length} 个工具调用。`,
          data: {
            tool_calls: toolCalls.map((item) => item.name),
          },
        },
      ]
    }
    const text = assistantContentToText(message.content)
    return [
      {
        stage: 'runtime.l3.llm',
        status: 'execute',
        title: '直接回答',
        detail: text || '模型直接完成回答。',
      },
    ]
  }

  if (event.type === 'tool_execution_start') {
    return [
      {
        stage: 'runtime.execution',
        status: 'execute',
        title: String(event.toolName ?? 'tool'),
        detail: '工具开始执行。',
        data: {
          tool_call_id: event.toolCallId,
          args: event.args,
        },
      },
    ]
  }

  if (event.type === 'tool_execution_end') {
    return [
      {
        stage: 'runtime.execution',
        status: event.isError ? 'error' : 'success',
        title: String(event.toolName ?? 'tool'),
        detail: event.isError ? '工具执行失败。' : '工具执行成功。',
        data: {
          tool_call_id: event.toolCallId,
          result: event.result,
        },
      },
    ]
  }

  if (event.type === 'agent_end') {
    return [
      {
        stage: 'runtime.l3.llm',
        status: 'success',
        title: 'Pi L3 完成',
        detail: 'Pi Agent Core settled the turn.',
      },
    ]
  }

  return []
}

function piUsage(promptTokens: number, completionTokens: number): Usage {
  return {
    input: promptTokens,
    output: completionTokens,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: promptTokens + completionTokens,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  }
}

function buildPiToolCalls(result: { tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }): Array<{
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}> {
  return (result.tool_calls ?? []).map((toolCall) => ({
    id: toolCall.id,
    type: 'function' as const,
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    },
  }))
}

const piModel: Model<any> = {
  id: 'homesense-default-chat',
  name: 'HomeSense Default Chat',
  api: 'homesense-llm-provider',
  provider: 'homesense',
  baseUrl: '',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 2048,
}

function piContextToHomeSenseMessages(context: Context): any[] {
  const messages: any[] = []
  if (context.systemPrompt?.trim()) {
    messages.push({ role: 'system', content: context.systemPrompt })
  }
  for (const message of context.messages) {
    if (message.role === 'user') {
      messages.push({ role: 'user', content: stringifyPiContent(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      const toolCalls = assistantContentToToolCalls(message.content)
      messages.push({
        role: 'assistant',
        content: assistantContentToText(message.content),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      continue
    }
    if (message.role === 'toolResult') {
      messages.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        name: message.toolName,
        content: stringifyPiContent(message.content),
      })
    }
  }
  return messages.filter((message) =>
    typeof message.content === 'string' && message.content.trim()
    || Array.isArray(message.tool_calls)
    || typeof message.tool_call_id === 'string',
  )
}

function stringifyPiContent(content: Message['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => item.type === 'text' ? item.text : item.type === 'image' ? '[image]' : '')
    .filter(Boolean)
    .join('\n')
}

function homesensePiStream(_model: Model<any>, context: Context): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream()

  void (async () => {
    const startedAt = Date.now()
    const partial: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: piModel.api,
      provider: piModel.provider,
      model: piModel.id,
      usage: piUsage(0, 0),
      stopReason: 'stop',
      timestamp: startedAt,
    }

    try {
      stream.push({ type: 'start', partial })
      const toolDefinitions = context.tools?.length
        ? context.tools.map((tool) => ({
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          }))
        : undefined
      const result = await llmService.chat({
        messages: piContextToHomeSenseMessages(context) as any,
        ...(toolDefinitions ? { tools: toolDefinitions } : {}),
      })
      const toolCalls = buildPiToolCalls(result)
      const content = stripHiddenReasoning(result.content ?? '')
      const finalMessage: AssistantMessage = {
        ...partial,
        content: [
          ...(content ? [{ type: 'text' as const, text: content }] : []),
          ...toolCalls.map((toolCall) => ({
            type: 'toolCall' as const,
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>,
          })),
        ],
        usage: piUsage(result.usage.prompt_tokens, result.usage.completion_tokens),
        stopReason: toolCalls.length > 0 ? 'toolUse' : 'stop',
      }

      if (content) {
        stream.push({ type: 'text_start', contentIndex: 0, partial: finalMessage })
        stream.push({ type: 'text_delta', contentIndex: 0, delta: content, partial: finalMessage })
        stream.push({ type: 'text_end', contentIndex: 0, content, partial: finalMessage })
      }

      for (let index = 0; index < toolCalls.length; index += 1) {
        const toolCall = toolCalls[index]
        stream.push({ type: 'toolcall_start', contentIndex: index, partial: finalMessage })
        stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: {
          type: 'toolCall',
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>,
        }, partial: finalMessage })
      }

      stream.push({
        type: 'done',
        reason: toolCalls.length > 0 ? 'toolUse' : 'stop',
        message: finalMessage,
      })
    } catch (err) {
      const errorMessage = (err as Error).message
      const finalMessage: AssistantMessage = {
        ...partial,
        content: [{ type: 'text', text: errorMessage }],
        stopReason: 'error',
        errorMessage,
      }
      stream.push({ type: 'error', reason: 'error', error: finalMessage })
    }
  })()

  return stream
}
