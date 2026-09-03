import { describe, expect, it } from 'vitest'
import { formatChinaDateTime, formatChinaTime, formatCommonDateTime, parseAppDate } from './chinaTime'

describe('chinaTime', () => {
  it('parses legacy SQLite UTC timestamps and displays China time', () => {
    expect(parseAppDate('2026-05-30 04:43:35')?.toISOString()).toBe('2026-05-30T04:43:35.000Z')
    expect(formatChinaTime('2026-05-30 04:43:35')).toBe('12:43')
  })

  it('keeps ISO timestamps in China time display', () => {
    expect(formatChinaDateTime('2026-05-30T04:43:35.000Z')).toContain('12:43')
  })

  it('formats file timestamps in a common date time shape', () => {
    expect(formatCommonDateTime('2026-05-30T04:43:35.000Z')).toBe('2026-05-30 12:43')
  })
})
