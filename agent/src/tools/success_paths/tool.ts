import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

type SkillsSource = "recorded" | "repaired";

interface SuccessPath {
  id: string;
  name: string;
  description: string;
  input: string;
  intent?: string;
  promotedRule?: boolean;
  contextSnapshot?: Record<string, unknown>;
  llmSummary?: {
    intentHint?: string;
    plan?: string[];
    nextHint?: string;
    selectedSkills?: string[];
    selectedSkillsSource?: SkillsSource;
    skillInsights?: Array<{
      tool: string;
      section: string;
      headline?: string;
    }>;
  };
  toolResultsSummary?: Array<{
    tool: string;
    action: string;
    success: boolean;
    error?: string;
  }>;
  failureReason?: string;
  actions: Array<{
    tool: string;
    action: string;
    params?: Record<string, unknown>;
  }>;
  successCount: number;
  failCount: number;
  lastUsed: number;
}

interface SuccessPathsConfig {
  dbPath: string;
  minSuccessRate: number;
  useVectorService?: boolean;
  vectorServiceUrl?: string;
}

interface MergeAuditRecord {
  mode: "single" | "strong_batch" | "weak_batch";
  mergedCount: number;
  primaryId?: string;
  mergedIds?: string[];
  preview?: unknown;
  updatedAt: number;
}

interface GovernanceMeta {
  lastMergeAudit?: MergeAuditRecord;
  mergeAuditHistory?: MergeAuditRecord[];
}

function recordMergeAudit(meta: GovernanceMeta, audit: MergeAuditRecord): GovernanceMeta {
  return {
    ...meta,
    lastMergeAudit: audit,
    mergeAuditHistory: [audit, ...(meta.mergeAuditHistory || [])].slice(0, 10),
  };
}

function governanceAuditPayload(meta: GovernanceMeta) {
  return {
    current: meta.lastMergeAudit || null,
    history: meta.mergeAuditHistory || [],
  };
}

function clearGovernanceAudit(meta: GovernanceMeta): GovernanceMeta {
  return {
    ...meta,
    lastMergeAudit: undefined,
    mergeAuditHistory: [],
  };
}

function normalizeAuditMode(mode?: string): MergeAuditRecord["mode"] | undefined {
  if (mode === "single" || mode === "strong_batch" || mode === "weak_batch") return mode;
  return undefined;
}

function filterGovernanceAudit(meta: GovernanceMeta, mode?: string) {
  const payload = governanceAuditPayload(meta);
  const normalizedMode = normalizeAuditMode(mode);
  if (!normalizedMode) return payload;
  return {
    current: payload.current && payload.current.mode === normalizedMode ? payload.current : null,
    history: payload.history.filter((item) => item.mode === normalizedMode),
  };
}

function pruneLastAudit(meta: GovernanceMeta): GovernanceMeta {
  const history = meta.mergeAuditHistory || [];
  return {
    ...meta,
    lastMergeAudit: history[0],
  };
}

function legacyGovernanceMeta(meta: GovernanceMeta): GovernanceMeta {
  if (meta.lastMergeAudit && !meta.mergeAuditHistory?.length) {
    return { ...meta, mergeAuditHistory: [meta.lastMergeAudit] };
  }
  return meta;
}

function loadGovernanceMeta(): GovernanceMeta {
  try {
    const content = readFileSync(metaPath(), "utf-8");
    return legacyGovernanceMeta(JSON.parse(content));
  } catch {
    return {};
  }
}

function saveGovernanceMeta(meta: GovernanceMeta): void {
  const target = metaPath();
  const dir = dirname(target);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(target, JSON.stringify(meta, null, 2));
}

function loadConfig(): SuccessPathsConfig {
  const configPath = join(__dirname, "config.yaml");
  try {
    const content = readFileSync(configPath, "utf-8");
    return YAML.parse(content);
  } catch {
    return {
      dbPath: "./data/paths.json",
      minSuccessRate: 0.8,
      useVectorService: true,
      vectorServiceUrl: "http://localhost:8001",
    };
  }
}

function dbPath(): string {
  const config = loadConfig();
  return join(__dirname, config.dbPath.replace("./", ""));
}

function metaPath(): string {
  return join(dirname(dbPath()), "governance.json");
}

