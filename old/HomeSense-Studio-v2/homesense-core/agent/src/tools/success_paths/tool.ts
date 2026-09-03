import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SuccessPath {
  id: string;
  name: string;
  description: string;
  intent: string;
  input: string;
  actions: Array<{
    tool: string;
    action: string;
    params?: Record<string, unknown>;
  }>;
  promotedRule?: boolean;
  successCount: number;
  failCount: number;
  lastUsed: number;
  updatedAt: number;
}

interface SuccessPathsConfig {
  dbPath: string;
  minSuccessRate: number;
  useVectorService?: boolean;
  vectorServiceUrl?: string;
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

function loadPaths(): SuccessPath[] {
  try {
    const content = readFileSync(dbPath(), "utf-8");
    return JSON.parse(content) as SuccessPath[];
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

function findPathByIntent(paths: SuccessPath[], intent?: string) {
  if (!intent) return null;
  return paths.find((path) => path.intent === intent) ?? null;
}

function toSearchResult(path: SuccessPath) {
  const reuseCount = path.successCount + path.failCount;
  const successRate = reuseCount > 0 ? path.successCount / reuseCount : 0;
  return {
    id: path.id,
    name: path.name,
    description: path.description,
    actions: path.actions,
    score: 1,
    successRate,
    isFailurePath: false,
    promotedRule: Boolean(path.promotedRule),
    reuseCount,
  };
}

function upsertPathByIntent(paths: SuccessPath[], input: {
  userInput?: unknown;
  pathName?: unknown;
  pathDescription?: unknown;
  intent?: unknown;
  actions?: unknown;
  promotedRule?: unknown;
  success?: unknown;
}) {
  const intent = typeof input.intent === "string" ? input.intent : "";
  const actionList = Array.isArray(input.actions) ? input.actions as SuccessPath["actions"] : [];
  const now = Date.now();
  const success = input.success !== false;

  if (!intent || actionList.length === 0) {
    return { success: false, error: "Missing intent or actions" };
  }

  const existing = findPathByIntent(paths, intent);
  if (existing) {
    existing.name = String(input.pathName || existing.name || intent);
    existing.description = String(input.pathDescription || existing.description || "");
    existing.input = String(input.userInput || existing.input || "");
    existing.actions = actionList;
    existing.promotedRule = typeof input.promotedRule === "boolean" ? input.promotedRule : existing.promotedRule;
    existing.updatedAt = now;
    existing.lastUsed = now;
    if (success) existing.successCount += 1;
    else existing.failCount += 1;
    return { success: true, id: existing.id, deduplicated: true };
  }

  const created: SuccessPath = {
    id: `path_${now}`,
    name: String(input.pathName || intent),
    description: String(input.pathDescription || ""),
    intent,
    input: String(input.userInput || ""),
    actions: actionList,
    promotedRule: Boolean(input.promotedRule),
    successCount: success ? 1 : 0,
    failCount: success ? 0 : 1,
    lastUsed: now,
    updatedAt: now,
  };
  paths.push(created);
  return { success: true, id: created.id, deduplicated: false };
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
      actions,
      success,
    } = input;

    switch (action) {
      case "search": {
        const paths = loadPaths();
        const matched = findPathByIntent(paths, typeof intent === "string" ? intent : undefined);
        return JSON.stringify({
          success: true,
          matches: matched ? [toSearchResult(matched)] : [],
        });
      }

      case "record": {
        const paths = loadPaths();
        const result = upsertPathByIntent(paths, {
          userInput,
          pathName,
          pathDescription,
          intent,
          actions,
          promotedRule,
          success,
        });
        if (result.success) savePaths(paths);
        return JSON.stringify(result);
      }

      case "feedback": {
        if (!pathId) {
          return JSON.stringify({ success: false, error: "Missing pathId" });
        }
        const paths = loadPaths();
        const found = paths.find((path) => path.id === pathId);
        if (!found) {
          return JSON.stringify({ success: false, error: "Path not found" });
        }
        if (success) found.successCount += 1;
        else found.failCount += 1;
        found.lastUsed = Date.now();
        savePaths(paths);
        return JSON.stringify({ success: true });
      }

      case "update": {
        if (!pathId) {
          return JSON.stringify({ success: false, error: "Missing pathId" });
        }
        const paths = loadPaths();
        const found = paths.find((path) => path.id === pathId);
        if (!found) {
          return JSON.stringify({ success: false, error: "Path not found" });
        }
        if (typeof promotedRule === "boolean") {
          found.promotedRule = promotedRule;
        }
        found.updatedAt = Date.now();
        savePaths(paths);
        return JSON.stringify({ success: true });
      }

      case "list": {
        const paths = loadPaths();
        return JSON.stringify({
          success: true,
          paths: paths.map((path) => {
            const reuseCount = path.successCount + path.failCount;
            const successRate = reuseCount > 0 ? path.successCount / reuseCount : 0;
            return {
              id: path.id,
              name: path.name,
              input: path.input,
              description: path.description,
              reuseCount,
              successRate,
              maturity: path.promotedRule ? "promoted" : reuseCount >= 5 ? "ready" : "warming",
              intent: path.intent,
              promotedRule: Boolean(path.promotedRule),
              actions: path.actions,
            };
          }),
        });
      }

      case "repair_skills":
      case "normalize_data":
      case "clusters":
      case "merge_cluster":
      case "merge_strong_clusters":
      case "merge_weak_clusters":
      case "preview_merge_strong_clusters":
      case "preview_merge_weak_clusters":
      case "merge_audit":
      case "clear_merge_audit":
        return JSON.stringify({
          success: true,
          message: `${action} is not used in the simplified success-path architecture`,
        });

      default:
        return JSON.stringify({ success: false, error: `Unknown action: ${action}` });
    }
  },
  {
    name: "success_paths",
    description: "按完整 intent 管理 success path 脚本缓存",
    schema: z.object({
      action: z.enum(["search", "record", "feedback", "update", "list", "repair_skills", "normalize_data", "clusters", "merge_cluster", "merge_strong_clusters", "merge_weak_clusters", "preview_merge_strong_clusters", "preview_merge_weak_clusters", "merge_audit", "clear_merge_audit"]).describe("操作类型"),
      input: z.string().optional().describe("用户输入"),
      intent: z.string().optional().describe("完整归一化 intent"),
      promotedRule: z.boolean().optional().describe("是否已升级为规则"),
      pathId: z.string().optional().describe("路径 ID"),
      pathName: z.string().optional().describe("路径名称"),
      pathDescription: z.string().optional().describe("路径描述"),
      actions: z.array(z.any()).optional().describe("动作序列"),
      success: z.boolean().optional().describe("是否成功"),
    }),
  },
);
