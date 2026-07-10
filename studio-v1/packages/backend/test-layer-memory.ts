/**
 * 单独测试 memoryKernel — 纯 SQL，不涉及 embedding/rerank
 */
import 'dotenv/config'
import { initDb } from './src/db/index.js'
import { memoryKernel } from './src/modules/memory-kernel/index.js'

initDb()

async function main() {
  // 1. recallObservations — 纯 SQL keyword 匹配，无 LLM
  console.log('=== recallObservations ("电视") ===')
  const obs = memoryKernel.recallObservations('电视', 5)
  for (const o of obs) {
    console.log(`  [${o.score.toFixed(3)}] ${o.name} (${o.type}) last: ${o.last_action}`)
  }

  // 2. search — 纯 SQL FTS，无 LLM
  console.log('\n=== search ("电视") ===')
  const hits = memoryKernel.search('电视', 5)
  for (const h of hits) {
    console.log(`  [${h.score.toFixed(3)}] ${h.id} type=${h.type} source=${h.source}`)
  }

  // 3. semanticSearch — 会调用 embedding（qwen3-embedding-8b）
  //    如果你只想测 SQL 部分，跳过这个
  const skipEmbedding = process.argv.includes('--no-embed')
  if (!skipEmbedding) {
    console.log('\n=== semanticSearch ("电视") ===')
    try {
      const semantic = await memoryKernel.semanticSearch('电视', 5)
      for (const s of semantic) {
        console.log(`  [${s.score.toFixed(3)}] ${s.id}`)
      }
    } catch (err) {
      console.log(`  (skip: ${(err as Error).message})`)
    }
  } else {
    console.log('\n=== semanticSearch skipped (--no-embed) ===')
  }
}

main().catch(console.error)