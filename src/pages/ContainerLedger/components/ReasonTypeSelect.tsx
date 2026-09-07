import { Select, Tooltip } from 'antd'
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  FILTER_BALANCE_REASON_TYPES,
  MANUAL_BALANCE_REASON_TYPES,
} from '../../../containerManagement/constants'
import type { BalanceReasonType } from '../../../containerManagement/types'

type Props = {
  value?: BalanceReasonType
  onChange?: (value: BalanceReasonType) => void
  /** 筛选场景加「全部」选项 */
  includeAll?: boolean
  placeholder?: string
  className?: string
}

export function ReasonTypeSelect({ value, onChange, includeAll, placeholder, className }: Props) {
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')

  const options = MANUAL_BALANCE_REASON_TYPES.map((type) => ({
    value: type,
    label: (
      <span className="inline-flex items-center gap-1.5">
        {t(`balanceReasonType.${type}`)}
        <Tooltip title={t(`balanceReasonTypeHint.${type}`)}>
          <Info className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
        </Tooltip>
      </span>
    ),
  }))

  return (
    <Select
      className={className ?? 'w-full'}
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? t('selectPlaceholder')}
      allowClear={includeAll}
      options={
        includeAll
          ? [
              { value: '', label: tc('all') },
              ...FILTER_BALANCE_REASON_TYPES.filter(
                (type) => !MANUAL_BALANCE_REASON_TYPES.includes(type),
              ).map((type) => ({
                value: type,
                label: t(`balanceReasonType.${type}`),
              })),
              ...options,
            ]
          : options
      }
    />
  )
}