function loadPaths(): SuccessPath[] {
  try {
    const content = readFileSync(dbPath(), "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

function savePaths(paths: SuccessPath[]): void {
  const target = dbPath();
  const dataDir = dirname(target);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  writeFileSync(target, JSON.stringify(paths, null, 2));
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return [];
  const spaced = normalized.split(/\s+/).filter(Boolean);
  if (spaced.length > 1) return spaced;
  if (normalized.length === 1) return [normalized];

  const chars = Array.from(normalized);
  const bigrams: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) {
    bigrams.push(chars[i] + chars[i + 1]);
  }
  return bigrams.length > 0 ? bigrams : chars;
}

function similarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);
  return intersection.size / union.size;
}

function combinedSimilarity(input: string, path: SuccessPath): number {
  const rawInput = input || "";
  const pathInput = path.input || path.name || "";
  const rawScore = similarity(rawInput, pathInput);
  const normalizedScore = similarity(normalizeIntentText(rawInput), normalizeIntentText(pathInput));
  return Math.max(rawScore, normalizedScore);
}

function searchThreshold(path: SuccessPath, hasIntentMatch: boolean, isFailurePath: boolean): number {
  if (hasIntentMatch && !isFailurePath) return 0.18;
  if (hasIntentMatch && isFailurePath) return 0.24;
  if (isFailurePath) return 0.42;
  return 0.36;
}

function canReusePath(path: SuccessPath, score: number, hasIntentMatch: boolean, isFailurePath: boolean, minSuccessRate: number): boolean {
  if (path.successCount <= 0) return false;
  if (path.failCount > 0) return false;
  if (path.failureReason) return false;
  if (score < searchThreshold(path, hasIntentMatch, isFailurePath)) return false;
  if (isFailurePath) return hasIntentMatch || score >= 0.5;
  if (hasIntentMatch) return path.successCount > 0;
  return (path.successCount + path.failCount) >= 2 && (path.successCount / ((path.successCount + path.failCount) || 1)) >= minSuccessRate;
}

function rankSearchMatch(path: SuccessPath, userInput: string, intent?: string) {
  const total = path.successCount + path.failCount;
  const successRate = total > 0 ? path.successCount / total : 0;
  const isFailurePath = path.failCount > 0 && path.successCount === 0;
  const inputScore = combinedSimilarity(userInput, path);
  const hasIntentMatch = Boolean(intent && path.intent && intent === path.intent);
  const intentScore = hasIntentMatch ? 1 : 0;
  const score = hasIntentMatch
    ? Math.min(1, inputScore * 0.85 + 0.15)
    : inputScore;
  return {
    path,
    score,
    inputScore,
    intentScore,
    hasIntentMatch,
    successRate,
    isFailurePath,
  };
}

function searchSuccessPaths(paths: SuccessPath[], userInput: string, intent: string | undefined, minSuccessRate: number) {
  return paths
    .map((path) => rankSearchMatch(path, userInput, intent))
    .filter((match) => canReusePath(match.path, match.score, match.hasIntentMatch, match.isFailurePath, minSuccessRate))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.successRate !== a.successRate) return b.successRate - a.successRate;
      return b.path.lastUsed - a.path.lastUsed;
    })
    .slice(0, 5);
}

async function scoreCandidatesByVectorService(
  query: string,
  candidates: string[],
  vectorServiceUrl: string,
  topK = 5,
): Promise<Array<{ index: number; score: number }>> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${vectorServiceUrl}/similarity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, candidates, top_k: topK }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return [];
    const parsed = await response.json() as { matches?: Array<{ index: number; score: number }> };
    return Array.isArray(parsed.matches) ? parsed.matches : [];
  } catch {
    return [];
  }
}

function buildPathSemanticText(path: SuccessPath) {
  return [
    path.intent || "",
    path.input || "",
    path.name || "",
    path.description || "",
  ].filter(Boolean).join(" | ");
}

