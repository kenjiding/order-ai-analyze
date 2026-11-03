/**
 * 容器数量水位线告警：每个启用品类一行，下限/上限留空表示不检查该方向。
 * 推送目标复用同一张表单上方的「流转通知」配置，这里不再重复选群。
 */
import { InputNumber, Space } from 'antd'
import { useTranslation } from 'react-i18next'
import { useActiveContainerTypes } from '../../../containerManagement/containerTypeStore'

export type ThresholdDraft = { minQty: string; maxQty: string }
export type ThresholdDraftMap = Record<string, ThresholdDraft>

type Props = {
  value: ThresholdDraftMap
  onChange: (next: ThresholdDraftMap) => void
}

export function AccountThresholdFields({ value, onChange }: Props) {
  const { t } = useTranslation('container')
  const types = useActiveContainerTypes()

  const update = (containerType: string, patch: Partial<ThresholdDraft>) => {
    const current = value[containerType] ?? { minQty: '', maxQty: '' }
    onChange({ ...value, [containerType]: { ...current, ...patch } })
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {types.map((type) => {
          const row = value[type.code] ?? { minQty: '', maxQty: '' }
          return (
            <Space.Compact key={type.code} block>
              <Space.Addon>{t(`containerType.${type.code}`)}</Space.Addon>
              <InputNumber
                style={{ width: '50%' }}
                min={0}
                step={1}
                precision={0}
                placeholder={t('accounts.thresholdMin')}
                value={row.minQty === '' ? null : Number(row.minQty)}
                onChange={(next) => update(type.code, { minQty: next === null ? '' : String(next) })}
              />
              <InputNumber
                style={{ width: '50%' }}
                min={0}
                step={1}
                precision={0}
                placeholder={t('accounts.thresholdMax')}
                value={row.maxQty === '' ? null : Number(row.maxQty)}
                onChange={(next) => update(type.code, { maxQty: next === null ? '' : String(next) })}
              />
            </Space.Compact>
          )
        })}
      </div>
      <p className="m-0 text-xs text-slate-500">{t('accounts.thresholdHint')}</p>
    </div>
  )
}
