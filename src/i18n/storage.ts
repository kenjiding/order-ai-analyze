import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from './types'

const LOCALE_STORAGE_KEY = 'app_locale_v1'

export function readStoredLocale(): AppLocale | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (raw && isAppLocale(raw)) return raw
  } catch {
    /* ignore */
  }
  return null
}

export function writeStoredLocale(locale: AppLocale): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    /* ignore */
  }
}

export function resolveInitialLocale(): AppLocale {
  return readStoredLocale() ?? DEFAULT_LOCALE
}
