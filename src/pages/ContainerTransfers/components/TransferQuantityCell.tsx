import { useTranslation } from 'react-i18next'
import type { Transfer, TransferItem } from '../../../containerManagement/types'

function LineQuantity({ item, status }: { item: TransferItem; status: Transfer['status'] }) {
  const { t } = useTranslation('container')
  const label = t(`containerType.${item.containerType}`)

  if (status === 'CONFIRMED' && item.settledQuantity !== null && item.settledQuantity !== item.declaredQuantity) {
    return (
      <span title={t('transfers.declaredToSettled')}>
        <span className="text-slate-500">{t('transfers.quantityLabel', { type: label })}</span>
        <span className="text-amber-700">{item.declaredQuantity}</span>
        <span className="mx-1 text-slate-400">→</span>
        <span className="font-semibold text-emerald-700">{item.settledQuantity}</span>
      </span>
    )
  }

  if (status === 'DISPUTED' && item.receivedQuantity !== null && item.receivedQuantity !== item.declaredQuantity) {
    return (
      <span title={t('transfers.declaredToReceived')}>
        <span className="text-slate-500">{t('transfers.quantityLabel', { type: label })}</span>
        <span className="text-amber-700">{item.declaredQuantity}</span>
        <span className="mx-1 text-slate-400">→</span>
        <span className="font-semibold text-violet-700">{item.receivedQuantity}</span>
      </span>
    )
  }

  return (
    <span>
      <span className="text-slate-500">{t('transfers.quantityLabel', { type: label })}</span>
      <span className="font-medium">{item.declaredQuantity}</span>
    </span>
  )
}

export function TransferQuantityCell({ transfer }: { transfer: Transfer }) {
  return (
    <div className="space-y-0.5 text-right text-sm tabular-nums">
      {transfer.items.map((item) => (
        <div key={item.containerType}>
          <LineQuantity item={item} status={transfer.status} />
        </div>
      ))}
    </div>
  )
}
