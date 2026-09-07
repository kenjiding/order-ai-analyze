import { InputNumber, Space } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ContainerType, TransferLineDraft } from '../../../containerManagement/types'

type Props = {
  lines: TransferLineDraft[]
  onChange: (lines: TransferLineDraft[]) => void
  maxByType?: Record<string, number>
  minQuantity?: number
  disabled?: boolean
  error?: string | null
}

export function TransferLineItemsInput({
  lines,
  onChange,
  maxByType,
  minQuantity = 1,
  disabled,
  error,
}: Props) {
  const { t } = useTranslation('container')

  const update = (type: ContainerType, quantity: string) => {
    onChange(lines.map((line) => (line.containerType === type ? { ...line, quantity } : line)))
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {lines.map((line) => {
          const max = maxByType?.[line.containerType]
          return (
            <Space.Compact key={line.containerType} block>
              <Space.Addon>{t(`containerType.${line.containerType}`)}</Space.Addon>
              <InputNumber
                style={{ width: '100%' }}
                min={minQuantity}
                max={max}
                step={1}
                precision={0}
                disabled={disabled}
                placeholder={
                  max === undefined ? t('transfers.qtyPlaceholder') : t('transfers.qtyRangePlaceholder', { max })
                }
                value={line.quantity === '' ? null : Number(line.quantity)}
                onChange={(value) =>
                  update(line.containerType, value === null ? '' : String(value))
                }
              />
            </Space.Compact>
          )
        })}
      </div>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </div>
  )
}
