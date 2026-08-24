import { Button, InputNumber, Select } from 'antd'
import { Plus, Trash2 } from 'lucide-react'
import { CONTAINER_TYPES, containerTypeLabel } from '../../../containerManagement/constants'
import type { ContainerType, TransferLineDraft } from '../../../containerManagement/types'

type Props = {
  lines: TransferLineDraft[]
  onChange: (lines: TransferLineDraft[]) => void
  /** 差异申报场景：品类固定，只填数量，且上限是申报数 */
  lockedTypes?: boolean
  maxByType?: Record<string, number>
  minQuantity?: number
  disabled?: boolean
  error?: string | null
}

export function TransferLineItemsInput({
  lines,
  onChange,
  lockedTypes,
  maxByType,
  minQuantity = 1,
  disabled,
  error,
}: Props) {
  const usedTypes = new Set(lines.map((line) => line.containerType))
  const canAdd = !lockedTypes && !disabled && lines.length < CONTAINER_TYPES.length

  const update = (index: number, patch: Partial<TransferLineDraft>) => {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  return (
    <div className="space-y-2">
      {lines.map((line, index) => {
        const max = maxByType?.[line.containerType]
        return (
          <div key={`${line.containerType}-${index}`} className="flex items-center gap-2">
            <Select
              className="w-40"
              value={line.containerType}
              disabled={lockedTypes || disabled}
              onChange={(value) => update(index, { containerType: value as ContainerType })}
              options={CONTAINER_TYPES.map((type) => ({
                value: type,
                label: containerTypeLabel[type],
                disabled: type !== line.containerType && usedTypes.has(type),
              }))}
            />
            <InputNumber
              className="flex-1"
              min={minQuantity}
              max={max}
              step={1}
              precision={0}
              disabled={disabled}
              placeholder={max === undefined ? '数量' : `0 ~ ${max}`}
              value={line.quantity === '' ? null : Number(line.quantity)}
              onChange={(value) => update(index, { quantity: value === null ? '' : String(value) })}
            />
            {!lockedTypes ? (
              <Button
                type="text"
                danger
                disabled={disabled || lines.length <= 1}
                icon={<Trash2 className="h-4 w-4" aria-hidden />}
                onClick={() => onChange(lines.filter((_, i) => i !== index))}
                aria-label="移除该行"
              />
            ) : (
              <span className="w-8 shrink-0" />
            )}
          </div>
        )
      })}
      {canAdd ? (
        <Button
          type="dashed"
          className="w-full"
          icon={<Plus className="h-4 w-4" aria-hidden />}
          onClick={() => {
            const next = CONTAINER_TYPES.find((type) => !usedTypes.has(type))
            if (!next) return
            onChange([...lines, { containerType: next, quantity: '' }])
          }}
        >
          添加品类
        </Button>
      ) : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </div>
  )
}
