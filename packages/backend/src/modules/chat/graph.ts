import { StateGraph, START, END, Annotation } from '@langchain/langgraph'
import { llmService } from '../llm-provider/service.js'
import { executorGateway } from '../executor-gateway/index.js'
import type { ExecutorInvokeResult } from '../executor-gateway/index.js'

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
  isComplete: Annotation<boolean>({
    default: () => false,
    reducer: (_, next) => next,
  }),
  finalResponse: Annotation<string>({
    default: () => '',
    reducer: (_, next) => next,
  }),
  error: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
})

type State = typeof ChatReActState.State

// ── Node: LLM Inference ──
async function inferenceNode(state: State): Promise<Partial<State>> {
  const messages = [
    { role: 'system', content: 'You are a helpful smart home assistant. You can control home devices using tool calls. Think step by step, then call tools if needed.' },
    ...state.messages,
    { role: 'user', content: state.input },
  ]

  try {
    const result = await llmService.chat({
      messages,
      tools: [
        {
          type: 'function' as const,
          function: {
            name: 'mi-cli',
            description: 'Control Mi Home devices via the Xiaomi smart home CLI. Use for lights, switches, sensors, and other smart home devices.',
            parameters: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  description: 'The action to perform (e.g., turn_on, turn_off, set_prop, get_prop, run_action)',
                },
                params: {
                  type: 'object',
                  description: 'Parameters for the action (device_id, siid, piid, value, etc.)',
                },
              },
              required: ['action'],
            },
          },
        },
        {
          type: 'function' as const,
          function: {
            name: 'adb',
            description: 'Control Android TV / ADB-connected devices. Use for TV app management, input, navigation.',
            parameters: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  description: 'The ADB action (e.g., list_packages, launch_app, input_keyevent, install_app)',
                },
                params: {
                  type: 'object',
                  description: 'Parameters for the action',
                },
              },
              required: ['action'],
            },
          },
        },
      ],
    })
    const content = result.content ?? ''

    // Check if assistant response contains tool calls
    if (result.tool_calls && result.tool_calls.length > 0) {
      const assistantMsg = {
        role: 'assistant',
        content,
        tool_calls: result.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: 'function' as const,
          function: tc.function,
        })),
      }

      return {
        messages: [assistantMsg],
        currentToolCall: result.tool_calls[0],
        isComplete: false,
      }
    }

    // Plain assistant response — done
    return {
      messages: [{ role: 'assistant', content }],
      finalResponse: content,
      isComplete: true,
    }
  } catch (err) {
    return {
      error: (err as Error).message,
      isComplete: true,
    }
  }
}

// ── Node: Execute Tool Call ──
async function toolsExecutionNode(state: State): Promise<Partial<State>> {
  if (!state.currentToolCall) {
    return { isComplete: true, finalResponse: 'No tool call to execute.' }
  }

  const tc = state.currentToolCall
  const fn = tc.function
  let args: { action?: string; params?: Record<string, unknown> } = {}
  try {
    args = JSON.parse(fn.arguments)
  } catch {}

  const toolName = fn.name
  const action = args.action ?? ''
  const toolParams = args.params ?? {}

  let result: ExecutorInvokeResult

  try {
    if (toolName.startsWith('mi-cli') || toolName.startsWith('adb')) {
      result = await executorGateway.invoke('cli.invoke', {
        cli_name: toolName.includes('adb') ? 'adb-cli' : 'mi-cli',
        action,
        params: toolParams,
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

  return {
    messages: [toolMsg],
    currentToolCall: undefined, // Clear so router goes to 'end' on next inference if no more tool calls
    isComplete: false, // Continue loop — route will check if more tools needed
  }
}

// ── Router ──
function shouldContinue(state: State): 'tools' | 'end' {
  if (state.isComplete || state.error) return 'end'
  if (state.currentToolCall) return 'tools'
  return 'end'
}

// ── Build Graph ──
export function createReActGraph() {
  const workflow = new StateGraph(ChatReActState)
    .addNode('inference', inferenceNode)
    .addNode('tools_execution', toolsExecutionNode)
    .addEdge(START, 'inference')
    .addConditionalEdges('inference', shouldContinue, {
      tools: 'tools_execution',
      end: END,
    })
    .addEdge('tools_execution', 'inference') // Always back to inference for ReAct loop

  return workflow.compile()
}

export const reactGraph = createReActGraph()
