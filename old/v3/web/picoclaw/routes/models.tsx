import { createFileRoute } from "@tanstack/react-router"

import { ModelsPage } from "@pico/components/models/models-page"

export const Route = createFileRoute("/models")({
  component: ModelsPage,
})
