import { IconLanguage, IconMoon, IconSun } from "@tabler/icons-react"
import { createFileRoute } from "@tanstack/react-router"
import * as React from "react"
import { useTranslation } from "react-i18next"

import {
  getAuthStatus,
  postLogin,
  postRegister,
} from "@pico/api/launcher-auth"
import { Button } from "@pico/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@pico/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pico/components/ui/dropdown-menu"
import { Input } from "@pico/components/ui/input"
import { Label } from "@pico/components/ui/label"
import { useTheme } from "@pico/hooks/use-theme"

type Mode = "login" | "register"

function LauncherLoginPage() {
  const { t, i18n } = useTranslation()
  const { theme, toggleTheme } = useTheme()
  const [mode, setMode] = React.useState<Mode>("login")
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [tenantName, setTenantName] = React.useState("")
  const [displayName, setDisplayName] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState("")
  const [status, setStatus] = React.useState<{
    checked: boolean
    available: boolean
    initialized: boolean
  }>({ checked: false, available: false, initialized: false })

  // 决定默认 tab:未初始化 → register(创建第一个家),已初始化 → login
  React.useEffect(() => {
    void getAuthStatus()
      .then((s) => {
        setStatus({ checked: true, available: s.available, initialized: s.initialized })
        if (!s.available) {
          // 旧版 /api/auth/* 不存在(理论上现在不会发生,留个兜底)
          globalThis.location.assign("/")
        } else {
          setMode(s.initialized ? "login" : "register")
        }
      })
      .catch(() => {
        setStatus({ checked: true, available: false, initialized: false })
      })
  }, [])

  const submit = React.useCallback(async () => {
    setError("")
    if (!username || username.length < 2) {
      setError(t("auth.errorUsernameShort"))
      return
    }
    if (!password || password.length < 6) {
      setError(t("auth.errorPasswordShort"))
      return
    }
    if (mode === "register" && password !== confirm) {
      setError(t("auth.errorPasswordMismatch"))
      return
    }
    setSubmitting(true)
    try {
      if (mode === "login") {
        const result = await postLogin(username, password)
        if (result.ok) {
          globalThis.location.assign("/")
          return
        }
        if (result.status === 401) {
          setError(t("auth.errorInvalid"))
          return
        }
        setError(result.error)
      } else {
        const result = await postRegister(username, password, tenantName, displayName)
        if (result.ok) {
          globalThis.location.assign("/")
          return
        }
        if (result.status === 409) {
          setError(t("auth.errorUsernameTaken"))
          return
        }
        setError(result.error)
      }
    } catch {
      setError(t("auth.errorNetwork"))
    } finally {
      setSubmitting(false)
    }
  }, [username, password, confirm, tenantName, displayName, mode, t])

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    void submit()
  }

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
      <header className="border-border/50 flex h-14 shrink-0 items-center justify-end gap-2 border-b px-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Language">
              <IconLanguage className="size-4" />
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
        <Button
          variant="outline"
          size="icon"
          type="button"
          onClick={() => toggleTheme()}
          aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? (
            <IconSun className="size-4" />
          ) : (
            <IconMoon className="size-4" />
          )}
        </Button>
      </header>

      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md" size="sm">
          <CardHeader>
            <CardTitle>
              {mode === "register" ? t("auth.registerTitle") : t("auth.loginTitle")}
            </CardTitle>
            <CardDescription>
              {mode === "register"
                ? t("auth.registerDescription")
                : t("auth.loginDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status.checked && status.initialized ? (
              <div
                role="tablist"
                className="border-border/60 mb-4 inline-flex h-9 items-center justify-center rounded-lg border p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "login"}
                  onClick={() => {
                    setMode("login")
                    setError("")
                  }}
                  className={
                    "inline-flex h-7 items-center rounded-md px-3 text-sm font-medium transition-colors " +
                    (mode === "login"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {t("auth.tabLogin")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "register"}
                  onClick={() => {
                    setMode("register")
                    setError("")
                  }}
                  className={
                    "inline-flex h-7 items-center rounded-md px-3 text-sm font-medium transition-colors " +
                    (mode === "register"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {t("auth.tabRegister")}
                </button>
              </div>
            ) : null}

            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="auth-username">{t("auth.usernameLabel")}</Label>
                <Input
                  id="auth-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  minLength={2}
                  maxLength={32}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("auth.usernamePlaceholder")}
                />
              </div>

              {mode === "register" ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="auth-display-name">{t("auth.displayNameLabel")}</Label>
                  <Input
                    id="auth-display-name"
                    name="displayName"
                    type="text"
                    autoComplete="name"
                    maxLength={32}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t("auth.displayNamePlaceholder")}
                  />
                </div>
              ) : null}

              {mode === "register" ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="auth-tenant-name">{t("auth.tenantNameLabel")}</Label>
                  <Input
                    id="auth-tenant-name"
                    name="tenantName"
                    type="text"
                    maxLength={48}
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    placeholder={t("auth.tenantNamePlaceholder")}
                  />
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <Label htmlFor="auth-password">{t("auth.passwordLabel")}</Label>
                <Input
                  id="auth-password"
                  name="password"
                  type="password"
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.passwordPlaceholder")}
                />
              </div>

              {mode === "register" ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="auth-confirm">{t("auth.confirmLabel")}</Label>
                  <Input
                    id="auth-confirm"
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={t("auth.confirmPlaceholder")}
                  />
                </div>
              ) : null}

              <Button type="submit" disabled={submitting || !status.checked}>
                {submitting
                  ? t("labels.loading")
                  : mode === "register"
                    ? t("auth.submitRegister")
                    : t("auth.submitLogin")}
              </Button>
              {error ? (
                <p className="text-destructive text-sm" role="alert">
                  {error}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export const Route = createFileRoute("/launcher-login")({
  component: LauncherLoginPage,
})
