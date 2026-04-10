import { StateGraph, START, END } from "@langchain/langgraph";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { buildRegistryPreviewV0, buildRuntimeRegistryPreview, enforceToolActionsByPolicy, readSkillSection, selectSkillSectionsByCapability, summarizeCapabilityCommands } from "./tools/skillsRegistry.js";
import {
  AgentState,
  createFallbackReply,
  createIntent,
  createStageResult,
  toTraceEntry,
  type ToolAction,
  type ExperienceDoc,
} from "./state.js";
import { executeToolAction, isValidToolAction, llmAgentTool, localIntentTool, ruleEngineTool, successPathsTool, toolActionToCapabilityCommand, intentClassifierTool, deriveSuggestedActions, shouldPromoteFallbackAction } from "./tools/index.js";
import { getRecentUserMessages, getRecentMessages, getSmartContext } from "./tools/memory/chatDb.js";
import { createPendingLlmCase, updateLlmCase } from "./tools/memory/llmCaseDb.js";
import { completeContext } from "./tools/context_completer/tool.js";
import { loadSkillsByKeywords } from "./tools/skill_loader/tool.js";
import { searchExperiences } from "./tools/experience_retrieval/tool.js";
import { writeExperience } from "./tools/experience_writer/tool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, "tools");

type SelectedSkillSection = NonNullable<ReturnType<typeof readSkillSection>>;
type RuntimeToolResult = {
  tool: string;
  action: string;
  success: boolean;
  data?: unknown;
  error?: string;
};



function addPolicySection(policy: Array<{ tool: string; sections: string[] }>, tool: string, section: string) {
  const existing = policy.find((item) => item.tool === tool);
  if (existing) {
    if (!existing.sections.includes(section)) existing.sections.push(section);
  } else {
    policy.push({ tool, sections: [section] });
  }
}

export function getSkillPolicy(state: typeof AgentState.State): Array<{ tool: string; sections: string[] }> {
  const policy: Array<{ tool: string; sections: string[] }> = [
    { tool: "llm_agent", sections: ["index", "planning"] },
  ];

  if (state.intent?.intent) {
    addPolicySection(policy, "local_intent", "index");
    addPolicySection(policy, "local_intent", "context");
  }

  const input = state.input || "";
  const inputLower = input.toLowerCase();

  // 在 llm_agent 阶段，根据用户输入关键词加载相关 skills
  if (state.currentStage === "llm_agent" || !state.currentStage) {
    // B站 / bilibili 相关
    if (inputLower.includes("b站") || inputLower.includes("bilibili") || inputLower.includes("哔哩")) {
      addPolicySection(policy, "adb", "bilibili");
      addPolicySection(policy, "adb", "index");
    }
    // 当贝市场相关
    if (inputLower.includes("当贝") || inputLower.includes("应用商店")) {
      addPolicySection(policy, "adb", "dangbei_market");
      addPolicySection(policy, "adb", "index");
    }
    // 通用电视操作
    if (inputLower.includes("电视") || inputLower.includes("tv") || inputLower.includes("安装") || inputLower.includes("下载")) {
      addPolicySection(policy, "adb", "index");
    }
    // 打开电视（hami 红外控制）
    if (inputLower.includes("打开电视") || inputLower.includes("开电视")) {
      addPolicySection(policy, "hami", "tv_power");
      addPolicySection(policy, "hami", "index");
    }
    // 打开机顶盒（hami 红外控制）
    if (inputLower.includes("打开机顶盒") || inputLower.includes("开机顶盒") || inputLower.includes("打开盒子")) {
      addPolicySection(policy, "hami", "box_power");
      addPolicySection(policy, "hami", "index");
    }
    // 小爱音箱相关（听歌、放歌、播放音乐等）
    if (inputLower.includes("听歌") || inputLower.includes("放歌") || inputLower.includes("播放音乐") || inputLower.includes("小爱") || inputLower.includes("音箱")) {
      addPolicySection(policy, "hami", "voice");
      addPolicySection(policy, "hami", "index");
    }
  }

  // tool_executor 阶段加载工具操作 skills
  if (state.currentStage === "tool_executor") {
    const selectedTool = state.stageResult?.data?.selectedTool as string | undefined;
    if (selectedTool === "adb" || !selectedTool) {
      addPolicySection(policy, "adb", "index");
    }
    if (selectedTool === "hami" || !selectedTool) {
      addPolicySection(policy, "hami", "index");
    }
  }

  return policy;
}

export function estimateSkillPolicy(input: string, intent?: string) {
  const normalizedIntent = intent?.trim() || undefined;
  const stageTrace = [
    { stage: "rule_engine" },
    { stage: "success_paths" },
  ] as Array<{ stage: string }>;
  return getSkillPolicy({
    input,
    intent: normalizedIntent ? { schemaVersion: "v0", intent: normalizedIntent, rawInput: input } : undefined,
    stageTrace,
  } as typeof AgentState.State);
}

export function flattenSkillPolicy(policy: Array<{ tool: string; sections: string[] }>) {
  return policy.flatMap(({ tool, sections }) => sections.map((section) => `${tool}/${section}`));
}

export function buildSkillPolicyPreview(input: string, intent?: string) {
  const policy = estimateSkillPolicy(input, intent);
  const refs = flattenSkillPolicy(policy);
  const runtimePreview = buildRuntimeRegistryPreview(TOOLS_DIR, refs, input, intent);
  return {
    ...runtimePreview,
    stages: policy.map((item) => ({
      stage: item.tool,
      refs: item.sections.map((section) => `${item.tool}/${section}`),
    })),
  };
}

