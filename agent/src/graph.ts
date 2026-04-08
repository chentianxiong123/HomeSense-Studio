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
} from "./state.js";
import { executeToolAction, isValidToolAction, llmAgentTool, localIntentTool, ruleEngineTool, successPathsTool, toolActionToCapabilityCommand, intentClassifierTool } from "./tools/index.js";
import { getRecentUserMessages } from "./tools/memory/chatDb.js";
import { createPendingLlmCase, updateLlmCase } from "./tools/memory/llmCaseDb.js";

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

  if (Array.isArray(state.stageTrace) && state.stageTrace.some((item) => item.stage === "rule_engine")) {
    addPolicySection(policy, "rule_engine", "index");
    addPolicySection(policy, "rule_engine", "matching");
  }

  if (Array.isArray(state.stageTrace) && state.stageTrace.some((item) => item.stage === "success_paths")) {
    addPolicySection(policy, "success_paths", "index");
    addPolicySection(policy, "success_paths", "retrieval");
  }

  const historicalSkillRefs = Array.isArray(state.context?.historicalSkillRefs)
    ? state.context.historicalSkillRefs as string[]
    : [];
  for (const ref of historicalSkillRefs) {
    const [tool, section] = String(ref).split("/");
    if (!tool || !section) continue;
    addPolicySection(policy, tool, section);
  }

  const input = state.input || "";
  const requestedAdbCapabilities: string[] = [];
  if (/(点击|坐标|页面|按钮|文本)/.test(input)) requestedAdbCapabilities.push("device.tv.ui.find_text", "device.tv.ui.click_element");
  if (/(截图|图标|识图|ocr|视觉|界面|UI|ui)/.test(input)) requestedAdbCapabilities.push("device.tv.ui.inspect.tree", "device.tv.ui.inspect.screenshot");
  if ((state.intent?.intent ?? "") === "navigate_back") requestedAdbCapabilities.push("device.tv.navigate.back");
  if ((state.intent?.intent ?? "") === "go_home") requestedAdbCapabilities.push("device.tv.navigate.home");
  if (requestedAdbCapabilities.length > 0) {
    addPolicySection(policy, "adb", "index");
    for (const section of selectSkillSectionsByCapability(TOOLS_DIR, "adb", requestedAdbCapabilities, true)) {
      addPolicySection(policy, "adb", section);
    }
  }

  const requestedHamiCapabilities: string[] = [];
  if ((state.intent?.intent ?? "") === "open_device" || /(打开|开启|播放|小爱|音箱)/.test(input)) requestedHamiCapabilities.push("home.voice.execute", "home.voice.speak");
  if (/(遥控|音量|静音|确认|方向键)/.test(input)) requestedHamiCapabilities.push("device.tv.remote.send");
  if (requestedHamiCapabilities.length > 0) {
    addPolicySection(policy, "hami", "index");
    for (const section of selectSkillSectionsByCapability(TOOLS_DIR, "hami", requestedHamiCapabilities, true)) {
      addPolicySection(policy, "hami", section);
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
    { device: "stb", keywords: ["机顶盒", "盒子"] },
    { device: "xiaoai_speaker", keywords: ["小爱", "音箱", "音响"] },
  ];

  const scores = new Map<string, number>();
  const allTexts = [...recentMessages.map((item) => item.content), input];

  for (const text of allTexts) {
    for (const pattern of devicePatterns) {
      const matches = pattern.keywords.filter((keyword) => text.includes(keyword)).length;
      if (matches > 0) {
        scores.set(pattern.device, (scores.get(pattern.device) ?? 0) + matches);
      }
    }
  }

  return Array.from(scores.entries())
    .map(([device, score]) => ({ device, score }))
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

async function contextBuilderNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  const recentMentionedDevices = extractDeviceWeights(state.input);
  const stageResult = createStageResult({
    ok: true,
    stage: "context_builder",
    next: "intent_router",
    message: "上下文已准备",
    reason: "context_ready",
    data: { recentMentionedDevices },
    meta: { source: "context_builder" },
  });

  return {
    currentStage: "intent_router",
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

    if (intentType === "chat" && confidence >= 0.55) {
      const reply = "嗯，说说看？";
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
      next: "intent_normalizer",
      message: "意图路由判定为任务请求，进入意图标准化",
      reason: "command_intent_routed",
      confidence,
      data: { intentType, method: parsed.method },
      meta: { source: "intent_router" },
    });

    return {
      currentStage: "intent_normalizer",
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
      next: "intent_normalizer",
      message: "意图路由失败，默认按任务请求进入意图标准化",
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
      const chatReply = "嗯，说说看？";
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

    const ruleCandidate = matched && actions.length > 0
      ? {
          trigger: parsed.matchedTrigger ?? state.input,
          intent: parsed.intent || "matched_rule",
          actions,
          confidence: 1,
          source: "rule_engine",
        }
      : null;

    const stageResult = createStageResult({
      ok: matched,
      stage: "rule_engine",
      next: "intent_normalizer",
      message: matched ? "规则命中，提供候选方案" : "规则未命中，进入意图标准化",
      reason: matched ? "rule_candidate_provided" : "no_rule_match",
      confidence: matched ? 1 : 0,
      intent: matched ? createIntent(state.input, parsed.intent || "matched_rule") : state.intent,
      data: {
        matched,
        ruleCandidate,
        matchedTrigger: parsed.matchedTrigger ?? null,
      },
      meta: { source: "rule_engine" },
    });

    return {
      currentStage: "intent_normalizer",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      ruleMatched: matched,
      context: {
        ...state.context,
        ruleCandidate,
      },
    };
  } catch (error) {
    const stageResult = createStageResult({
      ok: false,
      stage: "rule_engine",
      next: "intent_normalizer",
      message: "规则引擎异常",
      reason: "error",
      confidence: 0,
      data: { error: String(error) },
      meta: { source: "rule_engine" },
    });

    return {
      currentStage: "intent_normalizer",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      error: String(error),
    };
  }
}

