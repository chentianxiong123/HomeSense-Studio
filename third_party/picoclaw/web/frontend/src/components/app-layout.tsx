import type { ReactNode } from "react"
import * as React from "react"
import { Toaster } from "sonner"

import {
  AppHeader,
  HeaderExpandHandle,
} from "@/components/app-header"
import { AppSidebar } from "@/components/app-sidebar"
import { TourGuide } from "@/components/tour/tour-guide"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

export function AppLayout({ children }: { children: ReactNode }) {
  const [headerExpanded, setHeaderExpanded] = React.useState(true)
  return (
    <TooltipProvider>
      <SidebarProvider
        className="flex h-dvh flex-col overflow-hidden"
        style={
          {
            "--header-height": headerExpanded ? "3.5rem" : "0px",
          } as React.CSSProperties
        }
      >
        <AppHeader
          expanded={headerExpanded}
          onToggle={() => setHeaderExpanded((v) => !v)}
        />
        {!headerExpanded && (
          <HeaderExpandHandle onClick={() => setHeaderExpanded(true)} />
        )}

        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <div className="flex w-full flex-col overflow-hidden">
            <main className="flex min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden">
              {children}
            </main>
          </div>
        </div>
        <Toaster position="bottom-center" />
        <TourGuide />
      </SidebarProvider>
    </TooltipProvider>
  )
}
