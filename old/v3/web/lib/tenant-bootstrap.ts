// v5 Phase 1.2 — per-tenant 数据初始化。
//
// 首次访问某租户时,一次性建好:
//   - data/tenants/<tenantId>/timeline.db  (getTenantDb 自动建)
//   - data/tenants/<tenantId>/.homesense/agent/{models.json, auth.json, settings.json}
//   - data/tenants/<tenantId>/.homesense/agent/memories/{MEMORY.md, USER.md}
//   - data/tenants/<tenantId>/.homesense/agent/sessions/
//   - data/tenants/<tenantId>/.homesense/agent/skills/
//
// 保证每租户工作区物理隔离;缺啥补啥,幂等。
//
// ensureActiveSession(tenantId) 保证 tenants.active_session_id 永久维持:
//   - 已有: 直接返回 (永不重建, 聊天永不结束)
//   - 没有: 生成一个 UUID, 写库, 返回
//
// 调用入口: 任何需要 tenant 上下文的 lib 函数(getTimelineDb / getAgentDir 等)
// 的第一行,显式调 ensureTenantData(tenantId) 兜底。

import fs from "node:fs"
import path from "node:path"

import {
  getTenantAgentDir,
  getTenantAuthPath,
  getTenantMemoryDir,
  getTenantMemoryFile,
  getTenantModelsConfigPath,
  getTenantSessionsDir,
  getTenantSettingsPath,
  getTenantSkillsDir,
  getTenantSubagentSettingsPath,
  getTenantUserFile,
} from "./tenant-paths"
import { getIndexDb, getTenant } from "./tenant-store"

let bootstrapCache = new Set<string>()

/** 幂等创建 per-tenant 物理目录 + 占位文件。已建过的直接跳过。 */
export function ensureTenantData(tenantId: string): void {
  if (!tenantId) throw new Error("ensureTenantData: tenantId is required")
  if (bootstrapCache.has(tenantId)) return

  const dirs = [
    path.dirname(getTenantModelsConfigPath(tenantId)),
    getTenantMemoryDir(tenantId),
    getTenantSessionsDir(tenantId),
    getTenantSkillsDir(tenantId),
    path.dirname(getTenantSubagentSettingsPath(tenantId)),
  ]
  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true, mode: 0o700 })
  }

  // 占位文件,首次访问时建空对象
  const emptyJsonFiles = [
    getTenantModelsConfigPath(tenantId),
    getTenantAuthPath(tenantId),
    getTenantSettingsPath(tenantId),
  ]
  for (const p of emptyJsonFiles) {
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, "{}\n", { encoding: "utf-8", mode: 0o600 })
    }
  }

  // memory 占位
  if (!fs.existsSync(getTenantMemoryFile(tenantId))) {
    fs.writeFileSync(
      getTenantMemoryFile(tenantId),
      "# MEMORY\n\n长期记忆,agent 跨会话的笔记。\n",
      { encoding: "utf-8", mode: 0o600 },
    )
  }
  if (!fs.existsSync(getTenantUserFile(tenantId))) {
    fs.writeFileSync(
      getTenantUserFile(tenantId),
      "# USER PROFILE\n\n用户画像。\n",
      { encoding: "utf-8", mode: 0o600 },
    )
  }

  bootstrapCache.add(tenantId)
}

/** 保证 tenants.active_session_id 永久存在。已存在直接返回,绝不重建。 */
export function ensureActiveSession(tenantId: string): string {
  if (!tenantId) throw new Error("ensureActiveSession: tenantId is required")
  const t = getTenant(tenantId)
  if (!t) throw new Error(`租户不存在: ${tenantId}`)
  if (t.activeSessionId) return t.activeSessionId

  const sid = crypto.randomUUID()
  getIndexDb()
    .prepare(`UPDATE tenants SET active_session_id = ? WHERE id = ?`)
    .run(sid, tenantId)
  return sid
}

/** 清缓存(测试用,正常不要调) */
export function _resetBootstrapCache(): void {
  bootstrapCache = new Set()
}
