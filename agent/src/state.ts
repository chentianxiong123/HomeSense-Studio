import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

export interface ToolAction {
  tool: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface IntentSchema {
  schemaVersion: "v0";
  intent: string;
  target?: {
    domain?: string;
    device?: string;
    room?: string;
    app?: string;
    element?: string;
  };
  operation?: {
    action?: string;
    value?: string | number | boolean;
    mode?: string;
  };
  context?: {
    recentMentionedDevices?: Array<{ device: string; score: number }>;
    scene?: string;
    platform?: "tv" | "phone" | "speaker" | "home" | "unknown";
  };
  constraints?: {
    requiresVision?: boolean;
    requiresConfirmation?: boolean;
    latencySensitive?: boolean;
  };
  candidates?: Array<{
    source: string;
    score: number;
    note?: string;
  }>;
  rawInput: string;
}

export interface ToolResult {
  tool: string;
  action: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface StageResult {
  schemaVersion: "v0";
  ok: boolean;
  stage: string;
  next: string;
  message?: string;
  reason?: string;
  confidence?: number;
  intent?: IntentSchema;
  actions?: ToolAction[];
  data?: Record<string, unknown>;
  meta?: {
    source?: string;
    latencyMs?: number;
    version?: string;
    trace?: Record<string, unknown>;
    skillsHint?: string[];
  };
}

export interface StageTraceEntry {
  stage: string;
  ok: boolean;
  next: string;
  message?: string;
  reason?: string;
  confidence?: number;
}

export interface Rule {
  pattern: string;
  patternType: "exact" | "regex" | "contains";
  actions: ToolAction[];
}

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    default: () => [],
    reducer: (curr, next) => [...curr, ...next],
  }),
  input: Annotation<string>({
    default: () => "",
    reducer: (_, next) => next,
  }),
  currentStage: Annotation<string>({
    default: () => "context_builder",
    reducer: (_, next) => next,
  }),
  context: Annotation<Record<string, unknown>>({
    default: () => ({}),
    reducer: (_, next) => next,
  }),
  stageResult: Annotation<StageResult | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
  stageTrace: Annotation<StageTraceEntry[]>({
    default: () => [],
    reducer: (curr, next) => [...curr, ...next],
  }),
  ruleMatched: Annotation<boolean>({
    default: () => false,
    reducer: (_, next) => next,
  }),
  ruleActions: Annotation<ToolAction[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),
  intent: Annotation<IntentSchema | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
  intentConfidence: Annotation<number>({
    default: () => 0,
    reducer: (_, next) => next,
  }),
  needsToolExecution: Annotation<boolean>({
    default: () => false,
    reducer: (_, next) => next,
  }),
  toolResults: Annotation<ToolResult[]>({
    default: () => [],
    reducer: (curr, next) => [...curr, ...next],
  }),
  writeBackResults: Annotation<Record<string, unknown>[]>({
    default: () => [],
    reducer: (curr, next) => [...curr, ...next],
  }),
  llmData: Annotation<Record<string, unknown> | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
  toolFailureAttribution: Annotation<Record<string, unknown> | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
  resolutionSource: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
  finalResponse: Annotation<string>({
    default: () => "",
    reducer: (_, next) => next,
  }),
  error: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
});

export type RuleAction = ToolAction;

export function toTraceEntry(result: StageResult): StageTraceEntry {
  return {
    stage: result.stage,
    ok: result.ok,
    next: result.next,
    message: result.message,
    reason: result.reason,
    confidence: result.confidence,
  };
}

export function createStageResult(result: Omit<StageResult, "schemaVersion">): StageResult {
  return {
    schemaVersion: "v0",
    ...result,
  };
}

export function createIntent(
  input: string,
  intent: string,
  action?: string,
  context?: IntentSchema["context"],
): IntentSchema {
  return {
    schemaVersion: "v0",
    intent,
    operation: action ? { action } : undefined,
    context,
    rawInput: input,
  };
}

export function createFallbackReply(input: string): string {
  return `暂时还没学会处理“${input}”，我先记下这个需求。`;
}
