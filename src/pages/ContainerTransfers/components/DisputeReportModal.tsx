import { useState } from 'react'
import { Alert, Button, Input, Modal } from 'antd'
import { useTranslation } from 'react-i18next'
import type { Transfer, TransferLineDraft } from '../../../containerManagement/types'
import { TransferImageUpload } from './TransferImageUpload'
import { TransferLineItemsInput } from './TransferLineItemsInput'

type Props = {
  target: Transfer | null
  isUpdate?: boolean
  submitting: boolean
  onCancel: () => void
  onSubmit: (
    lines: TransferLineDraft[],
    reason: string,
    imageUrl: string | null,
    isUpdate: boolean,
    transferId: number,
  ) => Promise<boolean>
}

export function DisputeReportModal({ target, isUpdate = false, submitting, onCancel, onSubmit }: Props) {
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
  const [lines, setLines] = useState<TransferLineDraft[]>(() =>
    (target?.items ?? []).map((item) => ({
      containerType: item.containerType,
      quantity: String(item.receivedQuantity ?? item.declaredQuantity),
    })),
  )
  const [reason, setReason] = useState(target?.receiverReportReason ?? '')
  const [imageUrl, setImageUrl] = useState<string | null>(target?.receiverReportImageUrl ?? null)
  const [error, setError] = useState<string | null>(null)

  if (!target) return null

  const maxByType = Object.fromEntries(
    target.items.map((item) => [item.containerType, item.declaredQuantity]),
  )

  const handleOk = async () => {
    for (const line of lines) {
      if (!line.quantity.trim()) {
        setError(t('transfers.errAllReceivedQty'))
        return
      }
      const quantity = Number(line.quantity)
      const max = maxByType[line.containerType]
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > max) {
        setError(t('transfers.errReceivedRange', { max }))
        return
      }
    }
    if (!reason.trim()) {
      setError(t('transfers.errEnterReason'))
      return
    }
    setError(null)
    await onSubmit(lines, reason.trim(), imageUrl, isUpdate, target.id)
  }

  return (
    <Modal
      title={isUpdate ? t('transfers.disputeUpdateTitle') : t('transfers.disputeCreateTitle')}
      open
      onCancel={onCancel}
      destroyOnHidden
      width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button type="primary" loading={submitting} onClick={() => void handleOk()}>
            {t('transfers.disputeSubmit')}
          </Button>
        </div>
      }
    >
      <Alert className="mt-4" type="warning" showIcon message={t('transfers.disputeWarning')} />

      <div className="mt-4 flex flex-col gap-1.5">
        <span className="text-sm text-slate-700">
          {t('transfers.receivedQty')} <span className="text-rose-500">*</span>
        </span>
        <p className="text-xs text-slate-500">{t('transfers.receivedQtyHint')}</p>
        <TransferLineItemsInput
          lines={lines}
          onChange={setLines}
          maxByType={maxByType}
          minQuantity={0}
        />
      </div>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-sm text-slate-700">
          {t('transfers.reason')} <span className="text-rose-500">*</span>
        </span>
        <Input.TextArea
          rows={3}
          value={reason}
          maxLength={2000}
          placeholder={t('transfers.disputeReasonPlaceholder')}
          onChange={(e) => setReason(e.target.value)}
          allowClear
        />
      </label>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-sm text-slate-700">{t('transfers.evidenceOptional')}</span>
        <TransferImageUpload value={imageUrl} onChange={setImageUrl} />
      </label>

      {error ? <Alert className="mt-4" type="error" showIcon message={error} /> : null}
    </Modal>
  )
}
