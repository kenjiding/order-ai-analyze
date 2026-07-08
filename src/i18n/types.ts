/** 应用支持的 UI 语言；新增语言时同步扩展 resources 与 antd locale 映射。 */
export const APP_LOCALES = ['zh-CN', 'en'] as const

export type AppLocale = (typeof APP_LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = 'zh-CN'

export const LOCALE_LABELS: Record<AppLocale, string> = {
  'zh-CN': '简体中文',
  en: 'English',
}

export function isAppLocale(value: string): value is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(value)
}
