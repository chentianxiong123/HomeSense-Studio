// 用户侧模型选择器 — 严格只显示管理员「公布」的模型。
// 数据源 = /api/billing/published（PG billing_config.published_models，admin 勾选 enabled）。
// 没有管理员公布 = 没有任何模型可选（fail-closed：用户连聊天都不能发），提示联系管理员。
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

interface PublishedModel {
  model_id: string
  display_name: string
  input_price: number
  output_price: number
  description: string
}

export function GoModelSelector({
  disabled = false,
}: {
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [models, setModels] = useState<PublishedModel[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch("/api/billing/published", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { models?: PublishedModel[] }
        if (cancelled) return
        setModels(body.models ?? [])
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
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
            {t(
              "chat.modelHint",
              "发送时使用该模型（仅本条及后续由你选择的）— 管理员公布价 = 计费价",
            )}
          </SelectLabel>
          {(models ?? []).map((m) => (
            <SelectItem key={m.model_id} value={m.model_id}>
              <span className="flex items-center gap-2">
                <span>{m.display_name}</span>
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