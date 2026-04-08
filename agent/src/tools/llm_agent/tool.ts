import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import YAML from "yaml";

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

function deriveIntentHint(text: string): string {
  if ((text.includes("退") || text.includes("回")) && (text.includes("主页") || text.includes("首页") || text.includes("主界面"))) return "go_home";
  if (text.includes("打开") || text.includes("开启")) return "open_device";
  if (text.includes("返回") || text.includes("退回")) return "navigate_back";
  if (text.includes("播放") || text.includes("放歌")) return "play_media";
  if (text.includes("搜索") || text.includes("查找")) return "search_content";
  return "complex_task";
}

function summarizeSelectedSkills(context: Record<string, any>) {
  const selectedSkills = Array.isArray(context.selectedSkills) ? context.selectedSkills : [];
  return selectedSkills.map((item: Record<string, any>) => ({
    tool: item.tool,
    section: item.section,
    capabilities: Array.isArray(item.metadata?.capabilities) ? item.metadata.capabilities : [],
    exposure_level: typeof item.metadata?.exposure_level === "string" ? item.metadata.exposure_level : null,
    risk_level: typeof item.metadata?.risk_level === "string" ? item.metadata.risk_level : null,
    preconditions: Array.isArray(item.metadata?.preconditions) ? item.metadata.preconditions : [],
  }));
}

function buildSkillDisclosureSummary(context: Record<string, any>) {
  const selectedSkills = summarizeSelectedSkills(context);
  return selectedSkills.map((item: Record<string, any>) => ({
    tool: item.tool,
    section: item.section,
    capabilities: item.capabilities,
    exposure_level: item.exposure_level,
    risk_level: item.risk_level,
  }));
}

function buildSkillRiskHints(context: Record<string, any>) {
  const selectedSkills = summarizeSelectedSkills(context);
  return selectedSkills
    .filter((item: Record<string, any>) => item.risk_level)
    .map((item: Record<string, any>) => `${item.tool}/${item.section}: risk=${item.risk_level}, exposure=${item.exposure_level || "unknown"}`);
}

function buildCapabilityHints(context: Record<string, any>) {
  const selectedSkills = summarizeSelectedSkills(context);
  return Array.from(new Set(selectedSkills.flatMap((item: Record<string, any>) => Array.isArray(item.capabilities) ? item.capabilities : [])));
}

function buildPreconditionHints(context: Record<string, any>) {
  const selectedSkills = summarizeSelectedSkills(context);
  return Array.from(new Set(selectedSkills.flatMap((item: Record<string, any>) => Array.isArray(item.preconditions) ? item.preconditions : [])));
}

function preferredSkillExposure(context: Record<string, any>) {
  const selectedSkills = summarizeSelectedSkills(context);
  const hasProgressive = selectedSkills.some((item: Record<string, any>) => item.exposure_level === "progressive");
  return hasProgressive ? "respect_progressive_disclosure" : "default";
}

function buildSkillPromptHints(context: Record<string, any>) {
  return {
    capability_hints: buildCapabilityHints(context),
    risk_hints: buildSkillRiskHints(context),
    precondition_hints: buildPreconditionHints(context),
    disclosure_mode: preferredSkillExposure(context),
    selected_skill_metadata: buildSkillDisclosureSummary(context),
  };
}

function buildSkillPromptLine(context: Record<string, any>) {
  const capabilities = buildCapabilityHints(context);
  return capabilities.length > 0
    ? `优先在已披露 capability 内规划：${capabilities.join("、")}`
    : "当前没有额外 capability 提示";
}

function buildSkillRiskLine(context: Record<string, any>) {
  const riskHints = buildSkillRiskHints(context);
  return riskHints.length > 0
    ? `注意 skills 风险/披露约束：${riskHints.join("；")}`
    : "当前没有额外 risk 提示";
}

function buildPreconditionLine(context: Record<string, any>) {
  const preconditions = buildPreconditionHints(context);
  return preconditions.length > 0
    ? `关注前提条件：${preconditions.join("、")}`
    : "当前没有额外 precondition 提示";
}

function skillDisclosureModeLine(context: Record<string, any>) {
  return preferredSkillExposure(context) === "respect_progressive_disclosure"
    ? "遵守渐进式披露：优先使用已披露 capability，不主动发散到底层细节"
    : "可按默认方式参考当前 skills";
}