async function intentNormalizerNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  try {
    const result = await localIntentTool.invoke({
      text: state.input,
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
      next: "llm_agent",
      message: matched
        ? `找到成功经验：${best.name}`
        : "未找到成功经验，进入 LLM 主决策",
      reason: matched ? "success_experience_found" : "no_success_experience",
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
      currentStage: "llm_agent",
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
      next: "llm_agent",
      message: "成功经验检索异常，进入 LLM 主决策",
      reason: "success_experience_retrieval_error",
      data: { error: String(error) },
      meta: { source: "success_experience_retrieval" },
    });

    return {
      currentStage: "llm_agent",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
    };
  }
}

async function llmAgentNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  try {
    const selectedSkills = collectSelectedSkills(state);
    const skillRefs = extractSkillRefs(selectedSkills);
    const matchedPath = state.stageResult?.data?.matchedPath ?? null;
    const matchedPathCandidates = state.stageResult?.data?.matchedPathCandidates ?? [];
    const shouldEscalateToDeep = state.stageResult?.data?.shouldEscalateToDeep ?? false;
    const result = await llmAgentTool.invoke({
      text: state.input,
      context: JSON.stringify({
        intent: state.intent,
        recentMentionedDevices: state.context.recentMentionedDevices ?? [],
        trace: state.stageTrace,
        selectedSkills: extractSkillPayload(selectedSkills),
        selectedSkillRefs: skillRefs,
        matchedPath,
        matchedPathCandidates,
        shouldEscalateToDeep,
      }),
    });
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    const rawSuggestedActions = Array.isArray(parsed.suggested_actions) ? parsed.suggested_actions : [];
    const validSuggestedActions = rawSuggestedActions.filter(isValidToolAction);
    const enforcement = enforceToolActionsByPolicy(TOOLS_DIR, validSuggestedActions, skillRefs);
    const suggestedActions = enforcement.allowed as typeof validSuggestedActions;
    const droppedActionCount = rawSuggestedActions.length - suggestedActions.length;
    const reply = parsed.answer || "已进入 Deep Layer。";
    const hasExecutablePlan = suggestedActions.length > 0;
    const llmReason = droppedActionCount > 0 && !hasExecutablePlan
      ? "llm_agent_invalid_actions"
      : parsed.success
        ? (hasExecutablePlan ? "llm_agent_structured_plan" : "llm_agent_plan_only")
        : "llm_agent_not_configured";

    const stageResult = createStageResult({
      ok: Boolean(parsed.success) || hasExecutablePlan,
      stage: "llm_agent",
      next: hasExecutablePlan ? "tool_executor" : "end",
      message: reply,
      reason: llmReason,
      intent: state.intent ?? createIntent(state.input, parsed.intent_hint || "complex_task"),
      commands: actionsToCommands(suggestedActions, "llm_agent"),
      actions: suggestedActions,
      data: {
        llm: parsed,
        selectedSkills: skillRefs,
        selectedSkillMetadata: buildRuntimeRegistryPreview(TOOLS_DIR, skillRefs, state.input, state.intent?.intent).metadata,
        commandSummary: summarizeCapabilityCommands(actionsToCommands(suggestedActions, "llm_agent")),
        hasExecutablePlan,
        droppedActionCount,
        gatedBySkills: enforcement.gatedBySkills,
        gatedActionCount: enforcement.gatedActionCount,
        gatingReason: enforcement.gatingReason,
        blockedActions: enforcement.blocked,
        preconditionsEnforced: true,
      },
      meta: { source: "llm_agent", skillsHint: skillRefs },
    });

    return {
      currentStage: stageResult.next,
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      resolutionSource: hasExecutablePlan ? "llm_agent_actionable" : "llm_agent_plan_only",
      ruleActions: stageResult.actions ?? [],
      llmData: {
        ...parsed,
        selected_skills: skillRefs,
        filtered_suggested_actions: suggestedActions,
        dropped_action_count: droppedActionCount,
        matched_path_name: (matchedPath as { name?: string } | null)?.name ?? null,
        used_history_hint: Boolean(shouldEscalateToDeep && (matchedPath as { name?: string } | null)?.name),
      },
      registryDebug: buildRuntimeRegistryPreview(TOOLS_DIR, skillRefs, state.input, state.intent?.intent),
      commandSummary: summarizeCapabilityCommands(stageResult.commands ?? []),
      needsToolExecution: stageResult.next === "tool_executor",
      finalResponse: stageResult.next === "end" ? reply : state.finalResponse,
    };
  } catch (error) {
    const reply = "已进入 Deep Layer，但当前 LLM Agent 调用失败。";
    const stageResult = createStageResult({
      ok: false,
      stage: "llm_agent",
      next: "end",
      message: reply,
      reason: "llm_agent_error",
      data: { error: String(error) },
      meta: { source: "llm_agent" },
    });

    return {
      currentStage: "end",
      stageResult,
      stageTrace: [toTraceEntry(stageResult)],
      finalResponse: reply,
    };
  }
}