function collectSelectedSkills(state: typeof AgentState.State): SelectedSkillSection[] {
  const selected = getSkillPolicy(state)
    .flatMap(({ tool, sections }) => sections.map((section) => readSkillSection(TOOLS_DIR, tool, section)))
    .filter((item): item is SelectedSkillSection => Boolean(item));

  const seen = new Set<string>();
  return selected.filter((item) => {
    const key = `${item.tool}:${item.section}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractSkillRefs(skills: SelectedSkillSection[]) {
  return skills.map((item) => `${item.tool}/${item.section}`);
}

function extractSkillPayload(skills: SelectedSkillSection[]) {
  return skills.map((item) => ({
    tool: item.tool,
    section: item.section,
    content: item.content,
    metadata: item.metadata,
  }));
}

function actionsToCommands(actions: ToolAction[] | undefined, prefix: string) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((action, index) => toolActionToCapabilityCommand(`${prefix}_${index + 1}`, action))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function extractDeviceWeights(input: string) {
  const recentMessages = getRecentUserMessages(20);
  const devicePatterns = [
    { device: "tv_letv", keywords: ["乐视", "电视"] },
    { device: "toshiba_tv", keywords: ["东芝", "东芝电视", "toshiba"] },
    { device: "stb", keywords: ["机顶盒", "盒子"] },
    { device: "xiaoai_speaker", keywords: ["小爱", "音箱", "音响"] },
  ];

  const DECAY_FACTOR = 0.9;
  const scores = new Map<string, number>();

  const allTexts = [
    ...recentMessages.map((item) => item.content),
    input,
  ];

  for (let i = 0; i < allTexts.length; i++) {
    const text = allTexts[i];
    const isCurrentInput = i === allTexts.length - 1;
    const weight = isCurrentInput
      ? Math.pow(DECAY_FACTOR, 0)
      : Math.pow(DECAY_FACTOR, allTexts.length - 1 - i);

    for (const pattern of devicePatterns) {
      const matches = pattern.keywords.filter((keyword) => text.includes(keyword)).length;
      if (matches > 0) {
        scores.set(pattern.device, (scores.get(pattern.device) ?? 0) + matches * weight);
      }
    }
  }

  return Array.from(scores.entries())
    .map(([device, score]) => ({ 
      device, 
      score,
      type: device.includes("tv") || device.includes("speaker") ? device.split("_").slice(-1)[0] : "unknown"
    }))
    .sort((a, b) => b.score - a.score);
}

function normalizeRetrievalText(text: string) {
  return text
    .replace(/能不能|可以|请你|帮我|一下|这个|那个/g, "")
    .replace(/乐视/g, "电视")
    .replace(/首页|主界面/g, "主页")
    .replace(/退回去|退回|返回去/g, "返回")
    .replace(/\s+/g, "")
    .trim();
}

function retrievalSimilarity(input: string, candidateText: string) {
  const left = normalizeRetrievalText(input);
  const right = normalizeRetrievalText(candidateText);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  const leftChars = new Set(Array.from(left));
  const rightChars = new Set(Array.from(right));
  const intersection = Array.from(leftChars).filter((char) => rightChars.has(char)).length;
  const union = new Set([...leftChars, ...rightChars]).size;
  return union === 0 ? 0 : intersection / union;
}

function toMatchedPathCandidate(item: Record<string, any>) {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    score: item.score,
    successRate: item.successRate,
    isFailurePath: item.isFailurePath,
    actions: item.actions,
  };
}

async function buildDeepMatchedPathCandidates(input: string, intent: string | undefined, matches: Array<Record<string, any>>, best: Record<string, any> | undefined) {
  const seeded = matches.slice(0, 3).map(toMatchedPathCandidate);
  const hasExecutableSeed = seeded.some((item) => Array.isArray(item.actions) && item.actions.length > 0 && item.isFailurePath !== true);
  const bestIsNonActionable = Boolean(best) && (!Array.isArray(best?.actions) || best.actions.length === 0) && best?.isFailurePath !== true;

  if (!bestIsNonActionable || hasExecutableSeed) {
    return seeded;
  }

  const listed = await successPathsTool.invoke({ action: "list" });
  const parsed = typeof listed === "string" ? JSON.parse(listed) : listed;
  const paths = Array.isArray(parsed.paths) ? parsed.paths : [];
  const fallbackCandidates = paths
    .filter((item: Record<string, any>) => item.id !== best?.id)
    .filter((item: Record<string, any>) => typeof item.successRate === "number" && Number(item.successRate) > 0.99)
    .filter((item: Record<string, any>) => Array.isArray(item.actions) && item.actions.length > 0)
    .filter((item: Record<string, any>) => !item.failureReason)
    .filter((item: Record<string, any>) => !intent || !item.intent || item.intent === intent)
    .map((item: Record<string, any>) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      score: retrievalSimilarity(input, String(item.input || item.name || "")),
      successRate: typeof item.successRate === "number" ? item.successRate : 0,
      isFailurePath: false,
      actions: item.actions,
    }))
    .filter((item: Record<string, any>) => Number(item.score) >= 0.2)
    .sort((a: Record<string, any>, b: Record<string, any>) => Number(b.score || 0) - Number(a.score || 0) || Number(b.successRate || 0) - Number(a.successRate || 0))
    .slice(0, 2);

  const merged = [...seeded];
  for (const candidate of fallbackCandidates) {
    if (!merged.some((item) => item.id === candidate.id)) merged.push(candidate);
  }
  return merged.slice(0, 3);
}

async function contextCompleterNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  try {
    const { completedInput, deviceWeights } = completeContext(state.input);
    const changed = completedInput !== state.input;

    const stageResult = createStageResult({
      ok: true,
      stage: "context_completer",
      next: "intent_normalizer",
      message: changed ? `补全输入: ${completedInput}` : "无需补全",
      reason: changed ? "context_completed" : "no_completion_needed",
      data: { completedInput, deviceWeights, changed },
      meta: { source: "context_completer" },
    });

    return {
      currentStage: "intent_normalizer",
      completedInput,
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      context: { ...state.context, deviceWeights },
    };
  } catch (error) {
    const stageResult = createStageResult({
      ok: false,
      stage: "context_completer",
      next: "intent_normalizer",
      message: "上下文补全异常",
      reason: "context_completer_error",
      data: { error: String(error) },
      meta: { source: "context_completer" },
    });

    return {
      currentStage: "intent_normalizer",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
    };
  }
}

async function experienceWriterNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  try {
    const intent = state.intent?.intent || "unknown_intent";
    const completedInput = state.completedInput || state.input;

    const { experiencePath, successPathData } = await writeExperience({
      input: state.input,
      completedInput,
      intent,
      reactSteps: state.reactSteps || [],
      toolResults: state.toolResults.map((r) => ({ tool: r.tool, action: r.action, success: r.success, data: r.data })),
    });

    if (successPathData.actions.length > 0) {
      try {
        await successPathsTool.invoke({
          action: "record",
          input: completedInput,
          pathName: intent,
          pathDescription: `自动生成: ${completedInput}`,
          intent,
          actions: successPathData.actions,
          success: true,
        });
      } catch (e) {
        console.error("[Experience Writer] Success Path 记录失败:", e);
      }
    }

    const stageResult = createStageResult({
      ok: true,
      stage: "experience_writer",
      next: "end",
      message: "经验已写入",
      reason: "experience_written",
      data: { experiencePath, successPathData },
      meta: { source: "experience_writer" },
    });

    return {
      currentStage: "end",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      finalResponse: state.finalResponse,
    };
  } catch (error) {
    const stageResult = createStageResult({
      ok: false,
      stage: "experience_writer",
      next: "end",
      message: "经验写入异常",
      reason: "experience_writer_error",
      data: { error: String(error) },
      meta: { source: "experience_writer" },
    });

    return {
      currentStage: "end",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      finalResponse: state.finalResponse,
    };
  }
}

async function contextBuilderNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  const recentMentionedDevices = extractDeviceWeights(state.input);
  const stageResult = createStageResult({
    ok: true,
    stage: "context_builder",
    next: "intent_normalizer",
    message: "上下文已准备",
    reason: "context_ready",
    data: { recentMentionedDevices },
    meta: { source: "context_builder" },
  });

  return {
    currentStage: "intent_normalizer",
    context: { recentMentionedDevices },
    stageResult,
    stageTrace: [toTraceEntry(stageResult)],
  };
}

async function intentRouterNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  try {
    const result = await intentClassifierTool.invoke({ text: state.input });
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    const intentType = parsed.intentType || parsed.intent || "command";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;

    if (intentType === "chat" && confidence >= 0.3) {
      // 调用 LLM 获取简短闲聊回复
      let reply = "嗯嗯";
      try {
        const llmResult = await llmAgentTool.invoke({
          text: state.input,
          context: JSON.stringify({
            mode: "chat",
            systemPrompt: "你是闲聊助手。用户说什么你就简短回复几个字，不要多于10个字。",
          }),
        });
        const llmParsed = typeof llmResult === "string" ? JSON.parse(llmResult) : llmResult;
        reply = llmParsed.answer || llmParsed.text || "嗯嗯";
      } catch {}

      const stageResult = createStageResult({
        ok: true,
        stage: "intent_router",
        next: "end",
        message: reply,
        reason: "chat_intent_routed",
        confidence,
        data: { intentType, method: parsed.method },
        meta: { source: "intent_router" },
      });

      return {
        currentStage: "end",
        stageResult,
        stageTrace: [toTraceEntry(stageResult)],
        finalResponse: reply,
        context: { ...state.context, intentType: "chat" },
      };
    }

    const stageResult = createStageResult({
      ok: true,
      stage: "intent_router",
      next: "rule_engine",
      message: "意图路由判定为任务请求，进入规则引擎",
      reason: "command_intent_routed",
      confidence,
      data: { intentType, method: parsed.method },
      meta: { source: "intent_router" },
    });

    return {
      currentStage: "rule_engine",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      context: {
        ...state.context,
        intentType,
        coarseIntentConfidence: confidence,
      },
    };
  } catch (error) {
    const stageResult = createStageResult({
      ok: false,
      stage: "intent_router",
      next: "llm_agent",
      message: "意图路由失败，进入LLM决策",
      reason: "intent_router_error",
      confidence: 0,
      data: { error: String(error) },
      meta: { source: "intent_router" },
    });

    return {
      currentStage: "intent_normalizer",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      context: { ...state.context, intentType: "command" },
    };
  }
}

async function ruleEngineNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  try {
    const result = await ruleEngineTool.invoke({ text: state.input });
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    const matched = Boolean(parsed.matched);
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];

    if (parsed.intent === "chat" || parsed.intentSource === "keyword_match") {
      // 调用 LLM 获取简短闲聊回复
      let chatReply = "嗯嗯";
      try {
        const llmResult = await llmAgentTool.invoke({
          text: state.input,
          context: JSON.stringify({
            mode: "chat",
            systemPrompt: "你是闲聊助手。用户说什么你就简短回复几个字，不要多于10个字。",
          }),
        });
        const llmParsed = typeof llmResult === "string" ? JSON.parse(llmResult) : llmResult;
        chatReply = llmParsed.answer || llmParsed.text || "嗯嗯";
      } catch {}

      const stageResult = createStageResult({
        ok: true,
        stage: "rule_engine",
        next: "end",
        message: chatReply,
        reason: "chat_intent",
        confidence: parsed.intentConfidence ?? 0.8,
        data: { intent: "chat", source: "rule_engine_keyword" },
        meta: { source: "rule_engine" },
      });
      return {
        currentStage: "end",
        stageResult,
        stageTrace: [toTraceEntry(stageResult)],
        finalResponse: chatReply,
        context: { ...state.context, intentType: "chat" },
      };
    }

    if (matched && actions.length > 0) {
      const stageResult = createStageResult({
        ok: true,
        stage: "rule_engine",
        next: "tool_executor",
        message: "规则命中，直接执行",
        reason: "rule_matched",
        confidence: 1,
        intent: createIntent(state.input, parsed.intent || "matched_rule"),
        data: {
          matched,
          ruleCandidate: {
            trigger: parsed.matchedTrigger ?? state.input,
            intent: parsed.intent || "matched_rule",
            actions,
            confidence: 1,
            source: "rule_engine",
          },
          matchedTrigger: parsed.matchedTrigger ?? null,
        },
        meta: { source: "rule_engine" },
      });

      return {
        currentStage: "tool_executor",
        stageResult,
        stageTrace: [toTraceEntry(stageResult)],
        ruleMatched: true,
        ruleActions: actions,
        resolutionSource: "rule_engine",
        context: {
          ...state.context,
          ruleCandidate: {
            trigger: parsed.matchedTrigger ?? state.input,
            intent: parsed.intent || "matched_rule",
            actions,
            confidence: 1,
            source: "rule_engine",
          },
        },
      };
    }

    const stageResult = createStageResult({
      ok: false,
      stage: "rule_engine",
      next: "context_completer",
      message: "规则未命中，进入上下文补全",
      reason: "no_rule_match",
      confidence: 0,
      data: { matched: false },
      meta: { source: "rule_engine" },
    });

    return {
      currentStage: "context_completer",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      ruleMatched: false,
    };
  } catch (error) {
    const stageResult = createStageResult({
      ok: false,
      stage: "rule_engine",
      next: "context_completer",
      message: "规则引擎异常",
      reason: "error",
      confidence: 0,
      data: { error: String(error) },
      meta: { source: "rule_engine" },
    });

    return {
      currentStage: "context_completer",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      error: String(error),
    };
  }
}

async function intentNormalizerNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  try {
    const text = state.completedInput || state.input;
    const result = await localIntentTool.invoke({
      text,
      recentMentionedDevices: (state.context.recentMentionedDevices as Array<{ device: string; score: number }> | undefined) ?? [],
    });
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    const matched = Boolean(parsed.matched);
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;

    const normalizedIntent = matched
      ? createIntent(state.input, parsed.intent || "normalized_intent", parsed.action, {
          recentMentionedDevices: (state.context.recentMentionedDevices as Array<{ device: string; score: number }> | undefined) ?? [],
        })
      : state.intent;

    const stageResult = createStageResult({
      ok: matched,
      stage: "intent_normalizer",
      next: "success_experience_retrieval",
      message: matched ? `意图标准化：${parsed.intent || "normalized_intent"}` : "意图未标准化，进入经验检索",
      reason: matched ? "intent_normalized" : "no_intent_match",
      confidence,
      intent: normalizedIntent,
      commands: [],
      actions: [],
      data: {
        matched,
        normalizedIntent: normalizedIntent?.intent ?? null,
        normalizationSource: "intent_normalizer",
        ruleCandidate: state.context.ruleCandidate ?? null,
      },
      meta: { source: "intent_normalizer" },
    });

    return {
      currentStage: "success_experience_retrieval",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      intent: normalizedIntent,
      intentConfidence: confidence,
      context: {
        ...state.context,
        ruleCandidate: state.context.ruleCandidate,
      },
    };
  } catch (error) {
    const stageResult = createStageResult({
      ok: false,
      stage: "intent_normalizer",
      next: "success_experience_retrieval",
      message: "意图标准化异常",
      reason: "intent_normalizer_error",
      data: { error: String(error) },
      meta: { source: "intent_normalizer" },
    });

    return {
      currentStage: "success_experience_retrieval",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      error: `Intent normalizer error: ${error}`,
    };
  }
}

async function successExperienceRetrievalNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  try {
    const result = await successPathsTool.invoke({
      action: "search",
      input: state.input,
      intent: state.intent?.intent,
    });
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
    const best = matches[0];
    const hasReusableActions = Array.isArray(best?.actions) && best.actions.length > 0;
    const matched = Boolean(best);

    if (matched && hasReusableActions) {
      const resolvedIntent = state.intent ?? createIntent(state.input, best.intent || "success_path_match", undefined, {
        recentMentionedDevices: (state.context.recentMentionedDevices as Array<{ device: string; score: number }> | undefined) ?? [],
      });

      const stageResult = createStageResult({
        ok: true,
        stage: "success_experience_retrieval",
        next: "tool_executor",
        message: `Success Path 命中：${best.name}`,
        reason: "success_path_matched",
        confidence: best.score ?? 1,
        intent: resolvedIntent,
        commands: [],
        actions: best.actions,
        data: {
          matches,
          matchedPath: best,
          hasReusableActions,
          ruleCandidate: state.context.ruleCandidate ?? null,
        },
        meta: { source: "success_experience_retrieval" },
      });

      return {
        currentStage: "tool_executor",
        stageResult,
        stageTrace: [toTraceEntry(stageResult)],
        intent: resolvedIntent,
        ruleActions: best.actions,
        autoExecutePath: true,
        resolutionSource: "success_path",
        context: {
          ...state.context,
          ruleCandidate: state.context.ruleCandidate,
        },
      };
    }

    const historicalSkillRefs = Array.isArray(best?.llmSummary?.selectedSkills)
      ? best.llmSummary.selectedSkills
      : Array.isArray(best?.contextSnapshot?.selectedSkills)
        ? best.contextSnapshot.selectedSkills
        : Array.isArray(best?.contextSnapshot?.skillsHint)
          ? best.contextSnapshot.skillsHint
          : [];

    const resolvedIntent = state.intent ?? (matched
      ? createIntent(state.input, best.intent || "success_path_match", undefined, {
          recentMentionedDevices: (state.context.recentMentionedDevices as Array<{ device: string; score: number }> | undefined) ?? [],
        })
      : state.intent);

    const matchedPathCandidates = await buildDeepMatchedPathCandidates(state.input, state.intent?.intent, matches, best);

    const pendingLlmCaseId = createPendingLlmCase({
      rawInput: state.input,
      normalizedIntent: resolvedIntent?.intent ?? null,
      context: {
        recentMentionedDevices: state.context.recentMentionedDevices ?? [],
        historicalSkillRefs,
      },
      matchedCandidates: matchedPathCandidates as Array<Record<string, unknown>>,
    });

    const stageResult = createStageResult({
      ok: matched,
      stage: "success_experience_retrieval",
      next: "experience_retrieval",
      message: matched
        ? `找到成功经验：${best.name}`
        : "未找到 Success Path，进入 Experience 检索",
      reason: matched ? "success_experience_found" : "no_success_path",
      confidence: matched ? best.score : 0,
      intent: resolvedIntent,
      commands: [],
      actions: [],
      data: {
        matches,
        matchedPath: best ?? null,
        matchedPathCandidates,
        hasReusableActions,
        historicalSkillRefs,
        ruleCandidate: state.context.ruleCandidate ?? null,
      },
      meta: { source: "success_experience_retrieval", skillsHint: historicalSkillRefs },
    });

    return {
      currentStage: "experience_retrieval",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      intent: resolvedIntent,
      context: {
        ...state.context,
        historicalSkillRefs,
        pendingLlmCaseId,
        ruleCandidate: state.context.ruleCandidate,
      },
    };
  } catch (error) {
    const stageResult = createStageResult({
      ok: false,
      stage: "success_experience_retrieval",
      next: "experience_retrieval",
      message: "成功经验检索异常，进入 Experience 检索",
      reason: "success_experience_retrieval_error",
      data: { error: String(error) },
      meta: { source: "success_experience_retrieval" },
    });

    return {
      currentStage: "experience_retrieval",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
    };
  }
}

async function llmAgentNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  try {
    const selectedSkills = collectSelectedSkills(state);
    const skillRefs = extractSkillRefs(selectedSkills);
    
    const history = getSmartContext(2);
    console.log("[LLM] Smart context rounds:", history.length / 2);

    const experienceContext = state.matchedExperience
      ? `\n\n## 相关经验文档\n${state.matchedExperience.content}`
      : "";

    const skillContext = state.context?.skillContents
      ? `\n\n## 已加载 Skills\n${state.context.skillContents}`
      : "";

    const result = await llmAgentTool.invoke({
      text: state.completedInput || state.input,
      context: JSON.stringify({
        intent: state.intent,
        reactSteps: state.reactSteps || [],
        trace: state.stageTrace,
        selectedSkills: extractSkillPayload(selectedSkills),
        selectedSkillRefs: skillRefs,
        history,
        experienceDoc: state.matchedExperience?.content || null,
        loadedSkills: state.loadedSkills || [],
      }),
    });

    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    const thought = parsed.thought || "思考中...";
    const action = parsed.action || null;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 1;
    const isComplete = Boolean(parsed.is_complete);

    // 检查是否应该触发 fallback action promotion
    const contextForFallback = {
      intent: state.intent,
      reactSteps: state.reactSteps || [],
      trace: state.stageTrace,
      selectedSkills: extractSkillPayload(selectedSkills),
      matchedPath: (state.stageResult?.data as any)?.matchedPath,
    };

    // 如果 LLM 没有返回 action，尝试用 fallback
    let finalAction = action;
    if (!finalAction && shouldPromoteFallbackAction(state.input, parsed, contextForFallback)) {
      const fallbackActions = deriveSuggestedActions(state.input, contextForFallback);
      if (fallbackActions.length > 0) {
        finalAction = fallbackActions[0];
      }
    }

    // 置信度低于 0.7 且没有 fallback action，直接结束让用户确认
    const needsConfirmation = confidence < 0.7 && !finalAction;

    // 如果有 action 要执行，应该去 tool_executor，而不是 end
    // 只有当没有 action 且 is_complete 为 true 时才结束
    const shouldEnd = !finalAction && isComplete;
    const shouldExecute = finalAction && !needsConfirmation;

    const stageResult = createStageResult({
      ok: true,
      stage: "llm_agent",
      next: shouldEnd ? "end" : (shouldExecute ? "tool_executor" : "end"),
      message: needsConfirmation ? `我不确定我的判断，请确认：${thought}` : thought,
      reason: needsConfirmation ? "low_confidence_ask" : (isComplete ? "react_complete" : "react_thinking"),
      intent: state.intent ?? createIntent(state.input, "react_task"),
      commands: [],
      actions: finalAction ? [finalAction] : [],
      data: {
        thought,
        action: finalAction,
        confidence,
        is_complete: isComplete,
        needsConfirmation,
        selectedSkills: skillRefs,
      },
      meta: { source: "llm_agent" },
    });

    return {
      currentStage: stageResult.next,
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      isComplete: needsConfirmation || shouldEnd || Boolean(finalAction),
      finalResponse: needsConfirmation ? `我不确定我的判断，请确认：${thought}` : (shouldEnd ? thought : state.finalResponse),
    };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    console.error("[LLM Agent Error]:", errorMsg);
    const stageResult = createStageResult({
      ok: false,
      stage: "llm_agent",
      next: "end",
      message: `LLM 调用失败: ${errorMsg}`,
      reason: "llm_agent_error",
      data: { error: errorMsg },
      meta: { source: "llm_agent" },
    });

    return {
      currentStage: "end",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      isComplete: true,
      finalResponse: `LLM 调用失败: ${errorMsg}`,
    };
  }
}

async function toolExecutorNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  let action = state.stageResult?.data?.action as ToolAction | ToolAction[] | null;
  const thought = state.stageResult?.data?.thought as string || "执行中...";

  if (!action) {
    const stageResult = createStageResult({
      ok: false,
      stage: "tool_executor",
      next: "llm_agent",
      message: "没有可执行的 action",
      reason: "no_action",
      data: { observation: "没有可执行的 action" },
      meta: { source: "tool_executor" },
    });
    return {
      currentStage: "llm_agent",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      reactSteps: [...(state.reactSteps || []), { thought, action: null, observation: "没有可执行的 action" }],
      finalResponse: state.finalResponse,
    };
  }

  const actions = Array.isArray(action) ? action : [action];
  const allObservations: string[] = [];
  let allSuccess = true;

  for (const singleAction of actions) {
    let observation = "";
    let success = false;

    try {
      const result = await executeToolAction(singleAction);
      success = result.success;
      observation = result.error || JSON.stringify(result.data) || "执行完成";
    } catch (e) {
      observation = String(e);
    }

    allObservations.push(`${singleAction.tool}.${singleAction.action}: ${observation}`);
    if (!success) allSuccess = false;
  }

  const combinedObservation = allObservations.join(" → ");
  const reactStep = { thought, action: Array.isArray(action) ? action[0] || null : action, observation: combinedObservation };

  const isDeviceError = combinedObservation.includes("device not found") || combinedObservation.includes("device '");
  const isConnectionError = combinedObservation.includes("connection refused") || combinedObservation.includes("WinError 10061") || combinedObservation.includes("Upstream error");
  const shouldEnd = !allSuccess && (isDeviceError || isConnectionError);

  const stageResult = createStageResult({
    ok: allSuccess,
    stage: "tool_executor",
    next: shouldEnd ? "end" : "llm_agent",
    message: combinedObservation,
    reason: allSuccess ? "tool_executed" : "tool_failed",
    data: { observation: combinedObservation, success: allSuccess, shouldEnd },
    meta: { source: "tool_executor" },
  });

  return {
    currentStage: shouldEnd ? "end" : "llm_agent",
    stageResult,
    stageTrace: [toTraceEntry(stageResult)],
    reactSteps: [...(state.reactSteps || []), reactStep],
    isComplete: allSuccess,
    finalResponse: allSuccess ? `执行成功: ${combinedObservation}` : `执行失败: ${combinedObservation}。请确认如何继续。`,
  };
}

