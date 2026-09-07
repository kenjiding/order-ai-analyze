import { useState } from 'react'
import { Alert, Button, Input, Modal } from 'antd'
import { useTranslation } from 'react-i18next'
import { formatTransferNo } from '../../../containerManagement/constants'
import type { Transfer } from '../../../containerManagement/types'

export type TransferRemoveMode = 'delete' | 'void'

type Props = {
  target: Transfer | null
  mode: TransferRemoveMode
  submitting: boolean
  onCancel: () => void
  onSubmit: (reason: string) => Promise<boolean>
}

export function TransferDeleteModal({ target, mode, submitting, onCancel, onSubmit }: Props) {
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleOk = async () => {
    const emptyError = mode === 'void' ? t('transfers.errVoidReason') : t('transfers.errDeleteReason')
    if (!reason.trim()) {
      setError(emptyError)
      return
    }
    setError(null)
    await onSubmit(reason.trim())
  }

  return (
    <Modal
      title={mode === 'void' ? t('transfers.voidTitle') : t('transfers.deleteTitle')}
      open={target !== null}
      onCancel={onCancel}
      destroyOnHidden
      width={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button danger type="primary" loading={submitting} onClick={() => void handleOk()}>
            {mode === 'void' ? t('transfers.confirmVoid') : t('transfers.confirmDelete')}
          </Button>
        </div>
      }
    >
      {target ? (
        <p className="mt-4 text-sm text-slate-600">
          {t('transfers.removeWill', {
            action:
              mode === 'void' ? t('transfers.removeActionVoid') : t('transfers.removeActionDelete'),
          })}{' '}
          <span className="font-mono">{formatTransferNo(target.id)}</span>（{target.fromAccountName}{' '}
          → {target.toAccountName}）。
          {mode === 'void' ? (
            <>
              {' '}
              {t('transfers.voidReverseDetail', {
                count: target.settledTotal ?? 0,
                to: target.toAccountName,
                from: target.fromAccountName,
              })}
            </>
          ) : null}
        </p>
      ) : null}
      <Alert
        className="mt-3"
        type="warning"
        showIcon
        message={mode === 'void' ? t('transfers.voidHint') : t('transfers.deleteHint')}
      />
      {mode === 'void' ? (
        <Alert className="mt-2" type="info" showIcon message={t('transfers.voidBalanceHint')} />
      ) : null}
      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-sm text-slate-700">
          {mode === 'void' ? t('transfers.voidReason') : t('transfers.deleteReason')}{' '}
          <span className="text-rose-500">*</span>
        </span>
        <Input.TextArea
          rows={3}
          value={reason}
          maxLength={2000}
          placeholder={t('requiredPlaceholder')}
          onChange={(e) => setReason(e.target.value)}
          allowClear
        />
      </label>
      {error ? <Alert className="mt-3" type="error" showIcon message={error} /> : null}
    </Modal>
  )
}
