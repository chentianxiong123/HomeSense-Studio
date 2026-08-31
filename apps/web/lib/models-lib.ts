// 共享:加载可见模型列表(含默认模型解析)。
// 被 /api/models 和 /api/models/default-chain 复用。
//
// 模型配置(admin 在 /admin 维护的 models.json)全局共享,用 getAgentDir();
// 用户偏好(默认模型)按租户隔离,settingsManager 用 per-tenant agentDir。

import { createAgentSessionServices, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { withModelRuntimeError, type ModelsData } from "@/lib/models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "@/lib/model-scope";
import { projectTrustReloadOptions } from "@/lib/project-trust";
import { resolveTenantAgentDir } from "@/lib/tenant-paths";
import { getTenant } from "@/lib/tenant-store";
import { getRpcSession } from "@/lib/rpc-manager";

export class ModelNotFoundError extends Error {}

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string }
): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

export async function loadModels(cwd: string, tenantId?: string): Promise<ModelsData> {
  const nameMap = new Map<string, string>();
  let modelList: { id: string; name: string; provider: string }[] = [];
  let defaultModel: { provider: string; modelId: string } | null = null;
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};

  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(
    cwd,
    resolveTenantAgentDir(tenantId),
  );
  const trustReloadOptions = projectTrustReloadOptions(cwd, agentDir);
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager,
    ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
  });
  const modelError = services.modelRuntime.getError();
  const settings: SettingsManager = services.settingsManager;
  const scope = await resolveVisibleModels(
    services.modelRuntime,
    settings.getEnabledModels(),
  );
  const { visible, thinkingLevelPins, warnings } = scope;
  modelList = visible.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
  })).sort(compareModelEntries);
  for (const m of visible) {
    const key = `${m.provider}:${m.id}`;
    nameMap.set(key, m.name);
    thinkingLevels[key] = getSupportedThinkingLevels(m);
    if (m.thinkingLevelMap) thinkingLevelMaps[key] = m.thinkingLevelMap;
  }

  const defaultProvider = settings.getDefaultProvider();
  const defaultModelId = settings.getDefaultModel();
  const initial = selectInitialModelScope(scope, {
    ...(defaultProvider && defaultModelId
      ? { defaultModel: { provider: defaultProvider, modelId: defaultModelId } }
      : {}),
  });
  if (initial.model) {
    defaultModel = { provider: initial.model.provider, modelId: initial.model.id };
  }

  return withModelRuntimeError(
    {
      models: Object.fromEntries(nameMap),
      modelList,
      defaultModel,
      thinkingLevels,
      thinkingLevelMaps,
      thinkingLevelPins,
      ...(warnings.length > 0 ? { modelScopeWarnings: warnings } : {}),
    },
    modelError,
  );
}

/**
 * 设置租户默认模型(写 per-tenant settings.json),并立即热切换到运行中的 session。
 * /api/models/default 与 /api/models/default-chain 共用此逻辑(统一入口)。
 */
export async function setTenantDefaultModel(
  tenantId: string,
  modelName: string,
): Promise<{ default_model: string; provider: string; hotSwitched: boolean }> {
  const cwd = process.cwd();
  const data = await loadModels(cwd, tenantId);
  const target = data.modelList.find(
    (m) => (m.name || m.id) === modelName || m.id === modelName,
  );
  if (!target) {
    throw new ModelNotFoundError(`模型不存在: ${modelName}`);
  }

  const settingsManager = SettingsManager.create(
    cwd,
    resolveTenantAgentDir(tenantId),
  );
  settingsManager.setDefaultModelAndProvider(target.provider, target.id);
  await settingsManager.flush();

  // 热切换:把新模型推给该租户正在运行的 session。pi 单进程多 session、
  // 每个 session 各自带模型,set_model RPC 就是运行时换模型的现成入口。
  let hotSwitched = false;
  const tenant = getTenant(tenantId);
  const sessionId = tenant?.activeSessionId ?? null;
  if (sessionId) {
    const existing = getRpcSession(sessionId);
    if (existing?.isAlive()) {
      hotSwitched = await existing
        .send({ type: "set_model", provider: target.provider, modelId: target.id })
        .then(() => true)
        .catch((err) => {
          console.error(`[hot-switch] 热切换 ${target.provider}/${target.id} 失败:`, err);
          return false;
        });
    }
  }

  return {
    default_model: target.name || target.id,
    provider: target.provider,
    hotSwitched,
  };
}
