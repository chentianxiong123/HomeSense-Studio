import { existsSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { EXPERIENCES_DIR, ensureExperiencesDir } from "../experience_retrieval/tool.js";
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

function checkExperienceExists(intent: string): boolean {
  const dir = ensureExperiencesDir();
  const filename = intentToFilename(intent);
  return existsSync(join(dir, filename));
}

async function generateExperienceDoc(input: ExperienceWriteInput): Promise<string> {
  const prompt = `你是一个经验总结助手。请根据以下成功执行记录，生成一份结构化的经验文档。

用户原始输入: ${input.input}
补全后输入: ${input.completedInput}
标准化意图: ${input.intent}

执行步骤:
${input.reactSteps.map((step, i) => `${i + 1}. 思考: ${step.thought}\n   动作: ${JSON.stringify(step.action)}\n   观察: ${step.observation}`).join("\n")}

工具执行结果:
${input.toolResults.map((r, i) => `${i + 1}. ${JSON.stringify(r)}`).join("\n")}

请生成以下格式的经验文档（YAML frontmatter + Markdown）:

---
type: experience
intent: ${input.intent}
keywords:
  - 关键词1
  - 关键词2
  - 关键词3
---

# 经验：简短标题

## 背景
描述用户的需求背景

## 执行步骤
1. 步骤1描述
2. 步骤2描述
...

## 关键参数
- 参数1: 值1
- 参数2: 值2

## 注意事项
- 注意点1
- 注意点2

请直接输出文档内容，不要添加额外说明。`;

  const config = loadLlmAgentConfig();
  const response = await callChatModel(prompt, "你是经验总结助手。", config);
  return response;
}

export async function writeExperience(input: ExperienceWriteInput): Promise<{ experiencePath: string; successPathData: { intent: string; actions: ToolAction[] } }> {
  const dir = ensureExperiencesDir();

  if (checkExperienceExists(input.intent)) {
    return {
      experiencePath: join(dir, intentToFilename(input.intent)),
      successPathData: {
        intent: input.intent,
        actions: input.reactSteps
          .filter((step) => step.action)
          .map((step) => step.action as ToolAction),
      },
    };
  }

  const docContent = await generateExperienceDoc(input);
  const filename = intentToFilename(input.intent);
  const filePath = join(dir, filename);
  writeFileSync(filePath, docContent, "utf-8");

  const successPathData = {
    intent: input.intent,
    actions: input.reactSteps
      .filter((step) => step.action)
      .map((step) => step.action as ToolAction),
  };

  return { experiencePath: filePath, successPathData };
}

export { checkExperienceExists, intentToFilename };
