import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

export interface ToolAction {
  tool: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface CapabilityCommandV0 {
  schemaVersion: "command_v0";
  commandId: string;
  capability: string;
  target?: {
    domain?: "tv" | "speaker" | "home" | "phone" | "agent" | "memory" | "unknown";
    device?: string;
    room?: string;
    app?: string;
    element?: string;
  };
  operation?: {
    name?: string;
    value?: string | number | boolean;
    mode?: string;
  };
  input?: Record<string, unknown>;
  execution?: {
    preferredTool?: string;
    fallbackTools?: string[];
    timeoutMs?: number;
    requiresVision?: boolean;
    requiresConfirmation?: boolean;
    riskLevel?: "low" | "medium" | "high";
  };
  context?: {
    sourceStage?: string;
    sourceIntent?: string;
    sourceSkillRefs?: string[];
    sourceTraceId?: string;
  };
  metadata?: Record<string, unknown>;
}

export type WorkflowNodeTypeV0 =
  | "start"
  | "capability"
  | "condition"
  | "approval"
  | "fallback"
  | "parallel"
  | "merge"
  | "observe"
  | "reflect"
  | "end";

export interface WorkflowNodeV0 {
  nodeId: string;
  type: WorkflowNodeTypeV0;
  label: string;
  description?: string;
  capability?: string;
  command?: Partial<CapabilityCommandV0>;
  config?: Record<string, unknown>;
  policy?: {
    riskLevel?: "low" | "medium" | "high";
    requiresApproval?: boolean;
    allowFallback?: boolean;
    timeoutMs?: number;
  };
  debug?: {
    showInTrace?: boolean;
    collapseByDefault?: boolean;
  };
}

export interface WorkflowEdgeV0 {
  edgeId: string;
  from: string;
  to: string;
  when?: {
    result?: "success" | "failure" | "timeout" | "blocked";
    expression?: string;
  };
  label?: string;
}

export interface WorkflowV0 {
  schemaVersion: "workflow_v0";
  workflowId: string;
  name: string;
  description?: string;
  goal?: string;
  inputs?: Array<{
    name: string;
    type: "string" | "number" | "boolean" | "object" | "array";
    required?: boolean;
    description?: string;
  }>;
  nodes: WorkflowNodeV0[];
  edges: WorkflowEdgeV0[];
  metadata?: {
    source?: "human_authored" | "ai_drafted" | "self_orchestrated";
    tags?: string[];
    createdBy?: string;
  };
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
  commands?: CapabilityCommandV0[];
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

export interface ExperienceDoc {
  type: "experience";
  intent: string;
  keywords: string[];
  title: string;
  content: string;
  filePath?: string;
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
  completedInput: Annotation<string>({
    default: () => "",
    reducer: (_, next) => next,
  }),
  currentStage: Annotation<string>({
    default: () => "intent_router",
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
  registryDebug: Annotation<Record<string, unknown> | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
  commandSummary: Annotation<Record<string, unknown>[]>({
    default: () => [],
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
  reactSteps: Annotation<Array<{thought: string; action: ToolAction | null; observation: string}>>({
    default: () => [],
    reducer: (curr, next) => {
      const items = Array.isArray(next) ? next : [next];
      return [...curr, ...items];
    },
  }),
  isComplete: Annotation<boolean>({
    default: () => false,
    reducer: (_, next) => next,
  }),
  matchedExperience: Annotation<ExperienceDoc | undefined>({
    default: () => undefined,
    reducer: (_, next) => next,
  }),
  loadedSkills: Annotation<string[]>({
    default: () => [],
    reducer: (_, next) => next,
  }),
  autoExecutePath: Annotation<boolean>({
    default: () => false,
    reducer: (_, next) => next,
  }),
});

export type RuleAction = ToolAction;

export function createCapabilityCommand(command: Omit<CapabilityCommandV0, "schemaVersion">): CapabilityCommandV0 {
  return {
    schemaVersion: "command_v0",
    ...command,
  };
}

export function createWorkflowV0(workflow: Omit<WorkflowV0, "schemaVersion">): WorkflowV0 {
  return {
    schemaVersion: "workflow_v0",
    ...workflow,
  };
}

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
