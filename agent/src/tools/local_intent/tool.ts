import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import YAML from "yaml";
import type { ToolAction } from "../../state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface LocalIntentConfig {
  model: string;
  confidence_threshold: number;
  enabled: boolean;
}

interface MatchCandidate {
  keywords: string[];
  intent: string;
  message: string;
  actions: ToolAction[];
  confidence: number;
}

interface RecentMentionedDevice {
  device: string;
  score: number;
}

function loadConfig(): LocalIntentConfig {
  const configPath = join(__dirname, "config.yaml");
  try {
    const content = readFileSync(configPath, "utf-8");
    return YAML.parse(content);
  } catch {
    return { model: "local-intent", confidence_threshold: 0.8, enabled: false };
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
    default:
      return [];
  }
}

function createDeviceMessage(device: string, actionType: "open" | "play"): string {
  if (device === "tv_letv") return actionType === "open" ? "好的，打开乐视电视" : "好的，在电视上继续播放";
  if (device === "stb") return "好的，打开机顶盒";
  if (device === "xiaoai_speaker") return "好的，让小爱音箱开始播放";
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

  return [...candidates, ...createContextualCandidates(text, recentMentionedDevices)];
}

export const localIntentTool = tool(
  async (input) => {
    const config = loadConfig();
    const text = input.text as string;
    const recentMentionedDevices = (input.recentMentionedDevices as RecentMentionedDevice[] | undefined) ?? [];
    const candidates = createCandidates(text, recentMentionedDevices);
    const best = [...candidates].sort((a, b) => b.confidence - a.confidence)[0];

    if (!best) {
      return JSON.stringify({ matched: false, confidence: 0, candidates: [] });
    }

    const threshold = config.confidence_threshold || 0.8;
    const allowMatch = config.enabled || recentMentionedDevices.length > 0;

    if (!allowMatch || best.confidence < threshold) {
      return JSON.stringify({
        matched: false,
        confidence: best.confidence,
        candidates: candidates.map(({ intent, confidence, keywords }) => ({ intent, confidence, keywords })),
      });
    }

    return JSON.stringify({
      matched: true,
      confidence: best.confidence,
      intent: best.intent,
      actions: best.actions,
      action: best.actions[0]?.action,
      message: best.message,
      candidates: candidates.map(({ intent, confidence, keywords }) => ({ intent, confidence, keywords })),
    });
  },
  {
    name: "local_intent",
    description: "本地意图识别，轻量级语义理解",
    schema: z.object({
      text: z.string().describe("用户输入文本"),
      recentMentionedDevices: z.array(z.object({
        device: z.string(),
        score: z.number(),
      })).optional().describe("最近提及的设备及权重"),
    }),
  },
);
