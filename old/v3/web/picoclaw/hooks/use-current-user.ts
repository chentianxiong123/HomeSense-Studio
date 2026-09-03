// 拉 /api/auth/me 并缓存当前用户, 暴露 role/username/activeSessionId 给 UI。
// 作用: sidebar /admin 菜单项、admin 页面 guard 等都靠它判断 role。
//
// 缓存策略: 内存单例, 路由变化时 React Query 不会重拉(我们不用 React Query),
// 改用 ref 缓存 + listeners, 登入/登出/角色变更时 invalidate() 强刷。

import { useEffect, useState } from "react"

import { type AuthMe, getAuthMe } from "@pico/api/launcher-auth"

interface CurrentUserState {
  loading: boolean
  me: AuthMe | null
  refetch: () => Promise<void>
}

let cached: AuthMe | null = null
let inflight: Promise<AuthMe | null> | null = null
const listeners = new Set<(me: AuthMe | null) => void>()

async function fetchMe(): Promise<AuthMe | null> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const me = await getAuthMe()
      cached = me
      return me
    } catch {
      cached = { authenticated: false, available: false }
      return cached
    } finally {
      inflight = null
    }
  })()
  return inflight
}

function setCached(me: AuthMe | null) {
  cached = me
  for (const l of listeners) l(me)
}

export function invalidateCurrentUser() {
  setCached(null)
  void fetchMe()
}

export function getCachedCurrentUser(): AuthMe | null {
  return cached
}

export function useCurrentUser(): CurrentUserState {
  const [me, setMe] = useState<AuthMe | null>(cached)
  const [loading, setLoading] = useState(cached === null)

  useEffect(() => {
    let cancelled = false
    const listener = (next: AuthMe | null) => {
      if (!cancelled) setMe(next)
    }
    listeners.add(listener)

    if (cached === null) {
      setLoading(true)
      fetchMe().then((next) => {
        if (cancelled) return
        setMe(next)
        setLoading(false)
      })
    } else {
      setMe(cached)
      setLoading(false)
    }

    return () => {
      cancelled = true
      listeners.delete(listener)
    }
  }, [])

  return {
    loading,
    me,
    refetch: async () => {
      setLoading(true)
      const next = await fetchMe()
      setMe(next)
      setLoading(false)
    },
  }
}

export function isAdmin(me: AuthMe | null | undefined): boolean {
  return Boolean(me?.authenticated && me.user?.role === "admin")
}
