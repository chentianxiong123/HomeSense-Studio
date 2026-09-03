const CHINA_TIME_ZONE = 'Asia/Shanghai'

export function parseAppDate(raw: string | number | Date | undefined | null): Date | null {
  if (raw == null || raw === '') return null
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  if (typeof raw === 'number') {
    const date = new Date(raw)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const trimmed = raw.trim()
  if (!trimmed) return null
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatChinaTime(raw: string | number | Date | undefined | null): string {
  const date = parseAppDate(raw)
  if (!date) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatChinaDate(raw: string | number | Date | undefined | null): string {
  const date = parseAppDate(raw)
  if (!date) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function formatChinaDateTime(raw: string | number | Date | undefined | null): string {
  const date = parseAppDate(raw)
  if (!date) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function isSameChinaDate(left: string | number | Date | undefined | null, right: string | number | Date | undefined | null): boolean {
  const leftDate = parseAppDate(left)
  const rightDate = parseAppDate(right)
  if (!leftDate || !rightDate) return false
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(leftDate) === formatter.format(rightDate)
}