async function successWritebackNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  const actions = state.stageResult?.actions ?? state.ruleActions;
  const executedActions = state.toolResults.length > 0;
  const success = executedActions && state.toolResults.every((item) => item.success);
  const stageReason = state.stageResult?.reason;
  const isPlanOnly = stageReason === "llm_agent_plan_only";
  const pathName = buildPathName(state);
  const pathDescription = buildPathDescription(state, success, executedActions, isPlanOnly);
  const resolutionLabel = normalizedResolutionLabel(state.resolutionSource);
  const resolvedIntent = state.intent?.intent || "unknown_intent";
  const pendingLlmCaseId = typeof state.context.pendingLlmCaseId === "number" ? state.context.pendingLlmCaseId : undefined;

  const canWriteToSuccessExperience = shouldWriteToSuccessExperience(state, executedActions, isPlanOnly);

  if (!canWriteToSuccessExperience) {
    const skipReason = isLikelyProbeInput(state.input || "")
      ? "probe_input"
      : state.resolutionSource !== "llm_agent_actionable"
        ? "not_llm_decision"
        : isPlanOnly
          ? "plan_only"
          : !executedActions
            ? "no_execution"
            : "execution_failed";

    if (pendingLlmCaseId) {
      updateLlmCase(pendingLlmCaseId, {
        status: isPlanOnly ? "plan_only" : executedActions ? "failure" : "non_executable",
        finalResponse: state.finalResponse,
      });
    }
    const writeBackMeta = {
      skipped: true,
      reason: skipReason,
      recordType: success ? "success_not_llm" : isPlanOnly ? "plan_only" : executedActions ? "failure" : "non_executable",
      resolutionSource: state.resolutionSource,
      resolutionLabel,
      gatedBySkills: Boolean(state.stageResult?.data?.gatedBySkills),
      gatedActionCount: typeof state.stageResult?.data?.gatedActionCount === "number" ? state.stageResult.data.gatedActionCount : 0,
      gatingReason: typeof state.stageResult?.data?.gatingReason === "string" ? state.stageResult.data.gatingReason : null,
    };
    const writeBackResults = [
      { type: "execution_summary", success, message: state.finalResponse },
      { type: "user_visible_reflection", success: true, message: "这次结果未写入成功经验库。" },
    ];
    const stageResult = createStageResult({
      ok: true,
      stage: "success_writeback",
      next: "end",
      message: state.finalResponse,
      reason: "success_writeback_skipped",
      intent: state.intent,
      actions,
      data: {
        writeBackMeta,
        writeBackResults,
        pathName,
        pathDescription,
        resolutionLabel,
        gatingReason: typeof state.stageResult?.data?.gatingReason === "string" ? state.stageResult.data.gatingReason : null,
        blockedActions: Array.isArray(state.stageResult?.data?.blockedActions) ? state.stageResult.data.blockedActions : [],
      },
    });

    return {
      currentStage: "end",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      resolutionSource: state.resolutionSource,
      writeBackResults,
      llmData: state.llmData,
      finalResponse: state.finalResponse,
    };
  }

  const llmData = state.llmData as Record<string, unknown> | undefined;
  const fallbackSkillsHint = extractSkillRefs(collectSelectedSkills(state));
  const persistedSkillsHint = state.stageResult?.meta?.skillsHint?.length ? state.stageResult.meta.skillsHint : fallbackSkillsHint;
  const persistedSelectedSkills = Array.isArray(llmData?.selected_skills) && llmData.selected_skills.length > 0
    ? llmData.selected_skills
    : fallbackSkillsHint;
  const persistedSkillInsights = Array.isArray(llmData?.skill_insights) ? llmData.skill_insights : undefined;
  const llmSummary = llmData
    ? {
        intentHint: typeof llmData.intent_hint === "string" ? llmData.intent_hint : undefined,
        plan: Array.isArray(llmData.plan) ? (llmData.plan as string[]) : undefined,
        nextHint: typeof llmData.next_hint === "string" ? llmData.next_hint : undefined,
        selectedSkills: persistedSelectedSkills as string[] | undefined,
        skillInsights: persistedSkillInsights
          ? (persistedSkillInsights as Array<{ tool: string; section: string; headline?: string }>)
          : undefined,
      }
    : undefined;
  const toolResultsSummary = state.toolResults.map((item) => ({
    tool: item.tool,
    action: item.action,
    success: item.success,
    error: item.error,
  }));
  const failureReason = success ? undefined : state.toolResults.find((item) => !item.success)?.error;

  try {
    const recorded = await successPathsTool.invoke({
      action: "record",
      input: state.input,
      pathName,
      pathDescription,
      intent: state.intent?.intent,
      contextSnapshot: {
        recentMentionedDevices: state.context.recentMentionedDevices ?? [],
        trace: state.stageTrace,
        skillsHint: persistedSkillsHint,
        selectedSkills: persistedSelectedSkills,
        resolutionSource: state.resolutionSource,
        resolutionLabel,
      },
      llmSummary: llmSummary ? { ...llmSummary, selectedSkillsSource: "recorded" } : undefined,
      toolResultsSummary,
      failureReason,
      actions,
      success,
    });
    const parsed = typeof recorded === "string" ? JSON.parse(recorded) : recorded;
    const recordSucceeded = Boolean(parsed.success);
    if (pendingLlmCaseId) {
      updateLlmCase(pendingLlmCaseId, {
        status: "success",
        finalResponse: state.finalResponse,
        linkedPathId: typeof parsed.id === "string" ? parsed.id : null,
      });
    }
    const writeBackReason = success
      ? "success_path_recorded"
      : isPlanOnly
        ? "plan_only_recorded"
        : executedActions
          ? "failure_path_recorded"
          : "non_executable_path_recorded";
    const reflectionMessage = Boolean(parsed.deduplicated)
      ? "这次结果已合并进最近的同类经验，避免重复写入。"
      : success
        ? "这次执行已记录为可复用经验。"
        : isPlanOnly
          ? "这次 Deep 规划已记录为占位经验，后续可继续补全执行能力。"
          : executedActions
            ? "这次失败也已记录，后续可用于避坑。"
            : "这次未执行动作的结果也已记录，后续可继续补全可执行路径。";
    const createRuleCandidate = shouldCreateRuleCandidate(state, success, recordSucceeded, actions, resolvedIntent);
    const ruleCandidate = createRuleCandidate
      ? {
          type: "rule_candidate",
          success: true,
          candidate: {
            trigger: state.input,
            intent: resolvedIntent,
            actions,
            sourcePathId: parsed.id,
            resolutionSource: state.resolutionSource,
          },
          message: "已生成规则候选，后续可在配置中确认是否提升。",
        }
      : undefined;
    const recordType = success
      ? "success"
      : isPlanOnly
        ? "plan_only"
        : executedActions
          ? "failure"
          : "non_executable";
    const writeBackMeta = {
      pathId: parsed.id,
      pathName,
      pathDescription,
      resolutionSource: state.resolutionSource,
      resolutionLabel,
      recordType,
      deduplicated: Boolean(parsed.deduplicated),
      successState: success,
      executedActions,
      isPlanOnly,
      recordSucceeded,
    };
    const writeBackResults = [
      { type: "success_path", recordType, success: recordSucceeded, pathId: parsed.id, pathName, successState: success, deduplicated: Boolean(parsed.deduplicated) },
      { type: "execution_summary", success, message: state.finalResponse },
      ...(ruleCandidate ? [ruleCandidate] : []),
      { type: "user_visible_reflection", success, message: reflectionMessage },
    ];

    const stageResult = createStageResult({
      ok: recordSucceeded,
      stage: "success_writeback",
      next: "end",
      message: state.finalResponse,
      reason: writeBackReason,
      intent: state.intent,
      actions,
      data: { writeBackMeta, writeBackResults, ruleCandidate, llmSummary, toolResultsSummary, failureReason, pathName, pathDescription, resolutionLabel },
      meta: { source: "success_writeback", skillsHint: persistedSkillsHint },
    });

    return {
      currentStage: "end",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      resolutionSource: state.resolutionSource,
      writeBackResults,
      llmData: state.llmData,
      finalResponse: state.finalResponse,
    };
  } catch (error) {
    const stageResult = createStageResult({
      ok: false,
      stage: "success_writeback",
      next: "end",
      message: state.finalResponse,
      reason: "success_writeback_error",
      data: { error: String(error) },
      meta: { source: "success_writeback" },
    });

    return {
      currentStage: "end",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      resolutionSource: state.resolutionSource,
      writeBackResults: [{ type: "success_writeback_error", success: false, error: String(error) }],
      llmData: state.llmData,
      finalResponse: state.finalResponse,
    };
  }
}

