import { createFileRoute } from "@tanstack/react-router"

import { CredentialsPage } from "@pico/components/credentials/credentials-page"

export const Route = createFileRoute("/credentials")({
  component: CredentialsPage,
})
