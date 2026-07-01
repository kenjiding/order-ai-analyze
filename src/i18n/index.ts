import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCNCommon from './locales/zh-CN/common.json'
import enCommon from './locales/en/common.json'
import zhCNVendorSnapshot from './locales/zh-CN/vendorSnapshot.json'
import enVendorSnapshot from './locales/en/vendorSnapshot.json'
import { resolveInitialLocale, writeStoredLocale } from './storage'
import { DEFAULT_LOCALE, type AppLocale } from './types'

/** 按业务域划分 namespace，新增页面时在此注册并补充 locales/<locale>/<ns>.json */
export const I18N_NAMESPACES = ['common', 'vendorSnapshot'] as const

export type I18nNamespace = (typeof I18N_NAMESPACES)[number]

export const i18nResources = {
  'zh-CN': {
    common: zhCNCommon,
    vendorSnapshot: zhCNVendorSnapshot,
  },
  en: {
    common: enCommon,
    vendorSnapshot: enVendorSnapshot,
  },
} as const

void i18n.use(initReactI18next).init({
  resources: i18nResources,
  lng: resolveInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: 'common',
  ns: [...I18N_NAMESPACES],
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
})

i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng
  }
  writeStoredLocale(lng as AppLocale)
})

if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.language
}

export { i18n }

export function changeAppLocale(locale: AppLocale): Promise<void> {
  return i18n.changeLanguage(locale).then(() => undefined)
}

export function getDateTimeLocale(locale: AppLocale): string {
  return locale === 'en' ? 'en-AU' : 'zh-CN'
}
