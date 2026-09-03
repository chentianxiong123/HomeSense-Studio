import { createFileRoute } from "@tanstack/react-router"

import { RawConfigPage } from "@pico/components/config/raw-config-page"

export const Route = createFileRoute("/config/raw")({
  component: RawConfigPage,
})