async function searchSuccessPathsWithVectorService(
  paths: SuccessPath[],
  userInput: string,
  intent: string | undefined,
  minSuccessRate: number,
  vectorServiceUrl: string,
) {
  const ranked = paths.map((path) => rankSearchMatch(path, userInput, intent));
  const candidates = ranked
    .filter((match) => match.path.successCount > 0 && match.path.failCount === 0 && !match.path.failureReason)
    .filter((match) => !intent || !match.path.intent || match.path.intent === intent)
    .map((match) => ({
      ...match,
      semanticText: buildPathSemanticText(match.path),
    }));

  if (candidates.length === 0) return [];

  const vectorMatches = await scoreCandidatesByVectorService(
    userInput,
    candidates.map((item) => item.semanticText),
    vectorServiceUrl,
    8,
  );

  if (vectorMatches.length === 0) {
    return searchSuccessPaths(paths, userInput, intent, minSuccessRate);
  }

  return vectorMatches
    .map((item) => {
      const candidate = candidates[item.index];
      if (!candidate) return null;
      const finalScore = Math.max(item.score, candidate.score);
      return {
        ...candidate,
        score: finalScore,
        inputScore: item.score,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((match) => canReusePath(match.path, match.score, match.hasIntentMatch, match.isFailurePath, minSuccessRate))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.successRate !== a.successRate) return b.successRate - a.successRate;
      return b.path.lastUsed - a.path.lastUsed;
    })
    .slice(0, 5);
}

function isNearDuplicateWrite(paths: SuccessPath[], candidate: Pick<SuccessPath, "input" | "intent" | "actions" | "failureReason">, now: number) {
  const candidateSignature = JSON.stringify((candidate.actions || []).map((action) => ({ tool: action.tool, action: action.action })));
  const normalizedCandidateInput = normalizeIntentText(candidate.input || "");

  return paths.find((path) => {
    const withinWindow = now - path.lastUsed < 5 * 60 * 1000;
    if (!withinWindow) return false;

    const sameIntent = (path.intent || "") === (candidate.intent || "");
    const sameFailure = Boolean(path.failureReason) === Boolean(candidate.failureReason);
    const pathSignature = actionSignature(path);
    const normalizedPathInput = normalizeIntentText(path.input || path.name || "");
    const similarityScore = similarity(normalizedCandidateInput, normalizedPathInput);

    return sameIntent && sameFailure && pathSignature === candidateSignature && similarityScore >= 0.92;
  });
}

function mergeWriteIntoExistingPath(path: SuccessPath, input: { pathDescription?: unknown; contextSnapshot?: unknown; llmSummary?: unknown; toolResultsSummary?: unknown; failureReason?: unknown; success?: unknown }) {
  if (typeof input.pathDescription === "string" && input.pathDescription) {
    path.description = input.pathDescription;
  }
  if (input.contextSnapshot && typeof input.contextSnapshot === "object") {
    path.contextSnapshot = input.contextSnapshot as Record<string, unknown>;
  }
  if (input.llmSummary && typeof input.llmSummary === "object") {
    path.llmSummary = input.llmSummary as SuccessPath["llmSummary"];
  }
  if (Array.isArray(input.toolResultsSummary)) {
    path.toolResultsSummary = input.toolResultsSummary as SuccessPath["toolResultsSummary"];
  }
  if (typeof input.failureReason === "string") {
    path.failureReason = input.failureReason;
  }

  if (input.success === false) path.failCount += 1;
  else path.successCount += 1;
  path.lastUsed = Date.now();
}

function recordSuccessPath(paths: SuccessPath[], input: { userInput?: unknown; pathName?: unknown; pathDescription?: unknown; intent?: unknown; promotedRule?: unknown; contextSnapshot?: unknown; llmSummary?: unknown; toolResultsSummary?: unknown; failureReason?: unknown; actions?: unknown; success?: unknown }) {
  const now = Date.now();
  const candidate = {
    input: String(input.userInput || ""),
    intent: typeof input.intent === "string" ? input.intent : undefined,
    actions: Array.isArray(input.actions) ? input.actions as SuccessPath["actions"] : [],
    failureReason: typeof input.failureReason === "string" ? input.failureReason : undefined,
  };

  const existing = isNearDuplicateWrite(paths, candidate, now);
  if (existing) {
    mergeWriteIntoExistingPath(existing, input);
    return { success: true, id: existing.id, deduplicated: true };
  }

  const newPath: SuccessPath = {
    id: `path_${now}`,
    name: String(input.pathName || "unknown_path"),
    description: String(input.pathDescription || ""),
    input: candidate.input,
    intent: candidate.intent,
    promotedRule: Boolean(input.promotedRule),
    contextSnapshot: input.contextSnapshot as Record<string, unknown> | undefined,
    llmSummary: input.llmSummary as SuccessPath["llmSummary"] | undefined,
    toolResultsSummary: input.toolResultsSummary as SuccessPath["toolResultsSummary"] | undefined,
    failureReason: candidate.failureReason,
    actions: candidate.actions,
    successCount: input.success === false ? 0 : 1,
    failCount: input.success === false ? 1 : 0,
    lastUsed: now,
  };

  paths.push(newPath);
  return { success: true, id: newPath.id, deduplicated: false };
}

