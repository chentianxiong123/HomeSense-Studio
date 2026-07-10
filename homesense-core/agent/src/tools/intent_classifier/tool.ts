import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTENT_SERVICE_URL = process.env.INTENT_SERVICE_URL || "http://localhost:8001";

interface IntentClassifierConfig {
  chat_keywords: string[];
  command_indicators: string[];
  confidence_threshold: number;
  use_vector_service: boolean;
}

function loadConfig(): IntentClassifierConfig {
  const configPath = join(__dirname, "config.yaml");
  try {
    const content = readFileSync(configPath, "utf-8");
    return YAML.parse(content);
  } catch {
    return {
      chat_keywords: [
        "你好", "您好", "hi", "hello", "嗨", "在吗", "在不在",
        "聊聊", "聊天", "说话", "问个事", "请教", "请问",
        "天气", "新闻", "今天", "现在几", "多少",
        "笑", "好玩", "有趣", "哈哈", "呵呵",
        "谢谢", "感谢", "辛苦了", "麻烦",
        "好的", "行", "可以", "没问题", "收到",
        "明白", "知道", "懂了", "了解",
        "再见", "拜拜", "走了", "下次见",
      ],
      command_indicators: [
        "打开", "关闭", "关掉", "开启", "启动",
        "播放", "暂停", "停止", "继续",
        "搜索", "查找", "找一下",
        "安装", "卸载", "删除",
        "返回", "后退", "前进",
        "截图", "点击", "滑动",
        "设置", "调整", "修改",
        "快进", "快退",
      ],
      confidence_threshold: 0.6,
      use_vector_service: true,
    };
  }
}

function ruleBasedClassify(text: string): { intentType: string; confidence: number; reason: string } {
  const config = loadConfig();
  const lower = text.toLowerCase();
  const errorFeedbackKeywords = [
    "不行", "不对", "错了", "不是这个", "没反应", "失败了", "还是不行",
    "不可以", "不对劲", "不成功", "有问题",
  ];
  const chatKeywords = config.chat_keywords;
  const commandIndicators = config.command_indicators;

  if (errorFeedbackKeywords.some((keyword) => lower.includes(keyword))) {
    return { intentType: "error_feedback", confidence: 0.95, reason: "rule_error_feedback" };
  }

  let chatScore = 0;
  let commandScore = 0;

  for (const keyword of chatKeywords) {
    if (lower.includes(keyword.toLowerCase())) chatScore += 1;
  }

  for (const indicator of commandIndicators) {
    if (lower.includes(indicator.toLowerCase())) commandScore += 1;
  }

  if (lower.length <= 3) {
    chatScore += 1;
  }

  const totalScore = chatScore + commandScore;
  if (totalScore === 0) {
    return { intentType: "command", confidence: 0.5, reason: "no_signal" };
  }

  const chatRatio = chatScore / totalScore;
  const intentType = chatRatio > 0.5 ? "chat" : "command";
  const confidence = Math.min(Math.max(chatScore, commandScore) / 2, 1);

  return {
    intentType,
    confidence,
    reason: intentType === "chat" ? "rule_chat" : "rule_command",
  };
}

async function callVectorService(text: string): Promise<{ intent: string; score: number; method: string; matched_text?: string; category?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  const response = await fetch(`${INTENT_SERVICE_URL}/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Intent service error: ${response.status}`);
  }

  return await response.json();
}

export const intentClassifierTool = tool(
  async (input) => {
    const text = (input.text as string || "").trim();
    const config = loadConfig();
    const lower = text.toLowerCase();
    const errorFeedbackKeywords = [
      "不行", "不对", "错了", "不是这个", "没反应", "失败了", "还是不行",
      "不可以", "不对劲", "不成功", "有问题",
    ];

    if (errorFeedbackKeywords.some((keyword) => lower.includes(keyword))) {
      return JSON.stringify({
        intentType: "error_feedback",
        confidence: 0.95,
        reason: "rule_error_feedback",
        method: "rule_feedback",
      });
    }

    if (config.use_vector_service) {
      try {
        const vectorResult = await callVectorService(text);
        return JSON.stringify({
          intentType: vectorResult.intent,
          confidence: vectorResult.score,
          reason: vectorResult.method,
          matchedText: vectorResult.matched_text,
          category: vectorResult.category,
          method: "vector_service",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`意图分类服务不可用: ${message}`);
      }
    }

    const ruleResult = ruleBasedClassify(text);
    return JSON.stringify({
      ...ruleResult,
      method: "rule_fallback",
    });
  },
  {
    name: "intent_classifier",
    description: "意图模型 - 轻量级语义分类，区分 chat/command 意图",
    schema: z.object({
      text: z.string().describe("用户输入文本"),
    }),
  },
);
