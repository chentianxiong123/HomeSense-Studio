import { createFileRoute } from "@tanstack/react-router"

import { LogsPage } from "@pico/components/logs/logs-page"

export const Route = createFileRoute("/logs")({
  component: LogsPage,
})
