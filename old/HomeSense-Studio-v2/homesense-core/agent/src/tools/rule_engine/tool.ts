import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { initDatabase } from "./database.js"
import { matchWithSynonyms, matchExact } from "./matcher.js"
import { expandSynonyms, getSynonyms } from "./expander.js"
import type { ToolAction } from "../../state.js"

initDatabase()

const CHAT_KEYWORDS = [
  "你好", "您好", "hi", "hello", "嗨", "在吗", "在不在",
  "聊聊", "聊天", "说话", "问个事", "请教", "请问",
  "天气", "新闻", "今天", "现在几", "多少",
  "笑", "好玩", "有趣", "哈哈", "呵呵",
  "谢谢", "感谢", "辛苦了", "麻烦",
  "好的", "行", "可以", "没问题", "收到",
  "明白", "知道", "懂了", "了解",
  "再见", "拜拜", "走了", "下次见",
]

const COMMAND_KEYWORDS = [
  "打开", "关闭", "关掉", "开启", "启动",
  "播放", "暂停", "停止", "继续",
  "搜索", "查找", "找一下",
  "安装", "卸载", "删除",
  "返回", "后退", "前进",
  "截图", "点击", "滑动",
  "设置", "调整", "修改",
  "快进", "快退",
]

function classifyIntent(text: string): { isChat: boolean; score: number } {
  const lower = text.toLowerCase()
  let chatScore = 0
  let commandScore = 0

  for (const kw of CHAT_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) chatScore++
  }
  for (const kw of COMMAND_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) commandScore++
  }

  if (text.length <= 3) chatScore++

  const total = chatScore + commandScore
  if (total === 0) return { isChat: false, score: 0.5 }

  const chatRatio = chatScore / total
  return {
    isChat: chatRatio > 0.5,
    score: Math.min(Math.max(chatScore, commandScore) / 5, 1),
  }
}

function inferIntent(trigger: string | null): string | undefined {
  if (!trigger) return undefined
  if (trigger.includes("打开")) return "open_device"
  if (trigger === "返回") return "navigate_back"
  if (trigger === "主页") return "go_home"
  if (trigger.includes("放歌")) return "play_media"
  return undefined
}

function inferActions(trigger: string | null): ToolAction[] {
  if (!trigger) return []

  switch (trigger) {
    case "返回":
      return [{ tool: "adb", action: "back" }]
    case "主页":
      return [{ tool: "adb", action: "home" }]
    case "打开乐视电视":
    case "打开乐视电视机":
    case "打开电视":
      return [{ tool: "hami", action: "xiaoai_execute", params: { command: trigger } }]
    case "打开机顶盒":
      return [{ tool: "hami", action: "xiaoai_execute", params: { command: trigger } }]
    case "小爱音箱放歌":
    case "小爱音响放歌":
      return [{ tool: "hami", action: "xiaoai_execute", params: { command: trigger } }]
    default:
      return []
  }
}

export const ruleEngineTool = tool(
  async (input) => {
    const { text, useSynonym = true } = input

    const intentCheck = classifyIntent(text)
    if (intentCheck.isChat) {
      return JSON.stringify({
        matched: false,
        response: null,
        matchedTrigger: null,
        intent: "chat",
        actions: [],
        source: "rule_engine",
        intentConfidence: intentCheck.score,
        intentSource: "keyword_match",
      })
    }

    let result
    if (useSynonym) {
      result = matchWithSynonyms(text)
    } else {
      result = matchExact(text)
    }

    const actions = Array.isArray(result.actions) && result.actions.length > 0 ? result.actions : inferActions(result.matchedTrigger)
    const intent = inferIntent(result.matchedTrigger)

    return JSON.stringify({
      matched: result.matched,
      response: result.response,
      matchedTrigger: result.matchedTrigger,
      intent,
      actions,
      source: "rule_engine"
    })
  },
  {
    name: "rule_engine",
    description: "强力规则引擎：关键词匹配 + 同义词扩展 + 意图预判",
    schema: z.object({
      text: z.string().describe("用户输入的文本"),
      useSynonym: z.boolean().optional().describe("是否使用同义词扩展，默认true"),
    }),
  }
)

export { matchWithSynonyms, matchExact, expandSynonyms, getSynonyms }
