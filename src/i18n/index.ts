import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resolveInitialLocale, writeStoredLocale } from './storage'
import { syncAppLocaleSideEffects } from './syncLocale'
import { DEFAULT_LOCALE, type AppLocale } from './types'

/** 按业务域划分 namespace，新增页面时在此注册并补充 locales/<locale>/<ns>.json */
export const I18N_NAMESPACES = [
  'common',
  'menu',
  'login',
  'settings',
  'permission',
  'vendorSnapshot',
  'exitAlarm',
  'dispatchAlarm',
  'dispatchPerformance',
  'exitRateQuery',
  'chaseDispatch',
  'chaseDispatchShare',
  'workOrderPush',
  'container',
  'scannerEfficiency',
  'efficiencyRecords',
  'wageSalary',
  'warehouseSafety',
  'attendanceWorkTime',
  'orderException',
  'newMerchant',
  'problemPackage',
  'vendorAnalysis',
  'vendorRegionMap',
  'packageLoss',
  'pushEngagement',
  'pushNotifications',
  'systemUsers',
  'supplierConfig',
  'priorityClients',
  'regionPackagePrice',
  'warehouseSettings',
] as const

export type I18nNamespace = (typeof I18N_NAMESPACES)[number]

// ponytail: static imports per ns; add lazy loading only if bundle size becomes an issue
function loadNs(locale: 'zh-CN' | 'en', ns: string): Record<string, unknown> {
  const modules = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<
    string,
    { default: Record<string, unknown> }
  >
  const hit = modules[`./locales/${locale}/${ns}.json`]
  return hit?.default ?? {}
}

export const i18nResources = {
  'zh-CN': Object.fromEntries(I18N_NAMESPACES.map((ns) => [ns, loadNs('zh-CN', ns)])),
  en: Object.fromEntries(I18N_NAMESPACES.map((ns) => [ns, loadNs('en', ns)])),
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
  writeStoredLocale(lng as AppLocale)
  syncAppLocaleSideEffects(lng as AppLocale)
  if (typeof document !== 'undefined') {
    document.title = i18n.t('common:appTitle')
  }
})

syncAppLocaleSideEffects(resolveInitialLocale())
if (typeof document !== 'undefined') {
  document.title = i18n.t('common:appTitle')
}

export { i18n }

export function changeAppLocale(locale: AppLocale): Promise<void> {
  return i18n.changeLanguage(locale).then(() => undefined)
}

export function getDateTimeLocale(locale: AppLocale): string {
  return locale === 'en' ? 'en-AU' : 'zh-CN'
}
