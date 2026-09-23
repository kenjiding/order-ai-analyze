/** 不在 SPA Router 内的独立 HTML；登录后必须整页跳回，不能 navigate */
export const DELIVERING_NOTIFY_ENTRY = '/delivering-notify.html'
export const RETURN_TO_MERCHANT_ENTRY = '/return-to-merchant.html'
export const SCAN_STAT_ENTRY = '/scan-stat.html'

const STANDALONE_HTML_ENTRIES = new Set([
  DELIVERING_NOTIFY_ENTRY,
  RETURN_TO_MERCHANT_ENTRY,
  SCAN_STAT_ENTRY,
])

export function deliveringNotifyLoginHref(): string {
  return `/login?from=${encodeURIComponent(DELIVERING_NOTIFY_ENTRY)}`
}

export function returnToMerchantLoginHref(): string {
  return `/login?from=${encodeURIComponent(RETURN_TO_MERCHANT_ENTRY)}`
}

export function scanStatLoginHref(): string {
  return `/login?from=${encodeURIComponent(SCAN_STAT_ENTRY)}`
}

/** 只接受站内相对路径，避免 open redirect */
export function readSafeLoginReturnTo(search: string, stateFrom?: unknown): string | null {
  const fromState = typeof stateFrom === 'string' ? stateFrom.trim() : ''
  const fromQuery = new URLSearchParams(search).get('from')?.trim() ?? ''
  const raw = fromState || fromQuery
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://')) return null
  return raw
}

export function leaveLoginTo(
  target: string,
  navigate: (to: string, opts: { replace: boolean }) => void,
): void {
  const pathname = target.split('?')[0] ?? target
  if (STANDALONE_HTML_ENTRIES.has(pathname)) {
    window.location.replace(target)
    return
  }
  navigate(target, { replace: true })
}
