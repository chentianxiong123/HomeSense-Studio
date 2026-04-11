import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import YAML from "yaml";
import { grepSkills } from "../skill_loader/tool.js";
import { listExperiences } from "../experience_retrieval/tool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface LlmAgentConfig {
  provider: string;
  model: string;
  base_url: string;
  api_key_env: string;
  api_key?: string;
  max_iterations: number;
  timeout_ms: number;
}

interface ToolDescriptor {
  name: "adb" | "hami" | "web_search";
  summary: string;
}

interface ToolSelectionResult {
  selected_tools: string[];
  reason: string;
  keywords: string[];
  confidence: number;
}

const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  { name: "adb", summary: "控制电视或安卓界面，打开应用、返回主页、执行界面操作" },
  { name: "hami", summary: "发语音或遥控类指令，控制机顶盒、小爱音箱、电视电源类动作" },
  { name: "web_search", summary: "查询网页信息，适合补充联网知识" },
];

function loadConfig(): LlmAgentConfig {
  const configPath = existsSync(join(__dirname, "config.yaml"))
    ? join(__dirname, "config.yaml")
    : join(__dirname, "../../../src/tools/llm_agent/config.yaml");
  try {
    const content = readFileSync(configPath, "utf-8");
    return YAML.parse(content);
  } catch {
    return {
      provider: "deepseek",
      model: "deepseek-chat",
      base_url: "https://api.deepseek.com",
      api_key_env: "DEEPSEEK_API_KEY",
      api_key: "",
      max_iterations: 5,
      timeout_ms: 30000,
    };
  }
}

function extractJsonBlock(content: string) {
  const fenced = content.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const rawFence = content.match(/```\s*([\s\S]*?)```/i);
  if (rawFence?.[1]) return rawFence[1].trim();
  return content.trim();
}

function simpleChatReply(text: string): string {
  const lower = text.toLowerCase().trim();
  if (lower.includes("你好") || lower === "hi" || lower === "hello") return "你好，有什么需要我处理？";
  if (lower.includes("在吗")) return "在的，你说。";
  if (lower.includes("谢谢")) return "不客气。";
  return "你继续说。";
}

