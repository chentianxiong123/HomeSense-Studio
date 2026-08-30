/**
 * 单独测试 llmService 的三个模型 slot
 *
 * 每个模型完全独立 — 只测一个时另外两个不会触达
 *
 * Usage:
 *   node test-llm-standalone.mjs chat      # 只测 minimax-m2.7 chat
 *   node test-llm-standalone.mjs embed     # 只测 qwen3-embedding-8b
 *   node test-llm-standalone.mjs rerank    # 只测 qwen3-reranker-8b
 *   node test-llm-standalone.mjs all       # 串行测全部，互不影响
 */

import 'dotenv/config'
import { initDb } from './src/db/index.js'
import { llmService } from './src/modules/llm-provider/service.js'

initDb()
llmService.seedSlotsFromEnv()

const mode = process.argv[2] ?? 'all'

async function testChat() {
  console.log('\n=== test chat (minimax-m2.7) ===')
  const stream = llmService.chatStream({
    slot: 'planner',
    messages: [{ role: 'user', content: '用中文说"hello"' }],
    temperature: 0.7,
  })
  let count = 0
  let full = ''
  for await (const chunk of stream) {
    count++
    if (chunk.delta) full += chunk.delta
  }
  console.log(`  chunks: ${count}, full: ${full.slice(0, 120)}`)
}

async function testEmbed() {
  console.log('\n=== test embedding (qwen3-embedding-8b) ===')
  const result = await llmService.embed({
    slot: 'embedding',
    input: '打开电视',
  })
  console.log(`  dims: ${result.data[0]?.embedding.length ?? 0}, model: ${result.model}`)
}

async function testRerank() {
  console.log('\n=== test rerank (qwen3-reranker-8b) ===')
  const result = await llmService.rerank({
    slot: 'rerank',
    query: '打开电视',
    documents: [
      '用户想看电视',
      '用户想听音乐',
      '用户想关灯',
    ],
  })
  for (const r of result.results) {
    console.log(`  doc[${r.index}]: score=${r.relevance_score.toFixed(4)}`)
  }
}

async function main() {
  const tests = {
    chat: testChat,
    embed: testEmbed,
    rerank: testRerank,
    all: async () => {
      await testChat()
      await testEmbed()
      await testRerank()
    },
  }

  const fn = tests[mode]
  if (!fn) {
    console.error(`Unknown mode: ${mode}. Use chat / embed / rerank / all`)
    process.exit(1)
  }

  const start = Date.now()
  await fn()
  console.log(`\nTotal: ${Date.now() - start}ms`)
}

main().catch(console.error)