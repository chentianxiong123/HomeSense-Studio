import { createFileRoute } from "@tanstack/react-router"

import { ChatPage } from "@pico/components/chat/chat-page"

export const Route = createFileRoute("/")({
  component: ChatPage,
})
