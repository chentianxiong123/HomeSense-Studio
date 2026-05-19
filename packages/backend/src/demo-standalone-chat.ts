#!/usr/bin/env npx tsx
/**
 * Standalone chat demo — no Fastify, no database, no real LLM.
 *
 * Shows:
 *   1. Multi-turn conversation with a virtual LLM
 *   2. Virtual tool executor that intercepts device_control
 *   3. Full SSE-style event stream output
 */

import { StandaloneChatService, VirtualLLMProvider, VirtualToolExecutor } from './modules/chat/standalone.js'

// ── Tools that the LLM can call ──────────────────────────────────────

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'device_control',
      description: 'Control a smart home device. Params: { did, action, params }',
      parameters: {
        type: 'object',
        properties: {
          did: { type: 'string', description: 'Device ID' },
          action: { type: 'string', enum: ['turn_on', 'turn_off', 'get_state'] },
          params: { type: 'object', additionalProperties: true },
        },
        required: ['did', 'action'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'discover',
      description: 'List all available smart home devices.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

// ── Virtual LLM responses ─────────────────────────────────────────────

// Simulates a model that:
const virtualResponses = [
  // Turn 1: user asks to turn on TV → model calls device_control tool
  {
    content: '好的，我来打开东芝电视。',
    tool_calls: [
      {
        id: 'call_001',
        function: { name: 'device_control', arguments: JSON.stringify({ did: 'did_tv_001', action: 'turn_on', params: {} }) },
      },
    ],
  },
  // Turn 2 (after tool result): model responds with confirmation
  {
    content: '东芝电视已打开，B站也已启动。您可以直接观看。',
  },
]

// ── Virtual tool executor ────────────────────────────────────────────

const executor = new VirtualToolExecutor()

executor.register('device_control', async (args: unknown) => {
  const { did, action } = args as { did: string; action: string; params: unknown }
  console.log(`[VirtualTool] device_control → did=${did}, action=${action}`)
  // Simulate device delay
  await new Promise((r) => setTimeout(r, 200))
  return {
    success: true,
    data: {
      did,
      action,
      result: action === 'turn_on' ? 'TV turned on' : action === 'turn_off' ? 'TV turned off' : 'current state: on',
    },
  }
})

executor.register('discover', async () => {
  return {
    success: true,
    data: [
      { did: 'did_tv_001', name: '东芝电视', model: 'TV-001', connection_type: 'wifi' },
      { did: 'did_light_001', name: '客厅灯', model: 'LIGHT-001', connection_type: 'wifi' },
    ],
  }
})

// ── Run the chat ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是 HomeSense 智能家居控制助手。用户可以用自然语言控制设备。
设备列表：东芝电视(did_tv_001)、客厅灯(did_light_001)。
优先使用 device_control 或 discover 工具，不要发明设备。`

const llm = new VirtualLLMProvider(true)
const chat = new StandaloneChatService(llm, TOOLS, executor, {
  systemPrompt: SYSTEM_PROMPT,
  maxRounds: 6,
})

async function main() {
  console.log('=== Standalone Chat Demo ===\n')

  const messages: Array<{ role: string; content: string }> = []

  // Turn 1
  const userMessage = '帮我打开东芝电视'
  console.log(`\n[User] ${userMessage}`)

  for await (const event of chat.run(userMessage, messages as any)) {
    const time = Date.now()
    switch (event.type) {
      case 'turn.start':
        console.log(`\n[turn.start] ${event.message}`)
        break
      case 'assistant.message':
        if (event.delta) process.stdout.write(event.delta)
        if (event.tool_calls && event.tool_calls.length > 0) {
          console.log('\n[assistant.message] tool_calls:', JSON.stringify(event.tool_calls))
        }
        break
      case 'tool.call.start':
        console.log(`[tool.call.start] ${event.name} args=${JSON.stringify(event.args)}`)
        break
      case 'tool.call.end':
        console.log(`[tool.call.end] ${event.call_id} status=${event.status} result=${JSON.stringify(event.result)}`)
        break
      case 'assistant.final':
        console.log(`\n[assistant.final] ${event.content}`)
        break
      case 'turn.end':
        console.log(`\n[turn.end] duration=${event.duration_ms}ms level=${event.level}`)
        break
      case 'error':
        console.error(`[error] ${event.message}`)
        break
    }
  }
}

main().catch(console.error)