function buildPlan(text: string, context: Record<string, any>, suggestedActions: Array<Record<string, any>>) {
  const selectedSkills = summarizeSelectedSkills(context);
  const matchedPath = context.matchedPath as Record<string, any> | undefined;
  const matchedPathCandidates = Array.isArray(context.matchedPathCandidates) ? context.matchedPathCandidates as Array<Record<string, any>> : [];
  const candidateSummary = matchedPathCandidates.slice(0, 2).map((item) => `${item.name}(score=${item.score})`).join("、");
  const plan = [
    "分析用户目标和当前上下文",
    selectedSkills.length > 0 ? `参考已按需加载的 skills：${selectedSkills.map((item) => `${item.tool}/${item.section}`).join("、")}` : "当前没有额外 skills 上下文",
    buildSkillPromptLine(context),
    skillDisclosureModeLine(context),
    buildSkillRiskLine(context),
    buildPreconditionLine(context),
    matchedPath?.name ? `参考相似历史经验：${matchedPath.name}` : candidateSummary ? `参考候选历史经验：${candidateSummary}` : "判断是否已有可直接复用的设备或意图信息",
    suggestedActions.length > 0 ? "生成可尝试的动作建议" : "等待后续接入真实大模型规划",
  ];

  if (context.shouldEscalateToDeep && matchedPath?.description) {
    plan.splice(3, 0, `当前历史经验不可直接执行，可将其作为 Deep 规划参考：${matchedPath.description}`);
  }

  if (/截图|图标|识图|ocr|视觉|界面/.test(text) && selectedSkills.some((item: Record<string, any>) => item.tool === "adb" && item.section === "perception")) {
    plan.splice(2, 0, "优先参考 ADB perception 技能处理视觉/界面问题");
  }

  return plan;
}

function buildAnswer(context: Record<string, any>, hasModelConfig: boolean) {
  const skillRefs = Array.isArray(context.selectedSkillRefs) ? context.selectedSkillRefs : [];
  const matchedPath = context.matchedPath as Record<string, any> | undefined;
  const matchedPathCandidates = Array.isArray(context.matchedPathCandidates) ? context.matchedPathCandidates as Array<Record<string, any>> : [];
  const skillText = skillRefs.length > 0 ? `已按需加载 skills：${skillRefs.join("、")}。` : "当前未加载额外 skills。";
  const historyText = matchedPath?.name
    ? `已参考相似历史经验：${matchedPath.name}。`
    : matchedPathCandidates.length > 0
      ? `已参考候选历史经验：${matchedPathCandidates.slice(0, 2).map((item) => item.name).join("、")}。`
      : "";
  return hasModelConfig
    ? `${skillText}${historyText}已进入 Deep Layer，当前可返回结构化规划，下一步可继续扩展为真实大模型多步决策。`
    : `${skillText}${historyText}已进入 Deep Layer，但当前未配置大模型密钥。我已生成结构化规划占位结果，后续可接入真实推理。`;
}

function buildContextSummary(context: Record<string, any>) {
  const matchedPath = context.matchedPath as Record<string, any> | undefined;
  const matchedPathCandidates = Array.isArray(context.matchedPathCandidates) ? context.matchedPathCandidates as Array<Record<string, any>> : [];
  return {
    hasIntent: Boolean(context.intent),
    recentMentionedDevices: context.recentMentionedDevices || [],
    traceLength: Array.isArray(context.trace) ? context.trace.length : 0,
    selectedSkills: summarizeSelectedSkills(context),
    matchedPathName: matchedPath?.name || null,
    matchedPathCandidateCount: matchedPathCandidates.length,
    topCandidateNames: matchedPathCandidates.slice(0, 2).map((item) => item.name),
    shouldEscalateToDeep: Boolean(context.shouldEscalateToDeep),
  };
}

