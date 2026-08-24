import { Select, Tooltip } from 'antd'
import { Info } from 'lucide-react'
import {
  MANUAL_BALANCE_REASON_TYPES,
  balanceReasonTypeHint,
  balanceReasonTypeLabel,
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
  const options = MANUAL_BALANCE_REASON_TYPES.map((type) => ({
    value: type,
    label: (
      <span className="inline-flex items-center gap-1.5">
        {balanceReasonTypeLabel[type]}
        <Tooltip title={balanceReasonTypeHint[type]}>
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
      placeholder={placeholder ?? '请选择'}
      allowClear={includeAll}
      options={
        includeAll
          ? [
              { value: '', label: '全部' },
              // 流转记账不是手工原因，但筛选时需要能选中
              { value: 'TRANSFER_SETTLEMENT', label: balanceReasonTypeLabel.TRANSFER_SETTLEMENT },
              ...options,
            ]
          : options
      }
    />
  )
}
