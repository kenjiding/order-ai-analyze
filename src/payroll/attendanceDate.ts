import { parse, format, isValid } from 'date-fns'

export function isWeekendWorkday(workdayValue: unknown): boolean {
  if (!workdayValue) return false
  const normalized = workdayValue.toString().trim().toLowerCase()
  if (!normalized) return false
  const weekendKeywords = ['周六', '星期六', '周日', '星期日', 'saturday', 'sunday', 'sat', 'sun']
  return weekendKeywords.some((keyword) => normalized.includes(keyword))
}

/** 解析各种日期格式，统一返回 Date；优先处理澳大利亚格式 DD/MM/YYYY */
export function parseDate(dateValue: unknown): Date | null {
  if (!dateValue) return null

  if (dateValue instanceof Date && isValid(dateValue)) {
    return dateValue
  }

  if (typeof dateValue === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30))
    const milliseconds = dateValue * 24 * 60 * 60 * 1000
    return new Date(excelEpoch.getTime() + milliseconds)
  }

  if (typeof dateValue === 'string') {
    const dateStr = dateValue.trim()

    const australianFormats = ['dd/MM/yyyy', 'd/M/yyyy', 'dd-MM-yyyy', 'd-M-yyyy']
    for (const formatStr of australianFormats) {
      try {
        const parsedDate = parse(dateStr, formatStr, new Date())
        if (isValid(parsedDate)) {
          return parsedDate
        }
      } catch {
        /* try next */
      }
    }

    try {
      const isoDate = parse(dateStr, 'yyyy-MM-dd', new Date())
      if (isValid(isoDate)) {
        return isoDate
      }
    } catch {
      /* continue */
    }

    const fallbackDate = new Date(dateStr)
    if (isValid(fallbackDate)) {
      return fallbackDate
    }
  }

  return null
}

export function formatDateDisplay(dateValue: unknown): string {
  if (!dateValue) return '-'

  const date = parseDate(dateValue)
  if (!date || !isValid(date)) {
    return typeof dateValue === 'string' ? dateValue : '-'
  }

  return format(date, 'yyyy/M/d')
}

export function formatWorkdayDisplay(workdayValue: unknown): string {
  if (!workdayValue) return '-'
  const workdayStr = workdayValue.toString()
  return workdayStr.replace(/周天/g, '周日')
}

/** YYYY-MM-DD，使用本地日期 */
export function convertDateToStandard(dateValue: unknown): string {
  if (!dateValue) return ''

  const date = parseDate(dateValue)
  if (!date || !isValid(date)) {
    return typeof dateValue === 'string' ? dateValue : ''
  }

  return format(date, 'yyyy-MM-dd')
}