function buildSkillInsights(context: Record<string, any>) {
  const selectedSkills = Array.isArray(context.selectedSkills) ? context.selectedSkills : [];
  return selectedSkills.map((item: Record<string, any>) => {
    const lines = String(item.content || "").split("\n").map((line) => line.trim()).filter(Boolean);
    return {
      tool: item.tool,
      section: item.section,
      headline: lines[0] || `${item.tool}/${item.section}`,
      capabilities: Array.isArray(item.metadata?.capabilities) ? item.metadata.capabilities : [],
      exposure_level: typeof item.metadata?.exposure_level === "string" ? item.metadata.exposure_level : null,
      risk_level: typeof item.metadata?.risk_level === "string" ? item.metadata.risk_level : null,
    };
  });
}
function buildNextHint(suggestedActions: Array<Record<string, any>>) {
  return suggestedActions.length > 0 ? "tool_executor" : "end";
}

function deriveSuggestedActions(text: string, context: Record<string, any>) {
  const lower = text.toLowerCase();
  const matchedPath = context.matchedPath as Record<string, any> | undefined;
  const matchedPathCandidates = Array.isArray(context.matchedPathCandidates) ? context.matchedPathCandidates as Array<Record<string, any>> : [];
  const matchedActions = Array.isArray(matchedPath?.actions) ? matchedPath.actions : [];
  if (matchedActions.length > 0) return matchedActions;

  const sortedReusableCandidates = matchedPathCandidates
    .filter((item) => Array.isArray(item.actions) && item.actions.length > 0 && item.isFailurePath !== true)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const topCandidate = sortedReusableCandidates[0];
  if (Array.isArray(topCandidate?.actions) && topCandidate.actions.length > 0) return topCandidate.actions;

  if (lower.includes("返回") || lower.includes("退回") || lower.includes("上一页")) return [{ tool: "adb", action: "back" }];
  if (lower.includes("主页") || lower.includes("首页") || lower.includes("主界面")) return [{ tool: "adb", action: "home" }];
  if ((lower.includes("打开") || lower.includes("开启")) && (lower.includes("电视") || lower.includes("乐视"))) {
    return [{ tool: "hami", action: "xiaoai_execute", params: { command: "打开电视" } }];
  }
  if ((lower.includes("打开") || lower.includes("开启")) && (lower.includes("机顶盒") || lower.includes("盒子"))) {
    return [{ tool: "hami", action: "xiaoai_execute", params: { command: "打开机顶盒" } }];
  }
  return [];
}

function buildCandidatePreferenceSummary(context: Record<string, any>) {
  const matchedPathCandidates = Array.isArray(context.matchedPathCandidates) ? context.matchedPathCandidates as Array<Record<string, any>> : [];
  const sortedReusableCandidates = matchedPathCandidates
    .filter((item) => Array.isArray(item.actions) && item.actions.length > 0 && item.isFailurePath !== true)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const topCandidate = sortedReusableCandidates[0];
  return topCandidate?.name ? `${topCandidate.name}(score=${topCandidate.score})` : null;
}

function buildPreferredRetrievalAction(context: Record<string, any>) {
  const matchedPathCandidates = Array.isArray(context.matchedPathCandidates) ? context.matchedPathCandidates as Array<Record<string, any>> : [];
  const sortedReusableCandidates = matchedPathCandidates
    .filter((item) => Array.isArray(item.actions) && item.actions.length > 0 && item.isFailurePath !== true)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const topCandidate = sortedReusableCandidates[0];
  return Array.isArray(topCandidate?.actions) && topCandidate.actions.length > 0 ? topCandidate.actions : [];
}

function buildDeepControlHints(text: string, context: Record<string, any>) {
  return {
    preferred_retrieval_action: buildPreferredRetrievalAction(context),
    candidate_preference_summary: buildCandidatePreferenceSummary(context),
    derived_action_fallback: deriveSuggestedActions(text, context),
    skill_hints: buildSkillPromptHints(context),
  };
}

function buildDeepPromptContext(text: string, context: Record<string, any>) {
  return {
    ...context,
    recommended_examples: buildDeepExamples(),
    control_hints: buildDeepControlHints(text, context),
  };
}

function buildDeepUserPrompt(text: string, context: Record<string, any>) {
  return JSON.stringify({
    task: text,
    context: buildDeepPromptContext(text, context),
    expected_json_schema: {
      success: "boolean",
      intent_hint: "string",
      plan: ["string"],
      answer: "string",
      suggested_actions: [{ tool: "string", action: "string", params: "object?" }],
      next_hint: "string",
      skill_insights: [{ tool: "string", section: "string", headline: "string?" }],
    },
  }, null, 2);
}

