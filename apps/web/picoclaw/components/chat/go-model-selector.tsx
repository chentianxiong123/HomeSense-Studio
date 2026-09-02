// 用户侧模型选择器 — 严格只显示「管理员勾选 + 已配价」的模型。
// 数据源 = /api/models-config (Go provider 配置真模型池) ∩ /api/billing/priced-models
//          （该端点已 = models-config ∩ model_prices.enabled，非 admin 的计费端点）。
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
        const [cfgRes, pricedRes] = await Promise.all([
          fetch("/api/models-config", { credentials: "same-origin" }),
          fetch("/api/billing/priced-models", { credentials: "same-origin" }),
        ])
        if (!cfgRes.ok) throw new Error(`models-config HTTP ${cfgRes.status}`)
        if (!pricedRes.ok) throw new Error(`priced-models HTTP ${pricedRes.status}`)
        const cfg = (await cfgRes.json()) as { providers?: Record<string, { models?: { id?: string; name?: string }[] }> }
        const priced = (await pricedRes.json()) as { models?: { model_id: string; display_name: string; input_price: number; output_price: number }[] }
        const poolIds = new Set<string>()
        for (const provider of Object.values(cfg.providers ?? {})) {
          for (const m of provider.models ?? []) {
            const id = String(m?.id ?? "").trim()
            if (id) poolIds.add(id)
          }
        }
        const out: PricedModel[] = (priced.models ?? [])
          .filter((m) => poolIds.has(m.model_id))
          .map((m) => ({
            id: m.model_id,
            label: m.display_name || m.model_id,
            input_price: m.input_price || 0,
            output_price: m.output_price || 0,
          }))
          .sort((a, b) => a.label.localeCompare(b.label))
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
