import {
  IconBook,
  IconChevronDown,
  IconChevronUp,
  IconLanguage,
  IconLoader2,
  IconLogout,
  IconMenu2,
  IconMoon,
  IconPlayerPlay,
  IconPower,
  IconRefresh,
  IconSun,
} from "@tabler/icons-react"
import { Link } from "@tanstack/react-router"
import * as React from "react"
import { useTranslation } from "react-i18next"

import { getAuthMe, postLogout } from "@pico/api/launcher-auth"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@pico/components/ui/alert-dialog"
import { Button } from "@pico/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pico/components/ui/dropdown-menu"
import { Separator } from "@pico/components/ui/separator"
import { SidebarTrigger } from "@pico/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@pico/components/ui/tooltip"
import { useGateway } from "@pico/hooks/use-gateway"
import { useTheme } from "@pico/hooks/use-theme"

interface CurrentUser {
  userId: string
  tenantId: string
  username: string
  displayName: string
  role: string
}

export function AppHeader({
  expanded,
  onToggle,
}: {
  expanded: boolean
  onToggle: () => void
}) {
  const { i18n, t } = useTranslation()
  const { theme, toggleTheme } = useTheme()
  const {
    state: gwState,
    loading: gwLoading,
    canStart,
    startReason,
    restartRequired,
    start,
    restart,
    stop,
    error: gwError,
  } = useGateway()

  const [currentUser, setCurrentUser] = React.useState<CurrentUser | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void getAuthMe()
      .then((me) => {
        if (cancelled) return
        if (me.authenticated && me.user) setCurrentUser(me.user)
      })
      .catch(() => {
        /* unauthenticated or network error */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const [showStopDialog, setShowStopDialog] = React.useState(false)
  const [showLogoutDialog, setShowLogoutDialog] = React.useState(false)

  const isRunning = gwState === "running"
  const isStarting = gwState === "starting"
  const isRestarting = gwState === "restarting"
  const isStopping = gwState === "stopping"
  const isStopped = gwState === "stopped" || gwState === "unknown"
  const showNotConnectedHint =
    !isRestarting &&
    !isStopping &&
    canStart &&
    (gwState === "stopped" || gwState === "error")

  const handleLogout = async () => {
    await postLogout()
    globalThis.location.assign("/launcher-login")
  }

  const handleGatewayToggle = () => {
    if (gwLoading || isRestarting || isStopping || (!isRunning && !canStart)) {
      return
    }
    if (isRunning) {
      setShowStopDialog(true)
    } else {
      void start()
    }
  }

  const handleGatewayRestart = () => {
    if (gwLoading || isRestarting || !restartRequired || !canStart) return
    void restart()
  }

  const confirmStop = () => {
    setShowStopDialog(false)
    stop()
  }

  return (
    <header
      className={
        "bg-background/95 supports-backdrop-filter:bg-background/60 border-b-border/50 sticky top-0 z-50 flex shrink-0 items-center justify-between overflow-hidden border-b px-4 backdrop-blur transition-[height,opacity] duration-200 ease-out " +
        (expanded
          ? "h-14 opacity-100"
          : "pointer-events-none h-0 border-0 opacity-0")
      }
    >
      <div className="flex items-center gap-2">
        <SidebarTrigger className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 w-9 items-center justify-center rounded-lg sm:hidden [&>svg]:size-5">
          <IconMenu2 />
        </SidebarTrigger>
        <Link to="/" className="flex items-center">
          <img
            className="h-7 w-auto"
            src="/logo_with_text.svg"
            alt="HomeSense"
          />
        </Link>
      </div>

      {/* Center prominent connection status */}
      <div className="pointer-events-none absolute left-1/2 hidden h-full -translate-x-1/2 items-center justify-center lg:flex">
        {showNotConnectedHint && (
          <div className="text-muted-foreground flex items-center gap-2 rounded-full border border-dashed px-4 py-1.5 text-xs shadow-sm backdrop-blur-md">
            <span className="bg-destructive/50 relative flex size-2 shrink-0 items-center justify-center rounded-full">
              <span className="bg-destructive absolute inline-flex size-full animate-ping rounded-full opacity-75"></span>
            </span>
            {t("chat.notConnected")}
          </div>
        )}
      </div>

      <AlertDialog open={showStopDialog} onOpenChange={setShowStopDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("header.gateway.stopDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("header.gateway.stopDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmStop}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("header.gateway.stopDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("header.logout.tooltip")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("header.logout.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleLogout()}>
              {t("header.logout.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="text-muted-foreground flex items-center gap-1 text-sm font-medium md:gap-2">
        {restartRequired && (
          <Tooltip delayDuration={700}>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon-sm"
                className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-500/25"
                onClick={handleGatewayRestart}
                disabled={gwLoading || isRestarting || isStopping || !canStart}
                aria-label={t("header.gateway.action.restart")}
              >
                <IconRefresh className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("header.gateway.restartRequired")}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Gateway Start/Stop */}
        {isRunning ? (
          <Tooltip delayDuration={700}>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                size="icon-sm"
                className="size-8"
                data-tour="gateway-button"
                onClick={handleGatewayToggle}
                disabled={gwLoading}
                aria-label={t("header.gateway.action.stop")}
              >
                <IconPower className="h-4 w-4 opacity-80" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {gwError ?? t("header.gateway.action.stop")}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip
            delayDuration={gwError || (!canStart && startReason) ? 0 : 700}
          >
            <TooltipTrigger asChild>
              {/* Wrap in span so the tooltip still fires when the button is disabled */}
              <span
                className={
                  !canStart && startReason ? "cursor-not-allowed" : undefined
                }
                tabIndex={!canStart && startReason ? 0 : undefined}
              >
                <Button
                  variant={
                    isStarting || isRestarting || isStopping
                      ? "secondary"
                      : "default"
                  }
                  size="sm"
                  data-tour="gateway-button"
                  className={`h-8 gap-2 px-3 ${
                    isStopped
                      ? "bg-green-500 text-white hover:bg-green-600"
                      : ""
                  } ${!canStart ? "pointer-events-none" : ""}`}
                  onClick={handleGatewayToggle}
                  disabled={
                    gwLoading ||
                    isStarting ||
                    isRestarting ||
                    isStopping ||
                    !canStart
                  }
                >
                  {gwLoading || isStarting || isRestarting || isStopping ? (
                    <IconLoader2 className="h-4 w-4 animate-spin opacity-70" />
                  ) : (
                    <IconPlayerPlay className="h-4 w-4 opacity-80" />
                  )}
                  <span className="text-xs font-semibold">
                    {isStopping
                      ? t("header.gateway.status.stopping")
                      : isRestarting
                        ? t("header.gateway.status.restarting")
                        : isStarting
                          ? t("header.gateway.status.starting")
                          : t("header.gateway.action.start")}
                  </span>
                </Button>
              </span>
            </TooltipTrigger>
            {gwError || (!canStart && startReason) ? (
              <TooltipContent>{gwError ?? startReason}</TooltipContent>
            ) : null}
          </Tooltip>
        )}

        <Separator
          className="mx-4 my-2 hidden md:block"
          orientation="vertical"
        />

        {/* Docs Link */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          data-tour="docs-button"
          asChild
        >
          <a href="https://github.com/chentianxiong123/HomeSense-Studio-v3" target="_blank" rel="noreferrer">
            <IconBook className="size-4.5" />
          </a>
        </Button>

        {/* Language Switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <IconLanguage className="size-4.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => i18n.changeLanguage("en")}>
              English
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => i18n.changeLanguage("zh")}>
              简体中文
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={toggleTheme}
        >
          {theme === "dark" ? (
            <IconSun className="size-4.5" />
          ) : (
            <IconMoon className="size-4.5" />
          )}
        </Button>

        <Separator className="mx-2 my-2" orientation="vertical" />

        {/* User chip + dropdown (sign out, show username) */}
        {currentUser ? (
          <DropdownMenu>
            <Tooltip delayDuration={700}>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground h-8 gap-2 px-2"
                    data-testid="user-chip"
                  >
                    <span className="bg-foreground/10 text-foreground/80 flex size-6 items-center justify-center rounded-full text-xs font-semibold">
                      {currentUser.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="hidden text-sm font-medium sm:inline">
                      {currentUser.displayName}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{currentUser.displayName}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <span className="text-foreground text-sm font-medium">
                    {currentUser.displayName}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    @{currentUser.username}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowLogoutDialog(true)}
                className="text-destructive focus:text-destructive gap-2"
              >
                <IconLogout className="size-4" />
                {t("header.logout.tooltip")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Tooltip delayDuration={700}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setShowLogoutDialog(true)}
                aria-label={t("header.logout.tooltip")}
              >
                <IconLogout className="size-4.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("header.logout.tooltip")}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Center: collapse handle (always at the same spot the
          HeaderExpandHandle sits when the header is collapsed) */}
      <div className="pointer-events-none absolute left-1/2 flex h-full -translate-x-1/2 items-center justify-center">
        <Tooltip delayDuration={700}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="pointer-events-auto size-8"
              onClick={onToggle}
              aria-label={t("header.collapse")}
            >
              <IconChevronUp className="size-4.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("header.collapse")}</TooltipContent>
        </Tooltip>
      </div>

      {/* Center prominent connection status */}
      <div className="pointer-events-none absolute left-1/2 hidden h-full -translate-x-1/2 items-center justify-center lg:flex">
        {showNotConnectedHint && (
          <div className="text-muted-foreground flex items-center gap-2 rounded-full border border-dashed px-4 py-1.5 text-xs shadow-sm backdrop-blur-md">
            <span className="bg-destructive/50 relative flex size-2 shrink-0 items-center justify-center rounded-full">
              <span className="bg-destructive absolute inline-flex size-full animate-ping rounded-full opacity-75"></span>
            </span>
            {t("chat.notConnected")}
          </div>
        )}
      </div>
    </header>
  )
}

// Fixed handle rendered when the header is collapsed, so the user can
// pull it back down. Pinned to the top of the viewport.
export function HeaderExpandHandle({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <Tooltip delayDuration={700}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          aria-label={t("header.expand")}
          className="text-muted-foreground hover:bg-accent hover:text-foreground fixed left-1/2 top-7 z-50 size-7 -translate-x-1/2 rounded-full border border-border/50 bg-background/80 shadow-sm backdrop-blur"
        >
          <IconChevronDown className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("header.expand")}</TooltipContent>
    </Tooltip>
  )
}

