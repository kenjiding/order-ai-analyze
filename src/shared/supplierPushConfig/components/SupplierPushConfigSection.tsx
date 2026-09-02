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
  /**
   * 是否要求供应商「可推送」（配了 Webhook 或飞书群 Chat ID）才允许勾选，默认 true。
   * 纯统计类表单不推送消息，应传 false，见 SupplierPushSelectionGrid.requirePushable。
   */
  requirePushable?: boolean
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
  requirePushable = true,
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
          requirePushable={requirePushable}
          onToggle={handleToggle}
          // 本组件是受控的（handleToggle 每次都读同一份 props.value），逐条 toggle 只有最后一次生效
          onBulkChange={onChange}
        />
      }
    >
      <SupplierPushSelectionGrid
        configs={configs}
        enabledIdSet={enabledIdSet}
        disabled={disabled}
        saving={catalogLoading}
        columns={columns}
        requirePushable={requirePushable}
        onToggle={handleToggle}
      />
      {footnote ? <p className="mt-3 text-xs text-slate-400">{footnote}</p> : null}
    </FormSection>
  )
}
