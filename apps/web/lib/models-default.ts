// v5 pi 移除后的租户默认模型设置（/api/models/default 与 /api/models/default-chain 共用）。
// 模型来源 = admin 全局模型池(models.json, readModelsConfig)。
// 持久化 = 直接把模型 id 写进该租户 Go 网关 config.json 的 agents.defaults.model_name
//          （Go 侧 cfg.Agents.Defaults.GetModelName() 是运行期默认模型的权威源）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { tenantConfigPath } from "@/lib/tenant-brain";
import { readModelsConfig } from "@/lib/models-config-store";
import { getTenant } from "@/lib/tenant-store";

export class ModelNotFoundError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读 admin 全局模型池，返回 [{ id, name, provider }]（name = 显示名）。 */
function listPoolModels(): { id: string; name: string; provider: string }[] {
  const out: { id: string; name: string; provider: string }[] = [];
  const cfg = readModelsConfig();
  const providers = isRecord(cfg.providers) ? cfg.providers : {};
  for (const [providerId, providerRaw] of Object.entries(providers)) {
    if (!isRecord(providerRaw) || !Array.isArray(providerRaw.models)) continue;
    for (const mRaw of providerRaw.models) {
      if (!isRecord(mRaw) || typeof mRaw.id !== "string") continue;
      const id = mRaw.id.trim();
      if (!id) continue;
      const name =
        typeof mRaw.name === "string" && mRaw.name.trim() ? mRaw.name : id;
      out.push({ id, name, provider: providerId });
    }
  }
  return out;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeJson(file: string, data: Record<string, unknown>): void {
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

/** 把租户 Go 网关 config.json 的 agents.defaults.model_name 设为 modelId。租户未分配 gateway 时忽略。 */
function persistTenantDefaultModel(tenantId: string, modelId: string): void {
  const tenant = getTenant(tenantId);
  if (!tenant?.gatewayDir) return;
  const configPath = tenantConfigPath(tenant.gatewayDir);
  const cfg = readJson(configPath);
  if (!cfg) return;

  let agents: Record<string, unknown>;
  if (isRecord(cfg.agents)) {
    agents = cfg.agents;
  } else {
    agents = {};
    cfg.agents = agents;
  }
  let defaults: Record<string, unknown>;
  if (isRecord(agents.defaults)) {
    defaults = agents.defaults;
  } else {
    defaults = {};
    agents.defaults = defaults;
  }
  defaults.model_name = modelId;
  writeJson(configPath, cfg);
}

/**
 * 设置租户默认模型：在 admin 全局模型池里按显示名或 id 校验，
 * 命中后把模型 id 写到该租户 Go 网关 config.json 的 agents.defaults.model_name。
 */
export async function setTenantDefaultModel(
  tenantId: string,
  modelName: string,
): Promise<{ default_model: string; provider: string; hotSwitched: boolean }> {
  const target =
    listPoolModels().find((m) => m.name === modelName || m.id === modelName) ??
    null;
  if (!target) {
    throw new ModelNotFoundError(`模型不存在: ${modelName}`);
  }
  persistTenantDefaultModel(tenantId, target.id);
  return {
    default_model: target.name,
    provider: target.provider,
    hotSwitched: false,
  };
}