// HomeSense v3 — per-tenant agent 根目录解析(共享 helper)
//
// 模型配置(models.json)由管理员在全局 ~/.homesense/agent/ 统一维护,所有用户共享;
// 但每个用户的偏好设置(默认模型等)写在各自租户目录
// data/<tenantId>/.homesense/agent/settings.json,互相隔离。
//
// 必须跟 rpc-manager.ts / session-reader.ts / memory-store.ts 同源。

import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export function resolveTenantAgentDir(tenantId?: string): string {
  if (!tenantId || tenantId === "default") {
    return getAgentDir();
  }
  // 跟 apps/web 是 cwd 假设一致(data/ 在 apps/web/data/)。
  // 显式绝对路径避免 cwd 变化踩雷。
  return join(process.cwd(), "data", tenantId, ".homesense", "agent");
}
