import type { AlistAuthorizationRecord } from '@/api/alist'

export function defaultMountPath(auth: AlistAuthorizationRecord): string {
  const base = auth.name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-')
  return `/${base || auth.driver || 'storage'}`
}

export function normalizeVirtualPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  if (!normalized) return ''
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return withSlash.replace(/\/+$/, '') || '/'
}

export function joinVirtualPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '') || '/'}/${name}`.replace(/\/+/g, '/')
}

export function authSummary(auth: AlistAuthorizationRecord): string {
  const rootPath = typeof auth.props?.root_path === 'string' ? auth.props.root_path : ''
  if (auth.driver === 'local') return rootPath || auth.endpoint
  return [auth.endpoint, rootPath].filter(Boolean).join(' · ')
}

export function formatSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function propsSafeMessage(prefix: string, value: string): string {
  return `${prefix}: ${value}`
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
