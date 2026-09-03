// Chat 顶部的钱包/配额状态条。
// 触发条件（按严重度从高到低）：
//   - isEmpty        → 红色「钱包已欠费，请联系管理员充值」
//   - quotaExceeded  → 红色「本月用量已超配额 X tok」
//   - quotaApproaching → 黄色「本月用量已达 80% (X/Y tok)」
// 数据来自 useWalletStatus 钩子（30s 轮询 /api/wallet）。
// 不阻塞 chat 滚动；只在 PageHeader 下方塞一行 sticky 的窄条，够显眼。

import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react"

import type { WalletStatus } from "@pico/hooks/use-wallet-status"

interface Props {
  status: WalletStatus
  onRefresh: () => void
}

const fmtTokens = (n: number) => (n ? n.toLocaleString("zh-CN") : "0")
const fmtUsd = (n: number) => `$${(n || 0).toFixed(2)}`

export function WalletStatusBanner({ status, onRefresh }: Props) {
  if (status.loading || status.error) return null

  if (status.isEmpty) {
    return (
      <div
        role="alert"
        className="border-b border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs text-destructive md:px-8 lg:px-24 xl:px-48"
      >
        <div className="mx-auto flex max-w-250 items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <IconAlertTriangle className="size-3.5" />
            <span>
              钱包余额 <b>{fmtUsd(status.balanceUsd)}</b>，无法继续对话。请联系管理员充值后重试。
            </span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="text-[10px] underline-offset-2 hover:underline"
          >
            刷新
          </button>
        </div>
      </div>
    )
  }

  if (status.quotaWarning === "exceeded") {
    return (
      <div
        role="alert"
        className="border-b border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs text-destructive md:px-8 lg:px-24 xl:px-48"
      >
        <div className="mx-auto flex max-w-250 items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <IconAlertTriangle className="size-3.5" />
            <span>
              本月用量 <b>{fmtTokens(status.monthlyUsedTokens)}</b> 已超配额{" "}
              <b>{fmtTokens(status.monthlyQuota)}</b> tok。请联系管理员调整配额。
            </span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="text-[10px] underline-offset-2 hover:underline"
          >
            刷新
          </button>
        </div>
      </div>
    )
  }

  if (status.quotaWarning === "approaching") {
    return (
      <div className="border-b border-yellow-500/40 bg-yellow-500/10 px-4 py-1.5 text-xs text-yellow-700 dark:text-yellow-300 md:px-8 lg:px-24 xl:px-48">
        <div className="mx-auto flex max-w-250 items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <IconAlertTriangle className="size-3.5" />
            <span>
              本月用量已达 <b>{fmtTokens(status.monthlyUsedTokens)}</b> / {fmtTokens(status.monthlyQuota)} tok（≈
              {Math.round((status.monthlyUsedTokens / Math.max(status.monthlyQuota, 1)) * 100)}%），接近本月配额。
            </span>
          </div>
        </div>
      </div>
    )
  }

  return null
}

// 默认导出空 — 避免没异常时占用空间
export default function _UnusedOk() {
  return null
  // 注释：上面 export WalletStatusBanner 已用；这个空 default 仅供 tree-shake 提示
  void IconCircleCheck
}
