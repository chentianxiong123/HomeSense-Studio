/** Normalize URL pathname for comparisons (trailing slashes, empty). */
export function normalizePathname(p: string): boolean {
  // Compat shim: launcher-setup 已删除,统一在 /launcher-login 处理登录/注册双 tab
  const t = p.replace(/\/+$/, "")
  const normalized = t === "" ? "/" : t
  return normalized === "/launcher-login" || normalized === "/launcher-setup"
}

export function isLauncherAuthPathname(p: string): boolean {
  return normalizePathname(p)
}
