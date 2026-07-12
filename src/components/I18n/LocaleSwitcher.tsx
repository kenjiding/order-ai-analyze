import { Select } from 'antd'
import { Languages } from 'lucide-react'
import { useAppLocale } from '../../i18n/hooks'
import type { AppLocale } from '../../i18n/types'

type Props = {
  className?: string
  /** 紧凑模式：仅图标 + 下拉，适合页头工具栏 */
  compact?: boolean
  /** 标题行内嵌：无边框、宽度随文案、无语言图标 */
  inline?: boolean
}

/** 全局可复用的语言切换器；后续可挂到 Layout 顶栏 */
export function LocaleSwitcher({ className, compact = false, inline = false }: Props) {
  const { locale, setLocale, locales, localeLabels } = useAppLocale()
  const showIcon = compact && !inline

  return (
    <div
      className={[
        'flex items-center gap-2',
        inline ? 'vs-locale-switch--inline shrink-0' : '',
        className ?? '',
      ].join(' ')}
    >
      {showIcon ? <Languages className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
      <Select<AppLocale>
        value={locale}
        onChange={setLocale}
        variant={inline ? 'borderless' : undefined}
        popupMatchSelectWidth={false}
        className={
          inline ? 'vs-locale-select-inline !w-auto' : compact ? '!w-[132px]' : '!w-40'
        }
        options={locales.map((l) => ({ value: l, label: localeLabels[l] }))}
        aria-label="Language"
      />
    </div>
  )
}
