import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import YAML from "yaml";
import { HumanMessage } from "@langchain/core/messages";
import { buildSkillPolicyPreview, graph } from "./graph.js";
import { allTools, executeToolAction } from "./tools/index.js";
import type { RuleAction } from "./state.js";
import { saveMessage, getMessages, getMessageCount } from "./tools/memory/chatDb.js";
import { deleteRule, listRules, setRuleEnabled, upsertRule } from "./tools/rule_engine/database.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, "tools");

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

  fastify.get("/tools", async () => allTools.map((t) => ({ name: t.name, description: t.description })));

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

      return {
        status: "Success",
        data: {
          reply: assistantMsg.content,
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
            stageConfidence: stageResult?.confidence ?? null,
            inputScore: typeof stageResult?.data?.inputScore === "number" ? stageResult.data.inputScore : null,
            intentScore: typeof stageResult?.data?.intentScore === "number" ? stageResult.data.intentScore : null,
            hasExecutablePlan: typeof stageResult?.data?.hasExecutablePlan === "boolean" ? stageResult.data.hasExecutablePlan : null,
            droppedActionCount: typeof stageResult?.data?.droppedActionCount === "number" ? stageResult.data.droppedActionCount : null,
            isFailurePath: typeof stageResult?.data?.isFailurePath === "boolean" ? stageResult.data.isFailurePath : null,
            hasReusableActions: typeof stageResult?.data?.hasReusableActions === "boolean" ? stageResult.data.hasReusableActions : null,
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
    const query = request.query as { limit?: string; offset?: string };
    const limit = parseInt(query.limit || "5", 10);
    const offset = parseInt(query.offset || "0", 10);

    const messages = getMessages(limit, offset);
    const total = getMessageCount();

    return { status: "Success", data: { messages, total, limit, offset } };
  });

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

  fastify.get("/api/tools", async () => {
    const toolDirs = readdirSync(TOOLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(TOOLS_DIR, d.name, "config.yaml")))
      .map((d) => d.name);
    return toolDirs.map((name) => {
      const t = allTools.find((tool) => tool.name === name);
      return {
        name,
        description: t?.description ?? "",
        hasConfig: true,
      };
    });
  });

  fastify.get<{ Params: { name: string } }>("/api/tools/:name/config", async (request, reply) => {
    const { name } = request.params;
    const dir = getToolDir(name);
    if (!dir) return reply.status(404).send({ error: `Tool not found: ${name}` });
    try {
      const content = readFileSync(join(dir, "config.yaml"), "utf-8");
      const parsed = YAML.parse(content);
      return { name, config: parsed, raw: content };
    } catch (error) {
      return reply.status(500).send({ error: `Failed to read config: ${error}` });
    }
  });

  fastify.get<{ Params: { name: string } }>("/api/tools/:name/skills-sections", async (request, reply) => {
    const { name } = request.params;
    const sections = listToolSkillSections(name);
    if (!sections.length) return reply.status(404).send({ error: `No skills sections found for tool: ${name}` });
    return { name, sections };
  });

  fastify.get<{ Params: { name: string; section: string } }>("/api/tools/:name/skills/:section", async (request, reply) => {
    const { name, section } = request.params;
    const skillsPath = getToolSkillsPath(name, section);
    if (!skillsPath) return reply.status(404).send({ error: `Skill section not found: ${name}/${section}` });
    try {
      const content = readFileSync(skillsPath, "utf-8");
      return { name, section, content };
    } catch (error) {
      return reply.status(500).send({ error: `Failed to read skill section: ${error}` });
    }
  });

  fastify.get<{ Params: { name: string } }>("/api/tools/:name/skills", async (request, reply) => {
    const { name } = request.params;
    const skillsPath = getToolSkillsPath(name, "index");
    if (!skillsPath) return reply.status(404).send({ error: `Skills not found for tool: ${name}` });
    try {
      const content = readFileSync(skillsPath, "utf-8");
      return { name, section: "index", content };
    } catch (error) {
      return reply.status(500).send({ error: `Failed to read skills: ${error}` });
    }
  });

  fastify.get<{ Params: { name: string }; Querystring: { input?: string; intent?: string } }>("/api/tools/:name/skills-policy", async (request, reply) => {
    const { name } = request.params;
    const query = request.query as { input?: string; intent?: string };
    const dir = getToolDir(name);
    if (!dir) return reply.status(404).send({ error: `Tool not found: ${name}` });
    const input = query.input || "";
    const preview = buildSkillPolicyPreview(input, query.intent);
    return {
      tool: name,
      input,
      intent: query.intent ?? null,
      stages: preview.stages.filter((item) => item.refs.some((ref) => ref.startsWith(`${name}/`))),
      refs: preview.refs.filter((ref) => ref.startsWith(`${name}/`)),
      globalStages: preview.stages,
      globalRefs: preview.refs,
    };
  });

  fastify.put<{ Params: { name: string }; Body: { config: Record<string, unknown> } }>("/api/tools/:name/config", async (request, reply) => {
    const { name } = request.params;
    const body = request.body as { config?: Record<string, unknown>; raw?: string };
    const dir = getToolDir(name);
    if (!dir) return reply.status(404).send({ error: `Tool not found: ${name}` });
    try {
      const configPath = join(dir, "config.yaml");
      if (body.raw) {
        writeFileSync(configPath, body.raw, "utf-8");
      } else if (body.config) {
        const yamlStr = YAML.stringify(body.config, { lineWidth: 0, indent: 2 });
        writeFileSync(configPath, yamlStr, "utf-8");
      } else {
        return reply.status(400).send({ error: "Missing config or raw field" });
      }
      return { success: true, message: `Config saved for ${name}` };
    } catch (error) {
      return reply.status(500).send({ error: `Failed to write config: ${error}` });
    }
  });

  fastify.get("/api/experience-paths", async () => {
    const tool = allTools.find((t) => t.name === "success_paths");
    if (!tool) return { status: "Error", message: "success_paths tool not found" };

    try {
      const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({ action: "list" });
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return { status: "Success", data: parsed?.paths ?? [] };
    } catch (error) {
      return { status: "Error", message: String(error) };
    }
  });

  fastify.post("/api/experience-paths/repair-skills", async () => {
    const tool = allTools.find((t) => t.name === "success_paths");
    if (!tool) return { status: "Error", message: "success_paths tool not found" };

    try {
      const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({ action: "repair_skills" });
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return { status: "Success", data: parsed };
    } catch (error) {
      return { status: "Error", message: String(error) };
    }
  });

  fastify.post("/api/experience-paths/normalize-data", async () => {
    const tool = allTools.find((t) => t.name === "success_paths");
    if (!tool) return { status: "Error", message: "success_paths tool not found" };

    try {
      const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({ action: "normalize_data" });
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return { status: "Success", data: parsed };
    } catch (error) {
      return { status: "Error", message: String(error) };
    }
  });

  fastify.get("/api/experience-paths/clusters", async () => {
    const tool = allTools.find((t) => t.name === "success_paths");
    if (!tool) return { status: "Error", message: "success_paths tool not found" };

    try {
      const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({ action: "clusters" });
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return { status: "Success", data: parsed?.clusters ?? [] };
    } catch (error) {
      return { status: "Error", message: String(error) };
    }
  });

  fastify.post("/api/experience-paths/merge-cluster", async (request, reply) => {
    const tool = allTools.find((t) => t.name === "success_paths");
    if (!tool) return { status: "Error", message: "success_paths tool not found" };

    const body = request.body as { primaryId?: string; mergeIds?: string[] };
    if (!body?.primaryId || !Array.isArray(body.mergeIds)) {
      return reply.status(400).send({ status: "Error", message: "Missing primaryId or mergeIds" });
    }

    try {
      const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({
        action: "merge_cluster",
        pathId: body.primaryId,
        actions: body.mergeIds.map((id) => ({ id })),
      });
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return { status: parsed?.success ? "Success" : "Error", data: parsed };
    } catch (error) {
      return { status: "Error", message: String(error) };
    }
  });

  fastify.get("/api/experience-paths/merge-strong-clusters/preview", async () => {
    const tool = allTools.find((t) => t.name === "success_paths");
    if (!tool) return { status: "Error", message: "success_paths tool not found" };

    try {
      const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({ action: "preview_merge_strong_clusters" });
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return { status: parsed?.success ? "Success" : "Error", data: parsed };
    } catch (error) {
      return { status: "Error", message: String(error) };
    }
  });

  fastify.get("/api/experience-paths/merge-weak-clusters/preview", async () => {
    const tool = allTools.find((t) => t.name === "success_paths");
    if (!tool) return { status: "Error", message: "success_paths tool not found" };

    try {
      const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({ action: "preview_merge_weak_clusters" });
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return { status: parsed?.success ? "Success" : "Error", data: parsed };
    } catch (error) {
      return { status: "Error", message: String(error) };
    }
  });

  fastify.post("/api/experience-paths/merge-strong-clusters", async () => {
    const tool = allTools.find((t) => t.name === "success_paths");
    if (!tool) return { status: "Error", message: "success_paths tool not found" };

    try {
      const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({ action: "merge_strong_clusters" });
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return { status: parsed?.success ? "Success" : "Error", data: parsed };
    } catch (error) {
      return { status: "Error", message: String(error) };
    }
  });

  fastify.post("/api/experience-paths/merge-weak-clusters", async () => {
    const tool = allTools.find((t) => t.name === "success_paths");
    if (!tool) return { status: "Error", message: "success_paths tool not found" };

    try {
      const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({ action: "merge_weak_clusters" });
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return { status: parsed?.success ? "Success" : "Error", data: parsed };
    } catch (error) {
      return { status: "Error", message: String(error) };
    }
  });

  fastify.get("/api/experience-paths/merge-audit", async (request) => {
    const tool = allTools.find((t) => t.name === "success_paths");
    if (!tool) return { status: "Error", message: "success_paths tool not found" };

    try {
      const query = request.query as { mode?: string };
      const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({ action: "merge_audit", intent: query.mode });
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return { status: parsed?.success ? "Success" : "Error", data: { current: parsed?.current ?? null, history: parsed?.history ?? [] } };
    } catch (error) {
      return { status: "Error", message: String(error) };
    }
  });

  fastify.post("/api/experience-paths/merge-audit/clear", async () => {
    const tool = allTools.find((t) => t.name === "success_paths");
    if (!tool) return { status: "Error", message: "success_paths tool not found" };

    try {
      const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({ action: "clear_merge_audit" });
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return { status: parsed?.success ? "Success" : "Error", data: { current: parsed?.current ?? null, history: parsed?.history ?? [] } };
    } catch (error) {
      return { status: "Error", message: String(error) };
    }
  });

  fastify.get("/api/rule-candidates", async () => {
    const tool = allTools.find((t) => t.name === "success_paths");
    if (!tool) return { status: "Error", message: "success_paths tool not found" };

    try {
      const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({ action: "list" });
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      const paths = parsed?.paths ?? [];
      const candidates = paths
        .filter((item: Record<string, unknown>) => typeof item.intent === "string")
        .map((item: Record<string, unknown>) => {
          const status = item.promotedRule ? "promoted" : "candidate";
          const recommended = !item.promotedRule && item.maturity === 'ready' && typeof item.successRate === 'number' && item.successRate >= 0.6;
          const recommendationReason = recommended
            ? `已复用 ${item.reuseCount} 次，成功率 ${(Number(item.successRate) * 100).toFixed(0)}%`
            : undefined;
          const llmSummaryRecord = typeof item.llmSummary === "object" && item.llmSummary ? item.llmSummary as Record<string, unknown> : {};
          const contextSnapshotRecord = typeof item.contextSnapshot === "object" && item.contextSnapshot ? item.contextSnapshot as Record<string, unknown> : {};
          const backfilledSkills = Array.isArray(llmSummaryRecord.selectedSkills)
            ? llmSummaryRecord.selectedSkills
            : Array.isArray(contextSnapshotRecord.selectedSkills)
              ? contextSnapshotRecord.selectedSkills
              : Array.isArray(contextSnapshotRecord.skillsHint)
                ? contextSnapshotRecord.skillsHint
                : [];
          const selectedSkillsSource = typeof llmSummaryRecord.selectedSkillsSource === "string"
            ? llmSummaryRecord.selectedSkillsSource
            : typeof contextSnapshotRecord.skillsTraceSource === "string"
              ? contextSnapshotRecord.skillsTraceSource
              : undefined;
          return {
            trigger: typeof item.input === "string" && item.input.length > 0 ? item.input : item.name,
            intent: item.intent,
            actions: Array.isArray(item.actions) ? item.actions : [],
            responsePreview: item.responsePreview,
            successRate: item.successRate,
            reuseCount: item.reuseCount,
            maturity: item.maturity,
            recommended,
            recommendationReason,
            sourcePathId: item.id,
            status,
            contextSnapshot: {
              ...(typeof item.contextSnapshot === "object" && item.contextSnapshot ? item.contextSnapshot : {}),
              skillsHint: backfilledSkills,
            },
            llmSummary: {
              ...llmSummaryRecord,
              selectedSkills: backfilledSkills,
              selectedSkillsSource,
            },
          };
        });
      return { status: "Success", data: candidates };
    } catch (error) {
      return { status: "Error", message: String(error) };
    }
  });

  fastify.post("/api/rule-candidates/promote", async (request, reply) => {
    const body = request.body as { trigger?: string; intent?: string; actions?: Array<Record<string, unknown>>; sourcePathId?: string };
    if (!body?.trigger || !body?.intent) {
      return reply.status(400).send({ status: "Error", message: "Missing trigger or intent" });
    }

    const responses: Record<string, string> = {
      open_device: `好的，执行${body.trigger}`,
      navigate_back: "好的，返回上一页",
      go_home: "好的，返回主页",
      play_media: `好的，执行${body.trigger}`,
    };

    const result = upsertRule(body.trigger, responses[body.intent] || `好的，执行${body.trigger}`, body.actions);

    const successPathsToolEntry = allTools.find((t) => t.name === "success_paths");
    if (successPathsToolEntry && body.sourcePathId) {
      await (successPathsToolEntry as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({
        action: "update",
        pathId: body.sourcePathId,
        promotedRule: true,
      });
    }

    return {
      status: "Success",
      data: {
        promoted: true,
        inserted: result.inserted,
        trigger: body.trigger,
        intent: body.intent,
      },
    };
  });

  fastify.get("/api/rules", async () => {
    return { status: "Success", data: listRules().map((item) => ({
      ...item,
      enabled: item.enabled !== 0,
      actions: typeof item.actions === "string" ? JSON.parse(item.actions as string) : item.actions,
    })) };
  });

  fastify.post("/api/rules/disable", async (request, reply) => {
    const body = request.body as { trigger?: string };
    if (!body?.trigger) {
      return reply.status(400).send({ status: "Error", message: "Missing trigger" });
    }
    setRuleEnabled(body.trigger, false);
    return { status: "Success", data: { trigger: body.trigger, enabled: false } };
  });

  fastify.post("/api/rules/enable", async (request, reply) => {
    const body = request.body as { trigger?: string };
    if (!body?.trigger) {
      return reply.status(400).send({ status: "Error", message: "Missing trigger" });
    }
    setRuleEnabled(body.trigger, true);
    return { status: "Success", data: { trigger: body.trigger, enabled: true } };
  });

  fastify.post("/api/rules/rollback", async (request, reply) => {
    const body = request.body as { trigger?: string; sourcePathId?: string };
    if (!body?.trigger) {
      return reply.status(400).send({ status: "Error", message: "Missing trigger" });
    }
    deleteRule(body.trigger);
    const successPathsToolEntry = allTools.find((t) => t.name === "success_paths");
    if (successPathsToolEntry && body.sourcePathId) {
      await (successPathsToolEntry as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({
        action: "update",
        pathId: body.sourcePathId,
        promotedRule: false,
      });
    }
    return { status: "Success", data: { trigger: body.trigger, rolledBack: true } };
  });

  fastify.get("/api/devices", async () => {
    const results: Array<{ tool: string; devices: unknown[]; error?: string }> = [];
    const deviceTools = ["adb"];
    for (const toolName of deviceTools) {
      const tool = allTools.find((t) => t.name === toolName);
      if (!tool) continue;
      try {
        const result = await (tool as { invoke: (i: Record<string, unknown>) => Promise<unknown> }).invoke({
          action: "list_devices",
        });
        const parsed = typeof result === "string" ? JSON.parse(result) : result;
        results.push({ tool: toolName, devices: Array.isArray(parsed) ? parsed : (parsed?.devices ?? []) });
      } catch (error) {
        results.push({ tool: toolName, devices: [], error: String(error) });
      }
    }
    const allDevices = results.flatMap((r) =>
      (r.devices as Record<string, unknown>[]).map((d) => ({
        ...d,
        _source: r.tool,
      })),
    );
    return { devices: allDevices, sources: results };
  });

  try {
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`Server running at http://localhost:${PORT}`);
    console.log("Available tools:", allTools.map((t) => t.name).join(", "));
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
