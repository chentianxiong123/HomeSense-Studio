import type { RuntimeTraceEvent } from '../chat/graph.js'
import type { RuntimeContextWindow } from '../runtime/index.js'

export interface ChatAgentKernelInput {
  conversationId: number
  input: string
  messages: Array<{ role: string; content: string }>
  runtimeContext: RuntimeContextWindow
}

export interface ChatAgentKernelState {
  messages: any[]
  finalResponse?: string
  runtimeTrace?: RuntimeTraceEvent[]
  conversationId?: number
}

export interface ChatAgentKernel {
  readonly name: string
  stream(input: ChatAgentKernelInput): Promise<AsyncIterable<ChatAgentKernelState>>
}