function routeFromIntentRouter(state: typeof AgentState.State) {
  return state.context?.intentType === "chat" ? "end" : "context_completer";
}

function routeFromContextCompleter(state: typeof AgentState.State) {
  return "rule_engine";
}

function routeFromRuleEngine(state: typeof AgentState.State) {
  if (state.ruleMatched) return "tool_executor";
  return "intent_normalizer";
}

function routeFromIntentNormalizer(state: typeof AgentState.State) {
  return state.stageResult?.next ?? "success_experience_retrieval";
}

function routeFromSuccessExperienceRetrieval(state: typeof AgentState.State) {
  if (state.autoExecutePath) return "tool_executor";
  return "experience_retrieval";
}

// routeFromLlmAgent 已内联到 createGraph 中

function normalizedResolutionLabel(source?: string) {
  return source === "rule_engine"
    ? "规则命中"
    : source === "local_intent"
      ? "本地意图"
      : source === "success_paths"
        ? "成功经验复用"
        : source === "success_paths_failure"
          ? "失败经验提示"
          : source === "llm_agent_actionable"
            ? "Deep 可执行规划"
            : source === "llm_agent_plan_only"
              ? "Deep 规划占位"
              : "未分类";
}

function buildPathName(state: typeof AgentState.State) {
  return state.intent?.intent || `${state.resolutionSource || "unknown_source"}_path`;
}

