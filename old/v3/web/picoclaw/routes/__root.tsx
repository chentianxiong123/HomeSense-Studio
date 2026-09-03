import { Outlet, createRootRoute, useRouterState } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { AppLayout } from "@pico/components/app-layout"
import { initializeChatStore } from "@pico/features/chat/controller"
import { isLauncherAuthPathname } from "@pico/lib/launcher-login-path"

const RootLayout = () => {
  // 当前路径只信任 routerState.pathname(响应式),
  // windowPath 留给初次渲染时 globalThis 兜底,避免 useRouterState 渲染抖动
  // 把 isAuthPage 拉到 effect 依赖里导致无限循环。
  const routerState = useRouterState({
    select: (s) => ({ pathname: s.location.pathname }),
  })

  const windowPath =
    typeof globalThis.location !== "undefined"
      ? globalThis.location.pathname || "/"
      : routerState.pathname

  // 只信任 routerState.pathname(字符串稳定,React 按值比较不会无限重渲染)
  const isAuthPage = isLauncherAuthPathname(routerState.pathname)

  const [authError, setAuthError] = useState<string | null>(null)

  // Session guard: 检查 token,没 token 跳登录页。
  // 只在 path 变化时跑一次;使用 AbortController 取消上一次的 fetch
  // 避免多次 effect 跑时前一个未 resolve 的 promise 触发错误跳转。
  useEffect(() => {
    if (isAuthPage) return
    const ac = new AbortController()
    let mounted = true

    Promise.all([
      fetch("/api/auth/status", { credentials: "same-origin", signal: ac.signal }).then((r) => r.json()),
      fetch("/api/auth/me", { credentials: "same-origin", signal: ac.signal }).then((r) => r.json()),
    ])
      .then(([s, me]) => {
        if (!mounted) return
        if (!s.available) return
        if (!me.authenticated) {
          globalThis.location.assign("/launcher-login")
        }
      })
      .catch((err: unknown) => {
        if (!mounted) return
        if (err instanceof DOMException && err.name === "AbortError") return
        if (err instanceof Error && /^status 40[13]$/.test(err.message)) {
          globalThis.location.assign("/launcher-login")
        } else {
          setAuthError(
            err instanceof Error
              ? err.message
              : "Auth service unavailable. Restart the application.",
          )
        }
      })

    return () => {
      mounted = false
      ac.abort()
    }
  }, [isAuthPage, windowPath])

  useEffect(() => {
    if (isAuthPage) {
      return
    }
    initializeChatStore()
  }, [isAuthPage])

  if (isAuthPage) {
    return <Outlet />
  }

  return (
    <>
      {authError && (
        <div className="bg-destructive text-destructive-foreground fixed inset-x-0 top-0 z-[100] flex items-center justify-between px-4 py-2 text-sm shadow-md">
          <span>Auth service error: {authError}</span>
          <button
            className="ml-4 opacity-70 hover:opacity-100"
            onClick={() => setAuthError(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      <AppLayout>
        <Outlet />
      </AppLayout>
    </>
  )
}

export const Route = createRootRoute({ component: RootLayout })