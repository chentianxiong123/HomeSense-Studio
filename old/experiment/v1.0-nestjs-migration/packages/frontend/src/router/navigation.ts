export const APP_DEFAULT_ROUTE = '/home'
export const LAST_ROUTE_STORAGE_KEY = 'homesense-studio.last-route'

const ROUTE_PATTERNS = [
  /^\/home$/,
  /^\/chat$/,
  /^\/studio$/,
  /^\/workspace$/,
  /^\/assets$/,
  /^\/devices$/,
  /^\/integrations$/,
  /^\/mi$/,
  /^\/studio\/workflows\/[^/]+\/(overview|editor|runs)$/,
  /^\/assets\/device-skills\/[^/]+\/overview$/,
  /^\/assets\/skills\/[^/]+\/(overview|sections|prompt)$/,
  /^\/assets\/manifests\/[^/]+\/overview$/,
  /^\/assets\/plans\/[^/]+\/overview$/,
  /^\/assets\/memory\/[^/]+\/overview$/,
  /^\/assets\/mcp\/[^/]+\/overview$/,
  /^\/assets\/agents\/[^/]+\/overview$/,
]

export function normalizeRememberedRoute(value: string | null | undefined): string {
  if (!value) return APP_DEFAULT_ROUTE
  return ROUTE_PATTERNS.some((pattern) => pattern.test(value)) ? value : APP_DEFAULT_ROUTE
}

export function shouldRememberRoute(path: string): boolean {
  return path !== '/' && path !== '/settings' && Boolean(path)
}