function buildPathDescription(state: typeof AgentState.State, success: boolean, executedActions: boolean, isPlanOnly: boolean) {
  const label = normalizedResolutionLabel(state.resolutionSource);
  if (success) return `${label} / 成功执行：${state.finalResponse}`;
  if (isPlanOnly) return `${label} / 规划占位：${state.finalResponse}`;
  if (!executedActions) return `${label} / 未执行动作：${state.finalResponse}`;
  return `${label} / 失败经验：${state.finalResponse}`;
}

function isLikelyProbeInput(input: string) {
  return /\b(test|probe|debug|metadata|top1|demo)\b/i.test(input)
    || /(测试|联调|调试|验证|探针|示例|样例|元数据)/.test(input);
}

function shouldWriteToSuccessExperience(state: typeof AgentState.State, executedActions: boolean, isPlanOnly: boolean) {
  if (isLikelyProbeInput(state.input || "")) return false;
  if (!executedActions) return false;
  if (isPlanOnly) return false;
  if (state.resolutionSource !== "llm_agent_actionable") return false;
  if (!state.toolResults.every((item) => item.success)) return false;
  return true;
}

function shouldWriteBack(state: typeof AgentState.State, executedActions: boolean, isPlanOnly: boolean) {
  return shouldWriteToSuccessExperience(state, executedActions, isPlanOnly);
}

