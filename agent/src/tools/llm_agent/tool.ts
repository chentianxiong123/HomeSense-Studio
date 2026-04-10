import { tool } from "@langchain/core/tools";
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
  if (text.includes("b站") || text.includes("bilibili") || text.includes("哔哩")) return "open_app";
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
  if ((lower.includes("列举") || lower.includes("列出") || lower.includes("查看") || lower.includes("有什么")) && (lower.includes("包") || lower.includes("应用") || lower.includes("app"))) {
    return [{ tool: "adb", action: "list_packages" }];
  }
  if (lower.includes("b站") || lower.includes("bilibili") || lower.includes("哔哩")) {
    return [
      { tool: "hami", action: "xiaoai_execute", params: { command: "打开电视" } },
      { tool: "hami", action: "xiaoai_execute", params: { command: "打开机顶盒" } },
      { tool: "adb", action: "launch_app", params: { package: "com.xiaodianshi.tv.yst" } },
    ];
  }
  if (lower.includes("听歌") || lower.includes("音乐") || lower.includes("播放") || lower.includes("唱歌")) {
    return [{ tool: "hami", action: "xiaoai_execute", params: { command: "播放音乐" } }];
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
    intent: context.intent || null,
    examples: buildDeepExamples(),
  };
}

function buildDeepUserPrompt(text: string, context: Record<string, any>) {
  const reactSteps = context.reactSteps || [];
  const historySection = reactSteps.length > 0
    ? "\n历史步骤:\n" + reactSteps.map((s: any, i: number) => 
        `${i+1}. 思考: ${s.thought}\n   执行: ${s.action ? JSON.stringify(s.action) : 'null'}\n   结果: ${s.observation}`
      ).join("\n")
    : "";

  return JSON.stringify({
    task: text + historySection,
    tools: ["adb", "hami"],
    intent: context.intent || null,
    expected_json_schema: {
      thought: "string - 当前思考",
      action: "object {tool, action, params?} 或 null",
      confidence: "number 0-1，置信度低于0.7表示不确定",
      is_complete: "boolean - 是否完成任务",
    },
  }, null, 2);
}

function applyFallbackActionPromotion(text: string, parsed: Record<string, any>, context: Record<string, any>) {
  // ReAct 格式：如果已有 action，直接返回
  if (parsed.action) return parsed;

  // 如果没有 action，用关键词生成
  const fallbackActions = deriveSuggestedActions(text, context);
  if (fallbackActions.length === 0) return parsed;

  return {
    ...parsed,
    thought: parsed.thought || `我将执行: ${fallbackActions[0].action}`,
    action: fallbackActions[0],
    is_complete: false,
  };
}

function shouldPromoteFallbackAction(text: string, parsed: Record<string, any>, context: Record<string, any>) {
  if (Array.isArray(parsed.suggested_actions) && parsed.suggested_actions.length > 0) return false;
  if (parsed.success !== true) return false;
  const lower = text.toLowerCase();
  return lower.includes("返回") || lower.includes("退回") || lower.includes("上一页") || lower.includes("主页") || lower.includes("首页") || lower.includes("主界面") || lower.includes("打开电视") || lower.includes("打开机顶盒") || lower.includes("开启电视") || lower.includes("开启机顶盒") || lower.includes("听歌") || lower.includes("音乐") || lower.includes("播放") || lower.includes("唱歌") || Boolean((context.matchedPath as Record<string, any> | undefined)?.actions?.length) || buildPreferredRetrievalAction(context).length > 0;
}

function extractJsonBlock(content: string) {
  const fenced = content.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const rawFence = content.match(/```\s*([\s\S]*?)```/i);
  if (rawFence?.[1]) return rawFence[1].trim();
  return content.trim();
}

function sanitizeStructuredOutput(parsed: Record<string, any>) {
  const thought = typeof parsed.thought === "string" ? parsed.thought : "思考中...";
  const action = parsed.action || null;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 1;
  const isComplete = Boolean(parsed.is_complete);
  
  return {
    thought,
    action,
    confidence,
    is_complete: isComplete,
  };
}

function buildFallbackStructured(text: string, context: Record<string, any>, config: LlmAgentConfig) {
  const suggestedActions = deriveSuggestedActions(text, context);
  const action = suggestedActions.length > 0 ? suggestedActions[0] : null;
  return {
    thought: action ? `我将执行: ${action.action}` : "无法确定要执行的动作",
    action,
    confidence: action ? 0.8 : 0.3,
    is_complete: false,
    provider: config.provider,
    model: config.model,
  };
}