function applyFallbackActionPromotion(text: string, parsed: Record<string, any>, context: Record<string, any>) {
  if (!shouldPromoteFallbackAction(text, parsed, context)) return parsed;
  const preferredRetrievalAction = buildPreferredRetrievalAction(context);
  const fallbackActions = preferredRetrievalAction.length > 0 ? preferredRetrievalAction : deriveSuggestedActions(text, context);
  if (fallbackActions.length === 0) return parsed;
  return {
    ...parsed,
    suggested_actions: fallbackActions,
    next_hint: "tool_executor",
    answer: typeof parsed.answer === "string" && parsed.answer.length > 0 ? parsed.answer : "已生成可执行动作建议。",
  };
}

function shouldPromoteFallbackAction(text: string, parsed: Record<string, any>, context: Record<string, any>) {
  if (Array.isArray(parsed.suggested_actions) && parsed.suggested_actions.length > 0) return false;
  if (parsed.success !== true) return false;
  const lower = text.toLowerCase();
  return lower.includes("返回") || lower.includes("退回") || lower.includes("上一页") || lower.includes("主页") || lower.includes("首页") || lower.includes("主界面") || lower.includes("打开电视") || lower.includes("打开机顶盒") || lower.includes("开启电视") || lower.includes("开启机顶盒") || Boolean((context.matchedPath as Record<string, any> | undefined)?.actions?.length) || buildPreferredRetrievalAction(context).length > 0;
}

function extractJsonBlock(content: string) {
  const fenced = content.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const rawFence = content.match(/```\s*([\s\S]*?)```/i);
  if (rawFence?.[1]) return rawFence[1].trim();
  return content.trim();
}

function sanitizeStructuredOutput(parsed: Record<string, any>) {
  return {
    success: Boolean(parsed.success),
    intent_hint: typeof parsed.intent_hint === "string" ? parsed.intent_hint : "complex_task",
    plan: Array.isArray(parsed.plan) ? parsed.plan.map((item) => String(item)) : [],
    answer: typeof parsed.answer === "string" ? parsed.answer : "已进入 Deep Layer。",
    suggested_actions: Array.isArray(parsed.suggested_actions) ? parsed.suggested_actions : [],
    next_hint: typeof parsed.next_hint === "string" ? parsed.next_hint : (Array.isArray(parsed.suggested_actions) && parsed.suggested_actions.length > 0 ? "tool_executor" : "end"),
    skill_insights: Array.isArray(parsed.skill_insights) ? parsed.skill_insights : [],
    context_summary: parsed.context_summary,
  };
}

function buildFallbackStructured(text: string, context: Record<string, any>, config: LlmAgentConfig) {
  const apiKey = config.api_key || process.env[config.api_key_env];
  const hasModelConfig = Boolean(apiKey);
  const suggestedActions = deriveSuggestedActions(text, context);
  return {
    success: hasModelConfig,
    provider: config.provider,
    model: config.model,
    intent_hint: deriveIntentHint(text),
    plan: buildPlan(text, context, suggestedActions),
    answer: buildAnswer(context, hasModelConfig),
    suggested_actions: suggestedActions,
    context_summary: buildContextSummary(context),
    skill_insights: buildSkillInsights(context),
    needs_model_config: !hasModelConfig,
    next_hint: buildNextHint(suggestedActions),
    selected_skill_refs: Array.isArray(context.selectedSkillRefs) ? context.selectedSkillRefs : [],
  };
}

function buildDeepExamples() {
  return [
    {
      input: "返回上一页",
      output: { success: true, intent_hint: "navigate_back", plan: ["识别为返回操作", "直接调用 adb.back"], answer: "好的，返回上一页。", suggested_actions: [{ tool: "adb", action: "back" }], next_hint: "tool_executor", skill_insights: [] },
    },
    {
      input: "回到主界面",
      output: { success: true, intent_hint: "go_home", plan: ["识别为回主页操作", "直接调用 adb.home"], answer: "好的，返回主页。", suggested_actions: [{ tool: "adb", action: "home" }], next_hint: "tool_executor", skill_insights: [] },
    },
    {
      input: "打开电视",
      output: { success: true, intent_hint: "open_device", plan: ["识别为打开电视", "调用 hami 打开电视"], answer: "好的，打开乐视电视。", suggested_actions: [{ tool: "hami", action: "xiaoai_execute", params: { command: "打开电视" } }], next_hint: "tool_executor", skill_insights: [] },
    },
    {
      input: "帮我看看电视界面按钮",
      output: { success: true, intent_hint: "complex_task", plan: ["用户需要界面理解", "先获取界面结构或截图", "确认元素后再执行"], answer: "我先分析电视界面，再决定下一步动作。", suggested_actions: [], next_hint: "end", skill_insights: [] },
    },
  ];
}

