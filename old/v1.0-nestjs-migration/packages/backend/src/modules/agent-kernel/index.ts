import { langGraphChatKernel } from './langgraph-kernel.js'
import type { ChatAgentKernel } from './types.js'

export function getChatAgentKernel(): ChatAgentKernel {
  const mode = process.env.CHAT_RUNTIME_KERNEL ?? process.env.CHAT_RUNTIME_MODE ?? 'langgraph'
  if (mode !== 'langgraph') {
    return langGraphChatKernel
  }
  return langGraphChatKernel
}

export * from './types.js'
export { langGraphChatKernel } from './langgraph-kernel.js'
export { piSourceKernelReference } from './pi-source.js'
