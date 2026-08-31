import { stat } from "fs/promises";
import { resolve } from "path";
import {
  loadModelsWithCache,
  withSafeModelLoadFailure,
  type ModelsData,
} from "@/lib/models-cache";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";
import { loadModels } from "@/lib/models-lib";

export const dynamic = "force-dynamic";

const EMPTY_MODELS: ModelsData = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
  thinkingLevelPins: {},
};

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
    const data = await loadModelsWithCache(cwd, () => loadModels(cwd, tenantId));
    return Response.json(toPicoModelShape(data));
  } catch {
    return Response.json(withSafeModelLoadFailure(EMPTY_MODELS));
  }
}

// 把 pi 的 models 数据转换成 PicoClaw 前端期望的 ModelInfo 列表形状
function toPicoModelShape(
  data: ModelsData,
): {
  models: Record<string, string>;
  modelList: { id: string; name: string; provider: string }[];
  defaultModel: { provider: string; modelId: string } | null;
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
  const { modelList, defaultModel } = data;
  const picoModels = modelList.map((m, index) => ({
    index,
    model_name: m.name || m.id,
    provider: m.provider,
    model: m.id,
    api_base: "",
    api_key: "",
    auth_method: "configured",
    enabled: true,
    available: true,
    status: "available" as const,
    is_default:
      defaultModel != null &&
      defaultModel.provider === m.provider &&
      defaultModel.modelId === m.id,
    is_virtual: false,
  }));
  // default_model 用显示名(与 model_name 对齐,前端拿它匹配当前默认)
  const defaultModelName =
    defaultModel != null
      ? (modelList.find(
          (m) =>
            m.provider === defaultModel.provider && m.id === defaultModel.modelId,
        )?.name ?? defaultModel.modelId)
      : "";
  return {
    ...data,
    pico: {
      models: picoModels,
      total: picoModels.length,
      default_model: defaultModelName,
      default_provider: defaultModel?.provider ?? "",
      fallback_chain: [],
    },
  };
}