function buildDeepExamples() {
  return [
    { input: "返回", output: { thought: "用户想返回，我执行返回操作", action: { tool: "adb", action: "back" }, is_complete: true } },
    { input: "回主页", output: { thought: "用户想回主页，我执行主页操作", action: { tool: "adb", action: "home" }, is_complete: true } },
    { input: "打开B站", output: { thought: "用户想打开B站，我启动B站应用", action: { tool: "adb", action: "launch_app", params: { package: "com.xiaodianshi.tv.yst" } }, is_complete: true } },
  ];
}

function buildDeepSystemPrompt() {
  return [
    "你是 HomeSense 智能助手，使用 ReAct 循环思考和执行任务。",
    "",
    "工具说明：",
    "- adb: 操控安卓设备（手机/电视/机顶盒），可安装启动应用、点击屏幕、获取界面、返回、主页",
    "- hami: 控制小爱音箱，发送红外/蓝牙信号开启电器（电视、机顶盒、空调等）",
    "",
    "ReAct 格式：",
    "1. thought: 思考下一步做什么",
    "2. action: 要执行的工具动作（没有动作时填 null）",
    "3. confidence: 置信度 0-1，对行动不确定时设为 < 0.7",
    "4. is_complete: 是否完成（true 表示任务完成或遇到无法解决的问题）",
    "",
    "重要规则：",
    "- 置信度 < 0.7 时，设置 action: null，is_complete: true，thought 改为询问用户",
    "- 如果用户回答了你的问题，根据回答继续执行任务",
    "- 执行失败时（如 device not found），设置 is_complete: true 并说明问题",
    "- 只输出 JSON，不要其他内容。",
  ].join("\n");
}

function buildHistorySection(history: Array<{role: string; content: string}>): string {
  if (!history || history.length === 0) return "";
  
  const lines = history.map(msg => {
    const role = msg.role === "user" ? "用户" : "助手";
    return `${role}: ${msg.content}`;
  });
  
  return `\n对话历史:\n${lines.join("\n")}\n`;
}

async function callOpenAICompatible(text: string, context: Record<string, any>, config: LlmAgentConfig, apiKey: string) {
  const url = `${config.base_url}/v1/chat/completions`;
  const systemPrompt = buildDeepSystemPrompt();
  const history = Array.isArray(context.history) ? context.history : [];
  const historySection = buildHistorySection(history);
  const userPrompt = buildDeepUserPrompt(text, context) + historySection;

  console.log("[LLM] Calling API:", url, config.model);
  console.log("[LLM] History messages:", history.length);
  console.log("[LLM] System prompt length:", systemPrompt.length);
  console.log("[LLM] User prompt length:", userPrompt.length);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.log("[LLM] API error:", response.status, errorText);
    throw new Error(`API error: ${response.status} ${errorText}`);
  }

  const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  console.log("[LLM] API response keys:", Object.keys(result));
  
  const content = result.choices?.[0]?.message?.content || "";
  console.log("[LLM] Content length:", content.length);
  console.log("[LLM] Content preview:", content.slice(0, 100));

  if (!content) {
    throw new Error("Empty content from API");
  }

  const parsed = JSON.parse(extractJsonBlock(content));
  const normalized = sanitizeStructuredOutput(applyFallbackActionPromotion(text, parsed, context));
  return {
    ...normalized,
    provider: config.provider,
    model: config.model,
    needs_model_config: false,
    selected_skill_refs: Array.isArray(context.selectedSkillRefs) ? context.selectedSkillRefs : [],
    context_summary: buildContextSummary(context),
    skill_insights: buildSkillInsights(context),
  };
}

async function callConfiguredModel(text: string, context: Record<string, any>, config: LlmAgentConfig) {
  const apiKey = config.api_key || process.env[config.api_key_env];
  if (!apiKey) {
    throw new Error("未配置 LLM API Key，请在 config.yaml 中配置");
  }

  if (config.provider === "anthropic") {
    return callAnthropicModel(text, context, config, apiKey);
  }

  return callOpenAICompatible(text, context, config, apiKey);
}

