// Admin page — 维护全局模型配置 (models.json, ~/.homesense/agent/models.json)。
// admin 改完全员立刻能用,普通用户无入口(路由层 beforeLoad 拦截 + 403)。
//
// 现有 models.json schema:
//   { providers: { <providerId>: { name, baseUrl, api, apiKey, models: [{id, name, reasoning, ...}] } } }
// 我们不引入新概念,直接 JSON 增删改覆盖原文件。

import { IconDeviceFloppy, IconPlus, IconShield, IconTrash } from "@tabler/icons-react"
import { useEffect, useState } from "react"

import { PageHeader } from "@pico/components/page-header"
import { Button } from "@pico/components/ui/button"
import { useCurrentUser } from "@pico/hooks/use-current-user"

interface ProviderModel {
  id: string
  name?: string
  reasoning?: boolean
  [k: string]: unknown
}

interface Provider {
  name: string
  baseUrl?: string
  api?: string
  apiKey?: string
  models: ProviderModel[]
  [k: string]: unknown
}

interface ModelsConfig {
  providers: Record<string, Provider>
}

const newId = () => `prov_${Math.random().toString(36).slice(2, 10)}`

export function AdminPage() {
  const { me, loading: meLoading } = useCurrentUser()
  const [cfg, setCfg] = useState<ModelsConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  useEffect(() => {
    if (meLoading) return
    if (me?.user?.role !== "admin") return
    void load()
  }, [me, meLoading])

  async function load() {
    setLoadError(null)
    setSaveMsg(null)
    try {
      const res = await fetch("/api/models-config", { credentials: "same-origin" })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = (await res.json()) as ModelsConfig
      if (!data.providers) data.providers = {}
      setCfg(data)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }

  async function save() {
    if (!cfg) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(cfg),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(err.message || `status ${res.status}`)
      }
      const body = (await res.json().catch(() => ({}))) as {
        sync?: { updated?: string[]; reloaded?: string[]; failed?: { dir: string; error: string }[] }
      }
      const sync = body.sync
      const parts: string[] = []
      if (sync) {
        if (sync.updated?.length) parts.push(`下发 ${sync.updated.length} 个家庭`)
        if (sync.reloaded?.length) parts.push(`热生效 ${sync.reloaded.length} 个`)
        if (sync.failed?.length) parts.push(`失败 ${sync.failed.length}: ${sync.failed.map((f) => f.error).join("; ")}`)
        if (sync.updated?.length === 0) {
          // 没有已分配的租户 brain:模型源已更新,新租户会用它;已分配但失败则提示
          if (!sync.failed?.length) parts.push("模型源已更新(暂无已建家庭,新注册家庭会自动使用)")
        }
      }
      setSaveMsg(parts.length ? `已保存,${parts.join("，")}` : "已保存")
    } catch (e) {
      setSaveMsg(`保存失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  function addProvider() {
    if (!cfg) return
    const id = newId()
    setCfg({
      providers: {
        ...cfg.providers,
        [id]: {
          name: id,
          baseUrl: "https://api.openai.com/v1",
          api: "openai-completions",
          apiKey: "",
          models: [],
        },
      },
    })
  }

  function removeProvider(id: string) {
    if (!cfg) return
    const next = { ...cfg.providers }
    delete next[id]
    setCfg({ providers: next })
  }

  function patchProvider(id: string, patch: Partial<Provider>) {
    if (!cfg) return
    setCfg({
      providers: {
        ...cfg.providers,
        [id]: { ...cfg.providers[id], ...patch },
      },
    })
  }

  function addModel(providerId: string) {
    if (!cfg) return
    const p = cfg.providers[providerId]
    const mid = `model-${p.models.length + 1}`
    patchProvider(providerId, {
      models: [...p.models, { id: mid, name: mid, reasoning: false }],
    })
  }

  function removeModel(providerId: string, idx: number) {
    if (!cfg) return
    const p = cfg.providers[providerId]
    patchProvider(providerId, {
      models: p.models.filter((_, i) => i !== idx),
    })
  }

  function patchModel(providerId: string, idx: number, patch: Partial<ProviderModel>) {
    if (!cfg) return
    const p = cfg.providers[providerId]
    patchProvider(providerId, {
      models: p.models.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
    })
  }

  if (meLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">载入中…</div>
    )
  }
  if (me?.user?.role !== "admin") {
    return (
      <div className="p-6 text-sm text-destructive">
        拒绝访问: 此页面仅管理员可见。
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="管理后台" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
        <div className="flex items-center gap-3 py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconShield className="size-4" />
            <span>admin: {me?.user?.displayName}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={() => void load()} variant="outline" size="sm">
              重新载入
            </Button>
            <Button onClick={() => void save()} disabled={saving || !cfg} size="sm">
              <IconDeviceFloppy className="mr-1 size-4" />
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>

        {loadError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            加载失败: {loadError}
          </div>
        )}
        {saveMsg && (
          <div className="rounded-lg border bg-muted px-4 py-3 text-sm">{saveMsg}</div>
        )}

        {cfg && (
          <div className="space-y-4 py-4">
            {Object.entries(cfg.providers).length === 0 && (
              <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                还没有任何 provider,点下方按钮新增。
              </div>
            )}

            {Object.entries(cfg.providers).map(([pid, p]) => (
              <div key={pid} className="rounded-lg border bg-card p-4">
                <div className="flex items-center gap-2">
                  <input
                    className="rounded border bg-background px-2 py-1 font-mono text-xs"
                    value={pid}
                    readOnly
                    aria-label="provider id"
                  />
                  <input
                    className="flex-1 rounded border bg-background px-2 py-1 text-sm"
                    placeholder="显示名"
                    value={p.name}
                    onChange={(e) => patchProvider(pid, { name: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeProvider(pid)}
                    aria-label="删除 provider"
                  >
                    <IconTrash className="size-4 text-destructive" />
                  </Button>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input
                    className="rounded border bg-background px-2 py-1 text-sm"
                    placeholder="baseUrl"
                    value={p.baseUrl ?? ""}
                    onChange={(e) => patchProvider(pid, { baseUrl: e.target.value })}
                  />
                  <input
                    className="rounded border bg-background px-2 py-1 text-sm"
                    placeholder="api (openai-completions)"
                    value={p.api ?? ""}
                    onChange={(e) => patchProvider(pid, { api: e.target.value })}
                  />
                  <input
                    className="rounded border bg-background px-2 py-1 text-sm"
                    placeholder="apiKey (留空 = 用户 BYO)"
                    value={p.apiKey ?? ""}
                    onChange={(e) => patchProvider(pid, { apiKey: e.target.value })}
                    type="password"
                  />
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    Models ({p.models.length})
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => addModel(pid)}
                      aria-label="新增 model"
                    >
                      <IconPlus className="size-3" />
                    </Button>
                  </div>
                  {p.models.length === 0 && (
                    <div className="text-xs text-muted-foreground">无</div>
                  )}
                  {p.models.map((m, i) => (
                    <div
                      key={`${m.id}-${i}`}
                      className="flex items-center gap-2 rounded border bg-background px-2 py-1"
                    >
                      <input
                        className="flex-1 rounded border bg-card px-2 py-0.5 text-sm"
                        placeholder="model id"
                        value={m.id}
                        onChange={(e) => patchModel(pid, i, { id: e.target.value })}
                      />
                      <input
                        className="flex-1 rounded border bg-card px-2 py-0.5 text-sm"
                        placeholder="显示名"
                        value={m.name ?? ""}
                        onChange={(e) => patchModel(pid, i, { name: e.target.value })}
                      />
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={Boolean(m.reasoning)}
                          onChange={(e) => patchModel(pid, i, { reasoning: e.target.checked })}
                        />
                        reasoning
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeModel(pid, i)}
                        aria-label="删除 model"
                      >
                        <IconTrash className="size-3 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <Button onClick={addProvider} variant="outline" className="w-full">
              <IconPlus className="mr-1 size-4" />
              新增 provider
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
