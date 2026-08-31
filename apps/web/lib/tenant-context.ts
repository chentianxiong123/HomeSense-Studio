// HomeSense v3 — 租户上下文 (AsyncLocalStorage)
//
// proxy.ts 解析 token → 注入 ctx,所有 /api/* 处理函数用 getTenantContext() 拿到当前租户。
// 在 API route 里: ctx 存在 → 用 ctx.tenantId 路由;不存在 → 401。
// 默认租户(default)无 token 时也允许通过(兼容历史),其他租户必须带 token。

import { AsyncLocalStorage } from "node:async_hooks"

export interface TenantContext {
  tenantId: string
  userId: string
  username: string
}

const storage = new AsyncLocalStorage<TenantContext>()

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn)
}

export function getTenantContext(): TenantContext | null {
  return storage.getStore() ?? null
}

export function requireTenantContext(): TenantContext {
  const ctx = storage.getStore()
  if (!ctx) throw new Error("租户上下文未注入(请求未经过 proxy.ts 鉴权)")
  return ctx
}
