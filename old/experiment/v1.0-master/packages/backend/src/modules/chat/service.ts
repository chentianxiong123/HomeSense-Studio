import { chatRepository, type MessageRow, type PageInfo } from './repository.js'

export interface ChatService {
  addMessage(role: string, content: string, payloadJson?: string): { message: MessageRow }
  getMessages(cursorId?: number, limit?: number, direction?: string): { messages: MessageRow[]; pageInfo: PageInfo }
  // Conversations
  ensureConversation(id: number): void
  createConversation(): number
  listConversations(limit?: number): Array<{ id: number; summary: string; created_at: string; updated_at: string }>
  addConversationMessage(conversationId: number, role: string, content: string, toolCallsJson?: string | null, toolResultJson?: string | null, toolCallId?: string | null): number
  getConversationMessages(conversationId: number, cursor?: number, limit?: number): { messages: Array<{ id: number; role: string; content: string; tool_calls_json: string | null; tool_result_json: string | null; tool_call_id: string | null; created_at: string }>; hasMore: boolean }
  // Usage log
  recordUsage(opts: { provider_name: string; model_name: string; category: string; success: boolean; input_tokens: number; output_tokens: number }): void
  queryUsageTotals(): { total_input: number; total_output: number; total_success: number; total_fail: number; daily: Array<any>; by_provider: Array<any>; by_model: Array<any>; by_category: Array<any> }
}

export class SimpleChatService implements ChatService {
  // ── Messages ──

  addMessage(role: string, content: string, payloadJson?: string): { message: MessageRow } {
    const id = chatRepository.addMessage(role, content, payloadJson)
    const message = chatRepository.getMessage(id)
    if (!message) throw new Error('Failed to retrieve inserted message')
    return { message }
  }

  getMessages(cursorId?: number, limit = 20, direction = 'older'): { messages: MessageRow[]; pageInfo: PageInfo } {
    return chatRepository.listMessages(cursorId, limit, direction)
  }

  // ── Conversations ──

  ensureConversation(id: number): void {
    return chatRepository.ensureConversation(id)
  }

  createConversation(): number {
    return chatRepository.createConversation()
  }

  listConversations(limit?: number) {
    return chatRepository.listConversations(limit)
  }

  addConversationMessage(conversationId: number, role: string, content: string, toolCallsJson: string | null = null, toolResultJson: string | null = null, toolCallId: string | null = null): number {
    return chatRepository.addConversationMessage(conversationId, role, content, toolCallsJson, toolResultJson, toolCallId)
  }

  getConversationMessages(conversationId: number, cursor?: number, limit?: number) {
    return chatRepository.getConversationMessages(conversationId, cursor, limit)
  }

  // ── Usage Log ──

  recordUsage(opts: { provider_name: string; model_name: string; category: string; success: boolean; input_tokens: number; output_tokens: number }): void {
    chatRepository.recordUsage(opts)
  }

  queryUsageTotals(): { total_input: number; total_output: number; total_success: number; total_fail: number; daily: Array<any>; by_provider: Array<any>; by_model: Array<any>; by_category: Array<any> } {
    return chatRepository.queryUsageTotals()
  }
}

export const chatService = new SimpleChatService()
