import { describe, expect, it } from 'vitest'
import { APP_DEFAULT_ROUTE, LAST_ROUTE_STORAGE_KEY, normalizeRememberedRoute, shouldRememberRoute } from './navigation'

describe('normalizeRememberedRoute', () => {
  it('falls back to the app home route when storage is empty or invalid', () => {
    expect(normalizeRememberedRoute(null)).toBe(APP_DEFAULT_ROUTE)
    expect(normalizeRememberedRoute('http://example.com')).toBe(APP_DEFAULT_ROUTE)
    expect(normalizeRememberedRoute('/unknown')).toBe(APP_DEFAULT_ROUTE)
  })

  it('accepts supported first-class routes and nested Studio detail routes', () => {
    expect(normalizeRememberedRoute('/home')).toBe('/home')
    expect(normalizeRememberedRoute('/chat')).toBe('/chat')
    expect(normalizeRememberedRoute('/studio')).toBe('/studio')
    expect(normalizeRememberedRoute('/workspace')).toBe('/workspace')
    expect(normalizeRememberedRoute('/devices')).toBe('/devices')
    expect(normalizeRememberedRoute('/integrations')).toBe('/integrations')
    expect(normalizeRememberedRoute('/studio/workflows/9/editor')).toBe('/studio/workflows/9/editor')
    expect(normalizeRememberedRoute('/assets/device-skills/device_skill.tv_box/overview')).toBe('/assets/device-skills/device_skill.tv_box/overview')
    expect(normalizeRememberedRoute('/assets/manifests/cli.mi_adb/overview')).toBe('/assets/manifests/cli.mi_adb/overview')
    expect(normalizeRememberedRoute('/assets/memory/memory.experience_path.workflow.7/overview')).toBe('/assets/memory/memory.experience_path.workflow.7/overview')
  })
})

describe('shouldRememberRoute', () => {
  it('tracks application routes but ignores transient shell routes', () => {
    expect(shouldRememberRoute('/')).toBe(false)
    expect(shouldRememberRoute('/settings')).toBe(false)
    expect(shouldRememberRoute('/home')).toBe(true)
    expect(shouldRememberRoute('/studio')).toBe(true)
    expect(shouldRememberRoute('/chat')).toBe(true)
    expect(shouldRememberRoute('/workspace')).toBe(true)
    expect(shouldRememberRoute('/devices')).toBe(true)
    expect(shouldRememberRoute('/integrations')).toBe(true)
  })
})

describe('route storage constants', () => {
  it('exposes stable defaults for persisted navigation state', () => {
    expect(APP_DEFAULT_ROUTE).toBe('/home')
    expect(LAST_ROUTE_STORAGE_KEY).toContain('last-route')
  })
})
