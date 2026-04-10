import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Database from "better-sqlite3";
import { load } from "sqlite-vec";
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

interface NormalizedIntent {
  id: number;
  text: string;
  normalized_text: string;
  intent: string;
  action: string;
  params?: Record<string, any>;
  device?: string;
  vector?: number[];
}

interface RecentMentionedDevice {
  device: string;
  score: number;
}

let db: Database.Database | null = null;
let normalizedIntents: NormalizedIntent[] = [];

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

async function getEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch(`${VECTOR_SERVICE_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error("Embedding failed");
    const data = await response.json();
    return data.embedding;
  } catch (error) {
    console.error("[local_intent] Embedding error:", error);
    return [];
  }
}

function initVectorDb(dbPath: string): Database.Database {
  const dir = join(dbPath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const database = new Database(dbPath);
  database.exec("CREATE TABLE IF NOT EXISTS normalized_intents (id INTEGER PRIMARY KEY, text TEXT, normalized_text TEXT, intent TEXT, action TEXT, params TEXT, device TEXT)");

  try {
    load(database);
  } catch (e) {
    console.log("[local_intent] Vec0 extension loaded via alternative method");
  }

  try {
    database.exec("CREATE VIRTUAL TABLE IF NOT EXISTS intent_vectors USING vec0(embedding float[384])");
  } catch (e) {
    console.log("[local_intent] Vec0 table may already exist:", e);
  }

  return database;
}

function loadNormalizedIntents(): NormalizedIntent[] {
  const intents: NormalizedIntent[] = [
    { id: 1, text: "打开电视", normalized_text: "open_tv", intent: "open_device", action: "xiaoai_execute", params: { command: "打开电视" }, device: "tv" },
    { id: 2, text: "打开乐视电视", normalized_text: "open_tv", intent: "open_device", action: "xiaoai_execute", params: { command: "打开电视" }, device: "tv_letv" },
    { id: 3, text: "开启电视", normalized_text: "open_tv", intent: "open_device", action: "xiaoai_execute", params: { command: "打开电视" }, device: "tv" },
    { id: 4, text: "打开机顶盒", normalized_text: "open_stb", intent: "open_device", action: "xiaoai_execute", params: { command: "打开机顶盒" }, device: "stb" },
    { id: 5, text: "打开盒子", normalized_text: "open_stb", intent: "open_device", action: "xiaoai_execute", params: { command: "打开机顶盒" }, device: "stb" },
    { id: 6, text: "打开东芝电视", normalized_text: "open_toshiba_tv", intent: "open_device", action: "xiaoai_execute", params: { command: "打开东芝电视" }, device: "toshiba_tv" },
    { id: 7, text: "在东芝电视打开B站", normalized_text: "open_bilibili_tv", intent: "open_app", action: "open_bilibili", device: "toshiba_tv" },
    { id: 8, text: "在东芝电视看B站", normalized_text: "open_bilibili_tv", intent: "open_app", action: "open_bilibili", device: "toshiba_tv" },
    { id: 9, text: "用东芝电视看B站", normalized_text: "open_bilibili_tv", intent: "open_app", action: "open_bilibili", device: "toshiba_tv" },
    { id: 10, text: "在机顶盒看B站", normalized_text: "open_bilibili_stb", intent: "open_app", action: "open_bilibili", device: "stb" },
    { id: 11, text: "用机顶盒看B站", normalized_text: "open_bilibili_stb", intent: "open_app", action: "open_bilibili", device: "stb" },
    { id: 12, text: "打开B站", normalized_text: "open_bilibili", intent: "open_app", action: "open_bilibili", device: "tv" },
    { id: 13, text: "打开哔哩哔哩", normalized_text: "open_bilibili", intent: "open_app", action: "open_bilibili", device: "tv" },
    { id: 14, text: "看B站", normalized_text: "open_bilibili", intent: "open_app", action: "open_bilibili", device: "tv" },
    { id: 15, text: "我想看B站", normalized_text: "open_bilibili", intent: "open_app", action: "open_bilibili", device: "tv" },
    { id: 16, text: "返回", normalized_text: "navigate_back", intent: "navigate_back", action: "back" },
    { id: 17, text: "后退", normalized_text: "navigate_back", intent: "navigate_back", action: "back" },
    { id: 18, text: "上一页", normalized_text: "navigate_back", intent: "navigate_back", action: "back" },
    { id: 19, text: "主页", normalized_text: "go_home", intent: "go_home", action: "home" },
    { id: 20, text: "首页", normalized_text: "go_home", intent: "go_home", action: "home" },
    { id: 21, text: "home", normalized_text: "go_home", intent: "go_home", action: "home" },
    { id: 22, text: "播放音乐", normalized_text: "play_music", intent: "play_media", action: "xiaoai_execute", params: { command: "小爱音箱放歌" }, device: "xiaoai_speaker" },
    { id: 23, text: "放首歌", normalized_text: "play_music", intent: "play_media", action: "xiaoai_execute", params: { command: "小爱音箱放歌" }, device: "xiaoai_speaker" },
    { id: 24, text: "小爱音箱放歌", normalized_text: "play_music", intent: "play_media", action: "xiaoai_execute", params: { command: "小爱音箱放歌" }, device: "xiaoai_speaker" },
    { id: 25, text: "打开空调", normalized_text: "open_ac", intent: "open_device", action: "xiaoai_execute", params: { command: "打开空调" }, device: "ac" },
    { id: 26, text: "开灯", normalized_text: "turn_on_light", intent: "control_light", action: "turn_on", device: "light" },
    { id: 27, text: "关灯", normalized_text: "turn_off_light", intent: "control_light", action: "turn_off", device: "light" },
  ];
  return intents;
}

async function syncIntentsToVectorDb(db: Database.Database, intents: NormalizedIntent[]): Promise<void> {
  try {
    const count = db.prepare("SELECT COUNT(*) as count FROM normalized_intents").get() as { count: number };
    if (count.count > 0) {
      console.log(`[local_intent] ${count.count} intents already in DB`);
      return;
    }

    const insertStmt = db.prepare("INSERT INTO normalized_intents (id, text, normalized_text, intent, action, params, device) VALUES (?, ?, ?, ?, ?, ?, ?)");

    for (const intent of intents) {
      insertStmt.run(intent.id, intent.text, intent.normalized_text, intent.intent, intent.action, JSON.stringify(intent.params || {}), intent.device || "");
    }

    console.log(`[local_intent] Inserted ${intents.length} intents into DB`);

    for (const intent of intents) {
      const embedding = await getEmbedding(intent.text);
      if (embedding.length > 0) {
        const vectorJson = JSON.stringify(embedding).replace(/'/g, "''");
        db.exec(`INSERT INTO intent_vectors(rowid, embedding) VALUES (${intent.id}, '${vectorJson}')`);
      }
    }

    console.log(`[local_intent] Inserted ${intents.length} vectors into intent_vectors`);
  } catch (e) {
    console.error("[local_intent] Error syncing intents:", e);
  }
}

function getTopDevice(recentMentionedDevices: RecentMentionedDevice[] = []): string | undefined {
  return [...recentMentionedDevices].sort((a, b) => b.score - a.score)[0]?.device;
}

function createDeviceAction(device: string): ToolAction[] {
  switch (device) {
    case "tv_letv":
      return [{ tool: "hami", action: "xiaoai_execute", params: { command: "打开电视" } }];
    case "stb":
      return [{ tool: "hami", action: "xiaoai_execute", params: { command: "打开机顶盒" } }];
    case "xiaoai_speaker":
      return [{ tool: "hami", action: "xiaoai_execute", params: { command: "小爱音箱放歌" } }];
    case "toshiba_tv":
      return [{ tool: "adb", action: "open_bilibili" }];
    default:
      return [];
  }
}

function createDeviceMessage(device: string, actionType: "open" | "play"): string {
  if (device === "tv_letv") return actionType === "open" ? "好的，打开乐视电视" : "好的，在电视上继续播放";
  if (device === "stb") return "好的，打开机顶盒";
  if (device === "xiaoai_speaker") return "好的，让小爱音箱开始播放";
  if (device === "toshiba_tv") return actionType === "open" ? "好的，打开东芝电视" : "好的，在东芝电视上播放";
  return "好的，开始执行";
}

function createContextualCandidates(text: string, recentMentionedDevices: RecentMentionedDevice[] = []): MatchCandidate[] {
  const lower = text.toLowerCase();
  const topDevice = getTopDevice(recentMentionedDevices);
  if (!topDevice) return [];

  const candidates: MatchCandidate[] = [];
  const refersToPreviousDevice =
    lower.includes("它") || lower.includes("那个") || lower.includes("这个") || lower.includes("刚刚");

  if ((lower.includes("打开") || lower.includes("开启")) && refersToPreviousDevice) {
    candidates.push({
      keywords: ["打开", "它"],
      intent: "open_device",
      message: createDeviceMessage(topDevice, "open"),
      actions: createDeviceAction(topDevice),
      confidence: 0.84,
    });
  }

  if ((lower.includes("放歌") || lower.includes("播放") || lower.includes("继续")) && refersToPreviousDevice) {
    const targetDevice = topDevice === "xiaoai_speaker" ? topDevice : "xiaoai_speaker";
    candidates.push({
      keywords: ["播放", "它"],
      intent: "play_media",
      message: createDeviceMessage(targetDevice, "play"),
      actions: createDeviceAction(targetDevice),
      confidence: 0.82,
    });
  }

  return candidates.filter((candidate) => candidate.actions.length > 0);
}

interface MatchCandidate {
  keywords: string[];
  intent: string;
  message: string;
  actions: ToolAction[];
  confidence: number;
}

function createCandidates(text: string, recentMentionedDevices: RecentMentionedDevice[] = []): MatchCandidate[] {
  const lower = text.toLowerCase();
  const candidates: MatchCandidate[] = [];

  if (lower.includes("返回") || lower.includes("退回") || lower.includes("回到上一步")) {
    candidates.push({
      keywords: ["返回"],
      intent: "navigate_back",
      message: "好的，返回上一页",
      actions: [{ tool: "adb", action: "back" }],
      confidence: 0.92,
    });
  }

  if (lower.includes("主页") || lower.includes("首页") || lower.includes("home")) {
    candidates.push({
      keywords: ["主页"],
      intent: "go_home",
      message: "好的，返回主页",
      actions: [{ tool: "adb", action: "home" }],
      confidence: 0.92,
    });
  }

  if ((lower.includes("打开") || lower.includes("开启")) && (lower.includes("电视") || lower.includes("乐视"))) {
    candidates.push({
      keywords: ["打开", "电视"],
      intent: "open_device",
      message: "好的，打开乐视电视",
      actions: [{ tool: "hami", action: "xiaoai_execute", params: { command: "打开电视" } }],
      confidence: 0.88,
    });
  }

  if ((lower.includes("打开") || lower.includes("开启")) && (lower.includes("机顶盒") || lower.includes("盒子"))) {
    candidates.push({
      keywords: ["打开", "机顶盒"],
      intent: "open_device",
      message: "好的，打开机顶盒",
      actions: [{ tool: "hami", action: "xiaoai_execute", params: { command: "打开机顶盒" } }],
      confidence: 0.88,
    });
  }

  if ((lower.includes("放歌") || lower.includes("播放音乐") || lower.includes("来点歌")) && (lower.includes("小爱") || lower.includes("音箱"))) {
    candidates.push({
      keywords: ["小爱", "放歌"],
      intent: "play_media",
      message: "好的，让小爱音箱开始播放",
      actions: [{ tool: "hami", action: "xiaoai_execute", params: { command: "小爱音箱放歌" } }],
      confidence: 0.86,
    });
  }

  if (lower.includes("b站") || lower.includes("bilibili") || lower.includes("哔哩哔哩") || lower.includes("看b站") || lower.includes("看哔哩")) {
    candidates.push({
      keywords: ["B站", "bilibili"],
      intent: "open_app",
      message: "好的，打开B站",
      actions: [{ tool: "adb", action: "open_bilibili" }],
      confidence: 0.90,
    });
  }

  if (lower.includes("当贝") && (lower.includes("市场") || lower.includes("商店") || lower.includes("应用商店"))) {
    candidates.push({
      keywords: ["当贝", "市场"],
      intent: "open_app",
      message: "好的，打开当贝市场",
      actions: [{ tool: "adb", action: "open_dangbei" }],
      confidence: 0.88,
    });
  }

  return [...candidates, ...createContextualCandidates(text, recentMentionedDevices)];
}

async function vectorSearch(text: string, db: Database.Database): Promise<{ intent: NormalizedIntent; score: number } | null> {
  try {
    const embedding = await getEmbedding(text);
    if (embedding.length === 0) return null;

    const vectorJson = JSON.stringify(embedding);
    const results = db.prepare(
      "SELECT rowid, distance FROM intent_vectors WHERE embedding MATCH ? LIMIT 1"
    ).all(vectorJson) as { rowid: number; distance: number }[];

    if (results.length === 0) return null;

    const matchedIntent = db.prepare("SELECT * FROM normalized_intents WHERE id = ?").get(results[0].rowid) as any;
    if (!matchedIntent) return null;

    const score = Math.max(0, 1 - results[0].distance / 2);
    return {
      intent: {
        id: matchedIntent.id,
        text: matchedIntent.text,
        normalized_text: matchedIntent.normalized_text,
        intent: matchedIntent.intent,
        action: matchedIntent.action,
        params: JSON.parse(matchedIntent.params || "{}"),
        device: matchedIntent.device,
      },
      score,
    };
  } catch (error) {
    console.error("[local_intent] Vector search error:", error);
    return null;
  }
}

export const localIntentTool = tool(
  async (input) => {
    const config = loadConfig();
    const text = input.text as string;
    const recentMentionedDevices = (input.recentMentionedDevices as RecentMentionedDevice[] | undefined) ?? [];

    const candidates = createCandidates(text, recentMentionedDevices);
    const best = [...candidates].sort((a, b) => b.confidence - a.confidence)[0];

    if (best && best.confidence >= (config.confidence_threshold || 0.6)) {
      return JSON.stringify({
        matched: true,
        confidence: best.confidence,
        intent: best.intent,
        actions: best.actions,
        action: best.actions[0]?.action,
        message: best.message,
        candidates: candidates.map(({ intent, confidence, keywords }) => ({ intent, confidence, keywords })),
        source: "rule",
      });
    }

    if (config.use_vector_db) {
      if (!db) {
        const dbPath = config.vector_db_path || join(__dirname, "..", "..", "data", "intents.db");
        db = initVectorDb(dbPath);
        const intents = loadNormalizedIntents();
        await syncIntentsToVectorDb(db, intents);
        normalizedIntents = intents;
      }

      const vectorResult = await vectorSearch(text, db);
      if (vectorResult && vectorResult.score >= 0.3) {
        const actions: ToolAction[] = vectorResult.intent.params
          ? [{ tool: "hami", action: vectorResult.intent.action, params: vectorResult.intent.params }]
          : [{ tool: "adb", action: vectorResult.intent.action }];

        return JSON.stringify({
          matched: true,
          confidence: vectorResult.score,
          intent: vectorResult.intent.intent,
          actions,
          action: vectorResult.intent.action,
          message: `好的，执行${vectorResult.intent.text}`,
          normalized_text: vectorResult.intent.normalized_text,
          candidates: [],
          source: "vector",
        });
      }
    }

    return JSON.stringify({
      matched: false,
      confidence: best?.confidence || 0,
      intent: null,
      actions: [],
      candidates: candidates.map(({ intent, confidence, keywords }) => ({ intent, confidence, keywords })),
      source: "none",
    });
  },
  {
    name: "local_intent",
    description: "本地意图识别 - 规则匹配 + sqlite-vec 向量归一化",
    schema: z.object({
      text: z.string().describe("用户输入文本"),
      recentMentionedDevices: z.array(z.object({
        device: z.string(),
        score: z.number(),
      })).optional().describe("最近提及的设备及权重"),
    }),
  },
);