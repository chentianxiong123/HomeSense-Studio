#!/usr/bin/env npx tsx
/**
 * Real LLM multi-turn chat demo.
 * Uses actual llmService with real minimax-m2.7.
 * Run: npx tsx src/demo-real-chat.ts
 */

import { llmService } from './modules/llm-provider/service.js'

// ── Tools ────────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'mi-cli',
      description: 'Control Xiaomi/米家智能设备。Actions: discover, device_action (by capability name), device_prop, run_action (raw MIoT)',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['discover', 'device_action', 'device_prop', 'get_prop', 'set_prop', 'run_action'],
          },
          params: {
            type: 'object',
            description: 'Action-specific params',
          },
        },
        required: ['action'],
      },
    },
  },
]

// ── System prompt ────────────────────────────────────────────────────

const SYSTEM = `你是 HomeSense 智能家居助手。
已知设备通过 discover 获取，当前设备列表未知。
用户问设备状态时先 discover。
控制设备用 mi-cli action=device_action 或 device_prop。
只使用提供的工具，不要编造设备或服务名称。`

async function main() {
  console.log('=== Real LLM Chat Demo ===')
  console.log('Multi-turn test with real minimax-m2.7\n')

  const history: Array<{ role: string; content: string; tool_calls?: unknown; tool_call_id?: string; name?: string }> = []

  async function sendToLLM(message: string) {
    const messages = [
      { role: 'system' as const, content: SYSTEM },
      ...history,
      { role: 'user' as const, content: message },
    ]

    let accContent = ''
    let accToolCalls: Array<{ id: string; function: { name: string; arguments: string } }> = []

    console.log(`\n[User] ${message}`)

    const stream = llmService.chatStream({
      slot: 'planner',
      messages: messages as Array<{ role: string; content: string }>,
      tools: TOOLS,
    })

    for await (const delta of stream) {
      if (delta.delta != null) {
        accContent += delta.delta
        process.stdout.write(delta.delta)
      }
      if (delta.tool_calls && delta.tool_calls.length > 0) {
        accToolCalls = delta.tool_calls
      }
    }

    console.log()

    if (accToolCalls.length > 0) {
      console.log(`\n[Tool Calls] ${JSON.stringify(accToolCalls, null, 2)}`)
      // Save assistant message with tool_calls
      history.push({ role: 'assistant', content: accContent, tool_calls: accToolCalls })

      // Simulate tool execution (would call real mi-cli in production)
      for (const tc of accToolCalls) {
        const args = JSON.parse(tc.function.arguments)
        console.log(`\n[Would execute] ${tc.function.name}(${JSON.stringify(args)})`)
        // In real system this would call cliBridge.run('mi-cli', args.action, args.params)
        // For demo, return a simulated result
        history.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: JSON.stringify({ status: 'simulated', message: 'Tool execution simulated in demo' }),
        })
      }
    } else {
      history.push({ role: 'assistant', content: accContent })
    }
  }

  // Turn 1
  await sendToLLM('列出我家里的设备')

  // Turn 2
  await sendToLLM('帮我打开客厅灯')

  // Turn 3
  await sendToLLM('现在把电视关掉')

  console.log('\n\n=== History ===')
  for (const msg of history) {
    console.log(`${msg.role}: ${msg.content?.slice(0, 80) ?? JSON.stringify(msg.tool_calls ?? msg.content)?.slice(0, 80)}`)
  }
}

main().catch(console.error)