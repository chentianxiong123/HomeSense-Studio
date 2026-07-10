import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import YAML from "yaml";
import type { ToolAction } from "../../state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTOR_SERVICE_URL = process.env.INTENT_SERVICE_URL || "http://localhost:8001";

interface LocalIntentConfig {
  model: string;
  confidence_threshold: number;
  enabled: boolean;
  use_vector_db: boolean;
  vector_db_path: string;
}

interface RecentMentionedDevice {
  device: string;
  score: number;
}

interface IntentExample {
  text: string;
  intent: string;
  actions: ToolAction[];
  device?: string;
}

interface Candidate {
  intent: string;
  confidence: number;
  actions: ToolAction[];
  source: "rule" | "vector";
  device?: string;
  sampleText?: string;
}

function loadConfig(): LocalIntentConfig {
  const configPath = join(__dirname, "config.yaml");
  try {
    const content = readFileSync(configPath, "utf-8");
    return YAML.parse(content);
  } catch {
    return {
      model: "local-intent",
      confidence_threshold: 0.6,
      enabled: true,
      use_vector_db: true,
      vector_db_path: join(__dirname, "..", "..", "data", "intents.db"),
    };
  }
}

function getTopDevice(recentMentionedDevices: RecentMentionedDevice[] = []): string | undefined {
  return [...recentMentionedDevices].sort((a, b) => b.score - a.score)[0]?.device;
}

function resolveTelevisionDevice(recentMentionedDevices: RecentMentionedDevice[] = []): string | undefined {
  const topDevice = getTopDevice(recentMentionedDevices);
  if (topDevice === "toshiba_tv" || topDevice === "tv_letv") return topDevice;
  return undefined;
}

function buildDemoActionSequence(): ToolAction[] {
  return [
    { tool: "hami", action: "tv_remote", params: { device: "tvs_toshiba", command: "\u7535\u6e90" } },
    { tool: "adb", action: "wait", params: { seconds: 15 } },
    { tool: "hami", action: "tv_remote", params: { device: "stb", command: "\u7535\u6e90" } },
    { tool: "adb", action: "wait", params: { seconds: 15 } },
    { tool: "adb", action: "ensure_connected", params: { initial_wait_seconds: 10, max_attempts: 5, backoff_seconds: 2 } },
    { tool: "adb", action: "wait", params: { seconds: 15 } },
    { tool: "adb", action: "list_packages", params: { keyword: "bili" } },
    { tool: "adb", action: "wait", params: { seconds: 3 } },
    { tool: "adb", action: "launch_app", params: { package: "com.xiaodianshi.tv.yst" } },
  ];
}

function createIntentCatalog(recentMentionedDevices: RecentMentionedDevice[] = []): IntentExample[] {
  const preferredTv = resolveTelevisionDevice(recentMentionedDevices);
  const genericTvAction = preferredTv === "tv_letv"
    ? [{ tool: "hami", action: "xiaoai_execute", params: { command: "打开电视" } }]
    : [{ tool: "adb", action: "launch_app", params: { package: "com.xiaodianshi.tv.yst" } }];

  return [
    {
      text: "打开东芝电视",
      intent: "open_device_toshiba_tv",
      device: "toshiba_tv",
      actions: [{ tool: "hami", action: "xiaoai_execute", params: { command: "打开东芝电视" } }],
    },
    {
      text: "打开乐视电视",
      intent: "open_device_tv_letv",
      device: "tv_letv",
      actions: [{ tool: "hami", action: "xiaoai_execute", params: { command: "打开电视" } }],
    },
    {
      text: "打开机顶盒",
      intent: "open_device_stb",
      device: "stb",
      actions: [{ tool: "hami", action: "xiaoai_execute", params: { command: "打开机顶盒" } }],
    },
    {
      text: "小爱音箱放歌",
      intent: "play_media_xiaoai_speaker",
      device: "xiaoai_speaker",
      actions: [{ tool: "hami", action: "xiaoai_execute", params: { command: "小爱音箱放歌" } }],
    },
    {
      text: "在东芝电视看B站",
      intent: "open_bilibili_toshiba_tv",
      device: "toshiba_tv",
      actions: [{ tool: "adb", action: "launch_app", params: { package: "com.xiaodianshi.tv.yst" } }],
    },
    {
      text: "用机顶盒看B站",
      intent: "open_bilibili_stb",
      device: "stb",
      actions: buildDemoActionSequence(),
    },
    {
      text: "用乐视电视看B站",
      intent: "open_bilibili_tv_letv",
      device: "tv_letv",
      actions: genericTvAction,
    },
    {
      text: "我想看B站",
      intent: "watch_bilibili_demo",
      actions: buildDemoActionSequence(),
    },
    {
      text: "看B站",
      intent: "watch_bilibili_demo",
      actions: buildDemoActionSequence(),
    },
    {
      text: "返回",
      intent: "navigate_back",
      actions: [{ tool: "adb", action: "back" }],
    },
    {
      text: "主页",
      intent: "go_home",
      actions: [{ tool: "adb", action: "home" }],
    },
  ];
}

