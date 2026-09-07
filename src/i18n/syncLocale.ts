import dayjs from 'dayjs'
import 'dayjs/locale/en'
import 'dayjs/locale/zh-cn'
import type { AppLocale } from './types'

export function syncAppLocaleSideEffects(locale: AppLocale): void {
  dayjs.locale(locale === 'en' ? 'en' : 'zh-cn')
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}
