import { IconTrash } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

import { LogLevelSelect } from "@pico/components/logs/log-level-select"
import { LogsPanel } from "@pico/components/logs/logs-panel"
import { PageHeader } from "@pico/components/page-header"
import { Button } from "@pico/components/ui/button"
import { useGatewayLogs } from "@pico/hooks/use-gateway-logs"
import { useLogWrapColumns } from "@pico/hooks/use-log-wrap-columns"

export function LogsPage() {
  const { t } = useTranslation()
  const { clearLogs, clearing, logs } = useGatewayLogs()
  const { contentRef, measureRef, wrapColumns } = useLogWrapColumns()

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("navigation.logs")}
        children={
          <>
            <LogLevelSelect />

            <Button
              variant="outline"
              size="sm"
              onClick={clearLogs}
              disabled={logs.length === 0 || clearing}
            >
              <IconTrash className="size-4" />
              {t("pages.logs.clear")}
            </Button>
          </>
        }
      />

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4 sm:p-8">
        <LogsPanel
          logs={logs}
          wrapColumns={wrapColumns}
          contentRef={contentRef}
          measureRef={measureRef}
        />
      </div>
    </div>
  )
}
