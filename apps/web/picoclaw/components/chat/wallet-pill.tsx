// 用户侧钱包指示器 — 云平台计费（架构铁律：agent 不算钱）。
// 显示本家庭钱包余额 + 本月用量；余额不足时提示充值，不打扰 agent。

import { IconWallet } from "@tabler/icons-react"
import { useEffect, useState } from "react"

const fmtUsd = (n: number) =>
  n === null || n === undefined || Number.isNaN(n)
    ? ""
    : `$${n.toFixed(2)}`
const fmtTokens = (n: number) => (n ? n.toLocaleString("zh-CN") : "0")

interface WalletData {
  balance_usd: number
  monthly_quota: number
  monthly_used_tokens: number
  monthly_cost_usd: number
}

export function WalletPill() {
  const [data, setData] = useState<WalletData | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/wallet", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled || body?.error) return
        setData(body as WalletData)
      })
      .catch(() => {
        /* fail-open: 钱包读不到就静默隐藏 */
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (hidden || !data) return null

  const quota = data.monthly_quota || 0
  const usedPct = quota > 0 ? Math.min((data.monthly_used_tokens / quota) * 100, 100) : null
  const lowBalance = data.balance_usd < 0
  const nearQuota = quota > 0 && data.monthly_used_tokens >= quota * 0.9

  return (
    <button
      type="button"
      onClick={() => setHidden(true)}
      title="点击隐藏 · 钱包余额与本月用量"
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${
        lowBalance || nearQuota
          ? "border-amber-500/50 bg-amber-500/10 text-amber-600"
          : "border-border/60 bg-muted/40 text-muted-foreground"
      }`}
    >
      <IconWallet className="size-3.5" />
      <span className="font-mono">{fmtUsd(data.balance_usd)}</span>
      {quota > 0 && (
        <span className="font-mono opacity-80">
          {fmtTokens(data.monthly_used_tokens)}/{fmtTokens(quota)}
          {usedPct !== null ? ` (${Math.round(usedPct)}%)` : ""}
        </span>
      )}
      {(lowBalance || nearQuota) && <span>· 请联系管理员</span>}
    </button>
  )
}