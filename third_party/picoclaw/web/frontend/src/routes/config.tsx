import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router"

import { V7ConfigPage } from "@/components/config/v7-config-page"

export const Route = createFileRoute("/config")({
  component: ConfigRouteLayout,
})

function ConfigRouteLayout() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (pathname === "/config") {
    return <V7ConfigPage />
  }

  return <Outlet />
}
