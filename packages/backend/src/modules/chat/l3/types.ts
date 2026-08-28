import type { ChatReActState } from '../graph.js'

export type ChatGraphState = typeof ChatReActState.State

export interface L3Agent {
  readonly name: string
  inference(state: ChatGraphState): Promise<Partial<ChatGraphState>>
  executeTool(state: ChatGraphState): Promise<Partial<ChatGraphState>>
}
