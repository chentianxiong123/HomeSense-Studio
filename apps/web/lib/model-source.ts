// HomeSense v5 — 全局模型源（admin 权威配置）→ Go model_list 的纯函数。
// 无 import（除 node 内置），供 tenant-brain（provision 时应用）和
// model-sync（admin 保存时批量应用）共用，避免循环依赖。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

interface ProviderModel {
  id: string
  name?: string
  reasoning?: boolean
  [k: string]: unknown
}

interface Provider {
  name?: string
  baseUrl?: string
  api?: string
  apiKey?: string
  models: ProviderModel[]
  [k: string]: unknown
}

export interface ModelsConfig {
  providers: Record<string, Provider>
}

export interface GoModelEntry {
  model_name: string
  model: string
  api_base: string
  api_keys: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "")
}

function apiPrefixFor(api: string | undefined): string {
  if (!api) return "openai"
  const name = api.replace(/-completions$/, "").replace(/^openai-/, "openai")
  return name || "openai"
}

/** 读取 admin 维护的全局 models.json（云服务商权威配置）。 */
export function readGlobalModelsConfig(modelsPath: string): ModelsConfig {
  try {
    if (!existsSync(modelsPath)) return { providers: {} }
    return JSON.parse(readFileSync(modelsPath, "utf8")) as ModelsConfig
  } catch {
    return { providers: {} }
  }
}

/** 把 admin 的 models.json 映射成 Go model_list 条目。 */
export function deriveModelList(cfg: ModelsConfig): GoModelEntry[] {
  const entries: GoModelEntry[] = []
  const seen = new Set<string>()
  for (const provider of Object.values(cfg.providers)) {
    if (!isRecord(provider) || !Array.isArray(provider.models)) continue
    const baseUrl = stripTrailingSlash(String(provider.baseUrl ?? "").trim())
    if (!baseUrl) continue
    const apiKeys = typeof provider.apiKey === "string" && provider.apiKey.trim()
      ? [provider.apiKey.trim()]
      : []
    const apiPrefix = apiPrefixFor(typeof provider.api === "string" ? provider.api : undefined)
    for (const model of provider.models) {
      if (!isRecord(model)) continue
      const id = typeof model.id === "string" ? model.id.trim() : ""
      if (!id || seen.has(id)) continue
      seen.add(id)
      entries.push({
        model_name: id,
        model: `${apiPrefix}/${id}`,
        api_base: baseUrl,
        api_keys: apiKeys,
      })
    }
  }
  return entries
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  } catch {
    return null
  }
}

function writeJson(file: string, data: Record<string, unknown>): void {
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2))
}

/** 读租户 config.json，返回其当前 model_list 模型名集合（无文件返回空集）。 */
export function readConfigModelNames(configPath: string): Set<string> {
  const cfg = readJson(configPath)
  if (!cfg || !Array.isArray(cfg.model_list)) return new Set()
  return new Set(
    (cfg.model_list as { model_name?: string }[])
      .map((m) => m.model_name)
      .filter((n): n is string => typeof n === "string"),
  )
}

/** 把全局 style 的 entries 写入单个租户 config.json 的 model_list，保 default。 */
export function applyModelListToConfig(
  configPath: string,
  entries: GoModelEntry[],
): { changed: boolean } {
  const cfg = readJson(configPath)
  if (!cfg) throw new Error(`no config at ${configPath}`)
  const prevList = Array.isArray(cfg.model_list) ? (cfg.model_list as unknown[]) : []
  const oldDefault =
    (cfg.agents as Record<string, any> | undefined)?.defaults?.model_name as string | undefined

  const names = new Set(entries.map((e) => e.model_name))
  const newDefault = oldDefault && names.has(oldDefault) ? oldDefault : (entries[0]?.model_name ?? oldDefault)

  const next = structuredClone(cfg) as Record<string, any>
  next.model_list = entries
  if (next.agents && next.agents.defaults && newDefault) {
    next.agents.defaults.model_name = newDefault
  }
  const changed =
    JSON.stringify(prevList) !== JSON.stringify(entries) || oldDefault !== newDefault
  writeJson(configPath, next)
  return { changed }
}