function estimateSkillRefs(input: string, intent?: string): string[] {
  const refs = new Set<string>(["llm_agent/index", "llm_agent/planning", "rule_engine/index", "rule_engine/matching"]);

  if (intent) {
    refs.add("local_intent/index");
    refs.add("local_intent/context");
  }

  const normalizedInput = input || "";
  if (/(点击|坐标|界面|页面|按钮|截图|UI|ui|图标|电视|机顶盒)/.test(normalizedInput)
    || intent === "navigate_back"
    || intent === "go_home") {
    refs.add("adb/index");
    refs.add("adb/targeting");
  }

  if (/(截图|图标|识图|ocr|视觉|界面)/.test(normalizedInput)) {
    refs.add("adb/perception");
  }

  if (!intent || /(经验|复用|历史|之前)/.test(normalizedInput)) {
    refs.add("success_paths/index");
    refs.add("success_paths/retrieval");
  }

  return Array.from(refs);
}

function hasSkillsTrace(path: SuccessPath): boolean {
  const llmSkills = path.llmSummary?.selectedSkills;
  const snapshotSkills = path.contextSnapshot?.selectedSkills as string[] | undefined;
  const hintSkills = path.contextSnapshot?.skillsHint as string[] | undefined;
  return Boolean((Array.isArray(llmSkills) && llmSkills.length > 0)
    || (Array.isArray(snapshotSkills) && snapshotSkills.length > 0)
    || (Array.isArray(hintSkills) && hintSkills.length > 0));
}

function hasSkillsSource(path: SuccessPath): boolean {
  const snapshotSource = path.contextSnapshot?.skillsTraceSource;
  return typeof path.llmSummary?.selectedSkillsSource === "string" || typeof snapshotSource === "string";
}

function applySkillsTrace(path: SuccessPath, refs: string[], source: SkillsSource): void {
  path.contextSnapshot = {
    ...(path.contextSnapshot || {}),
    skillsHint: refs,
    selectedSkills: refs,
    skillsTraceSource: source,
  };
  path.llmSummary = {
    ...(path.llmSummary || {}),
    selectedSkills: refs,
    selectedSkillsSource: source,
  };
}

function recordDistribution(distribution: Record<string, number>, refs: string[]): void {
  for (const ref of refs) {
    const [toolName] = String(ref).split("/");
    if (!toolName) continue;
    distribution[toolName] = (distribution[toolName] || 0) + 1;
  }
}

function normalizeErrorText(text?: string): string | undefined {
  if (!text) return text;
  let normalized = text.replace(/\r\n/g, "\n").trim();

  if (normalized.includes("����") || normalized.includes("WinError 10061")) {
    return "Target service refused the connection (historical WinError 10061).";
  }
  if (normalized.includes("daemon not running") && normalized.includes("device") && normalized.includes("not found")) {
    return "ADB device not found after daemon startup.";
  }
  if (normalized.includes("device") && normalized.includes("not found")) {
    return "ADB device not found.";
  }
  if (normalized.length > 240) {
    normalized = `${normalized.slice(0, 237)}...`;
  }
  return normalized;
}

function normalizePathData(paths: SuccessPath[]) {
  let normalized = 0;
  for (const path of paths) {
    const nextFailureReason = normalizeErrorText(path.failureReason);
    if (nextFailureReason !== path.failureReason) {
      path.failureReason = nextFailureReason;
      normalized++;
    }

    path.toolResultsSummary = (path.toolResultsSummary || []).map((item) => {
      const nextError = normalizeErrorText(item.error);
      if (nextError !== item.error) {
        normalized++;
        return { ...item, error: nextError };
      }
      return item;
    });
  }
  return { normalized, scanned: paths.length };
}

