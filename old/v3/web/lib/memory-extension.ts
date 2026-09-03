// HomeSense v3 — agent 记忆扩展
//
// 在会话里注册两个工具,让 agent 真正"记得":
//   - timeline_search: 全文搜索 SQLite 时间线(历史对话),agent 主动召回
//   - memory: 维护 MEMORY.md(agent 笔记) / USER.md(用户画像),跨会话持久
//
// 与 hermes 的 memory_tool + session_search 对应。

import { Type } from "./pi-shims"
import { defineTool, InlineExtension } from "./pi-shims"

import {
  buildMemorySnapshot,
  memoryAction,
  type MemoryTarget,
} from "./memory-store"
import { searchTimelineMessages } from "./timeline-db"

export const HOME_SENSE_MEMORY_EXTENSION_NAME = "homesense-memory"

function memoryTargetOf(value: unknown): MemoryTarget {
  return value === "user" ? "user" : "memory"
}

function formatTimelineResults(
  results: Array<{
    id: number
    role: "user" | "assistant"
    content: string
    ts: string
    model: string | null
    snippet: string
  }>,
): string {
  if (results.length === 0) return "没有找到相关历史对话。"
  return results
    .map(
      (r, i) =>
        `[${i + 1}] ${r.role === "user" ? "用户" : "助手"} (${new Date(r.ts).toLocaleString()}):\n${r.content.slice(0, 1200)}`,
    )
    .join("\n\n---\n\n")
}

export function createHomeSenseMemoryExtension(tenantId: string): InlineExtension {
  return {
    name: HOME_SENSE_MEMORY_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.registerTool(
        defineTool({
          name: "timeline_search",
          label: "Timeline Search",
          description:
            "在家庭的长期对话时间线里全文搜索历史消息。这是你的跨会话回忆——\n" +
            "当用户提到'以前/上次/还记得吗/我们说过吗'、或你想确认之前是否讨论过某事时,主动使用它。\n" +
            "每次对话都是家庭的持续会话,远古消息不在当前上下文窗口里,必须靠这个工具找回。\n" +
            "传中文关键词即可子串匹配。",
          promptSnippet: "搜索家庭历史对话时间线",
          promptGuidelines: [
            "用户提及历史对话('以前/上次/还记得吗')时主动调用 timeline_search。",
            "返回的片段包含原始上下文,可直接引用其中内容。",
          ],
          parameters: Type.Object({
            query: Type.String({ description: "搜索关键词(中文子串即可)。" }),
          }),
          executionMode: "parallel",
          async execute(_toolCallId, params) {
            const results = searchTimelineMessages(tenantId, params.query, 8)
            return {
              content: [{ type: "text", text: formatTimelineResults(results) }],
              details: {
                kind: "homesense-timeline-search",
                query: params.query,
                count: results.length,
              },
            }
          },
        }),
      )

      pi.registerTool(
        defineTool({
          name: "memory",
          label: "Memory",
          description:
            "维护跨会话的持久记忆。两个分类:\n" +
            "  - memory: 你的笔记(环境事实、家庭信息、设备约定、学到的经验)\n" +
            "  - user: 用户画像(偏好、沟通风格、习惯)\n" +
            "action: add 添加新记忆(自动去重);replace 用唯一子串替换旧记忆;remove 用唯一子串删除。\n" +
            "对话开始时这些记忆会注入你的上下文;重要且稳定的信息请写入,琐碎的一次性内容不要写。\n" +
            "限制: 总量约 6000 字符。",
          promptSnippet: "读写长期记忆(MEMORY/USER)",
          promptGuidelines: [
            "发现重要、跨会话有价值的信息(家庭/用户/环境稳定事实)时主动写入 memory。",
            "避免写入一次性的任务进度——那些用 timeline_search 找回。",
          ],
          parameters: Type.Object({
            action: Type.String({
              description: "add(添加) / replace(替换) / remove(删除)",
              examples: ["add", "replace", "remove"],
            }),
            target: Type.String({
              description: "memory(agent 笔记) 或 user(用户画像)",
              examples: ["memory", "user"],
            }),
            content: Type.String({ description: "记忆内容。replace/remove 传唯一子串即可。" }),
          }),
          executionMode: "sequential",
          async execute(_toolCallId, params) {
            const result = memoryAction(tenantId, {
              action: params.action as "add" | "replace" | "remove",
              target: memoryTargetOf(params.target),
              content: params.content,
            })
            return {
              content: [{ type: "text", text: result.message }],
              details: { kind: "homesense-memory", ...result },
            }
          },
        }),
      )
    },
  }
}

export { buildMemorySnapshot }
export { readMemoryEntries } from "./memory-store"