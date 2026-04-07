import type { ToolResult, ToolAction } from "../state.js";
import { ruleEngineTool } from "./rule_engine/tool.js";
import { memoryTool } from "./memory/tool.js";
import { adbTool } from "./adb/wrapper.js";
import { hamiTool } from "./hami/wrapper.js";
import { successPathsTool } from "./success_paths/tool.js";
import { webSearchTool } from "./web_search/tool.js";
import { localIntentTool } from "./local_intent/tool.js";
import { llmAgentTool } from "./llm_agent/tool.js";

export const allTools = [
  ruleEngineTool,
  memoryTool,
  adbTool,
  hamiTool,
  successPathsTool,
  webSearchTool,
  localIntentTool,
  llmAgentTool,
] as const;

export function getTool(name: string) {
  return allTools.find((t) => t.name === name);
}

export function isValidToolAction(action: unknown): action is ToolAction {
  if (!action || typeof action !== "object") return false;
  const candidate = action as Record<string, unknown>;
  return typeof candidate.tool === "string"
    && candidate.tool.length > 0
    && typeof candidate.action === "string"
    && candidate.action.length > 0
    && getTool(candidate.tool) !== undefined
    && (candidate.params === undefined || (typeof candidate.params === "object" && candidate.params !== null && !Array.isArray(candidate.params)));
}

export async function executeToolAction(action: ToolAction): Promise<ToolResult> {
  const tool = getTool(action.tool);
  if (!tool) {
    return {
      tool: action.tool,
      action: action.action,
      success: false,
      error: `Tool not found: ${action.tool}`,
    };
  }

  try {
    const input = { action: action.action, ...action.params };
    const result = await (tool as { invoke: (input: Record<string, unknown>) => Promise<unknown> }).invoke(input);
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    const success = typeof parsed?.success === "boolean" ? parsed.success : true;
    return {
      tool: action.tool,
      action: action.action,
      success,
      data: parsed,
      error: success ? undefined : (parsed?.error ?? parsed?.message ?? "Tool execution failed"),
    };
  } catch (error) {
    return { tool: action.tool, action: action.action, success: false, error: String(error) };
  }
}

export async function toolNode(state: typeof import("../state.js").AgentState.State): Promise<Partial<typeof import("../state.js").AgentState.State>> {
  const actions = state.ruleActions;
  const results: ToolResult[] = [];

  for (const action of actions) {
    const result = await executeToolAction(action);
    results.push(result);
  }

  const successCount = results.filter((r) => r.success).length;
  const finalResponse =
    successCount === results.length
      ? `成功执行 ${results.length} 个操作`
      : `执行完成：${successCount}/${results.length} 成功`;

  return { toolResults: results, finalResponse, needsToolExecution: false };
}

export {
  ruleEngineTool,
  memoryTool,
  adbTool,
  hamiTool,
  successPathsTool,
  webSearchTool,
  localIntentTool,
  llmAgentTool,
};
