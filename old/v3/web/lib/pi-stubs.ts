// v5 砍掉 pi 依赖:本地类型桩
// 原 pi-types.ts + 散落在各文件的 pi-agent-core / pi-ai / pi-coding-agent 类型
// 这里统一定义,其它文件从这里导入。
//
// 任何仍然引用真实 pi 包的代码都应该改成本地桩,或者删除(如果 Go 后端已经接管)。

// ==================== 基础类型 ====================

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh"

export interface TextContent {
  type: "text"
  text: string
}

export interface ImageContent {
  type: "image"
  data: string
  mimeType: string
}

// ==================== pi-ai (Model / Api / Credential) ====================

export type Credential =
  | { type: "api_key"; key: string }
  | { type: "oauth"; access: string; refresh: string; expires: number }
  | { type: "wellknown"; key: string; [k: string]: unknown }

export interface Model {
  id: string
  name: string
  provider: string
  api?: string
  baseUrl?: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number }
  [k: string]: unknown
}

export interface Api {
  id: string
  baseUrl: string
  apiKey: string
  [k: string]: unknown
}

export function Type<T>(): T {
  throw new Error("Type<T>() 是 pi-ai 的 schema 桩,Go 后端接管后不再使用")
}

// ==================== pi-agent-core (AgentMessage / AgentLoopTurnUpdate) ====================

export interface AgentMessage {
  role: "user" | "assistant" | "tool" | "system"
  content: TextContent[] | ImageContent[] | (TextContent | ImageContent)[] | string
  [k: string]: unknown
}

export interface AgentLoopTurnUpdate {
  reason?: string
  [k: string]: unknown
}

export interface PrepareNextTurnContext {
  [k: string]: unknown
}

// ==================== pi-coding-agent (SessionManager / SettingsManager / Theme 等) ====================

export interface SessionManager {
  getSession(sessionId: string): Promise<unknown | null>
  listSessions(): Promise<unknown[]>
  appendEntry(entry: unknown): Promise<void>
  [k: string]: unknown
}

export interface SettingsManager {
  getDefaultProvider(): string | undefined
  setDefaultProvider(provider: string): void
  getDefaultModel(): string | undefined
  setDefaultModel(model: string): void
  getDefaultThinkingLevel(): ThinkingLevel | undefined
  setDefaultThinkingLevel(level: ThinkingLevel | undefined): void
  getEnabledModels(): string[] | undefined
  setEnabledModels(models: string[] | undefined): void
  flush(): Promise<void>
  [k: string]: unknown
}

export interface Theme {
  name: string
  [k: string]: unknown
}

export interface ModelRuntime {
  getModel(provider: string, modelId: string): Model | undefined
  refresh(options?: { allowNetwork?: boolean }): Promise<unknown>
  getError(): { message: string } | undefined
  [k: string]: unknown
}

export interface BashOperations {
  [k: string]: unknown
}

export interface SlashCommandInfo {
  name: string
  description?: string
  sourceInfo?: unknown
}

export interface AgentSessionEvent {
  type: string
  [k: string]: unknown
}

export interface ScopedModel {
  model: Model
  [k: string]: unknown
}

export interface ResourceDiagnostic {
  [k: string]: unknown
}

export interface AuthEvent {
  type: string
  [k: string]: unknown
}

export interface AuthPrompt {
  [k: string]: unknown
}

// 工具函数桩
export function getAgentDir(): string {
  throw new Error("getAgentDir() 已废弃,使用 getTenantAgentDir(tenantId)")
}

export function createAgentSessionServices(_opts: unknown): Promise<{
  modelRuntime: ModelRuntime
  settingsManager: SettingsManager
  [k: string]: unknown
}> {
  throw new Error("createAgentSessionServices() 已废弃,Go 后端接管 agent 会话")
}

export function createAgentSessionFromServices(_opts: unknown): Promise<unknown> {
  throw new Error("createAgentSessionFromServices() 已废弃,Go 后端接管 agent 会话")
}

export function initTheme(_opts?: unknown): void {
  // noop
}

export function resolveModelScopeWithDiagnostics(_runtime: ModelRuntime, _enabled?: string[]) {
  return { visible: [] as Model[], warnings: [] as string[] }
}

export function getSupportedThinkingLevels(_model: Model): ThinkingLevel[] {
  return ["off", "low", "medium", "high"]
}

export function hasTrustRequiringProjectResources(_dir: string): boolean {
  return false
}

export class ProjectTrustStore {
  constructor(_opts?: unknown) {}
}

export class DefaultResourceLoader {
  constructor(_opts?: unknown) {}
  getSkills() { return { skills: [] as Array<{ name: string; description?: string; sourceInfo?: unknown }> } }
  getAgentsFiles() { return { agentsFiles: [] as Array<{ path: string; content: string }> } }
}

export function parseFrontmatter<T = unknown>(text: string): { data: T; content: string } {
  // 简单 frontmatter 解析
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { data: {} as T, content: text }
  try {
    const data = require("js-yaml").load(match[1]) as T
    return { data, content: match[2] }
  } catch {
    return { data: {} as T, content: match[2] }
  }
}

export function getPackageDir(_pkg: string): string {
  throw new Error("getPackageDir() 已废弃")
}

export class KeybindingsManager {}
export const TUI_KEYBINDINGS: unknown = {}

// ==================== 原 pi-types.ts 本地接口 ====================

export interface ContextUsage {
  percent: number | null
  contextWindow: number
  tokens: number | null
}

export interface ModelLike {
  id: string
  provider: string
}

export interface ToolInfo {
  name: string
  description: string
  parameters?: unknown
  promptGuidelines?: string[]
  sourceInfo?: unknown
}