function keywordScore(text: string, candidate: IntentExample): number {
  const normalized = text.toLowerCase();
  const sample = candidate.text.toLowerCase();
  if (normalized === sample) return 1;

  let score = 0;
  if ((normalized.includes("返回") || normalized.includes("后退")) && candidate.intent === "navigate_back") score = 0.95;
  if ((normalized.includes("主页") || normalized.includes("首页") || normalized.includes("home")) && candidate.intent === "go_home") score = 0.95;
  if ((normalized.includes("机顶盒") || normalized.includes("盒子")) && candidate.device === "stb") score += 0.45;
  if ((normalized.includes("东芝") || normalized.includes("东芝电视") || normalized.includes("toshiba")) && candidate.device === "toshiba_tv") score += 0.45;
  if ((normalized.includes("乐视") || normalized.includes("乐视电视")) && candidate.device === "tv_letv") score += 0.45;
  if ((normalized.includes("小爱") || normalized.includes("音箱") || normalized.includes("音响")) && candidate.device === "xiaoai_speaker") score += 0.45;
  if ((normalized.includes("b站") || normalized.includes("bilibili") || normalized.includes("哔哩")) && candidate.intent.includes("bilibili")) score += 0.45;
  if ((normalized.includes("打开") || normalized.includes("开启")) && candidate.intent.startsWith("open_device")) score += 0.25;
  if ((normalized.includes("放歌") || normalized.includes("听歌") || normalized.includes("播放")) && candidate.intent.startsWith("play_media")) score += 0.25;
  if ((normalized.includes("我想看b站") || normalized.includes("看b站")) && candidate.intent === "watch_bilibili_demo") score = Math.max(score, 0.95);

  return Math.min(score, 0.98);
}

async function getEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch(`${VECTOR_SERVICE_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error("Embedding failed");
    const data = await response.json() as { embedding?: number[] };
    return Array.isArray(data.embedding) ? data.embedding : [];
  } catch {
    return [];
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function buildVectorCandidates(text: string, catalog: IntentExample[]): Promise<Candidate[]> {
  const queryEmbedding = await getEmbedding(text);
  if (queryEmbedding.length === 0) return [];

  const scored = await Promise.all(catalog.map(async (item) => {
    const itemEmbedding = await getEmbedding(item.text);
    return {
      item,
      score: cosineSimilarity(queryEmbedding, itemEmbedding),
    };
  }));

  return scored
    .filter((entry) => entry.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => ({
      intent: entry.item.intent,
      confidence: entry.score,
      actions: entry.item.actions,
      source: "vector" as const,
      device: entry.item.device,
      sampleText: entry.item.text,
    }));
}

function buildRuleCandidates(text: string, catalog: IntentExample[]): Candidate[] {
  return catalog
    .map((item) => ({
      intent: item.intent,
      confidence: keywordScore(text, item),
      actions: item.actions,
      source: "rule" as const,
      device: item.device,
      sampleText: item.text,
    }))
    .filter((item) => item.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const deduped: Candidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.intent)) continue;
    seen.add(candidate.intent);
    deduped.push(candidate);
  }
  return deduped;
}

export const localIntentTool = tool(
  async (input) => {
    const config = loadConfig();
    const text = String(input.text || "").trim();
    const recentMentionedDevices = (input.recentMentionedDevices as RecentMentionedDevice[] | undefined) ?? [];
    const catalog = createIntentCatalog(recentMentionedDevices);

    const ruleCandidates = buildRuleCandidates(text, catalog);
    const vectorCandidates = config.use_vector_db ? await buildVectorCandidates(text, catalog) : [];
    const candidates = dedupeCandidates([...ruleCandidates, ...vectorCandidates])
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    const best = candidates[0];
    if (best && best.confidence >= (config.confidence_threshold || 0.6)) {
      return JSON.stringify({
        matched: true,
        confidence: best.confidence,
        intent: best.intent,
        actions: best.actions,
        action: best.actions[0]?.action,
        source: best.source,
        candidates: candidates.map((item) => ({
          intent: item.intent,
          confidence: item.confidence,
          device: item.device ?? null,
          source: item.source,
          sampleText: item.sampleText ?? null,
        })),
      });
    }

    return JSON.stringify({
      matched: false,
      confidence: best?.confidence || 0,
      intent: null,
      actions: [],
      source: "none",
      candidates: candidates.map((item) => ({
        intent: item.intent,
        confidence: item.confidence,
        device: item.device ?? null,
        source: item.source,
        sampleText: item.sampleText ?? null,
      })),
    });
  },
  {
    name: "local_intent",
    description: "本地意图归一化，输出带设备的完整 intent，并为 Demo 提供稳定归一化入口",
    schema: z.object({
      text: z.string().describe("用户输入文本"),
      recentMentionedDevices: z.array(z.object({
        device: z.string(),
        score: z.number(),
      })).optional().describe("最近提到的设备及权重"),
    }),
  },
);