function normalizeIntentText(text: string): string {
  return text
    .replace(/能不能|可以|请你|帮我|一下|这个|那个/g, "")
    .replace(/乐视/g, "电视")
    .replace(/首页|主界面/g, "主页")
    .replace(/退回去|退回|返回去/g, "返回")
    .replace(/\s+/g, "")
    .trim();
}

function clusterConfidence(a: SuccessPath, b: SuccessPath): number {
  const raw = similarity(a.input || a.name, b.input || b.name);
  const normalized = similarity(normalizeIntentText(a.input || a.name), normalizeIntentText(b.input || b.name));
  return Math.max(raw, normalized);
}

function pathQualityScore(path: SuccessPath): number {
  const total = path.successCount + path.failCount;
  const successRate = total > 0 ? path.successCount / total : 0;
  const hasLessFailureNoise = path.failureReason ? 0 : 0.2;
  const hasIntent = path.intent ? 0.1 : 0;
  return successRate * 10 + total + hasLessFailureNoise + hasIntent;
}

function actionSignature(path: SuccessPath): string {
  return JSON.stringify((path.actions || []).map(action => ({ tool: action.tool, action: action.action })));
}

function mergePathGroup(paths: SuccessPath[], primaryId: string, mergeIds: string[]) {
  const primary = paths.find(path => path.id === primaryId);
  if (!primary) return { success: false, error: `Primary path not found: ${primaryId}` };

  const mergeSet = new Set(mergeIds);
  const mergeTargets = paths.filter(path => mergeSet.has(path.id));
  if (mergeTargets.length === 0) return { success: false, error: "No merge candidates found" };

  for (const path of mergeTargets) {
    primary.successCount += path.successCount;
    primary.failCount += path.failCount;
    primary.lastUsed = Math.max(primary.lastUsed, path.lastUsed);

    if (!primary.failureReason && path.failureReason) {
      primary.failureReason = path.failureReason;
    }

    primary.toolResultsSummary = [...(primary.toolResultsSummary || []), ...(path.toolResultsSummary || [])];

    if (!primary.llmSummary?.selectedSkills?.length && path.llmSummary?.selectedSkills?.length) {
      primary.llmSummary = { ...(primary.llmSummary || {}), ...path.llmSummary };
    }

    if (!primary.contextSnapshot && path.contextSnapshot) {
      primary.contextSnapshot = path.contextSnapshot;
    }
  }

  const remaining = paths.filter(path => path.id === primaryId || !mergeSet.has(path.id));
  return { success: true, primaryId, mergedIds: mergeTargets.map(path => path.id), paths: remaining };
}

function clusterPaths(paths: SuccessPath[]) {
  const clusters: Array<{ signature: string; paths: SuccessPath[]; confidence: "strong" | "weak" }> = [];

  for (const path of paths) {
    const signature = `${path.intent || "unknown"}::${actionSignature(path)}`;
    const existing = clusters.find(cluster => cluster.signature === signature && cluster.paths.some(item => clusterConfidence(item, path) >= 0.28));

    if (existing) {
      existing.paths.push(path);
      if (existing.paths.some(item => clusterConfidence(item, path) >= 0.45)) {
        existing.confidence = "strong";
      }
      continue;
    }

    clusters.push({ signature, paths: [path], confidence: "weak" });
  }

  return clusters
    .filter(cluster => cluster.paths.length > 1)
    .map((cluster, index) => {
      const sorted = [...cluster.paths].sort((a, b) => pathQualityScore(b) - pathQualityScore(a));
      const primary = sorted[0];
      return {
        id: `cluster_${index + 1}`,
        intent: sorted[0]?.intent || "unknown",
        actionSignature: actionSignature(sorted[0]),
        size: sorted.length,
        confidence: cluster.confidence,
        sampleInput: sorted[0]?.input || sorted[0]?.name || "",
        suggestedPrimaryPathId: primary?.id,
        suggestedMergeCandidateIds: sorted.slice(1).map(path => path.id),
        paths: sorted.map(path => ({
          id: path.id,
          input: path.input,
          name: path.name,
          description: path.description,
          successRate: path.successCount / ((path.successCount + path.failCount) || 1),
          failureReason: path.failureReason,
          score: pathQualityScore(path),
          suggestedRole: path.id === primary?.id ? "primary" : "merge_candidate",
        })),
      };
    })
    .sort((a, b) => b.size - a.size);
}