async function toolExecutorNode(state: typeof AgentState.State): Promise<Partial<typeof AgentState.State>> {
  const actions = state.stageResult?.actions ?? state.ruleActions;
  const toolResults = [];

  for (const action of actions) {
    const result = await executeToolAction(action);
    toolResults.push(result);
  }

  const successCount = toolResults.filter((item) => item.success).length;
  const hasActions = actions.length > 0;
  const baseMessage = state.stageResult?.message || state.finalResponse;
  const failedResults = toolResults.filter((item) => !item.success);
  const primaryFailure = failedResults[0];
  const failureAttribution = !hasActions
    ? null
    : failedResults.length === 0
      ? null
      : {
          tool: primaryFailure?.tool ?? null,
          action: primaryFailure?.action ?? null,
          error: primaryFailure?.error ?? null,
          failedCount: failedResults.length,
        };
  const message =
    toolResults.length === 0
      ? baseMessage || "未执行任何工具操作"
      : successCount === toolResults.length
        ? baseMessage || `成功执行 ${toolResults.length} 个操作`
        : `${baseMessage || "执行完成"}（${successCount}/${toolResults.length} 成功）`;

  const executionSourceSummary = {
    resolutionSource: state.resolutionSource ?? "unknown",
    actionCount: actions.length,
    attemptedCount: toolResults.length,
    successCount,
    failedCount: failedResults.length,
    gatedBySkills: Boolean(state.stageResult?.data?.gatedBySkills),
    gatedActionCount: typeof state.stageResult?.data?.gatedActionCount === "number" ? state.stageResult.data.gatedActionCount : 0,
    gatingReason: typeof state.stageResult?.data?.gatingReason === "string" ? state.stageResult.data.gatingReason : null,
    blockedActions: Array.isArray(state.stageResult?.data?.blockedActions) ? state.stageResult.data.blockedActions : [],
  };
  const stageResult = createStageResult({
    ok: !hasActions || successCount === toolResults.length,
    stage: "tool_executor",
    next: hasActions ? "write_back" : "end",
    message,
    reason: !hasActions
      ? "no_actions"
      : successCount === toolResults.length
        ? "tool_execution_completed"
        : "tool_execution_partial_failure",
    intent: state.intent,
    actions,
    data: { toolResults, failureAttribution, executionSourceSummary },
    meta: { source: "tool_executor" },
  });

  const toolFailureAttribution = failureAttribution
    ? {
        tool: failureAttribution.tool,
        action: failureAttribution.action,
        error: failureAttribution.error,
        failedCount: failureAttribution.failedCount,
      }
    : null;

  return {
    currentStage: stageResult.next,
    stageResult,
    stageTrace: [toTraceEntry(stageResult)],
    resolutionSource: state.resolutionSource,
    toolResults,
    llmData: state.llmData,
    registryDebug: state.registryDebug,
    commandSummary: Array.isArray(state.commandSummary) && state.commandSummary.length > 0
      ? state.commandSummary
      : summarizeCapabilityCommands(state.stageResult?.commands ?? []),
    toolFailureAttribution: toolFailureAttribution ?? undefined,
    needsToolExecution: false,
    finalResponse: message,
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
  return state.stageResult?.next ?? "intent_normalizer";
}

function routeFromRuleEngine(state: typeof AgentState.State) {
  return state.stageResult?.next ?? "intent_normalizer";
}

function routeFromIntentNormalizer(state: typeof AgentState.State) {
  return state.stageResult?.next ?? "success_experience_retrieval";
}

function routeFromSuccessExperienceRetrieval(state: typeof AgentState.State) {
  return state.stageResult?.next ?? "llm_agent";
}

function routeFromLlmAgent(state: typeof AgentState.State) {
  return state.stageResult?.next ?? "end";
}

function routeFromToolExecutor(state: typeof AgentState.State) {
  return state.stageResult?.next ?? "end";
}

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
    .addNode("context_builder", contextBuilderNode)
    .addNode("intent_router", intentRouterNode)
    .addNode("intent_normalizer", intentNormalizerNode)
    .addNode("success_experience_retrieval", successExperienceRetrievalNode)
    .addNode("llm_agent", llmAgentNode)
    .addNode("tool_executor", toolExecutorNode)
    .addNode("success_writeback", successWritebackNode)
    .addEdge(START, "context_builder")
    .addEdge("context_builder", "intent_router")
    .addConditionalEdges("intent_router", routeFromIntentRouter, {
      intent_normalizer: "intent_normalizer",
      end: END,
    })
    .addConditionalEdges("intent_normalizer", routeFromIntentNormalizer, {
      success_experience_retrieval: "success_experience_retrieval",
    })
    .addConditionalEdges("success_experience_retrieval", routeFromSuccessExperienceRetrieval, {
      llm_agent: "llm_agent",
    })
    .addConditionalEdges("llm_agent", routeFromLlmAgent, {
      tool_executor: "tool_executor",
      end: END,
    })
    .addConditionalEdges("tool_executor", routeFromToolExecutor, {
      success_writeback: "success_writeback",
      end: END,
    })
    .addEdge("success_writeback", END);

  return workflow.compile();
}

export const graph = createGraph();
