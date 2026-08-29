import type { ReactNode } from "react"
import { Toaster } from "sonner"

import { AppHeader } from "@pico/components/app-header"
import { AppSidebar } from "@pico/components/app-sidebar"
import { TourGuide } from "@pico/components/tour/tour-guide"
import { SidebarProvider } from "@pico/components/ui/sidebar"
import { TooltipProvider } from "@pico/components/ui/tooltip"

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider className="flex h-dvh flex-col overflow-hidden">
        <AppHeader />

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
