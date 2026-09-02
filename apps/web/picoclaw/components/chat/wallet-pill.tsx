// 用户侧钱包指示器 — 云平台计费（架构铁律：agent 不算钱）。
// 点击展开 dialog: 本月余额 + 本月用量 + 最近 ledger 流水 + 最近 session 用量明细。

import { IconReceipt, IconWallet } from "@tabler/icons-react"
import { useEffect, useState } from "react"

import { Button } from "@pico/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@pico/components/ui/dialog"
import { ScrollArea } from "@pico/components/ui/scroll-area"

const fmtUsd = (n: number) =>
  n === null || n === undefined || Number.isNaN(n)
    ? ""
    : `$${n.toFixed(4)}`
const fmtUsd2 = (n: number) =>
  n === null || n === undefined || Number.isNaN(n)
    ? ""
    : `$${n.toFixed(2)}`
const fmtTokens = (n: number) => (n ? n.toLocaleString("zh-CN") : "0")
const fmtTime = (iso: string) => {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("zh-CN", { hour12: false })
}

interface WalletData {
  balance_usd: number
  monthly_quota: number
  monthly_used_tokens: number
  monthly_cost_usd: number
}

interface UsageRecord {
  sessionId: string
  requests: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  models: string[]
  firstSeen: string
  lastSeen: string
  estimated_cost_usd: number
}

interface LedgerEntry {
  id: number
  kind: "topup" | "charge" | "adjust" | "grant"
  model: string | null
  inputTokens: number
  outputTokens: number
  amountUsd: number
  balanceAfterUsd: number
  note: string | null
  createdAt: string
}

export function WalletPill() {
  const [data, setData] = useState<WalletData | null>(null)
  const [open, setOpen] = useState(false)
  const [records, setRecords] = useState<UsageRecord[]>([])
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [tab, setTab] = useState<"usage" | "ledger">("usage")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch("/api/wallet", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((body) => body?.error ? null : setData(body as WalletData))
      .catch(() => {})
  }, [])

  // Dialog 打开时按需拉明细
  useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all([
      fetch("/api/usage/records?limit=50", { credentials: "same-origin" })
        .then((r) => r.json())
        .then((b) => Array.isArray(b?.sessions) ? b.sessions : []),
      fetch("/api/wallet/ledger?limit=100", { credentials: "same-origin" })
        .then((r) => r.json())
        .then((b) => Array.isArray(b?.entries) ? b.entries : []),
    ])
      .then(([usage, led]) => {
        setRecords(usage as UsageRecord[])
        setLedger(led as LedgerEntry[])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  if (!data) return null

  const quota = data.monthly_quota || 0
  const usedPct = quota > 0 ? Math.min((data.monthly_used_tokens / quota) * 100, 100) : null
  const lowBalance = data.balance_usd < 0
  const nearQuota = quota > 0 && data.monthly_used_tokens >= quota * 0.9

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          title="点击查看账单明细"
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${
            lowBalance || nearQuota
              ? "border-amber-500/50 bg-amber-500/10 text-amber-600"
              : "border-border/60 bg-muted/40 text-muted-foreground"
          }`}
        >
          <IconWallet className="size-3.5" />
          <span className="font-mono">{fmtUsd2(data.balance_usd)}</span>
          {quota > 0 && (
            <span className="font-mono opacity-80">
              {fmtTokens(data.monthly_used_tokens)}/{fmtTokens(quota)}
              {usedPct !== null ? ` (${Math.round(usedPct)}%)` : ""}
            </span>
          )}
          {(lowBalance || nearQuota) && <span>· 请联系管理员</span>}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconReceipt className="size-4" />
            我的钱包与账单
          </DialogTitle>
          <DialogDescription>
            余额 {fmtUsd2(data.balance_usd)} ·
            {" "}本月用量 {fmtTokens(data.monthly_used_tokens)} tok · {fmtUsd(data.monthly_cost_usd)}
            {quota > 0 && ` · 配额 ${fmtTokens(quota)} (${Math.round(usedPct ?? 0)}%)`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 border-b">
          <button
            onClick={() => setTab("usage")}
            className={`px-3 py-1.5 text-sm ${tab === "usage" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
          >
            用量明细 ({records.length})
          </button>
          <button
            onClick={() => setTab("ledger")}
            className={`px-3 py-1.5 text-sm ${tab === "ledger" ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
          >
            钱包流水 ({ledger.length})
          </button>
          <div className="ml-auto">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>关闭</Button>
          </div>
        </div>

        <ScrollArea className="h-[420px]">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">加载中…</div>
          ) : tab === "usage" ? (
            <UsageTab records={records} />
          ) : (
            <LedgerTab entries={ledger} />
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function UsageTab({ records }: { records: UsageRecord[] }) {
  if (records.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">本月还没有对话记录</div>
  }
  return (
    <div className="divide-y">
      {records.map((r) => (
        <div key={r.sessionId} className="space-y-1 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono text-xs text-muted-foreground">{r.sessionId}</span>
            <span className="ml-auto font-mono">{fmtUsd(r.estimated_cost_usd)}</span>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{r.requests} 次</span>
            <span>in {fmtTokens(r.inputTokens)}</span>
            <span>out {fmtTokens(r.outputTokens)}</span>
            <span>模型: {r.models.join(", ")}</span>
          </div>
          <div className="text-[10px] text-muted-foreground/70">
            {fmtTime(r.firstSeen)} → {fmtTime(r.lastSeen)}
          </div>
        </div>
      ))}
    </div>
  )
}

function LedgerTab({ entries }: { entries: LedgerEntry[] }) {
  if (entries.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">还没有钱包流水</div>
  }
  return (
    <div className="divide-y">
      {entries.map((e) => {
        const isCredit = e.amountUsd > 0
        return (
          <div key={e.id} className="space-y-1 px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  isCredit
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-rose-500/10 text-rose-600"
                }`}
              >
                {e.kind}
              </span>
              {e.model && <span className="font-mono text-xs text-muted-foreground">{e.model}</span>}
              <span className={`ml-auto font-mono ${isCredit ? "text-emerald-600" : "text-rose-600"}`}>
                {isCredit ? "+" : ""}{fmtUsd(e.amountUsd)}
              </span>
            </div>
            {e.note && <div className="text-xs text-muted-foreground">{e.note}</div>}
            <div className="flex justify-between text-[10px] text-muted-foreground/70">
              <span>余额 {fmtUsd2(e.balanceAfterUsd)}</span>
              <span>{fmtTime(e.createdAt)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
