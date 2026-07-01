import { Select } from 'antd'
import { Languages } from 'lucide-react'
import { useAppLocale } from '../../i18n/hooks'
import type { AppLocale } from '../../i18n/types'

type Props = {
  className?: string
  /** 紧凑模式：仅图标 + 下拉，适合页头工具栏 */
  compact?: boolean
}

/** 全局可复用的语言切换器；后续可挂到 Layout 顶栏 */
export function LocaleSwitcher({ className, compact = false }: Props) {
  const { locale, setLocale, locales, localeLabels } = useAppLocale()

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      {compact ? <Languages className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
      <Select<AppLocale>
        value={locale}
        onChange={setLocale}
        className={compact ? '!w-[132px]' : '!w-40'}
        options={locales.map((l) => ({ value: l, label: localeLabels[l] }))}
        aria-label="Language"
      />
    </div>
  )
}
