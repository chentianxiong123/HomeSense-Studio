import { createFileRoute } from "@tanstack/react-router"

import { SkillsPage } from "@pico/components/agent/skills/skills-page"

export const Route = createFileRoute("/agent/skills")({
  component: AgentSkillsRoute,
})

function AgentSkillsRoute() {
  return <SkillsPage />
}
