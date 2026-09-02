import { stat } from "fs/promises";
import { resolve } from "path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";
import { readModelsConfig } from "@/lib/models-config-store";

export const dynamic = "force-dynamic";

const EMPTY_MODELS = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
  thinkingLevelPins: {},
  pico: {
    models: [],
    total: 0,
    default_model: "",
    default_provider: "",
    fallback_chain: [],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(req: Request) {
  const auth = await resolveAuthFromRequest();
  if (!auth) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const tenantId = auth.tenantId;

  const requestedCwd = new URL(req.url).searchParams.get("cwd") || process.cwd();
  const cwd = resolve(requestedCwd);

  let cwdStat;
  try {
    cwdStat = await stat(cwd);
  } catch {
    return Response.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!cwdStat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }
  const allowedRoots = await getAllowedFileRoots(tenantId);
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    return Response.json(toPicoModelShape(readModelsConfig()));
  } catch {
    return Response.json(EMPTY_MODELS);
  }
}

// 把 admin 全局模型池(models.json, readModelsConfig)转换成 PicoClaw 前端期望的 ModelInfo 列表形状。
// 模型全部 available,不按 billing enabled 过滤;defaultModel 恒为 null。
function toPicoModelShape(
  cfg: Record<string, unknown>,
): {
  models: Record<string, string>;
  modelList: { id: string; name: string; provider: string }[];
  defaultModel: null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  thinkingLevelPins: Record<string, string>;
  pico: {
    models: Array<{
      index: number;
      model_name: string;
      provider: string;
      model: string;
      api_base: string;
      api_key: string;
      auth_method: string;
      enabled: boolean;
      available: boolean;
      status: "available" | "unconfigured" | "unreachable";
      is_default: boolean;
      is_virtual: boolean;
    }>;
    total: number;
    default_model: string;
    default_provider: string;
    fallback_chain: string[];
  };
} {
  const providers = isRecord(cfg.providers) ? cfg.providers : {};
  const models: Record<string, string> = {};
  const modelList: { id: string; name: string; provider: string }[] = [];
  for (const [providerId, providerRaw] of Object.entries(providers)) {
    if (!isRecord(providerRaw) || !Array.isArray(providerRaw.models)) continue;
    for (const mRaw of providerRaw.models) {
      if (!isRecord(mRaw) || typeof mRaw.id !== "string") continue;
      const id = mRaw.id.trim();
      if (!id) continue;
      const name =
        typeof mRaw.name === "string" && mRaw.name.trim() ? mRaw.name : id;
      const key = `${providerId}:${id}`;
      models[key] = name;
      modelList.push({ id, name, provider: providerId });
    }
  }
  const picoModels = modelList.map((m, index) => ({
    index,
    model_name: m.name,
    provider: m.provider,
    model: m.id,
    api_base: "",
    api_key: "",
    auth_method: "configured",
    enabled: true,
    available: true,
    status: "available" as const,
    is_default: false,
    is_virtual: false,
  }));
  return {
    models,
    modelList,
    defaultModel: null,
    thinkingLevels: {},
    thinkingLevelMaps: {},
    thinkingLevelPins: {},
    pico: {
      models: picoModels,
      total: picoModels.length,
      default_model: "",
      default_provider: "",
      fallback_chain: [],
    },
  };
}