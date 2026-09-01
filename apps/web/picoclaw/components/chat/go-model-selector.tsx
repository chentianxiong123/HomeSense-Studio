// 用户侧热切换模型选择器。
// 数据源 = admin 全局模型配置（云服务商卖的模型，Go 云大脑正是按它加载 model_list），
// 选择只写前端缓存（localStorage），发消息时随消息带给云大脑这一条消息用。
// 不做任何云端配置改动，云端全局默认模型不受影响。

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

interface GlobalModelSource {
  providers?: Record<
    string,
    {
      name?: string
      baseUrl?: string
      api?: string
      models?: { id?: string; name?: string; [k: string]: unknown }[]
      [k: string]: unknown
    }
  >
  [k: string]: unknown
}

export function GoModelSelector({
  disabled = false,
}: {
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [source, setSource] = useState<GlobalModelSource | null>(null)

  // 所有可用模型名（去重，保持 admin 配置顺序）
  const modelNames = useMemo(() => {
    if (!source?.providers) return []
    const seen = new Set<string>()
    const names: { id: string; label: string }[] = []
    for (const [pid, provider] of Object.entries(source.providers)) {
      const apiBase = provider?.baseUrl ?? ""
      for (const model of provider?.models ?? []) {
        if (!model?.id) continue
        const id = String(model.id).trim()
        if (!id || seen.has(id)) continue
        seen.add(id)
        names.push({ id, label: model.name || id })
      }
      if (names.length === 0 && apiBase && pid) {
        // provider 没有 models 时，把 provider 本身当作一个模型入口
        names.push({ id: pid, label: pid })
      }
    }
    return names
  }, [source])

  const current = getStoredChatModel()

  useEffect(() => {
    let cancelled = false
    void fetch("/api/models-config", { credentials: "same-origin" })
      .then((res) => (res.ok ? (res.json() as Promise<GlobalModelSource>) : null))
      .then((data) => {
        if (!cancelled) setSource(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Select
      value={current || ""}
      onValueChange={(name) => setStoredChatModel(name)}
      disabled={disabled || modelNames.length === 0}
    >
      <SelectTrigger
        size="sm"
        className="text-muted-foreground hover:text-foreground focus-visible:border-input h-8 max-w-[160px] min-w-[80px] bg-transparent shadow-none focus-visible:ring-0 sm:max-w-[220px]"
      >
        <SelectValue placeholder={current || t("chat.autoModel", "自动")} />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectGroup>
          <SelectLabel>{t("chat.modelHint", "发送时使用该模型（仅本条及后续由你选择的）")}</SelectLabel>
          {modelNames.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}