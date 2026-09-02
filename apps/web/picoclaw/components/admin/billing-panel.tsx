// Admin 计费/钱包面板 — 云平台全栈计费（架构铁律：agent 不算钱）。
// 一屏搞定：模型单价编辑、每租户月度配额、钱包余额/充值、本月用量账本。
// 所有费用 = pico_usage token × 单价，纯 Node 计算。

import {
  IconDeviceFloppy,
  IconRefresh,
  IconWallet,
  IconPlus,
  IconMinus,
} from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@pico/components/ui/button"
import type { UsageSnapshot } from "@/lib/usage"

interface BillingPrices {
  [model: string]: { input: number; output: number }
}
interface MonthlyQuota {
  [tenantId: string]: number
}
interface TenantInfo {
  tenantId: string
  name: string
  gatewayDir: string | null
}
interface BillingResponse {
  config: { model_prices: BillingPrices; monthly_quota: MonthlyQuota }
  tenants: TenantInfo[]
  usage: UsageSnapshot
}

const fmtUsd = (n: number) => `$${(n || 0).toFixed(4)}`
const fmtTokens = (n: number) => (n ? n.toLocaleString("zh-CN") : "0")

interface WalletRow {
  tenantId: string
  balance_usd: number
  monthly_quota: number
  monthly_used_tokens: number
}

export function BillingPanel() {
  const [data, setData] = useState<BillingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [prices, setPrices] = useState<BillingPrices>({})
  const [quota, setQuota] = useState<MonthlyQuota>({})
  const [wallets, setWallets] = useState<Record<string, number>>({})

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/billing", { credentials: "same-origin" })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
      setData(body)
      setPrices(body.config?.model_prices ?? {})
      setQuota(body.config?.monthly_quota ?? {})
      // 预拉每个租户钱包余额（慢但一次到位；fail-open）
      const bal: Record<string, number> = {}
      for (const t of body.tenants ?? []) {
        try {
          const wres = await fetch(`/api/wallet?tenant=${encodeURIComponent(t.tenantId)}`, {
            credentials: "same-origin",
          })
          const wb = await wres.json()
          bal[t.tenantId] = typeof wb?.balance_usd === "number" ? wb.balance_usd : 0
        } catch {
          bal[t.tenantId] = 0
        }
      }
      setWallets(bal)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function save() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch("/api/billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ model_prices: prices, monthly_quota: quota }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
      setSaveMsg("已保存计费配置")
    } catch (e) {
      setSaveMsg(`保存失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  async function topup(tenantId: string, delta: number) {
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ tenantId, amount: delta, kind: "adjust", note: "admin 调整" }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
      setWallets((w) => ({ ...w, [tenantId]: body.balance_usd }))
      void load()
    } catch (e) {
      setSaveMsg(`充值失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const modelNames = useMemo(() => {
    const all = new Set<string>()
    for (const t of data?.usage?.tenants ?? []) {
      for (const m of t.by_model ?? []) all.add(m.model)
    }
    return [...all].sort()
  }, [data])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <IconWallet className="size-4 text-muted-foreground" />
        <div className="text-sm font-medium">计费 / 钱包（云平台全栈）</div>
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={() => void load()} variant="ghost" size="sm" disabled={loading}>
            <IconRefresh className="size-3" />
            {loading ? "刷新中…" : "刷新"}
          </Button>
          <Button onClick={() => void save()} size="sm" disabled={saving}>
            <IconDeviceFloppy className="mr-1 size-4" />
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>

      {saveMsg && <div className="text-xs text-muted-foreground">{saveMsg}</div>}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          加载失败: {error}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* 模型单价 */}
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-2 text-sm font-medium">模型单价 (USD / 1M tokens)</div>
            <div className="space-y-2">
              {(modelNames.length ? modelNames : Object.keys(prices)).map((model) => {
                const p = prices[model] ?? { input: 0, output: 0 }
                return (
                  <div key={model} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-xs">
                    <span className="truncate font-mono">{model}</span>
                    <label className="flex items-center gap-1">
                      <span className="text-muted-foreground">in</span>
                      <input
                        type="number"
                        step="0.000001"
                        min="0"
                        value={p.input}
                        onChange={(e) =>
                          setPrices((s) => ({
                            ...s,
                            [model]: { ...s[model], input: parsePrice(e.target.value) },
                          }))
                        }
                        className="w-24 rounded border bg-background px-1.5 py-1 font-mono"
                      />
                    </label>
                    <label className="flex items-center gap-1">
                      <span className="text-muted-foreground">out</span>
                      <input
                        type="number"
                        step="0.000001"
                        min="0"
                        value={p.output}
                        onChange={(e) =>
                          setPrices((s) => ({
                            ...s,
                            [model]: { ...s[model], output: parsePrice(e.target.value) },
                          }))
                        }
                        className="w-24 rounded border bg-background px-1.5 py-1 font-mono"
                      />
                    </label>
                  </div>
                )
              })}
              {modelNames.length === 0 && Object.keys(prices).length === 0 && (
                <div className="text-xs text-muted-foreground">
                  暂无模型用量。产生对话后这里会出现各模型，可为其设置单价。
                </div>
              )}
              <div className="text-[10px] text-muted-foreground">
                费用 = 本月真实 token × 单价，纯云平台计算，agent 不参与。
              </div>
            </div>
          </div>

          {/* 每租户钱包 + 配额 */}
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-2 text-sm font-medium">每家庭钱包 / 月度配额</div>
            <div className="divide-y divide-border">
              {data.tenants.length === 0 && (
                <div className="py-4 text-center text-xs text-muted-foreground">还没有家庭</div>
              )}
              {data.tenants.map((t) => {
                const used = data.usage.tenants.find((u) => u.tenantId === t.tenantId)
                const q = quota[t.tenantId] ?? 0
                return (
                  <div key={t.tenantId} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                    <span className="font-mono">{t.name}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {t.tenantId}
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => void topup(t.tenantId, -1)}>
                        <IconMinus className="size-3" />
                      </Button>
                      <span className={`font-mono ${(wallets[t.tenantId] ?? 0) < 0 ? "text-destructive" : ""}`}>
                        {fmtUsd(wallets[t.tenantId] ?? 0)}
                      </span>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => void topup(t.tenantId, 1)}>
                        <IconPlus className="size-3" />
                      </Button>
                    </span>
                    <label className="flex items-center gap-1">
                      <span className="text-muted-foreground">月配额</span>
                      <input
                        type="number"
                        min="0"
                        step={10000}
                        value={q}
                        onChange={(e) => {
                          const v = parseInt(e.target.value || "0", 10)
                          setQuota((s) => ({ ...s, [t.tenantId]: Number.isFinite(v) && v >= 0 ? v : 0 }))
                        }}
                        className="w-28 rounded border bg-background px-1.5 py-1 font-mono"
                      />
                    </label>
                    <span className="text-muted-foreground">
                      本月 {fmtTokens(used?.total_tokens ?? 0)} tok · {fmtUsd(used?.estimated_cost_usd ?? 0)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function parsePrice(v: string): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}