function previewClusterMerges(paths: SuccessPath[], confidence: "strong" | "weak") {
  const clusters = clusterPaths(paths).filter(cluster => cluster.confidence === confidence && cluster.suggestedPrimaryPathId && (cluster.suggestedMergeCandidateIds?.length || 0) > 0);
  return {
    clusterCount: clusters.length,
    totalMergeCandidates: clusters.reduce((sum, cluster) => sum + (cluster.suggestedMergeCandidateIds?.length || 0), 0),
    clusters: clusters.map(cluster => ({
      id: cluster.id,
      confidence: cluster.confidence,
      intent: cluster.intent,
      sampleInput: cluster.sampleInput,
      primaryId: cluster.suggestedPrimaryPathId,
      mergeIds: cluster.suggestedMergeCandidateIds,
    })),
  };
}

function previewStrongClusterMerges(paths: SuccessPath[]) {
  return previewClusterMerges(paths, "strong");
}

function previewWeakClusterMerges(paths: SuccessPath[]) {
  return previewClusterMerges(paths, "weak");
}

function backfillSkillsTrace(paths: SuccessPath[]) {
  let updated = 0;
  let skipped = 0;
  let sourceTagged = 0;
  const distribution: Record<string, number> = {};

  for (const path of paths) {
    if (hasSkillsTrace(path)) {
      if (!hasSkillsSource(path)) {
        const refs = Array.isArray(path.llmSummary?.selectedSkills)
          ? path.llmSummary.selectedSkills
          : Array.isArray(path.contextSnapshot?.selectedSkills as string[] | undefined)
            ? path.contextSnapshot?.selectedSkills as string[]
            : Array.isArray(path.contextSnapshot?.skillsHint as string[] | undefined)
              ? path.contextSnapshot?.skillsHint as string[]
              : [];
        if (refs.length > 0) {
          applySkillsTrace(path, refs, "repaired");
          sourceTagged++;
          recordDistribution(distribution, refs);
        }
      } else {
        skipped++;
      }
      continue;
    }

    const refs = estimateSkillRefs(path.input || path.name || "", path.intent);
    applySkillsTrace(path, refs, "repaired");
    updated++;
    recordDistribution(distribution, refs);
  }

  return { updated, skipped, sourceTagged, scanned: paths.length, distribution };
}

