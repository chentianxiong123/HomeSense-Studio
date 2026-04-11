import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import YAML from "yaml";
import { HumanMessage } from "@langchain/core/messages";
import { buildSkillPolicyPreview, graph } from "./graph.js";
import { buildRuntimeRegistryPreview, summarizeCapabilityCommands } from "./tools/skillsRegistry.js";
import { allTools, executeToolAction } from "./tools/index.js";
import { createWorkflowV0, type RuleAction, type WorkflowV0 } from "./state.js";
import { saveMessage, getMessages, getMessageCount, getMessagesPage, type MessagePageDirection } from "./tools/memory/chatDb.js";
import { listWorkflowCandidates, upsertWorkflowCandidate } from "./tools/memory/workflowCandidateDb.js";
import { deleteRule, listRules, listSynonyms, setRuleEnabled, upsertRule } from "./tools/rule_engine/database.js";
import { buildWorkflowDraftFromCommands, listWorkflowsV0, mergeWorkflowRegistryEntry, previewWorkflowMerge, upsertWorkflowRegistryEntry } from "./workflowRegistry.js";
const PORT = parseInt(process.env.PORT || "3000", 10);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, "tools");
let shouldAbort = false;

function formatThinking(text: string): string {
  const parts = text.split(/(<think>\n[\s\S]*?\n<\/think>)/g);
  return parts.map(part => {
    if (part.startsWith('<think>\n') && part.endsWith('\n<\/think>')) {
      const content = part.slice(8, -10).trim();
      return '<details class="think-block"><summary>思考过程</summary><pre>' + content + '</pre></details>';
    }
    return part;
  }).join('');
}

function getToolDir(name: string): string | null {
  const dir = join(TOOLS_DIR, name);
  if (existsSync(dir) && existsSync(join(dir, "config.yaml"))) return dir;
  return null;
}

function getToolSkillsDir(name: string): string | null {
  const dir = getToolDir(name);
  if (!dir) return null;
  const skillsDir = join(dir, "skills");
  return existsSync(skillsDir) ? skillsDir : null;
}

function getToolSkillsPath(name: string, section = "index"): string | null {
  const skillsDir = getToolSkillsDir(name);
  if (!skillsDir) return null;
  const skillsPath = join(skillsDir, `${section}.md`);
  return existsSync(skillsPath) ? skillsPath : null;
}

function invokeToolByName(name: string, input: Record<string, unknown>) {
  const tool = allTools.find((item) => item.name === name);
  if (!tool) return null;
  return (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke(input);
}

async function invokeJsonToolByName(name: string, input: Record<string, unknown>) {
  const result = await invokeToolByName(name, input);
  if (result == null) return null;
  return typeof result === "string" ? JSON.parse(result) : result;
}

const SUCCESS_PATHS_TOOL_NAME = "success_paths";

function successPathsMissingResponse() {
  return { status: "Error", message: `${SUCCESS_PATHS_TOOL_NAME} tool not found` };
}

async function buildSuccessPathsResponse(
  input: Record<string, unknown>,
  options?: {
    data?: (parsed: any) => unknown;
    status?: (parsed: any) => "Success" | "Error";
  },
) {
  try {
    const parsed = await invokeJsonToolByName(SUCCESS_PATHS_TOOL_NAME, input);
    if (!parsed) return successPathsMissingResponse();
    return {
      status: options?.status ? options.status(parsed) : parsed?.success === false ? "Error" : "Success",
      data: options?.data ? options.data(parsed) : parsed,
    };
  } catch (error) {
    return { status: "Error", message: String(error) };
  }
}

async function updateSuccessPathPromotion(sourcePathId: string | undefined, promotedRule: boolean) {
  if (!sourcePathId) return;
  await invokeJsonToolByName(SUCCESS_PATHS_TOOL_NAME, {
    action: "update",
    pathId: sourcePathId,
    promotedRule,
  });
}

function buildRuleCandidatesFromPaths(paths: Array<Record<string, unknown>>) {
  return paths
    .filter((path) => path.promotedRule !== true)
    .map((path) => {
      const reuseCount = typeof path.reuseCount === "number" ? path.reuseCount : 0;
      const successRate = typeof path.successRate === "number" ? path.successRate : 0;
      const recommended = reuseCount >= 5 && successRate >= 0.6;
      const recommendationReason = recommended
        ? `复用 ${reuseCount} 次，成功率 ${(successRate * 100).toFixed(0)}%`
        : undefined;

      return {
        trigger: typeof path.input === "string" && path.input.trim() ? path.input : typeof path.name === "string" ? path.name : "",
        intent: typeof path.intent === "string" ? path.intent : "unknown",
        actions: Array.isArray(path.actions) ? path.actions : [],
        responsePreview: typeof path.responsePreview === "string" ? path.responsePreview : typeof path.description === "string" ? path.description : undefined,
        successRate,
        reuseCount,
        maturity: typeof path.maturity === "string" ? path.maturity : undefined,
        recommended,
        recommendationReason,
        sourcePathId: typeof path.id === "string" ? path.id : "",
        status: path.promotedRule === true ? "promoted" : "pending",
        contextSnapshot: typeof path.contextSnapshot === "object" && path.contextSnapshot !== null ? path.contextSnapshot : undefined,
        llmSummary: typeof path.llmSummary === "object" && path.llmSummary !== null ? path.llmSummary : undefined,
      };
    })
    .filter((candidate) => candidate.trigger && candidate.sourcePathId);
}

function listToolSkillSections(name: string): string[] {
  const skillsDir = getToolSkillsDir(name);
  if (!skillsDir) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.replace(/\.md$/, ''))
    .sort((a, b) => (a === 'index' ? -1 : b === 'index' ? 1 : a.localeCompare(b)));
}

