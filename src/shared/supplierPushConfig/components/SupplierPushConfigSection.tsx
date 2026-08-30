import { Truck } from 'lucide-react'
import type { ReactNode } from 'react'
import { FormSection } from '../../../components/FormSection'
import type { SupplierPushConfig } from '../types'
import { SupplierPushSelectAllButtons, SupplierPushSelectionGrid } from './SupplierPushSelectionGrid'

type Props = {
  configs: SupplierPushConfig[]
  /** 已选中的供应商配置 id */
  value: string[]
  onChange: (ids: string[]) => void
  title?: string
  description?: string
  disabled?: boolean
  catalogLoading?: boolean
  columns?: 4 | 5
  /** 卡片下方补充说明 */
  footnote?: ReactNode
}

/**
 * 「供应商配置」分组：全选/清空 + 供应商多选卡片网格。
 * 派签告警、出仓派签达成分析等按供应商圈选范围的表单共用同一套 UI。
 */
export function SupplierPushConfigSection({
  configs,
  value,
  onChange,
  title = '供应商配置',
  description,
  disabled = false,
  catalogLoading = false,
  columns = 4,
  footnote,
}: Props) {
  const enabledIdSet = new Set(value)
  const handleToggle = (id: string, next: boolean) =>
    onChange(next ? [...value, id] : value.filter((x) => x !== id))

  return (
    <FormSection
      icon={Truck}
      title={title}
      description={description}
      action={
        <SupplierPushSelectAllButtons
          configs={configs}
          enabledIdSet={enabledIdSet}
          disabled={disabled}
          saving={catalogLoading}
          onToggle={handleToggle}
        />
      }
    >
      <SupplierPushSelectionGrid
        configs={configs}
        enabledIdSet={enabledIdSet}
        disabled={disabled}
        saving={catalogLoading}
        columns={columns}
        onToggle={handleToggle}
      />
      {footnote ? <p className="mt-3 text-xs text-slate-400">{footnote}</p> : null}
    </FormSection>
  )
}