export interface NavigateTreeResult {
  editorText?: string
  cancelled: boolean
  aborted?: boolean
}

export interface SessionStatsInfo {
  sessionFile?: string
  sessionId: string
  sessionName?: string
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  totalMessages: number
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  cost: number
  contextUsage?: ContextUsage
  totalActiveMs?: number
}

export interface ExtensionUiContextLike {
  select(title: string, options: string[], opts?: { signal?: AbortSignal; timeout?: number }): Promise<string | undefined>
  confirm(title: string, message: string, opts?: { signal?: AbortSignal; timeout?: number }): Promise<boolean>
  input(title: string, placeholder?: string, opts?: { signal?: AbortSignal; timeout?: number }): Promise<string | undefined>
  editor(title: string, prefill?: string, opts?: { signal?: AbortSignal; timeout?: number }): Promise<string | undefined>
  notify(message: string, type?: "info" | "warning" | "error"): void
  onTerminalInput(): () => void
  setStatus(key: string, text: string | undefined): void
  setWorkingMessage(message?: string): void
  setWorkingVisible(visible: boolean): void
  setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }): void
  setHiddenThinkingLabel(label?: string): void
  setWidget(key: string, content: string[] | ((...args: never[]) => unknown) | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }): void
  setFooter(factory: unknown): void
  setHeader(factory: unknown): void
  setTitle(title: string): void
  custom<T = unknown>(...args: unknown[]): Promise<T>
  pasteToEditor(text: string): void
  setEditorText(text: string): void
  getEditorText(): string
  addAutocompleteProvider(): void
  setEditorComponent(): void
  getEditorComponent(): undefined
  readonly theme: Theme
  getAllThemes(): unknown[]
  getTheme(name: string): undefined
  setTheme(theme: unknown): { success: boolean; error?: string }
  getToolsExpanded(): boolean
  setToolsExpanded(expanded: boolean): void
}

// ==================== pi 兼容层(已被 pi-types.ts 引用) ====================

export interface AgentSessionLike {
  readonly sessionId: string
  readonly sessionFile: string | undefined
  readonly isStreaming: boolean
  readonly isCompacting: boolean
  readonly autoCompactionEnabled: boolean
  readonly autoRetryEnabled: boolean
  readonly model: { id: string; provider: string } | undefined
  readonly modelRuntime: ModelRuntime
  readonly sessionManager: SessionManager
  readonly settingsManager: SettingsManager
  readonly agent: {
    state?: {
      systemPrompt?: string
      thinkingLevel?: string
      streamingMessage?: AgentMessage
    }
    prepareNextTurnWithContext?: (
      context: PrepareNextTurnContext,
      signal?: AbortSignal,
    ) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined
  }
  readonly extensionRunner: {
    getRegisteredCommands(): Array<{
      invocationName: string
      description?: string
      sourceInfo?: unknown
    }>
    emit?(event: { type: "session_shutdown"; reason: "quit" }): Promise<unknown>
    setUIContext?(uiContext?: unknown, mode?: "tui" | "rpc" | "json" | "print"): void
  }
  readonly promptTemplates: ReadonlyArray<{ name: string; description?: string; sourceInfo?: unknown }>
  readonly resourceLoader: {
    getSkills(): { skills: Array<{ name: string; description?: string; sourceInfo?: unknown }> }
    getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> }
  }

  dispose(): void
  reload(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void>
  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  prompt(text: string, options?: {
    images?: Array<{ type: "image"; data: string; mimeType: string }>
    streamingBehavior?: "steer" | "followUp"
    source?: "interactive" | "rpc"
    preflightResult?: (success: boolean) => void
  }): Promise<void>
  sendCustomMessage<T = unknown>(message: {
    customType: string
    content: string | (TextContent | ImageContent)[]
    display: boolean
    details?: T
  }, options?: {
    triggerTurn?: boolean
    deliverAs?: "steer" | "followUp" | "nextTurn"
  }): Promise<void>
  abort(): Promise<void>
  executeBash(command: string, onChunk?: (chunk: string) => void, options?: {
    excludeFromContext?: boolean
    operations?: BashOperations
  }): Promise<{ output: string; exitCode?: number; cancelled?: boolean; truncated?: boolean; fullOutputPath?: string }>
  abortBash(): void
  readonly isBashRunning: boolean
  setModel(model: { id: string; provider: string }): Promise<void>
  navigateTree(targetId: string, options?: { summarize?: boolean }): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean }>
  setThinkingLevel(level: string): void
  compact(customInstructions?: string): Promise<unknown>
  setSessionName(name: string): void
  getSessionStats(): {
    sessionFile?: string
    sessionId: string
    userMessages: number
    assistantMessages: number
    toolCalls: number
    toolResults: number
    totalMessages: number
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
    cost: number
    contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null }
    totalActiveMs?: number
  }
  getLastAssistantText(): string | undefined
  setAutoCompactionEnabled(enabled: boolean): void
  setAutoRetryEnabled(enabled: boolean): void
  steer(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void>
  followUp(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void>
  readonly pendingMessageCount: number
  getSteeringMessages(): readonly string[]
  getFollowUpMessages(): readonly string[]
  clearQueue(): { steering: string[]; followUp: string[] }
  getAllTools(): Array<{ name: string; description: string; parameters?: unknown; promptGuidelines?: string[]; sourceInfo?: unknown }>
  getActiveToolNames(): string[]
  setActiveToolsByName(names: string[]): void
  abortCompaction(): void
  getContextUsage(): { percent: number | null; contextWindow: number; tokens: number | null } | undefined
}
