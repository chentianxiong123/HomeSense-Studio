// v5 Phase 1.2 — per-tenant 路径解析（v3 蓝图 §5.4）。
//
// v3 蓝图白纸黑字：data/tenants/<tenantId>/{timeline.db, .homesense/agent/{models,auth,settings,memory,sessions,skills,...}}
// 每租户一个 SQLite 文件 + 各自的工作区。物理隔离,删租户 = 删目录。
//
// 绝不兜底 default tenant——所有路径都从 tenantId 派生。

import path from "node:path"

const DATA_ROOT = process.env.HOMESENSE_DATA_ROOT || path.resolve(process.cwd(), "data")

/** per-tenant 根目录：data/tenants/<tenantId>/ */
export function getTenantRoot(tenantId: string): string {
  if (!tenantId || typeof tenantId !== "string") {
    throw new Error("getTenantRoot: tenantId is required")
  }
  return path.join(DATA_ROOT, "tenants", tenantId)
}

/** per-tenant agent 工作区：data/tenants/<tenantId>/.homesense/agent */
export function getTenantAgentDir(tenantId: string): string {
  if (!tenantId) throw new Error("getTenantAgentDir: tenantId is required")
  return path.join(getTenantRoot(tenantId), ".homesense", "agent")
}

/** 兼容旧名(老 caller 引用) */
export function resolveTenantAgentDir(tenantId: string): string {
  return getTenantAgentDir(tenantId)
}

/** per-tenant 时间线 SQLite：data/tenants/<tenantId>/timeline.db */
export function getTenantTimelineDbPath(tenantId: string): string {
  return path.join(getTenantRoot(tenantId), "timeline.db")
}

/** per-tenant models.json */
export function getTenantModelsConfigPath(tenantId: string): string {
  return path.join(getTenantAgentDir(tenantId), "models.json")
}

/** per-tenant auth.json */
export function getTenantAuthPath(tenantId: string): string {
  return path.join(getTenantAgentDir(tenantId), "auth.json")
}

/** per-tenant settings.json */
export function getTenantSettingsPath(tenantId: string): string {
  return path.join(getTenantAgentDir(tenantId), "settings.json")
}

/** per-tenant agents/settings.json */
export function getTenantSubagentSettingsPath(tenantId: string): string {
  return path.join(getTenantAgentDir(tenantId), "agents", "settings.json")
}

/** per-tenant memory 目录：MEMORY.md / USER.md */
export function getTenantMemoryDir(tenantId: string): string {
  return path.join(getTenantAgentDir(tenantId), "memories")
}

export function getTenantMemoryFile(tenantId: string): string {
  return path.join(getTenantMemoryDir(tenantId), "MEMORY.md")
}

export function getTenantUserFile(tenantId: string): string {
  return path.join(getTenantMemoryDir(tenantId), "USER.md")
}

/** per-tenant sessions 目录 */
export function getTenantSessionsDir(tenantId: string): string {
  return path.join(getTenantAgentDir(tenantId), "sessions")
}

/** per-tenant skills 目录 */
export function getTenantSkillsDir(tenantId: string): string {
  return path.join(getTenantAgentDir(tenantId), "skills")
}
