import { IconLoader2, IconStar } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { type ModelInfo, getModels, updateDefaultChain } from "@pico/api/models"
import { PageHeader } from "@pico/components/page-header"
import { Button } from "@pico/components/ui/button"

export function ModelsPage() {
  const { t } = useTranslation()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [defaultModel, setDefaultModel] = useState("")
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState("")
  const [saving, setSaving] = useState<string | null>(null)

  const fetchModels = async () => {
    setLoading(true)
    setFetchError("")
    try {
      const data = await getModels()
      setModels(data.models ?? [])
      setDefaultModel(data.default_model || "")
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : t("models.loadError"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchModels()
  }, [])

  const handleSetDefault = async (model: ModelInfo) => {
    if (saving || model.model_name === defaultModel) return
    setSaving(model.model_name)
    try {
      await updateDefaultChain({
        default_model: model.model_name,
        fallback_chain: [],
      })
      setDefaultModel(model.model_name)
      toast.success(t("models.setDefaultSuccess"))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("models.loadError"))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("navigation.models")} />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
        <div className="pt-2">
          <p className="text-muted-foreground text-sm">
            {t("models.description")}
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <IconLoader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        )}

        {fetchError && (
          <div className="bg-destructive/10 mt-4 rounded-lg px-4 py-3 text-sm">
            <p className="text-destructive">{fetchError}</p>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void fetchModels()}>
                {t("models.retry")}
              </Button>
            </div>
          </div>
        )}

        {!loading && !fetchError && (
          <div className="mt-4 space-y-2 pb-8">
            {models.length === 0 && (
              <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                {t("models.empty")}
              </div>
            )}
            {models.map((model) => {
              const isDefault = model.model_name === defaultModel
              return (
                <div
                  key={`${model.provider}:${model.model_name}`}
                  className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {isDefault && (
                        <IconStar className="text-amber-500 size-4 shrink-0" />
                      )}
                      <p className="truncate text-sm font-medium">
                        {model.model_name}
                      </p>
                      {model.status !== "available" && (
                        <span className="text-muted-foreground text-xs">
                          {model.status}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground truncate text-xs">
                      {model.provider}
                      {model.model ? ` · ${model.model}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={isDefault ? "outline" : "default"}
                    disabled={isDefault || saving !== null}
                    onClick={() => void handleSetDefault(model)}
                  >
                    {saving === model.model_name
                      ? t("common.saving")
                      : isDefault
                        ? t("models.defaultSelected")
                        : t("models.setDefault")}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
