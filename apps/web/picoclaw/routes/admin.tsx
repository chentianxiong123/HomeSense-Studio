import { createFileRoute, redirect } from "@tanstack/react-router"

import { AdminPage } from "@pico/components/admin/admin-page"

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ location }) => {
    if (typeof globalThis === "undefined") return
    let me: { authenticated?: boolean; user?: { role?: string } } | null = null
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" })
      if (res.ok) me = (await res.json()) as { authenticated?: boolean; user?: { role?: string } }
    } catch {
      me = null
    }
    if (!me?.authenticated) {
      throw redirect({ to: "/launcher-login" })
    }
    if (me?.user?.role !== "admin") {
      throw redirect({ to: "/", search: { denied: location.pathname } })
    }
  },
  component: AdminPage,
})
