// HomeSense v5 — 模型配置下发（admin 保存时把全局模型源同步到所有租户 brain）。
//
// 云服务商视角：admin 在 /admin 维护的 models.json 是"一份配置卖给所有家庭"，
// 包含 provider 的 baseUrl/apiKey/模型清单。这份配置是唯一权威源。
// 保存时：推导 model_list → 写入每个租户 config.json → 对运行中的网关 POST /reload
// 热生效，不重启进程。未运行/未分配 brain 的租户在下次冷启动时由 provision 应用。

import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import type { ModelsConfig } from "@/lib/model-source"
import { deriveModelList, applyModelListToConfig } from "@/lib/model-source"
import { readModelsConfig } from "@/lib/models-config-store"
import { listTenants } from "@/lib/tenant-store"
import { tenantConfigPath } from "@/lib/tenant-brain"

const BRAIN_DATA_DIR = process.env.HS_BRAIN_DATA ?? "/home/a1/HomeSense-Studio-v3/.hs-brain"

export interface SyncModelsResult {
  updated: string[]
  reloaded: string[]
  failed: { dir: string; error: string }[]
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 从 pidfile 读 Go 网关的 reload token。 */
async function readGatewayToken(gatewayDir: string): Promise<string | null> {
  const pidfile = join(BRAIN_DATA_DIR, gatewayDir, ".picoclaw-home", ".picoclaw.pid")
  const data = readJson(pidfile)
  if (!data) return null
  return typeof data.token === "string" ? data.token : null
}

/** 对单个租户网关触发 /reload（热加载新模型配置）。 */
async function reloadGateway(gatewayDir: string, port: number, token: string | null): Promise<boolean> {
  try {
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`http://127.0.0.1:${port}/reload`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 把 admin 的全局模型配置同步到所有已分配 brain 的租户：
 *  1. 推导 model_list（基于 admin 权威 models.json）
 *  2. 写进每个租户的 config.json
 *  3. 对运行中的网关 POST /reload 热生效
 */
export async function syncModelsToAllTenants(): Promise<SyncModelsResult> {
  const cfg = readModelsConfig() as unknown as ModelsConfig
  const entries = deriveModelList(cfg)
  if (entries.length === 0) {
    throw new Error("全局模型配置里没有可用模型（至少需要 provider 里带 baseUrl 的模型）")
  }

  const result: SyncModelsResult = { updated: [], reloaded: [], failed: [] }
  for (const tenant of listTenants()) {
    const dir = tenant.gatewayDir
    if (!dir) continue
    try {
      const { changed } = applyModelListToConfig(tenantConfigPath(dir), entries)
      if (changed) result.updated.push(dir)
      if (tenant.gatewayPort) {
        const token = await readGatewayToken(dir)
        const ok = await reloadGateway(dir, tenant.gatewayPort, token)
        if (ok) result.reloaded.push(dir)
      }
    } catch (e) {
      result.failed.push({ dir, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}