function extractKeywordsFromText(input: string): string[] {
  const cleaned = input
    .replace(/[，。！？、；：“”"'（）()\[\]{}]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const bigrams: string[] = [];
  for (let i = 0; i < input.length - 1; i++) {
    const piece = input.slice(i, i + 2).trim();
    if (piece.length === 2) bigrams.push(piece);
  }

  return Array.from(new Set([...cleaned, ...bigrams])).slice(0, 12);
}

async function callOpenAIJson(systemPrompt: string, userPrompt: string, config: LlmAgentConfig) {
  const apiKey = config.api_key || process.env[config.api_key_env];
  if (!apiKey) return null;

  const response = await fetch(`${config.base_url}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 900,
    }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${await response.text()}`);
  }

  const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = result.choices?.[0]?.message?.content || "";
  if (!content) return null;
  return JSON.parse(extractJsonBlock(content));
}

function heuristicToolSelection(text: string): ToolSelectionResult {
  const lower = text.toLowerCase();
  const selected = new Set<string>();

  if (/(电视|东芝|乐视|b站|bilibili|返回|主页|首页|截图|界面|按钮|app)/.test(lower)) selected.add("adb");
  if (/(机顶盒|小爱|音箱|音响|打开电视|打开机顶盒|放歌|听歌|播放)/.test(lower)) selected.add("hami");
  if (/(搜索|查一下|联网|网页|新闻|天气)/.test(lower)) selected.add("web_search");

  return {
    selected_tools: Array.from(selected),
    reason: selected.size > 0 ? "根据用户目标匹配了相关工具能力" : "当前看不出可用工具",
    keywords: extractKeywordsFromText(text).slice(0, 8),
    confidence: selected.size > 0 ? 0.75 : 0.2,
  };
}

async function selectToolsAndKeywords(text: string, config: LlmAgentConfig): Promise<ToolSelectionResult> {
  const systemPrompt = [
    "你是 HomeSense 的工具选择器。",
    "你只能做三件事：选择工具、说明理由、给出用于搜索知识的关键词。",
    "不要规划动作，不要编造能力。",
    "如果现有工具明显不足，就返回空数组并降低 confidence。",
    "只输出 JSON。",
  ].join("\n");

  const userPrompt = JSON.stringify({
    task: text,
    tools: TOOL_DESCRIPTORS,
    output_schema: {
      selected_tools: ["adb|hami|web_search"],
      reason: "string",
      keywords: ["string"],
      confidence: "number 0-1",
    },
  }, null, 2);

  try {
    const parsed = await callOpenAIJson(systemPrompt, userPrompt, config);
    if (!parsed) return heuristicToolSelection(text);
    return {
      selected_tools: Array.isArray(parsed.selected_tools) ? parsed.selected_tools.filter((item: unknown) => typeof item === "string") : [],
      reason: typeof parsed.reason === "string" ? parsed.reason : "模型未提供明确理由",
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((item: unknown) => typeof item === "string").slice(0, 8) : extractKeywordsFromText(text).slice(0, 8),
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    return heuristicToolSelection(text);
  }
}

function retrieveSkillKnowledge(toolNames: string[], keywords: string[]) {
  if (toolNames.length === 0 || keywords.length === 0) return [];
  return grepSkills({ keywords, maxResults: 8 })
    .filter((item) => toolNames.includes(item.tool))
    .map((item) => ({
      ref: item.ref,
      tool: item.tool,
      section: item.section,
      content: item.content,
    }));
}

function retrieveExperienceKnowledge(keywords: string[]) {
  if (keywords.length === 0) return [];
  const docs = listExperiences();
  return docs
    .map((doc) => {
      const haystack = `${doc.title}\n${doc.content}\n${doc.keywords.join(" ")}`;
      const score = keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0);
      return { doc, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => ({
      intent: item.doc.intent,
      title: item.doc.title,
      content: item.doc.content,
      filePath: item.doc.filePath,
    }));
}

function buildPlanningPrompt(text: string, context: Record<string, any>, toolSelection: ToolSelectionResult, skillDocs: Array<Record<string, unknown>>, experienceDocs: Array<Record<string, unknown>>) {
  return JSON.stringify({
    task: text,
    selected_tools: toolSelection.selected_tools,
    selected_reason: toolSelection.reason,
    retrieval_keywords: toolSelection.keywords,
    available_tool_capabilities: TOOL_DESCRIPTORS.filter((item) => toolSelection.selected_tools.includes(item.name)),
    retrieved_skills: skillDocs.map((item) => ({ ref: item.ref, content: item.content })),
    retrieved_experiences: experienceDocs.map((item) => ({ title: item.title, content: item.content })),
    previous_failure: context.previousFailure || null,
    intent: context.intent || null,
    output_schema: {
      thought: "string",
      action: "{tool, action, params?} | null",
      confidence: "number 0-1",
      is_complete: "boolean",
      reason: "string",
    },
    rules: [
      "如果检索不到任何有效知识，返回 action=null，is_complete=true，confidence<0.7",
      "如果你认为现有工具不能完成任务，返回 action=null，is_complete=true，confidence<0.7",
      "如果置信度极低，直接让用户补充信息，不要硬做",
      "只有在你确信可执行时才返回 action",
    ],
  }, null, 2);
}

async function buildStructured(text: string, context: Record<string, any>, config: LlmAgentConfig) {
  const toolSelection = await selectToolsAndKeywords(text, config);
  const lower = text.toLowerCase();

  if (lower.includes("b站") || lower.includes("bilibili") || lower.includes("哔哩")) {
    return {
      thought: "我将按 Demo 路径执行：先打开东芝电视和机顶盒，再确认已安装 B 站包名，最后启动 B 站。",
      action: [
        { tool: "hami", action: "tv_remote", params: { device: "tvs_toshiba", command: "\u7535\u6e90" } },
        { tool: "adb", action: "wait", params: { seconds: 15 } },
        { tool: "hami", action: "tv_remote", params: { device: "stb", command: "\u7535\u6e90" } },
        { tool: "adb", action: "wait", params: { seconds: 15 } },
        { tool: "adb", action: "ensure_connected", params: { initial_wait_seconds: 10, max_attempts: 5, backoff_seconds: 2 } },
        { tool: "adb", action: "wait", params: { seconds: 15 } },
        { tool: "adb", action: "list_packages", params: { keyword: "bili" } },
        { tool: "adb", action: "wait", params: { seconds: 3 } },
        { tool: "adb", action: "launch_app", params: { package: "com.xiaodianshi.tv.yst" } },
      ],
      confidence: 0.92,
      is_complete: false,
      reason: "demo_bilibili_flow",
      selected_tools: ["hami", "adb"],
      retrieval_keywords: ["B站", "bilibili", "电视", "机顶盒"],
      selection_reason: "这是当前 Demo 的目标链路，现有工具能力足够执行。",
      selected_skill_refs: ["hami/index", "adb/index"],
    };
  }

  if (toolSelection.selected_tools.length === 0) {
    return {
      thought: `现有工具不足以完成这个任务。${toolSelection.reason}`,
      action: null,
      confidence: toolSelection.confidence,
      is_complete: true,
      selected_tools: [],
      retrieval_keywords: toolSelection.keywords,
      selection_reason: toolSelection.reason,
      selected_skill_refs: [],
    };
  }

  const skillDocs = retrieveSkillKnowledge(toolSelection.selected_tools, toolSelection.keywords);
  const experienceDocs = retrieveExperienceKnowledge(toolSelection.keywords);
  if (skillDocs.length === 0 && experienceDocs.length === 0) {
    return {
      thought: "我没有检索到可支持当前任务的技能或经验，现有信息不足，无法继续执行。",
      action: null,
      confidence: 0.2,
      is_complete: true,
      selected_tools: toolSelection.selected_tools,
      retrieval_keywords: toolSelection.keywords,
      selection_reason: toolSelection.reason,
      selected_skill_refs: [],
    };
  }

  const systemPrompt = [
    "你是 HomeSense 的执行规划器。",
    "你已经先完成了工具选择，现在只能基于被选中的工具和检索到的知识做决定。",
    "如果知识不足或置信度低，必须停止并让用户补充。",
    "只输出 JSON。",
  ].join("\n");

  const userPrompt = buildPlanningPrompt(text, context, toolSelection, skillDocs, experienceDocs);

  try {
    const parsed = await callOpenAIJson(systemPrompt, userPrompt, config);
    if (!parsed) {
      return {
        thought: "模型没有返回有效规划结果。",
        action: null,
        confidence: 0.2,
        is_complete: true,
        selected_tools: toolSelection.selected_tools,
        retrieval_keywords: toolSelection.keywords,
        selection_reason: toolSelection.reason,
        selected_skill_refs: skillDocs.map((item) => String(item.ref)),
      };
    }

    return {
      thought: typeof parsed.thought === "string" ? parsed.thought : "已完成工具与知识检查。",
      action: parsed.action ?? null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      is_complete: Boolean(parsed.is_complete),
      reason: typeof parsed.reason === "string" ? parsed.reason : "planned",
      selected_tools: toolSelection.selected_tools,
      retrieval_keywords: toolSelection.keywords,
      selection_reason: toolSelection.reason,
      selected_skill_refs: skillDocs.map((item) => String(item.ref)),
    };
  } catch (error) {
    return {
      thought: `规划失败：${String(error)}`,
      action: null,
      confidence: 0.2,
      is_complete: true,
      selected_tools: toolSelection.selected_tools,
      retrieval_keywords: toolSelection.keywords,
      selection_reason: toolSelection.reason,
      selected_skill_refs: skillDocs.map((item) => String(item.ref)),
    };
  }
}

function deriveSuggestedActions(text: string, context: Record<string, any>) {
  const matchedPath = context.matchedPath as Record<string, any> | undefined;
  if (Array.isArray(matchedPath?.actions) && matchedPath.actions.length > 0) {
    return matchedPath.actions;
  }

  const lower = text.toLowerCase();
  if (lower.includes("返回") || lower.includes("后退")) return [{ tool: "adb", action: "back" }];
  if (lower.includes("主页") || lower.includes("首页") || lower.includes("home")) return [{ tool: "adb", action: "home" }];
  if (lower.includes("机顶盒")) return [{ tool: "hami", action: "xiaoai_execute", params: { command: "打开机顶盒" } }];
  if (lower.includes("小爱") || lower.includes("音箱") || lower.includes("放歌") || lower.includes("听歌")) {
    return [{ tool: "hami", action: "xiaoai_execute", params: { command: "小爱音箱放歌" } }];
  }
  if (lower.includes("b站") || lower.includes("bilibili") || lower.includes("哔哩")) {
    return [{ tool: "adb", action: "open_bilibili" }];
  }
  return [];
}

function shouldPromoteFallbackAction(text: string, parsed: Record<string, any>, context: Record<string, any>) {
  if (parsed.action) return false;
  if (typeof parsed.confidence === "number" && parsed.confidence < 0.7) return false;
  return deriveSuggestedActions(text, context).length > 0;
}

async function callChatModel(text: string, systemPrompt: string, config: LlmAgentConfig): Promise<string> {
  const apiKey = config.api_key || process.env[config.api_key_env];
  if (!apiKey) return simpleChatReply(text);

  try {
    const response = await fetch(`${config.base_url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        temperature: 0.7,
        max_tokens: 256,
      }),
    });

    if (!response.ok) return simpleChatReply(text);
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return result.choices?.[0]?.message?.content?.trim() || simpleChatReply(text);
  } catch {
    return simpleChatReply(text);
  }
}

export const llmAgentTool = tool(
  async (input) => {
    const config = loadConfig();
    const text = String(input.text || "");
    const context = input.context ? JSON.parse(String(input.context)) : {};

    if (context.mode === "chat") {
      const systemPrompt = context.systemPrompt || "你是聊天助手，简短回答。";
      const chatResult = await callChatModel(text, systemPrompt, config);
      return JSON.stringify({ answer: chatResult });
    }

    const structured = await buildStructured(text, context, config);
    return JSON.stringify(structured);
  },
  {
    name: "llm_agent",
    description: "LLM 兜底层：先选工具，再检索知识，再决定是否执行",
    schema: z.object({
      text: z.string().describe("用户输入文本"),
      context: z.string().optional().describe("上下文信息"),
    }),
  },
);

export { callChatModel, loadConfig as loadLlmAgentConfig, deriveSuggestedActions, shouldPromoteFallbackAction };
