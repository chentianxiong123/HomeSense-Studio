export const APP_DEFAULT_ROUTE = '/studio'
export const LAST_ROUTE_STORAGE_KEY = 'homesense-studio.last-route'

const ROUTE_PATTERNS = [
  /^\/chat$/,
  /^\/studio$/,
  /^\/assets$/,
  /^\/devices$/,
  /^\/integrations$/,
  /^\/mi$/,
  /^\/settings$/,
  /^\/studio\/workflows\/[^/]+\/(overview|editor|runs)$/,
  /^\/assets\/skills\/[^/]+\/(overview|prompt)$/,
  /^\/assets\/manifests\/[^/]+\/overview$/,
  /^\/assets\/plans\/[^/]+\/overview$/,
  /^\/assets\/agents\/[^/]+\/overview$/,
]

export function normalizeRememberedRoute(value: string | null | undefined): string {
  if (!value) return APP_DEFAULT_ROUTE
  return ROUTE_PATTERNS.some((pattern) => pattern.test(value)) ? value : APP_DEFAULT_ROUTE
}

export function shouldRememberRoute(path: string): boolean {
  return path !== '/' && path !== '/settings' && Boolean(path)
}