async function callAnthropicModel(text: string, context: Record<string, any>, config: LlmAgentConfig, apiKey: string) {
  const url = `${config.base_url}/v1/messages`;
  const systemPrompt = buildDeepSystemPrompt();
  const userPrompt = buildDeepUserPrompt(text, context);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt }
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${errorText}`);
  }

  const result = await response.json() as { content?: Array<{ type: string; text?: string }> };
  const content = result.content?.[0]?.text || "";

  const parsed = JSON.parse(extractJsonBlock(content));
  const normalized = sanitizeStructuredOutput(applyFallbackActionPromotion(text, parsed, context));
  return {
    ...normalized,
    provider: config.provider,
    model: config.model,
    needs_model_config: false,
    selected_skill_refs: Array.isArray(context.selectedSkillRefs) ? context.selectedSkillRefs : [],
    context_summary: buildContextSummary(context),
    skill_insights: buildSkillInsights(context),
  };
}



function simpleChatReply(text: string): string {
  const lower = text.toLowerCase().trim();
  if (lower.includes("你好") || lower.includes("您好") || lower === "hi" || lower === "hello") return "你好！有什么可以帮你的吗？";
  if (lower.includes("在吗") || lower.includes("在不在")) return "在的！想说点什么？";
  if (lower.includes("谢谢") || lower.includes("感谢")) return "不客气！";
  if (lower.includes("拜拜") || lower.includes("再见") || lower.includes("走了")) return "拜拜，有事叫我！";
  if (lower.includes("好的") || lower.includes("行") || lower.includes("可以")) return "好的！";
  if (lower.includes("知道") || lower.includes("明白") || lower.includes("懂了")) return "嗯嗯！";
  if (lower.includes("天气")) return "今天天气不错呢！";
  if (lower.includes("新闻")) return "新闻我不太了解呢，说说别的吧。";
  if (lower.includes("哈哈") || lower.includes("呵呵")) return "😄";
  if (lower.includes("好玩") || lower.includes("有趣")) return "是挺好玩的~";
  return "嗯，说说看？";
}

async function callChatModel(text: string, systemPrompt: string, config: LlmAgentConfig): Promise<string> {
  const apiKey = config.api_key || process.env[config.api_key_env];
  if (!apiKey) return simpleChatReply(text);

  try {
    const url = `${config.base_url}/v1/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text }
        ],
        temperature: 0.7,
        max_tokens: 256,
      }),
    });

    if (!response.ok) return simpleChatReply(text);
    
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = result.choices?.[0]?.message?.content || "";
    return content.trim() || simpleChatReply(text);
  } catch {
    return simpleChatReply(text);
  }
}

async function callChatModelStreaming(
  text: string,
  systemPrompt: string,
  config: LlmAgentConfig,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const apiKey = config.api_key || process.env[config.api_key_env];
  if (!apiKey) return simpleChatReply(text);

  try {
    const url = `${config.base_url}/v1/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text }
        ],
        temperature: 0.7,
        max_tokens: 256,
        stream: true,
      }),
    });

    if (!response.ok) return simpleChatReply(text);
    
    const reader = response.body?.getReader();
    if (!reader) return simpleChatReply(text);
    
    let fullContent = "";
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter(line => line.startsWith("data: "));
      
      for (const line of lines) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || "";
          if (content) {
            fullContent += content;
            if (onChunk) onChunk(content);
          }
        } catch {}
      }
    }
    
    return fullContent.trim() || simpleChatReply(text);
  } catch {
    return simpleChatReply(text);
  }
}

async function callConfiguredModelStreaming(
  text: string,
  context: Record<string, any>,
  config: LlmAgentConfig,
  onChunk?: (chunk: string) => void
): Promise<Record<string, any> | null> {
  const apiKey = config.api_key || process.env[config.api_key_env];
  if (!apiKey) return null;

  try {
    const url = `${config.base_url}/v1/chat/completions`;
    const systemPrompt = buildDeepSystemPrompt();
    const userPrompt = buildDeepUserPrompt(text, context);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0,
        max_tokens: 1024,
        stream: true,
      }),
    });

    if (!response.ok) return null;
    
    const reader = response.body?.getReader();
    if (!reader) return null;
    
    let fullContent = "";
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter(line => line.startsWith("data: "));
      
      for (const line of lines) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || "";
          if (content) {
            fullContent += content;
            if (onChunk) onChunk(content);
          }
        } catch {}
      }
    }

    const parsed = JSON.parse(extractJsonBlock(fullContent));
    return parsed;
  } catch {
    return null;
  }
}

async function buildStructured(text: string, context: Record<string, any>, config: LlmAgentConfig) {
  const configured = await callConfiguredModel(text, context, config);
  if (!configured) {
    throw new Error("LLM API 调用失败，请检查 API 配置");
  }
  return configured;
}

export const llmAgentTool = tool(
  async (input) => {
    const config = loadConfig();
    const text = input.text as string;
    const context = input.context ? JSON.parse(String(input.context)) : {};

    // 闲聊模式：简单回复
    if (context.mode === "chat") {
      const systemPrompt = context.systemPrompt || "你是闲聊助手，简短回复。";
      const chatResult = await callChatModel(text, systemPrompt, config);
      return JSON.stringify({ answer: chatResult });
    }

    // ReAct 模式：结构化输出
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

export { callChatModel, loadConfig as loadLlmAgentConfig, deriveSuggestedActions, shouldPromoteFallbackAction };
