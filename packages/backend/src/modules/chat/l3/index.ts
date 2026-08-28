import { piL3Agent } from './pi-l3-agent.js'
import type { L3Agent } from './types.js'

export function getL3Agent(fallback: L3Agent): L3Agent {
  const mode = process.env.CHAT_L3_AGENT ?? 'current'
  if (mode === 'pi') return piL3Agent
  if (mode !== 'current') {
    return fallback
  }
  return fallback
}

export * from './types.js'
export { piL3Agent } from './pi-l3-agent.js'