export const successPathsTool = tool(
  async (input) => {
    const {
      action,
      input: userInput,
      pathId,
      pathName,
      pathDescription,
      intent,
      promotedRule,
      contextSnapshot,
      llmSummary,
      toolResultsSummary,
      failureReason,
      actions,
      success,
    } = input;

    switch (action) {
      case "search": {
        if (!userInput) {
          return JSON.stringify({ success: false, error: "Missing input" });
        }

        const paths = loadPaths();
        const config = loadConfig();
        const matches = config.useVectorService && config.vectorServiceUrl
          ? await searchSuccessPathsWithVectorService(paths, userInput, intent, config.minSuccessRate, config.vectorServiceUrl)
          : searchSuccessPaths(paths, userInput, intent, config.minSuccessRate);

        return JSON.stringify({
          success: true,
          matches: matches.map((m) => ({
            id: m.path.id,
            name: m.path.name,
            description: m.path.description,
            actions: m.path.actions,
            score: m.score,
            successRate: m.successRate,
            isFailurePath: m.isFailurePath,
            llmSummary: m.path.llmSummary,
            contextSnapshot: m.path.contextSnapshot,
            failureReason: m.path.failureReason,
          })),
        });
      }

      case "record": {
        if (!pathName || !actions) {
          return JSON.stringify({ success: false, error: "Missing pathName or actions" });
        }

        const paths = loadPaths();
        const normalizedContextSnapshot = contextSnapshot ? {
          ...contextSnapshot,
          skillsTraceSource: "recorded",
        } : contextSnapshot;
        const normalizedLlmSummary = llmSummary ? {
          ...llmSummary,
          selectedSkillsSource: "recorded" as const,
        } : llmSummary;

        const result = recordSuccessPath(paths, {
          userInput,
          pathName,
          pathDescription,
          intent,
          promotedRule,
          contextSnapshot: normalizedContextSnapshot,
          llmSummary: normalizedLlmSummary,
          toolResultsSummary,
          failureReason,
          actions,
          success,
        });

        savePaths(paths);
        return JSON.stringify(result);
      }

      case "feedback": {
        if (!pathId) {
          return JSON.stringify({ success: false, error: "Missing pathId" });
        }
        const paths = loadPaths();
        const path = paths.find((p) => p.id === pathId);
        if (!path) {
          return JSON.stringify({ success: false, error: "Path not found" });
        }
        if (success) path.successCount++;
        else path.failCount++;
        path.lastUsed = Date.now();
        savePaths(paths);
        return JSON.stringify({ success: true });
      }

      case "update": {
        if (!pathId) {
          return JSON.stringify({ success: false, error: "Missing pathId" });
        }
        const paths = loadPaths();
        const path = paths.find((p) => p.id === pathId);
        if (!path) {
          return JSON.stringify({ success: false, error: "Path not found" });
        }
        if (typeof promotedRule === "boolean") {
          path.promotedRule = promotedRule;
        }
        path.lastUsed = Date.now();
        savePaths(paths);
        return JSON.stringify({ success: true });
      }

      case "repair_skills": {
        const paths = loadPaths();
        const result = backfillSkillsTrace(paths);
        if (result.updated > 0 || result.sourceTagged > 0) {
          savePaths(paths);
        }
        return JSON.stringify({ success: true, ...result });
      }

      case "normalize_data": {
        const paths = loadPaths();
        const result = normalizePathData(paths);
        if (result.normalized > 0) {
          savePaths(paths);
        }
        return JSON.stringify({ success: true, ...result });
      }

      case "clusters": {
        return JSON.stringify({ success: true, clusters: clusterPaths(loadPaths()) });
      }

      case "preview_merge_strong_clusters": {
        return JSON.stringify({ success: true, ...previewStrongClusterMerges(loadPaths()) });
      }

      case "preview_merge_weak_clusters": {
        return JSON.stringify({ success: true, ...previewWeakClusterMerges(loadPaths()) });
      }

      case "merge_cluster": {
        if (!pathId || !Array.isArray(actions)) {
          return JSON.stringify({ success: false, error: "Missing primary pathId or merge candidate ids" });
        }
        const paths = loadPaths();
        const mergeIds = actions.map(item => String((item as Record<string, unknown>).id));
        const result = mergePathGroup(paths, pathId, mergeIds);
        if (!result.success) {
          return JSON.stringify(result);
        }
        savePaths(result.paths as SuccessPath[]);
        saveGovernanceMeta(recordMergeAudit(loadGovernanceMeta(), {
          mode: "single",
          mergedCount: result.mergedIds?.length || 0,
          primaryId: result.primaryId,
          mergedIds: result.mergedIds,
          updatedAt: Date.now(),
        }));
        return JSON.stringify({ success: true, primaryId: result.primaryId, mergedIds: result.mergedIds });
      }

      case "merge_strong_clusters": {
        let paths = loadPaths();
        const preview = previewStrongClusterMerges(paths);
        const merged: Array<{ primaryId?: string; mergedIds?: string[] }> = [];

        for (const cluster of preview.clusters) {
          const result = mergePathGroup(paths, cluster.primaryId as string, cluster.mergeIds as string[]);
          if (!result.success) continue;
          merged.push({ primaryId: result.primaryId, mergedIds: result.mergedIds });
          paths = result.paths as SuccessPath[];
        }

        savePaths(paths);
        saveGovernanceMeta(recordMergeAudit(loadGovernanceMeta(), {
          mode: "strong_batch",
          mergedCount: merged.length,
          preview,
          updatedAt: Date.now(),
        }));
        return JSON.stringify({ success: true, mergedCount: merged.length, merged, preview });
      }

      case "merge_weak_clusters": {
        let paths = loadPaths();
        const preview = previewWeakClusterMerges(paths);
        const merged: Array<{ primaryId?: string; mergedIds?: string[] }> = [];

        for (const cluster of preview.clusters) {
          const result = mergePathGroup(paths, cluster.primaryId as string, cluster.mergeIds as string[]);
          if (!result.success) continue;
          merged.push({ primaryId: result.primaryId, mergedIds: result.mergedIds });
          paths = result.paths as SuccessPath[];
        }

        savePaths(paths);
        saveGovernanceMeta(recordMergeAudit(loadGovernanceMeta(), {
          mode: "weak_batch",
          mergedCount: merged.length,
          preview,
          updatedAt: Date.now(),
        }));
        return JSON.stringify({ success: true, mergedCount: merged.length, merged, preview });
      }

      case "merge_audit": {
        return JSON.stringify({ success: true, ...filterGovernanceAudit(loadGovernanceMeta(), typeof intent === "string" ? intent : undefined) });
      }

      case "clear_merge_audit": {
        const cleared = clearGovernanceAudit(loadGovernanceMeta());
        saveGovernanceMeta(pruneLastAudit(cleared));
        return JSON.stringify({ success: true, ...governanceAuditPayload(cleared) });
      }

      case "list": {
        const paths = loadPaths();
        return JSON.stringify({
          success: true,
          paths: paths
            .filter((p) => p.successCount > 0 && p.failCount === 0 && !p.failureReason)
            .map((p) => {
            const reuseCount = p.successCount + p.failCount;
            const successRate = p.successCount / (reuseCount || 1);
            const maturity = p.promotedRule
              ? "promoted"
              : reuseCount >= 3
                ? "ready"
                : reuseCount === 2
                  ? "warming"
                  : "new";
            return {
              id: p.id,
              name: p.name,
              input: p.input,
              description: p.description,
              reuseCount,
              successRate,
              maturity,
              intent: p.intent,
              promotedRule: Boolean(p.promotedRule),
              actions: p.actions,
              responsePreview: p.description,
              contextSnapshot: p.contextSnapshot,
              llmSummary: p.llmSummary,
              toolResultsSummary: p.toolResultsSummary,
              failureReason: p.failureReason,
            };
          }),
        });
      }

      default:
        return JSON.stringify({ success: false, error: `Unknown action: ${action}` });
    }
  },
  {
    name: "success_paths",
    description: "成功路径记录和检索，用于学习和复用成功的操作序列",
    schema: z.object({
      action: z.enum(["search", "record", "feedback", "update", "list", "repair_skills", "normalize_data", "clusters", "merge_cluster", "merge_strong_clusters", "merge_weak_clusters", "preview_merge_strong_clusters", "preview_merge_weak_clusters", "merge_audit", "clear_merge_audit"]).describe("操作类型"),
      input: z.string().optional().describe("用户输入（用于搜索）"),
      intent: z.string().optional().describe("标准意图（用于检索和记录）"),
      promotedRule: z.boolean().optional().describe("是否已提升为规则"),
      contextSnapshot: z.record(z.any()).optional().describe("上下文快照"),
      llmSummary: z.object({
        intentHint: z.string().optional(),
        plan: z.array(z.string()).optional(),
        nextHint: z.string().optional(),
        selectedSkills: z.array(z.string()).optional(),
        selectedSkillsSource: z.enum(["recorded", "repaired"]).optional(),
        skillInsights: z.array(z.object({
          tool: z.string(),
          section: z.string(),
          headline: z.string().optional(),
        })).optional(),
      }).optional().describe("LLM 规划摘要"),
      toolResultsSummary: z.array(z.object({
        tool: z.string(),
        action: z.string(),
        success: z.boolean(),
        error: z.string().optional(),
      })).optional().describe("工具结果摘要"),
      failureReason: z.string().optional().describe("失败原因"),
      pathId: z.string().optional().describe("路径ID（用于反馈/更新/合并主路径）"),
      pathName: z.string().optional().describe("路径名称（用于记录）"),
      pathDescription: z.string().optional().describe("路径描述（用于记录）"),
      actions: z.array(z.any()).optional().describe("动作序列（用于记录或传递 merge ids）"),
      success: z.boolean().optional().describe("是否成功（用于反馈）"),
    }),
  },
);