function shouldCreateRuleCandidate(state: typeof AgentState.State, success: boolean, recordSucceeded: boolean, actions: Array<Record<string, any>>, resolvedIntent: string) {
  if (!success || !recordSucceeded || actions.length === 0) return false;
  if (isLikelyProbeInput(state.input || "")) return false;
  if (!resolvedIntent || resolvedIntent === "unknown_intent" || resolvedIntent === "complex_task") return false;
  if (state.resolutionSource === "llm_agent_actionable") return false;
  return true;
}

export function createGraph() {
  const workflow = new StateGraph(AgentState)
    .addNode("intent_router", intentRouterNode)
    .addNode("rule_engine", ruleEngineNode)
    .addNode("context_completer", contextCompleterNode)
    .addNode("intent_normalizer", intentNormalizerNode)
    .addNode("success_experience_retrieval", successExperienceRetrievalNode)
    .addNode("llm_agent", llmAgentNode)
    .addNode("tool_executor", toolExecutorNode)
    .addNode("experience_writer", experienceWriterNode)
    .addEdge(START, "intent_router")
    .addConditionalEdges("intent_router", routeFromIntentRouter, {
      context_completer: "context_completer",
      end: END,
    })
    .addConditionalEdges("context_completer", routeFromContextCompleter, {
      rule_engine: "rule_engine",
      llm_agent: "llm_agent",
    })
    .addConditionalEdges("rule_engine", routeFromRuleEngine, {
      tool_executor: "tool_executor",
      intent_normalizer: "intent_normalizer",
    })
    .addEdge("intent_normalizer", "success_experience_retrieval")
    .addConditionalEdges("intent_normalizer", routeFromIntentNormalizer, {
      success_experience_retrieval: "success_experience_retrieval",
    })
    .addConditionalEdges("success_experience_retrieval", routeFromSuccessExperienceRetrieval, {
      tool_executor: "tool_executor",
      llm_agent: "llm_agent",
    })
    .addConditionalEdges("llm_agent", (state) => {
      if (state.stageResult?.data?.action) return "tool_executor";
      if (state.isComplete) {
        const reactSteps = state.reactSteps || [];
        const hasSuccessfulAction = reactSteps.some((step) => step.action);
        if (hasSuccessfulAction) return "experience_writer";
        return "end";
      }
      return "end";
    }, {
      tool_executor: "tool_executor",
      experience_writer: "experience_writer",
      end: END,
    })
    .addConditionalEdges("tool_executor", (state) => {
      if (state.isComplete) {
        const reactSteps = state.reactSteps || [];
        const hasSuccessfulAction = reactSteps.some((step) => step.action);
        if (hasSuccessfulAction) return "experience_writer";
        return "end";
      }
      return "llm_agent";
    }, {
      llm_agent: "llm_agent",
      experience_writer: "experience_writer",
      end: END,
    })
    .addEdge("experience_writer", END);

  return workflow.compile();
}

export const graph = createGraph();
