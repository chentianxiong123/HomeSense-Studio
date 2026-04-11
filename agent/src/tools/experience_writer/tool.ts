import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ensureExperiencesDir } from "../experience_retrieval/tool.js";
import { callChatModel, loadLlmAgentConfig } from "../llm_agent/tool.js";
import type { ToolAction } from "../../state.js";

interface ExperienceWriteInput {
  input: string;
  completedInput: string;
  intent: string;
  reactSteps: Array<{ thought: string; action: ToolAction | null; observation: string }>;
  toolResults: Array<Record<string, unknown>>;
}

function intentToFilename(intent: string): string {
  return intent.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase() + ".md";
}

function getExperiencePath(intent: string) {
  return join(ensureExperiencesDir(), intentToFilename(intent));
}

function checkExperienceExists(intent: string): boolean {
  return existsSync(getExperiencePath(intent));
}

function buildExecutionSummary(input: ExperienceWriteInput) {
  return [
    `用户原始输入: ${input.input}`,
    `补全后输入: ${input.completedInput}`,
    `归一化意图: ${input.intent}`,
    "",
    "执行步骤:",
    ...input.reactSteps.map((step, index) => `${index + 1}. thought=${step.thought} action=${JSON.stringify(step.action)} observation=${step.observation}`),
    "",
    "工具结果:",
    ...input.toolResults.map((item, index) => `${index + 1}. ${JSON.stringify(item)}`),
  ].join("\n");
}

async function generateNewExperienceDoc(input: ExperienceWriteInput): Promise<string> {
  const prompt = [
    "你是经验文档整理助手。",
    "请生成一个 Markdown 文档，重点总结失败教训、避坑、适用条件，同时保留必要操作步骤。",
    "输出格式必须包含 YAML frontmatter。",
    "",
    buildExecutionSummary(input),
    "",
    "输出模板要求：",
    "---",
    `type: experience`,
    `intent: ${input.intent}`,
    "keywords:",
    "  - 关键词1",
    "  - 关键词2",
    "---",
    "# 标题",
    "## 背景",
    "## 关键步骤",
    "## 失败教训与避坑",
    "## 适用条件",
  ].join("\n");

  const config = loadLlmAgentConfig();
  return callChatModel(prompt, "你负责生成结构化经验文档。", config);
}

async function updateExistingExperienceDoc(existingDoc: string, input: ExperienceWriteInput): Promise<string> {
  const prompt = [
    "你是经验文档更新助手。",
    "请在尽量保留原文结构的前提下更新这份经验文档。",
    "优先补充失败教训、避坑、适用条件；如果原文已有相关章节，请直接修改细节，不要重复堆叠。",
    "只有在无法自然融入时，才追加新的小节。",
    "",
    "现有文档：",
    existingDoc,
    "",
    "新的执行信息：",
    buildExecutionSummary(input),
  ].join("\n");

  const config = loadLlmAgentConfig();
  return callChatModel(prompt, "你负责更新经验文档，输出完整的新文档内容。", config);
}

function fallbackAppend(existingDoc: string, input: ExperienceWriteInput): string {
  return [
    existingDoc.trim(),
    "",
    "## 补充记录",
    buildExecutionSummary(input),
  ].join("\n");
}

export async function writeExperience(input: ExperienceWriteInput): Promise<{ experiencePath: string; successPathData: { intent: string; actions: ToolAction[] } }> {
  const filePath = getExperiencePath(input.intent);

  if (checkExperienceExists(input.intent)) {
    const existingDoc = readFileSync(filePath, "utf-8");
    try {
      const updated = await updateExistingExperienceDoc(existingDoc, input);
      writeFileSync(filePath, updated, "utf-8");
    } catch {
      writeFileSync(filePath, fallbackAppend(existingDoc, input), "utf-8");
    }
  } else {
    const generated = await generateNewExperienceDoc(input);
    writeFileSync(filePath, generated, "utf-8");
  }

  return {
    experiencePath: filePath,
    successPathData: {
      intent: input.intent,
      actions: input.toolResults
        .filter((item) => item.success)
        .map((item) => {
          const tool = typeof item.tool === "string" ? item.tool : "";
          const action = typeof item.action === "string" ? item.action : "";
          if (!tool || !action) return null;
          const params = typeof item.data === "object" && item.data !== null && "params" in item.data
            ? (item.data as { params?: Record<string, unknown> | null }).params ?? undefined
            : undefined;
          return { tool, action, params } as ToolAction;
        })
        .filter((item): item is ToolAction => Boolean(item)),
    },
  };
}

export { checkExperienceExists, intentToFilename };
