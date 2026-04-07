import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { initDatabase } from "./database.js"
import { matchWithSynonyms, matchExact } from "./matcher.js"
import { expandSynonyms, getSynonyms } from "./expander.js"
import type { ToolAction } from "../../state.js"

initDatabase()

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
    description: "规则引擎匹配，支持同义扩展匹配",
    schema: z.object({
      text: z.string().describe("用户输入的文本（已拼装好的查询，如'打开乐视电视'）"),
      useSynonym: z.boolean().optional().describe("是否使用同义词扩展，默认true"),
    }),
  }
)

export { matchWithSynonyms, matchExact, expandSynonyms, getSynonyms }