async function main() {
  const fastify = Fastify({ logger: true });
  await fastify.register(cors, { origin: "*" });

  fastify.get("/health", async () => ({ status: "ok", timestamp: Date.now() }));

  fastify.get("/api/abort", async () => {
    shouldAbort = true;
    return { status: "aborted" };
  });

  fastify.get("/api/chat/stream", async (request, reply) => {
    const query = request.query as { text?: string };
    if (!query?.text) return reply.status(400).send({ error: "Missing text" });
    shouldAbort = false;
    saveMessage("user", query.text);
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });

    const allSteps: Array<{ stage: string; message: string; reason: string; confidence: number; action?: any; observation?: any }> = [];
    let currentThinking = "";
    let latestState: any = null;

    const emitter = {
      emitChunk: (chunk: string) => {
        currentThinking += chunk;
        reply.raw.write("event: chunk\ndata: " + JSON.stringify({ content: chunk }) + "\n\n");
      },
      emitStep: (step: any) => {
        allSteps.push(step);
        reply.raw.write("event: step\ndata: " + JSON.stringify(step) + "\n\n");
      }
    };

    try {
      reply.raw.write("event: start\ndata: {}\n\n");

      const stream = await graph.stream(
        { input: query.text, messages: [new HumanMessage(query.text)] },
        { streamMode: ["values", "updates"] }
      );

      for await (const event of stream) {
        if (shouldAbort) break;

        if (event[0] === "values") {
          const state = event[1];
          latestState = state;
          const stageResult = state.stageResult;

          if (stageResult) {
            const stepData = {
              stage: stageResult.stage || "unknown",
              message: stageResult.message || "",
              reason: stageResult.reason || "",
              confidence: stageResult.confidence ?? 1,
              action: stageResult.data?.action || null,
              observation: stageResult.data?.observation || null,
              executionResults: stageResult.data?.executionResults || [],
            };

            emitter.emitStep(stepData);
          }
        }
      }

      const finalState = allSteps.length > 0 ? allSteps[allSteps.length - 1] : null;

      let replyText = "";
      if (allSteps.length > 1) {
        const thinkContent = allSteps
          .map((s, i) => `${i + 1}. 【${s.stage}】${s.message}`)
          .join("\n");
        replyText = `【思考过程】\n${thinkContent}`;
      } else {
        replyText = finalState?.message || "完成";
      }

      const isClarification = finalState?.reason === "low_confidence_ask" || 
        (finalState?.confidence !== undefined && finalState.confidence < 0.7 && !finalState?.action);

      const finalReply = shouldAbort
        ? (replyText || "本次对话已手动终止")
        : replyText;

      saveMessage("assistant", finalReply, { trace: allSteps }, { is_clarification: isClarification });
      const doneData = {
        reply: finalReply,
        outcomeType: shouldAbort ? "aborted" : (finalState?.reason || "done"),
        trace: allSteps,
        steps: allSteps.length,
        resolutionMeta: {
          completedInput: latestState?.completedInput ?? null,
          currentCompletionDevice: Array.isArray(latestState?.context?.recentMentionedDevices) && latestState.context.recentMentionedDevices.length > 0
            ? latestState.context.recentMentionedDevices[0]?.device ?? null
            : null,
        },
      };
      reply.raw.write("event: done\ndata: " + JSON.stringify(doneData) + "\n\n");
    } catch (error: any) {
      reply.raw.write("event: error\ndata: " + JSON.stringify({ message: error.message }) + "\n\n");
      if (allSteps.length > 0) {
        saveMessage("assistant", `执行出错: ${error.message}`, { trace: allSteps });
      }
    }
    reply.raw.write("event: close\ndata: {}\n\n");
    reply.raw.end();
    return reply;
  });

  const listTools = () => allTools.map((t) => ({ name: t.name, description: t.description }));
  fastify.get("/tools", async () => listTools());
  fastify.get("/api/tools", async () => ({
    status: "Success",
    data: listTools(),
  }));

  fastify.get("/api/registry", async (request) => {
    const query = request.query as { input?: string; intent?: string };
    const preview = buildSkillPolicyPreview(query.input || "", query.intent);
    return {
      status: "Success",
      data: preview,
    };
  });

  fastify.get("/api/workflows", async () => {
    return {
      status: "Success",
      data: {
        workflows: listWorkflowsV0(),
      },
    };
  });

  fastify.get("/api/workflow-candidates", async () => {
    return {
      status: "Success",
      data: {
        workflows: listWorkflowCandidates(),
      },
    };
  });

  function analyzeWorkflowDraftUpgrade(body: { workflowDraft?: Record<string, unknown>; targetWorkflowId?: string | null }) {
    const workflowDraft = body.workflowDraft as {
      workflowId?: string;
      name?: string;
      description?: string;
      goal?: string;
      nodes?: Array<Record<string, unknown>>;
      edges?: Array<Record<string, unknown>>;
    };
    const examples = listWorkflowsV0();
    const target = body.targetWorkflowId
      ? examples.find((item) => item.workflowId === body.targetWorkflowId) ?? null
      : null;

    const draftCapabilities = Array.isArray(workflowDraft.nodes)
      ? workflowDraft.nodes
          .map((item) => (typeof item.capability === "string" ? item.capability : null))
          .filter((item): item is string => Boolean(item))
      : [];
    const matchedExample = target ?? examples.find((item) => {
      const exampleCapabilities = item.nodes
        .map((node) => (typeof node.capability === "string" ? node.capability : null))
        .filter((capability): capability is string => Boolean(capability));
      return exampleCapabilities.some((capability) => draftCapabilities.includes(capability));
    }) ?? null;

    return {
      workflowDraft,
      matchedExample,
      sharedCapabilities: matchedExample
        ? matchedExample.nodes
            .map((node) => (typeof node.capability === "string" ? node.capability : null))
            .filter((capability): capability is string => typeof capability === "string")
            .filter((capability) => draftCapabilities.includes(capability))
        : [],
    };
  }

  fastify.post("/api/workflows/upgrade-draft", async (request, reply) => {
    const body = request.body as { workflowDraft?: Record<string, unknown>; targetWorkflowId?: string | null };
    if (!body?.workflowDraft || typeof body.workflowDraft !== "object") {
      return reply.status(400).send({ status: "Error", message: "Missing workflowDraft" });
    }

    const { workflowDraft, matchedExample, sharedCapabilities } = analyzeWorkflowDraftUpgrade(body);

    return {
      status: "Success",
      data: {
        accepted: true,
        mode: matchedExample ? "merge_candidate" : "new_candidate",
        draft: workflowDraft,
        targetWorkflowId: matchedExample?.workflowId ?? null,
        targetWorkflowName: matchedExample?.name ?? null,
        sharedCapabilities,
        next: matchedExample ? "review_merge" : "save_new_workflow",
        message: matchedExample
          ? `Draft can be upgraded toward ${matchedExample.name}`
          : "Draft can be upgraded into a new workflow",
      },
    };
  });

  fastify.post("/api/workflows/save-draft", async (request, reply) => {
    const body = request.body as { workflowDraft?: Record<string, unknown> };
    if (!body?.workflowDraft || typeof body.workflowDraft !== "object") {
      return reply.status(400).send({ status: "Error", message: "Missing workflowDraft" });
    }

    const draftInput = body.workflowDraft as Record<string, unknown>;
    const workflowDraft = createWorkflowV0({
      workflowId: typeof draftInput.workflowId === "string" ? draftInput.workflowId : `saved_${Date.now()}`,
      name: typeof draftInput.name === "string" ? draftInput.name : "untitled draft",
      description: typeof draftInput.description === "string" ? draftInput.description : undefined,
      goal: typeof draftInput.goal === "string" ? draftInput.goal : undefined,
      inputs: Array.isArray(draftInput.inputs) ? draftInput.inputs as unknown as WorkflowV0["inputs"] : undefined,
      nodes: Array.isArray(draftInput.nodes) ? draftInput.nodes as unknown as WorkflowV0["nodes"] : [],
      edges: Array.isArray(draftInput.edges) ? draftInput.edges as unknown as WorkflowV0["edges"] : [],
      metadata: typeof draftInput.metadata === "object" && draftInput.metadata !== null ? draftInput.metadata as WorkflowV0["metadata"] : undefined,
    });
    const saved = upsertWorkflowCandidate({
      workflow: workflowDraft,
      status: "pending",
      source: "save_draft",
    });
    return {
      status: "Success",
      data: {
        accepted: true,
        saved: true,
        workflowId: saved.workflowId,
        name: saved.name,
        next: "persist_workflow",
        mode: "pending_candidate",
        message: "Draft saved as pending workflow candidate",
      },
    };
  });

  fastify.post("/api/workflows/accept-upgrade", async (request, reply) => {
    const body = request.body as { workflowDraft?: Record<string, unknown>; targetWorkflowId?: string | null };
    if (!body?.workflowDraft || typeof body.workflowDraft !== "object") {
      return reply.status(400).send({ status: "Error", message: "Missing workflowDraft" });
    }

    const { workflowDraft, matchedExample, sharedCapabilities } = analyzeWorkflowDraftUpgrade(body);
    const normalizedWorkflow = createWorkflowV0({
      workflowId: typeof workflowDraft.workflowId === "string" ? workflowDraft.workflowId : `promoted_${Date.now()}`,
      name: typeof workflowDraft.name === "string" ? workflowDraft.name : "promoted draft",
      description: typeof workflowDraft.description === "string" ? workflowDraft.description : undefined,
      goal: typeof workflowDraft.goal === "string" ? workflowDraft.goal : undefined,
      nodes: Array.isArray(workflowDraft.nodes) ? workflowDraft.nodes as unknown as WorkflowV0["nodes"] : [],
      edges: Array.isArray(workflowDraft.edges) ? workflowDraft.edges as unknown as WorkflowV0["edges"] : [],
    });
    const mergePreview = matchedExample?.workflowId ? previewWorkflowMerge(matchedExample.workflowId, normalizedWorkflow) : null;
    const persistedWorkflow = matchedExample?.workflowId
      ? mergeWorkflowRegistryEntry(matchedExample.workflowId, normalizedWorkflow)
      : upsertWorkflowRegistryEntry(normalizedWorkflow);
    const saved = upsertWorkflowCandidate({
      workflow: persistedWorkflow,
      status: "accepted",
      source: matchedExample ? "accept_upgrade_merge" : "accept_upgrade_new",
      targetWorkflowId: matchedExample?.workflowId ?? null,
      targetWorkflowName: matchedExample?.name ?? null,
    });

    return {
      status: "Success",
      data: {
        accepted: true,
        upgraded: true,
        mode: matchedExample ? "merge_into_existing" : "promote_as_new",
        workflowId: saved.workflowId,
        workflowName: persistedWorkflow.name,
        targetWorkflowId: saved.targetWorkflowId,
        targetWorkflowName: saved.targetWorkflowName,
        sharedCapabilities,
        mergedNodeCount: matchedExample
          ? (mergePreview?.mergedNodeCount ?? 0)
          : normalizedWorkflow.nodes.length,
        mergedEdgeCount: matchedExample
          ? (mergePreview?.mergedEdgeCount ?? 0)
          : normalizedWorkflow.edges.length,
        next: matchedExample ? "persist_merge_result" : "persist_new_workflow",
        message: matchedExample
          ? `Draft accepted and merged into ${matchedExample.name}`
          : "Draft accepted as new workflow candidate",
      },
    };
  });

  fastify.post("/api/chat", async (request, reply) => {
    const body = request.body as { text?: string };
    if (!body?.text) return reply.status(400).send({ status: "Error", message: "Missing text parameter" });

    saveMessage("user", body.text);

    try {
      const result = await graph.invoke({
        input: body.text,
        messages: [new HumanMessage(body.text)],
      });

      const replyText = result.finalResponse || result.stageResult?.message || "收到";
      const assistantMsg = saveMessage("assistant", replyText);
      const stageResult = result.stageResult;
      const normalizedReason = stageResult?.reason || "";
      const resolutionSource = result.resolutionSource ?? stageResult?.meta?.source ?? "unknown";
      const writeBackMetaRecordType = typeof (stageResult?.data?.writeBackMeta as { recordType?: string } | undefined)?.recordType === "string"
        ? (stageResult?.data?.writeBackMeta as { recordType: string }).recordType
        : null;
      const writeBackRecordType = normalizedReason === "write_back_skipped" ? "skipped" : writeBackMetaRecordType;
      const matched = Boolean(result.ruleMatched)
        || ["matched_local_intent", "matched_success_path", "matched_failure_path", "llm_agent_structured_plan", "llm_agent_plan_only", "llm_agent_invalid_actions"].includes(normalizedReason)
        || ["rule_engine", "local_intent", "success_paths", "success_paths_failure", "llm_agent_actionable", "llm_agent_plan_only"].includes(resolutionSource)
        || Boolean(writeBackRecordType);
      const confidence = typeof stageResult?.confidence === "number"
        ? stageResult.confidence
        : typeof result.intentConfidence === "number"
          ? result.intentConfidence
          : matched
            ? 1
            : 0;

      const escalationReason = normalizedReason === "local_intent_below_bar"
        ? "local_intent_low_confidence"
        : normalizedReason === "success_path_non_actionable"
          ? "success_path_non_actionable"
          : normalizedReason === "no_success_path_match"
            ? "success_path_miss"
            : normalizedReason === "llm_agent_not_configured"
              ? "deep_not_configured"
              : normalizedReason === "llm_agent_plan_only"
                ? "deep_plan_only"
                : normalizedReason === "llm_agent_invalid_actions"
                  ? "deep_invalid_actions"
                  : null;
      const reasonToOutcomeType: Record<string, string> = {
        matched_rule: "rule_match",
        matched_local_intent: "local_intent_match",
        matched_success_path: "success_path_reuse",
        matched_failure_path: "failure_path_hint",
        llm_agent_structured_plan: "deep_actionable",
        llm_agent_plan_only: "deep_plan_only",
        llm_agent_invalid_actions: "deep_invalid_actions",
        success_path_recorded: "write_back_success",
        plan_only_recorded: "write_back_plan_only",
        failure_path_recorded: "write_back_failure",
        non_executable_path_recorded: "write_back_non_executable",
        tool_execution_partial_failure: "tool_partial_failure",
        tool_execution_completed: "tool_success",
        write_back_error: "write_back_error",
        rule_engine_error: "rule_error",
        local_intent_error: "local_intent_error",
        success_path_error: "success_path_error",
        llm_agent_error: "deep_error",
      };
      const resolutionToOutcomeType: Record<string, string> = {
        rule_engine: "rule_match",
        local_intent: "local_intent_match",
        success_paths: "success_path_reuse",
        success_paths_failure: "failure_path_hint",
        llm_agent_actionable: "deep_actionable",
        llm_agent_plan_only: "deep_plan_only",
      };
      const outcomeType = resolutionToOutcomeType[resolutionSource]
        || reasonToOutcomeType[normalizedReason]
        || (writeBackRecordType === "success"
          ? "write_back_success"
          : matched
            ? "matched_other"
            : "fallback");

      const executionSummary = stageResult?.stage === "tool_executor"
        ? ((stageResult?.data?.executionSourceSummary as Record<string, unknown> | undefined) ?? {
            attemptedCount: Array.isArray(result.toolResults) ? result.toolResults.length : 0,
            successCount: Array.isArray(result.toolResults) ? result.toolResults.filter((item: { success?: boolean }) => item.success).length : 0,
            failedCount: Array.isArray(result.toolResults) ? result.toolResults.filter((item: { success?: boolean }) => item.success === false).length : 0,
          })
        : null;

      const executionSourceSummary = (stageResult?.data?.executionSourceSummary as Record<string, unknown> | undefined) ?? null;
      const writeBackMeta = (stageResult?.data?.writeBackMeta as Record<string, unknown> | undefined) ?? null;
      const toolFailureAttribution = (result.toolFailureAttribution as Record<string, unknown> | undefined)
        ?? ((stageResult?.data?.failureAttribution as Record<string, unknown> | undefined) ?? null);
      const consistency = {
        reason: normalizedReason || null,
        outcomeType,
        resolutionSource,
        writeBackRecordType,
      };
      const terminalSummary = {
        stage: stageResult?.stage ?? "unknown",
        matched,
        confidence,
        outcomeType,
        resolutionSource,
        escalationReason,
        writeBackRecordType,
        executionSourceSummary,
      };
      const runtimeRefs = stageResult?.meta?.skillsHint
        ?? ((result.llmData as { selected_skills?: string[] } | undefined)?.selected_skills ?? []);
      const registryPreview = (result.registryDebug as Record<string, unknown> | undefined)
        ?? buildRuntimeRegistryPreview(TOOLS_DIR, runtimeRefs, body.text, result.intent?.intent);
      const commandSummary = Array.isArray(result.commandSummary) && result.commandSummary.length > 0
        ? result.commandSummary
        : summarizeCapabilityCommands(stageResult?.commands ?? []);
      const workflowDraft = buildWorkflowDraftFromCommands(body.text, stageResult?.commands ?? [], {
        name: stageResult?.stage ? `${stageResult.stage} draft` : undefined,
        description: stageResult?.reason ? `由 ${stageResult.reason} 生成的 workflow 草稿` : undefined,
      });

      return {
        status: "Success",
        data: {
          reply: assistantMsg.content,
          messageId: assistantMsg.id,
          matched,
          confidence,
          outcomeType,
          terminalSummary,
          stage: stageResult?.stage ?? "unknown",
          resolutionSource,
          resolutionMeta: {
            consistency,
            executionSummary,
            executionSourceSummary,
            completedInput: result.completedInput ?? null,
            currentCompletionDevice: Array.isArray((result.context as { recentMentionedDevices?: Array<{ device?: string }> } | undefined)?.recentMentionedDevices)
              ? ((result.context as { recentMentionedDevices: Array<{ device?: string }> }).recentMentionedDevices[0]?.device ?? null)
              : null,
            stageConfidence: stageResult?.confidence ?? null,
            inputScore: typeof stageResult?.data?.inputScore === "number" ? stageResult.data.inputScore : null,
            intentScore: typeof stageResult?.data?.intentScore === "number" ? stageResult.data.intentScore : null,
            hasExecutablePlan: typeof stageResult?.data?.hasExecutablePlan === "boolean" ? stageResult.data.hasExecutablePlan : null,
            droppedActionCount: typeof stageResult?.data?.droppedActionCount === "number" ? stageResult.data.droppedActionCount : null,
            gatedBySkills: typeof stageResult?.data?.gatedBySkills === "boolean" ? stageResult.data.gatedBySkills : null,
            gatedActionCount: typeof stageResult?.data?.gatedActionCount === "number" ? stageResult.data.gatedActionCount : null,
            gatingReason: typeof stageResult?.data?.gatingReason === "string" ? stageResult.data.gatingReason : null,
            blockedActions: Array.isArray(stageResult?.data?.blockedActions) ? stageResult.data.blockedActions : [],
            commandSummary,
            workflowDraft,
            selectedSkillMetadata: Array.isArray(stageResult?.data?.selectedSkillMetadata) ? stageResult.data.selectedSkillMetadata : registryPreview.metadata,
            preconditionsEnforced: typeof stageResult?.data?.preconditionsEnforced === "boolean" ? stageResult.data.preconditionsEnforced : null,
            isFailurePath: typeof stageResult?.data?.isFailurePath === "boolean" ? stageResult.data.isFailurePath : null,
            shouldEscalateToDeep: typeof stageResult?.data?.shouldEscalateToDeep === "boolean" ? stageResult.data.shouldEscalateToDeep : null,
            matchedPathName: typeof (stageResult?.data?.matchedPath as { name?: string } | undefined)?.name === "string" ? (stageResult?.data?.matchedPath as { name?: string }).name ?? null : null,
            matchedPathCandidates: Array.isArray(stageResult?.data?.matchedPathCandidates)
              ? (stageResult?.data?.matchedPathCandidates as Array<Record<string, unknown>>).map((item) => ({
                  id: item.id ?? null,
                  name: item.name ?? null,
                  score: item.score ?? null,
                  successRate: item.successRate ?? null,
                  isFailurePath: item.isFailurePath ?? null,
                }))
              : [],
            usedHistoryHint: typeof (result.llmData as { used_history_hint?: boolean } | undefined)?.used_history_hint === "boolean" ? (result.llmData as { used_history_hint: boolean }).used_history_hint : null,
            deepMatchedPathName: typeof (result.llmData as { matched_path_name?: string | null } | undefined)?.matched_path_name === "string" ? (result.llmData as { matched_path_name: string }).matched_path_name : null,
            deepTopCandidateNames: Array.isArray((result.llmData as { context_summary?: { topCandidateNames?: string[] } } | undefined)?.context_summary?.topCandidateNames)
              ? ((result.llmData as { context_summary: { topCandidateNames: string[] } }).context_summary.topCandidateNames)
              : [],
            deepCandidateCount: typeof (result.llmData as { context_summary?: { matchedPathCandidateCount?: number } } | undefined)?.context_summary?.matchedPathCandidateCount === "number"
              ? (result.llmData as { context_summary: { matchedPathCandidateCount: number } }).context_summary.matchedPathCandidateCount
              : null,
            escalationReason,
            writeBack: writeBackMeta,
            writeBackRecordType,
            toolFailureAttribution,
          },
          registryDebug: registryPreview,
          workflowDraft,
          intent: result.intent,
          trace: result.stageTrace ?? [],
          toolResults: result.toolResults ?? [],
          writeBackResults: result.writeBackResults ?? [],
          llm: result.llmData ?? stageResult?.data?.llm,
          skillsHint: stageResult?.meta?.skillsHint ?? ((stageResult?.data?.llmSummary as { selectedSkills?: string[] } | undefined)?.selectedSkills ?? []),
          reason: stageResult?.reason,
        },
      };
    } catch (error) {
      return reply.status(500).send({
        status: "Error",
        message: `Chat execution failed: ${error}`,
      });
    }
  });

  fastify.get("/api/messages", async (request) => {
    const query = request.query as {
      limit?: string;
      direction?: string;
      cursorId?: string;
    };

    const limit = Math.min(parseInt(query.limit || "20", 10), 100);
    const direction = (query.direction as MessagePageDirection) || "latest";
    const cursorId = query.cursorId ? parseInt(query.cursorId, 10) : undefined;

    const page = getMessagesPage(limit, direction, cursorId);

    return {
      status: "Success",
      data: {
        messages: page.messages,
        pageInfo: page.pageInfo,
        limit,
        direction,
        cursorId: cursorId ?? null,
      },
    };
  });

  // fastify.get("/api/messages", async (request) => {
  //   const query = request.query as { limit?: string; offset?: string };
  //   const limit = parseInt(query.limit || "5", 10);
  //   const offset = parseInt(query.offset || "0", 10);

  //   const messages = getMessages(limit, offset);
  //   const total = getMessageCount();

  //   return { status: "Success", data: { messages, total, limit, offset } };
  // });

  fastify.post("/api/execute", async (request, reply) => {
    const body = request.body as { actions?: RuleAction[] };
    if (!body?.actions || !Array.isArray(body.actions)) {
      return reply.status(400).send({ error: "Missing actions parameter" });
    }
    const results = await Promise.all(body.actions.map(executeToolAction));
    return { results };
  });

  fastify.post("/api/tool/:name", async (request, reply) => {
    const params = request.params as { name: string };
    const body = request.body as Record<string, unknown>;
    const tool = allTools.find((t) => t.name === params.name);
    if (!tool) return reply.status(404).send({ error: `Tool not found: ${params.name}` });
    try {
      const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke(body);
      return { success: true, result: typeof result === "string" ? JSON.parse(result) : result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  fastify.get("/api/tools/:name/config", async (request, reply) => {
    const { name } = request.params as { name: string };
    const toolDir = getToolDir(name);
    if (!toolDir) return reply.status(404).send({ error: `Tool not found: ${name}` });
    const configPath = join(toolDir, "config.yaml");
    const content = readFileSync(configPath, "utf-8");
    const parsed = YAML.parse(content);
    return { name, config: parsed, raw: content };
  });

  fastify.get("/api/tools/:name/skills", async (request, reply) => {
    const { name } = request.params as { name: string };
    const skillsDir = getToolSkillsDir(name);
    if (!skillsDir) return reply.status(404).send({ error: `Skills not found for tool: ${name}` });
    const sections = listToolSkillSections(name);
    return { name, sections };
  });

  fastify.get("/api/tools/:name/skills-sections", async (request, reply) => {
    const { name } = request.params as { name: string };
    const skillsDir = getToolSkillsDir(name);
    if (!skillsDir) return reply.status(404).send({ status: "Error", message: `Skills not found for tool: ${name}` });
    return { status: "Success", data: listToolSkillSections(name) };
  });

  fastify.get("/api/tools/:name/skills-policy", async (request) => {
    const { name } = request.params as { name: string };
    const query = request.query as { input?: string; intent?: string };
    const input = query.input || "";
    const preview = buildSkillPolicyPreview(input, query.intent);
    return {
      status: "Success",
      data: {
        tool: name,
        input,
        intent: query.intent || null,
        stages: preview.stages,
        refs: preview.refs,
        globalStages: preview.stages,
        globalRefs: preview.refs,
      },
    };
  });

  fastify.get("/api/tools/:name/skills/:section", async (request, reply) => {
    const { name, section } = request.params as { name: string; section: string };
    const skillsPath = getToolSkillsPath(name, section);
    if (!skillsPath) return reply.status(404).send({ error: `Skill section not found: ${name}/${section}` });
    const content = readFileSync(skillsPath, "utf-8");
    return { name, section, content };
  });

  fastify.get("/api/tools/:name/skill", async (request, reply) => {
    const { name } = request.params as { name: string };
    const skillsPath = getToolSkillsPath(name, "index");
    if (!skillsPath) return reply.status(404).send({ error: `Skill not found for tool: ${name}` });
    const content = readFileSync(skillsPath, "utf-8");
    return { name, section: "index", content };
  });

  fastify.get("/api/skill-policy-preview", async (request) => {
    const query = request.query as { input?: string; intent?: string };
    const input = query.input || "";
    const preview = buildSkillPolicyPreview(input, query.intent);
    return {
      status: "Success",
      data: preview,
    };
  });

  fastify.put("/api/tools/:name/config", async (request, reply) => {
    const { name } = request.params as { name: string };
    const body = request.body as { config?: Record<string, unknown>; raw?: string };
    const toolDir = getToolDir(name);
    if (!toolDir) return reply.status(404).send({ error: `Tool not found: ${name}` });
    const configPath = join(toolDir, "config.yaml");
    if (typeof body?.raw === "string") {
      writeFileSync(configPath, body.raw, "utf-8");
    } else if (body?.config && typeof body.config === "object") {
      writeFileSync(configPath, YAML.stringify(body.config), "utf-8");
    } else {
      return reply.status(400).send({ error: "Missing config or raw" });
    }
    return { success: true, message: `Config saved for ${name}` };
  });

  function registerSuccessPathsGet(
    path: string,
    input: Record<string, unknown> | ((request: { query: unknown }) => Record<string, unknown>),
    options?: Parameters<typeof buildSuccessPathsResponse>[1],
  ) {
    fastify.get(path, async (request) => {
      const resolvedInput = typeof input === "function"
        ? input(request as { query: unknown })
        : input;
      return buildSuccessPathsResponse(resolvedInput, options);
    });
  }

  function registerSuccessPathsPost(
    path: string,
    input: Record<string, unknown> | ((request: { body: unknown }) => Record<string, unknown>),
    options?: Parameters<typeof buildSuccessPathsResponse>[1],
  ) {
    fastify.post(path, async (request) => {
      const resolvedInput = typeof input === "function"
        ? input(request as { body: unknown })
        : input;
      return buildSuccessPathsResponse(resolvedInput, options);
    });
  }

  function registerRuleToggleRoute(path: string, enabled: boolean) {
    fastify.post(path, async (request, reply) => {
      const body = request.body as { trigger?: string };
      if (!body?.trigger) {
        return reply.status(400).send({ status: "Error", message: "Missing trigger" });
      }
      setRuleEnabled(body.trigger, enabled);
      return { status: "Success", message: `Rule ${body.trigger} ${enabled ? "enabled" : "disabled"}` };
    });
  }

  fastify.get("/api/rules", async () => {
    const rules = listRules();
    return { status: "Success", data: rules };
  });

  fastify.get("/api/rules/synonyms", async () => {
    const synonyms = listSynonyms();
    return { status: "Success", data: synonyms };
  });

  registerSuccessPathsGet("/api/success-paths", { action: "list" }, { data: parsed => parsed?.paths ?? [] });

  registerSuccessPathsGet("/api/experience-paths", { action: "list" }, { data: parsed => parsed?.paths ?? [] });

  registerSuccessPathsPost("/api/success-paths/repair-skills", { action: "repair_skills" });

  registerSuccessPathsPost("/api/experience-paths/repair-skills", { action: "repair_skills" });

  registerSuccessPathsPost("/api/success-paths/normalize-data", { action: "normalize_data" });

  registerSuccessPathsPost("/api/experience-paths/normalize-data", { action: "normalize_data" });

  fastify.get("/api/rule-candidates", async () => {
    return buildSuccessPathsResponse(
      { action: "list" },
      { data: parsed => buildRuleCandidatesFromPaths(parsed?.paths ?? []) },
    );
  });

  fastify.post("/api/rule-candidates/promote", async (request, reply) => {
    const body = request.body as { trigger?: string; intent?: string; actions?: Array<Record<string, unknown>>; sourcePathId?: string };
    if (!body?.trigger || !body?.intent || !Array.isArray(body.actions)) {
      return reply.status(400).send({ status: "Error", message: "Missing trigger, intent, or actions" });
    }

    upsertRule(body.trigger, body.intent, body.actions as unknown as RuleAction[]);
    await updateSuccessPathPromotion(body.sourcePathId, true);

    return { status: "Success", message: `Rule promoted for ${body.trigger}` };
  });

  registerSuccessPathsGet("/api/success-paths/clusters", { action: "clusters" });

  registerSuccessPathsGet("/api/experience-paths/clusters", { action: "clusters" });

  registerSuccessPathsGet("/api/success-paths/merge-strong-clusters/preview", { action: "preview_merge_strong_clusters" });

  registerSuccessPathsGet("/api/experience-paths/merge-strong-clusters/preview", { action: "preview_merge_strong_clusters" });

  registerSuccessPathsGet("/api/success-paths/merge-weak-clusters/preview", { action: "preview_merge_weak_clusters" });

  registerSuccessPathsGet("/api/experience-paths/merge-weak-clusters/preview", { action: "preview_merge_weak_clusters" });

  registerSuccessPathsPost("/api/success-paths/merge-cluster", (request) => {
    const body = request.body as { primaryId?: string; mergeIds?: string[] };
    return { action: "merge_cluster", pathId: body.primaryId, actions: body.mergeIds };
  });

  registerSuccessPathsPost("/api/experience-paths/merge-cluster", (request) => {
    const body = request.body as { primaryId?: string; mergeIds?: string[] };
    return { action: "merge_cluster", pathId: body.primaryId, actions: body.mergeIds };
  });

  registerSuccessPathsPost("/api/success-paths/merge-strong-clusters", { action: "merge_strong_clusters" });

  registerSuccessPathsPost("/api/experience-paths/merge-strong-clusters", { action: "merge_strong_clusters" });

  registerSuccessPathsPost("/api/success-paths/merge-weak-clusters", { action: "merge_weak_clusters" });

  registerSuccessPathsPost("/api/experience-paths/merge-weak-clusters", { action: "merge_weak_clusters" });

  registerSuccessPathsGet(
    "/api/success-paths/merge-audit",
    (request) => {
      const query = request.query as { mode?: string };
      return { action: "merge_audit", intent: query.mode };
    },
    { data: parsed => ({ current: parsed?.current ?? null, history: parsed?.history ?? [] }) },
  );

  registerSuccessPathsGet(
    "/api/experience-paths/merge-audit",
    (request) => {
      const query = request.query as { mode?: string };
      return { action: "merge_audit", intent: query.mode };
    },
    { data: parsed => ({ current: parsed?.current ?? null, history: parsed?.history ?? [] }) },
  );

  registerSuccessPathsPost("/api/success-paths/merge-audit/clear", (request) => {
    const body = request.body as { trigger?: string };
    return { action: "clear_merge_audit", trigger: body.trigger };
  });

  registerSuccessPathsPost("/api/experience-paths/merge-audit/clear", (request) => {
    const body = request.body as { trigger?: string };
    return { action: "clear_merge_audit", trigger: body.trigger };
  });

  registerSuccessPathsGet("/api/success-paths/preview-merge-strong", { action: "preview_merge_strong_clusters" });

  registerSuccessPathsGet("/api/success-paths/preview-merge-weak", { action: "preview_merge_weak_clusters" });

  registerSuccessPathsPost("/api/success-paths/merge-strong", { action: "merge_strong_clusters" });

  registerSuccessPathsPost("/api/success-paths/merge-weak", { action: "merge_weak_clusters" });

  fastify.get("/api/devices", async () => {
    return {
      status: "Success",
      data: [
        { id: "toshiba_tv", name: "东芝电视", type: "tv", online: true },
        { id: "tv_letv", name: "乐视电视", type: "tv", online: true },
        { id: "stb", name: "机顶盒", type: "stb", online: true },
        { id: "xiaoai_speaker", name: "小爱音箱", type: "speaker", online: true },
      ],
    };
  });

  fastify.post("/api/rules", async (request, reply) => {
    const body = request.body as { trigger?: string; intent?: string; actions?: Array<Record<string, unknown>>; sourcePathId?: string };
    if (!body?.trigger || !body?.intent || !Array.isArray(body.actions)) {
      return reply.status(400).send({ status: "Error", message: "Missing trigger, intent, or actions" });
    }
    upsertRule(
      body.trigger,
      body.intent,
      body.actions as unknown as RuleAction[],
    );
    return { status: "Success", message: `Rule upserted for ${body.trigger}` };
  });

  registerRuleToggleRoute("/api/rules/disable", false);

  registerRuleToggleRoute("/api/rules/enable", true);

  fastify.post("/api/rules/rollback", async (request, reply) => {
    const body = request.body as { trigger?: string; sourcePathId?: string };
    if (!body?.trigger) {
      return reply.status(400).send({ status: "Error", message: "Missing trigger" });
    }

    deleteRule(body.trigger);
    await updateSuccessPathPromotion(body.sourcePathId, false);

    return { status: "Success", message: `Rule ${body.trigger} rolled back` };
  });

  fastify.put("/api/rules/:trigger/enabled", async (request, reply) => {
    const { trigger } = request.params as { trigger: string };
    const body = request.body as { enabled?: boolean };
    if (typeof body?.enabled !== "boolean") {
      return reply.status(400).send({ status: "Error", message: "Missing enabled boolean" });
    }
    setRuleEnabled(trigger, body.enabled);
    return { status: "Success", message: `Rule ${trigger} updated` };
  });

  fastify.delete("/api/rules/:trigger", async (request) => {
    const { trigger } = request.params as { trigger: string };
    deleteRule(trigger);
    return { status: "Success", message: `Rule ${trigger} deleted` };
  });

  fastify.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
    if (err) {
      fastify.log.error(err);
      process.exit(1);
    }
    console.log(`Server running at ${address}`);
    console.log(`Available tools: ${allTools.map((t) => t.name).join(", ")}`);
  });
}

main();
