import { useState } from 'react'
import { Button, Input, Modal, Tooltip } from 'antd'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatTransferNo } from '../../../containerManagement/constants'
import type { Transfer } from '../../../containerManagement/types'
import { TransferImageUpload } from './TransferImageUpload'

type Props = {
  target: Transfer | null
  submitting: boolean
  proxy?: boolean
  onCancel: () => void
  onSubmit: (note: string, evidenceUrl: string | null) => Promise<boolean>
}

function QuantityTile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={`min-w-[92px] flex-1 rounded-lg border px-3 py-2 ${
        accent
          ? 'border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]'
          : 'border-[var(--admin-line)] bg-white'
      }`}
    >
      <div className={`text-xs ${accent ? 'text-[var(--admin-accent)]' : 'text-slate-500'}`}>
        {label}
      </div>
      <div
        className={`tabular-nums text-2xl font-semibold leading-tight ${
          accent ? 'text-[var(--admin-accent)]' : 'text-slate-900'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

export function ConfirmReceiptModal({ target, submitting, proxy = false, onCancel, onSubmit }: Props) {
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
  const [note, setNote] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null)
  // 代确认是替对方签字，没有回单后端也会拒绝，这里先把提交按钮按住，省一次失败往返
  const missingProxyEvidence = proxy && !evidenceUrl

  return (
    <Modal
      title={proxy ? t('transfers.proxyConfirmTitle') : t('transfers.confirmTitle')}
      open={target !== null}
      onCancel={onCancel}
      destroyOnHidden
      width={520}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-left text-xs text-slate-500">
            {proxy ? t('transfers.confirmFooterProxy') : t('transfers.confirmFooterNormal')}
          </span>
          <div className="flex shrink-0 gap-2">
            <Button onClick={onCancel} disabled={submitting}>
              {tc('cancel')}
            </Button>
            <Tooltip title={missingProxyEvidence ? t('transfers.proxyEvidenceRequired') : ''}>
              <span className="inline-block">
                <Button
                  type="primary"
                  loading={submitting}
                  disabled={missingProxyEvidence}
                  onClick={() => void onSubmit(note, evidenceUrl)}
                >
                  {proxy ? t('transfers.proxyConfirmSubmit') : t('transfers.confirmSubmit')}
                </Button>
              </span>
            </Tooltip>
          </div>
        </div>
      }
    >
      {target ? (
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-lg bg-[var(--admin-sky-soft)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="tabular-nums">{formatTransferNo(target.id)}</span>
              <span>{t(`transferKind.${target.kind}`)}</span>
              <span className="tabular-nums">{target.occurredAt}</span>
              {proxy ? (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                  {t('transfers.proxyConfirmedTag')}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
              <span>{target.fromAccountName}</span>
              <ArrowRight className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
              <span>{target.toAccountName}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {target.items.map((item) => (
              <QuantityTile
                key={item.containerType}
                label={t(`containerType.${item.containerType}`)}
                value={item.declaredQuantity}
              />
            ))}
            <QuantityTile label={t('transfers.settleTotal')} value={target.declaredTotal} accent />
          </div>

          {proxy ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-slate-700">
                <span className="text-rose-500">*</span> {t('transfers.proxyEvidence')}
              </span>
              <TransferImageUpload value={evidenceUrl} onChange={setEvidenceUrl} disabled={submitting} />
            </label>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-slate-700">
              {proxy ? t('transfers.noteProxyOptional') : t('transfers.noteOptional')}
            </span>
            <Input.TextArea
              rows={2}
              value={note}
              maxLength={2000}
              placeholder={proxy ? t('transfers.noteProxyPlaceholder') : undefined}
              onChange={(e) => setNote(e.target.value)}
              allowClear
            />
          </label>
        </div>
      ) : null}
    </Modal>
  )
}
