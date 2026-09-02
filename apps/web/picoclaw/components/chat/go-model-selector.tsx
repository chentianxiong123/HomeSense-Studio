// 用户侧模型选择器 — 严格只显示「管理员勾选 + 已配价」的模型。
// 数据源 = /api/models-config (Go provider 配置) ∩ /api/billing 里的 model_prices.enabled。
// 没有勾选 = 用户看不到（fail-closed）。
// 选择只写前端 localStorage，发消息时随消息带；不触碰云端任何配置。

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@pico/components/ui/select"
import { getStoredChatModel, setStoredChatModel } from "@/lib/chat-model-pref"

interface ModelPriceRow {
  input: number
  output: number
  enabled?: boolean
}
interface ModelPrices {
  [model: string]: ModelPriceRow
}

interface PricedModel {
  id: string
  label: string
  input_price: number
  output_price: number
}

export function GoModelSelector({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation()
  const [models, setModels] = useState<PricedModel[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [cfgRes, billRes] = await Promise.all([
          fetch("/api/models-config", { credentials: "same-origin" }),
          fetch("/api/billing", { credentials: "same-origin" }),
        ])
        if (!cfgRes.ok) throw new Error(`models-config HTTP ${cfgRes.status}`)
        const cfg = (await cfgRes.json()) as { providers?: Record<string, { models?: { id?: string; name?: string }[] }> }
        const bill = billRes.ok ? ((await billRes.json()) as { config?: { model_prices?: ModelPrices } }) : { config: {} }
        const prices = bill.config?.model_prices ?? {}
        const seen = new Set<string>()
        const out: PricedModel[] = []
        for (const provider of Object.values(cfg.providers ?? {})) {
          for (const m of provider.models ?? []) {
            const id = String(m?.id ?? "").trim()
            if (!id || seen.has(id)) continue
            const p = prices[id]
            // 必须 admin 勾选 enabled + 配了价 才给用户
            if (!p || p.enabled !== true) continue
            seen.add(id)
            out.push({ id, label: m?.name || id, input_price: p.input, output_price: p.output })
          }
        }
        out.sort((a, b) => a.label.localeCompare(b.label))
        if (!cancelled) setModels(out)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const current = getStoredChatModel()
  const hasPublished = (models?.length ?? 0) > 0

  return (
    <Select
      value={hasPublished ? current || "" : ""}
      onValueChange={(name) => setStoredChatModel(name)}
      disabled={disabled || !hasPublished}
    >
      <SelectTrigger
        size="sm"
        className="text-muted-foreground hover:text-foreground focus-visible:border-input h-8 max-w-[200px] min-w-[100px] bg-transparent shadow-none focus-visible:ring-0 sm:max-w-[280px]"
      >
        <SelectValue
          placeholder={
            err
              ? t("chat.modelLoadErr", "加载失败")
              : hasPublished
                ? current || t("chat.autoModel", "自动")
                : t("chat.noPublishedModel", "暂无可用模型")
          }
        />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectGroup>
          <SelectLabel>
            {t("chat.modelHint", "发送时使用该模型（仅本条及后续由你选择的）— 管理员勾选 + 已配价")}
          </SelectLabel>
          {(models ?? []).map((m) => (
            <SelectItem key={m.id} value={m.id}>
              <span className="flex items-center gap-2">
                <span>{m.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  ${m.input_price}/${m.output_price}/1M
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
