/**
 * Port: Llm
 *
 * Boundary between the rest of the system and any concrete LLM
 * implementation (openai / deepseek / ollama / mimo / custom).
 * Modules that need to talk to a model depend on this interface,
 * not on `modules/llm-provider`.
 */

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool'

export interface LlmMessage {
  role: LlmRole
  content: string
  name?: string
  tool_call_id?: string
}

export interface LlmChatRequest {
  messages: LlmMessage[]
  model?: string
  temperature?: number
  max_tokens?: number
  stop?: string[]
  /** Free-form extension; the implementation may ignore unknown keys. */
  extra?: Record<string, unknown>
}

export interface LlmChatResponse {
  content: string
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'error'
  usage?: { input_tokens: number; output_tokens: number; model: string }
  raw?: unknown
}

export interface LlmEmbedRequest {
  input: string | string[]
  model?: string
}

export interface LlmEmbedResponse {
  vectors: number[][]
  model: string
  dimensions: number
}

export interface LlmRerankRequest {
  query: string
  documents: string[]
  top_n?: number
  model?: string
}

export interface LlmRerankResponse {
  results: Array<{ index: number; score: number }>
  model: string
}

export interface LlmPort {
  chat(req: LlmChatRequest): Promise<LlmChatResponse>
  embed(req: LlmEmbedRequest): Promise<LlmEmbedResponse>
  rerank(req: LlmRerankRequest): Promise<LlmRerankResponse>
}
