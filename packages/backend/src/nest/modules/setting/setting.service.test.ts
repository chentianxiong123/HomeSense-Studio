import { describe, expect, it, beforeEach } from 'vitest'
import { SettingService } from './setting.service.js'

describe('SettingService', () => {
  let svc: SettingService

  beforeEach(() => {
    svc = new SettingService()
  })

  it('starts empty', () => {
    expect(svc.list()).toEqual([])
  })

  it('sets and gets a value', () => {
    svc.set('theme', 'dark')
    expect(svc.get('theme')).toEqual({ key: 'theme', value: 'dark' })
  })

  it('returns undefined for missing key', () => {
    expect(svc.get('nope')).toBeUndefined()
  })

  it('lists all stored values', () => {
    svc.set('a', 1)
    svc.set('b', 'two')
    const list = svc.list()
    expect(list).toHaveLength(2)
    expect(list).toContainEqual({ key: 'a', value: 1 })
    expect(list).toContainEqual({ key: 'b', value: 'two' })
  })

  it('deletes an existing key', () => {
    svc.set('temp', 'x')
    expect(svc.delete('temp')).toBe(true)
    expect(svc.get('temp')).toBeUndefined()
  })

  it('returns false when deleting missing key', () => {
    expect(svc.delete('nope')).toBe(false)
  })

  it('overwrites on duplicate set', () => {
    svc.set('k', 1)
    svc.set('k', 2)
    expect(svc.get('k')).toEqual({ key: 'k', value: 2 })
    expect(svc.list()).toHaveLength(1)
  })
})
