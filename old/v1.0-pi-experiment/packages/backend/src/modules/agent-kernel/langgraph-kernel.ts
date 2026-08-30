import { ChatReActState, reactGraph } from '../chat/graph.js'
import type { ChatAgentKernel, ChatAgentKernelInput, ChatAgentKernelState } from './types.js'

class LangGraphChatKernel implements ChatAgentKernel {
  readonly name = 'langgraph'

  async stream(input: ChatAgentKernelInput): Promise<AsyncIterable<ChatAgentKernelState>> {
    const initialState: typeof ChatReActState.State = {
      messages: input.messages,
      input: input.input,
      conversationId: input.conversationId,
      currentToolCall: undefined,
      pendingToolCalls: [],
      isComplete: false,
      finalResponse: '',
      runtimeRoute: undefined,
      l1Command: undefined,
      runtimeTrace: [],
      runtimeContext: input.runtimeContext,
      lightIntent: undefined,
      deviceInventory: [],
      error: undefined,
    }

    return reactGraph.stream(initialState, { streamMode: 'values' }) as Promise<AsyncIterable<ChatAgentKernelState>>
  }
}

export const langGraphChatKernel = new LangGraphChatKernel()
