// Admin 用量/计费面板 — 读各租户 Go 网关的 pico_usage 累计表。
// 只读、fail-open：任一租户异常不影响其它展示。展示为"本月 token 账本"，
// 不引入积分/虚拟币概念。

import { IconRefresh } from "@tabler/icons-react"
import { useEffect, useState } from "react"

import { Button } from "@pico/components/ui/button"
import type { UsageSnapshot, TenantUsage } from "@/lib/usage"

const fmtTokens = (n: number) => (n ? n.toLocaleString("zh-CN") : "0")
const fmtUsd = (n: number) => `$${(n || 0).toFixed(4)}`

export function UsagePanel() {
  const [data, setData] = useState<UsageSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/usage", { credentials: "same-origin" })
      const body = await res.json()
      if (!res.ok) {
        setError(body.message ?? body.error ?? `HTTP ${res.status}`)
        setData(null)
        return
      }
      setData(body)
    } catch (e) {
      setError(String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-xs font-medium text-muted-foreground">本月用量账本</div>
        <Button onClick={() => void load()} variant="ghost" size="sm" disabled={loading}>
          <IconRefresh className="size-3" />
          {loading ? "刷新中…" : ""}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          用量加载失败: {error}
        </div>
      )}

      {data && (
        <div className="rounded-lg border bg-card">
          <div className="flex flex-wrap gap-4 border-b px-4 py-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">全部租户 Token</div>
              <div className="text-lg font-semibold">{fmtTokens(data.total_tokens)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">预估费用</div>
              <div className="text-lg font-semibold">{fmtUsd(data.total_estimated_cost_usd)}</div>
            </div>
          </div>

          <div className="divide-y divide-border">
            {data.tenants.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                还没有任何家庭
              </div>
            )}
            {data.tenants.map((t) => (
              <TenantRow key={t.tenantId} tenant={t} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TenantRow({ tenant }: { tenant: TenantUsage }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs">{tenant.name}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {tenant.tenantId}
        </span>
        {tenant.available ? (
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600">
            有数据
          </span>
        ) : (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            未使用
          </span>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <Stat label="请求" value={fmtTokens(tenant.requests)} />
        <Stat label="输入 Tokens" value={fmtTokens(tenant.input_tokens)} />
        <Stat label="输出 Tokens" value={fmtTokens(tenant.output_tokens)} />
        <Stat label="预估费用" value={fmtUsd(tenant.estimated_cost_usd)} />
      </div>

      {tenant.by_model.length > 0 && (
        <div className="mt-2 space-y-1">
          {tenant.by_model.map((m) => (
            <div
              key={m.model}
              className="flex items-center gap-2 rounded border bg-background px-2 py-1 text-xs"
            >
              <span className="font-mono">{m.model}</span>
              <span className="text-muted-foreground">{fmtTokens(m.requests)} 次</span>
              <span className="text-muted-foreground">in {fmtTokens(m.input_tokens)}</span>
              <span className="text-muted-foreground">out {fmtTokens(m.output_tokens)}</span>
              <span className="ml-auto font-mono">{fmtUsd(m.estimated_cost_usd)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted/50 px-2 py-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  )
}