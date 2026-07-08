import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { changeAppLocale } from './index'
import { APP_LOCALES, LOCALE_LABELS, type AppLocale } from './types'

/* eslint-disable react-refresh/only-export-components */

export function useAppLocale() {
  const { i18n } = useTranslation()

  const locale = i18n.language as AppLocale

  const setLocale = useCallback((next: AppLocale) => {
    void changeAppLocale(next)
  }, [])

  return {
    locale,
    setLocale,
    locales: APP_LOCALES,
    localeLabels: LOCALE_LABELS,
  }
}

/** 页面级 namespace 快捷 hook，避免重复写 namespace 字符串 */
export function useVendorSnapshotTranslation() {
  return useTranslation('vendorSnapshot')
}
