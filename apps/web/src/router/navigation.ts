export const APP_DEFAULT_ROUTE = '/chat'
export const LAST_ROUTE_STORAGE_KEY = 'homesense-studio.last-route'

const ROUTE_PATTERNS = [
  /^\/chat$/,
  /^\/studio$/,
  /^\/media$/,
  /^\/storage$/,
  /^\/streaming$/,
  /^\/streaming\/control\/[^/]+$/,
  /^\/streaming\/monitor\/[^/]+$/,
  /^\/workspace$/,
  /^\/assets$/,
  /^\/devices$/,
  /^\/authorizations$/,
  /^\/authorizations\/mi-cli$/,
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
  if (value === '/integrations' || value === '/integrations/sources') return '/authorizations'
  if (value === '/integrations/mi-cli') return '/authorizations/mi-cli'
  return ROUTE_PATTERNS.some((pattern) => pattern.test(value)) ? value : APP_DEFAULT_ROUTE
}

export function shouldRememberRoute(path: string): boolean {
  return path !== '/' && path !== '/settings' && Boolean(path)
}