function buildDeepSystemPrompt() {
  return [
    "你是 HomeSense 的 Deep Layer 规划器。",
    "根据用户输入和上下文，只输出严格 JSON。",
    "优先复用已有 intent、设备上下文、相似历史经验、已加载 skills。",
    "优先在已披露 capability 内规划；若 skills 标明 progressive disclosure，不要主动发散到底层未披露能力。",
    "如果 skill metadata 包含 risk_level 或 preconditions，要把它们视为规划约束。",
    "如果 context.control_hints.preferred_retrieval_action 非空，把它视为第一优先候选动作；仅当它明显不适合当前任务时才放弃。",
    "如果 context.control_hints.candidate_preference_summary 存在，应优先参考该 top-1 历史经验，而不是自行发散到其他动作。",
    "如果用户目标与受支持动作高度吻合，请优先返回可执行 suggested_actions，而不是只给抽象计划。",
    "只有在动作结构正确且你有较高把握时，才返回 suggested_actions；否则返回空数组。",
    "支持动作模式：adb.back、adb.home、hami.xiaoai_execute(command=打开电视/打开机顶盒/小爱音箱放歌)、adb.click_element、adb.get_ui_tree。",
    "如果用户明确说返回/上一页，优先给 adb.back。",
    "如果用户明确说回主页/首页/主界面，优先给 adb.home。",
    "如果用户明确说打开电视/打开机顶盒，优先给 hami.xiaoai_execute。",
    "如果用户要求看电视界面、按钮、页面元素，但没有明确可执行动作，返回空 suggested_actions。",
    "不要输出 markdown，不要输出解释性前缀，只输出 JSON。",
  ].join("\n");
}

async function callConfiguredModel(text: string, context: Record<string, any>, config: LlmAgentConfig) {
  const apiKey = config.api_key || process.env[config.api_key_env];
  if (!apiKey) return null;

  const model = new ChatOpenAI({
    model: config.model,
    apiKey,
    configuration: { baseURL: config.base_url },
    temperature: 0,
    timeout: config.timeout_ms,
    maxRetries: 1,
  });

  const response = await model.invoke([
    new SystemMessage(buildDeepSystemPrompt()),
    new HumanMessage(buildDeepUserPrompt(text, context)),
  ]);

  const content = typeof response.content === "string"
    ? response.content
    : Array.isArray(response.content)
      ? response.content.map((item) => typeof item === "string" ? item : ("text" in item ? String(item.text) : "")).join("\n")
      : "";

  const parsed = JSON.parse(extractJsonBlock(content));
  const normalized = sanitizeStructuredOutput(applyFallbackActionPromotion(text, parsed, context));
  return {
    ...normalized,
    provider: config.provider,
    model: config.model,
    needs_model_config: false,
    selected_skill_refs: Array.isArray(context.selectedSkillRefs) ? context.selectedSkillRefs : [],
    context_summary: normalized.context_summary || buildContextSummary(context),
    skill_insights: Array.isArray(normalized.skill_insights) ? normalized.skill_insights : buildSkillInsights(context),
  };
}

async function buildStructured(text: string, context: Record<string, any>, config: LlmAgentConfig) {
  const configured = await callConfiguredModel(text, context, config).catch(() => null);
  if (configured) return configured;
  return buildFallbackStructured(text, context, config);
}

export const llmAgentTool = tool(
  async (input) => {
    const config = loadConfig();
    const text = input.text as string;
    const context = input.context ? JSON.parse(String(input.context)) : {};
    const structured = await buildStructured(text, context, config);
    return JSON.stringify(structured);
  },
  {
    name: "llm_agent",
    description: "大模型推理，复杂决策和自然语言理解",
    schema: z.object({
      text: z.string().describe("用户输入文本"),
      context: z.string().optional().describe("上下文信息"),
    }),
  },
);
