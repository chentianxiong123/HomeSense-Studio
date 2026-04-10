import { getRecentUserMessages } from "../memory/chatDb.js";

interface DevicePattern {
  device: string;
  label: string;
  keywords: string[];
  type: "tv" | "speaker" | "stb";
}

const DEVICE_PATTERNS: DevicePattern[] = [
  { device: "tv_letv", label: "乐视电视", keywords: ["乐视", "乐视电视"], type: "tv" },
  { device: "toshiba_tv", label: "东芝电视", keywords: ["东芝", "东芝电视", "toshiba"], type: "tv" },
  { device: "stb", label: "机顶盒", keywords: ["机顶盒", "盒子"], type: "stb" },
  { device: "xiaoai_speaker", label: "小爱音箱", keywords: ["小爱", "音箱", "音响"], type: "speaker" },
];

const PRONOUNS = ["它", "那个", "这个", "他", "她"];

const TRIGGER_RULES: Array<{
  pattern: RegExp;
  defaultDeviceType: string;
  template: (device: string, content: string) => string;
}> = [
  {
    pattern: /^(看|播放|放).+/,
    defaultDeviceType: "tv",
    template: (device, content) => `在${device}上${content}`,
  },
  {
    pattern: /^(听|听歌|放歌|播放音乐).+/,
    defaultDeviceType: "speaker",
    template: (device, content) => `用${device}${content}`,
  },
  {
    pattern: /^打开.+/,
    defaultDeviceType: "",
    template: (device, content) => content,
  },
];

function extractDeviceWeights(input: string, limit: number = 20, decayFactor: number = 0.9) {
  const recentMessages = getRecentUserMessages(limit);
  const scores = new Map<string, { device: DevicePattern; score: number }>();

  const allTexts = [...recentMessages.map((item) => item.content), input];

  for (let i = 0; i < allTexts.length; i++) {
    const text = allTexts[i];
    const isCurrentInput = i === allTexts.length - 1;
    const weight = isCurrentInput ? 1 : Math.pow(decayFactor, allTexts.length - 1 - i);

    for (const pattern of DEVICE_PATTERNS) {
      const matches = pattern.keywords.filter((keyword) => text.includes(keyword)).length;
      if (matches > 0) {
        const existing = scores.get(pattern.device);
        const newScore = (existing?.score ?? 0) + matches * weight;
        scores.set(pattern.device, { device: pattern, score: newScore });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score);
}

function hasPronoun(input: string): boolean {
  return PRONOUNS.some((pronoun) => input.includes(pronoun));
}

function findDeviceByType(type: string, weights: Array<{ device: DevicePattern; score: number }>): DevicePattern | undefined {
  const match = weights.find((item) => item.device.type === type);
  return match?.device;
}

function findTopDevice(weights: Array<{ device: DevicePattern; score: number }>): DevicePattern | undefined {
  return weights[0]?.device;
}

function resolvePronoun(input: string, weights: Array<{ device: DevicePattern; score: number }>): string {
  const topDevice = findTopDevice(weights);
  if (!topDevice) return input;

  let result = input;
  for (const pronoun of PRONOUNS) {
    result = result.replace(new RegExp(pronoun, "g"), topDevice.label);
  }
  return result;
}

function applyTriggerRules(input: string, weights: Array<{ device: DevicePattern; score: number }>): string {
  for (const rule of TRIGGER_RULES) {
    if (rule.pattern.test(input)) {
      if (rule.defaultDeviceType) {
        const device = findDeviceByType(rule.defaultDeviceType, weights) || findTopDevice(weights);
        if (device) {
          const alreadyHasDevice = DEVICE_PATTERNS.some((p) => input.includes(p.label));
          if (!alreadyHasDevice) {
            return rule.template(device.label, input);
          }
        }
      }
      break;
    }
  }
  return input;
}

export function completeContext(input: string): { completedInput: string; deviceWeights: Array<{ device: string; label: string; score: number; type: string }> } {
  const weights = extractDeviceWeights(input);
  let completedInput = input;

  if (hasPronoun(input)) {
    completedInput = resolvePronoun(input, weights);
  }

  completedInput = applyTriggerRules(completedInput, weights);

  return {
    completedInput,
    deviceWeights: weights.map((item) => ({
      device: item.device.device,
      label: item.device.label,
      score: item.score,
      type: item.device.type,
    })),
  };
}
