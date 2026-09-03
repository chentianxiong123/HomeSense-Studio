// 用户钱包/用量状态 hook — chat 顶部 banner + composer 禁用逻辑用。
// 数据源：/api/wallet（已含 balance_usd + monthly_quota + monthly_used_tokens）。
// 轮询 30s 一次（用户聊天可能持续 10+ 分钟，期间 recordUsage 在后台扣费）。
// Fail-open：拉失败时不阻塞 UI，余额未知视同"非空"。

import { useEffect, useState } from "react"

export interface WalletStatus {
  loading: boolean
  error: string | null
  balanceUsd: number
  monthlyQuota: number
  monthlyUsedTokens: number
  /** 余额 <= 0 时 true（chat 拒发，banner 提示） */
  isEmpty: boolean
  /** 已用 / 配额 >= 0.8 时提示（仅在 monthlyQuota>0 时算） */
  quotaWarning: "none" | "approaching" | "exceeded"
  /** 拉一次 /api/wallet — 主要给 wallet-pill dialog 用 */
  refresh: () => Promise<void>
}

interface WalletResponse {
  balance_usd?: number
  monthly_quota?: number
  monthly_used_tokens?: number
  monthly_cost_usd?: number
}

export function useWalletStatus(pollMs: number = 30_000): WalletStatus {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [balanceUsd, setBalanceUsd] = useState(0)
  const [monthlyQuota, setMonthlyQuota] = useState(0)
  const [monthlyUsedTokens, setMonthlyUsedTokens] = useState(0)

  const refresh = async () => {
    try {
      const res = await fetch("/api/wallet", { credentials: "same-origin" })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
      }
      const body = (await res.json()) as WalletResponse
      setBalanceUsd(typeof body.balance_usd === "number" ? body.balance_usd : 0)
      setMonthlyQuota(typeof body.monthly_quota === "number" ? body.monthly_quota : 0)
      setMonthlyUsedTokens(
        typeof body.monthly_used_tokens === "number" ? body.monthly_used_tokens : 0,
      )
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const t = setInterval(() => {
      void refresh()
    }, pollMs)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs])

  const isEmpty = balanceUsd <= 0
  let quotaWarning: "none" | "approaching" | "exceeded" = "none"
  if (monthlyQuota > 0) {
    const ratio = monthlyUsedTokens / monthlyQuota
    if (ratio >= 1) quotaWarning = "exceeded"
    else if (ratio >= 0.8) quotaWarning = "approaching"
  }

  return {
    loading,
    error,
    balanceUsd,
    monthlyQuota,
    monthlyUsedTokens,
    isEmpty,
    quotaWarning,
    refresh,
  }
}
