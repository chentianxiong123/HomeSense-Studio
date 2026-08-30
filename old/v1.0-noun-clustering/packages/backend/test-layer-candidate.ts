/**
 * 单独测试 candidatePlanService.resolve() — 可禁用 embedding/rerank
 *
 * Usage:
 *   node test-layer-candidate.mjs             # 完整链路（embed + rerank）
 *   node test-layer-candidate.mjs --no-rerank # 只用本地 rerank fallback
 *   node test-layer-candidate.mjs --no-embed  # 跳过 semantic search（纯 keyword）
 */
import 'dotenv/config'
import { initDb } from './src/db/index.js'
import { candidatePlanService } from './src/modules/candidate-plan/index.js'
import { contextCompleter } from './src/modules/context-completer/index.js'
import { memoryKernel } from './src/modules/memory-kernel/index.js'

initDb()

// 如果传了 --no-embed，先清空 semanticSearch 让它返回空
const noEmbed = process.argv.includes('--no-embed')
const noRerank = process.argv.includes('--no-rerank')

if (noEmbed) {
  const orig = memoryKernel.semanticSearch.bind(memoryKernel)
  memoryKernel.semanticSearch = async () => []
  console.log('  [injected] semanticSearch → [] (skip)')
}

if (noRerank) {
  // 让 provider rerank 失败，触发本地 fallback
  const orig = process.env.RERANK_BASE_URL
  process.env.RERANK_BASE_URL = 'http://0.0.0.1:9999'
  console.log('  [injected] rerank → force fallback to local rerankService')
}

async function main() {
  const queries = [
    '打开电视',
    '播放哔哩哔哩',
    '声音大一点',
  ]

  for (const query of queries) {
    console.log(`\n=== resolve("${query}") ===`)
    const completion = contextCompleter.complete({ message: query })
    const plans = await candidatePlanService.resolve({
      query,
      completion,
    })

    console.log(`  plans: ${plans.length}`)
    for (const p of plans) {
      console.log(`    [${p.confidence.toFixed(3)}] ${p.title} (${p.candidate_kind})`)
      console.log(`           source=${p.source}  steps=${p.steps.length}`)
    }
  }
}

main().catch(console.error)