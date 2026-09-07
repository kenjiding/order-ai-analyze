import { Select } from 'antd'
import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppLocale } from '../../i18n/hooks'
import type { AppLocale } from '../../i18n/types'

type Props = {
  className?: string
  /** 顶栏工具栏：与 GlobalStationSelector 同款无边框 + 左侧图标 */
  toolbar?: boolean
  /** 标题行内嵌：无边框、宽度随文案、无语言图标（日报/门户页） */
  inline?: boolean
}

/** 全局可复用的语言切换器 */
export function LocaleSwitcher({ className, toolbar = false, inline = false }: Props) {
  const { t } = useTranslation('common')
  const { locale, setLocale, locales, localeLabels } = useAppLocale()

  const options = locales.map((l) => ({ value: l, label: localeLabels[l] }))

  if (inline) {
    return (
      <div className={['vs-locale-switch--inline shrink-0 flex items-center', className ?? ''].join(' ')}>
        <Select<AppLocale>
          value={locale}
          onChange={setLocale}
          variant="borderless"
          popupMatchSelectWidth={false}
          className="vs-locale-select-inline !w-auto"
          options={options}
          aria-label={t('language')}
        />
      </div>
    )
  }

  if (toolbar) {
    return (
      <div className={['flex items-center', className ?? ''].join(' ')}>
        <Languages className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <Select<AppLocale>
          variant="borderless"
          value={locale}
          onChange={setLocale}
          options={options}
          suffixIcon={null}
          popupMatchSelectWidth={false}
          aria-label={t('language')}
        />
      </div>
    )
  }

  return (
    <div className={['flex items-center gap-2', className ?? ''].join(' ')}>
      <Languages className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      <Select<AppLocale>
        value={locale}
        onChange={setLocale}
        popupMatchSelectWidth={false}
        className="!w-40"
        options={options}
        aria-label={t('language')}
      />
    </div>
  )
}
