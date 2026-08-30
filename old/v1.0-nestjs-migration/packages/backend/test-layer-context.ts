/**
 * 单独测试 contextCompleter — 不涉及任何 LLM
 * 纯 deterministic 模式匹配 + 设备模糊查找
 */
import 'dotenv/config'
import { initDb } from './src/db/index.js'
import { contextCompleter } from './src/modules/context-completer/index.js'

initDb()

const tests = [
  '打开电视',
  '把声音调大',
  '播放哔哩哔哩',
  '关灯',
  '今天天气怎么样',
]

for (const msg of tests) {
  console.log(`\n=== input: "${msg}" ===`)
  const result = contextCompleter.complete({ message: msg })
  console.log(`  completed:     ${result.completed_message}`)
  console.log(`  target_device: ${result.target_device_id ?? '(none)'} (${result.target_device_label ?? '-'})`)
  console.log(`  target_type:   ${result.target_device_type ?? '(none)'}`)
  console.log(`  media_app:     ${result.matched_media_app ?? '(none)'}`)
  console.log(`  confidence:    ${result.confidence?.toFixed(3) ?? '-'}`)
  console.log(`  weights:       ${result.device_weights.length} device(s)`)
}