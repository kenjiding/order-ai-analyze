import { useState } from 'react'
import { Button, Input, Modal } from 'antd'
import { ArrowRight } from 'lucide-react'
import {
  containerTypeLabel,
  formatTransferNo,
  transferKindLabel,
} from '../../../containerManagement/constants'
import type { Transfer } from '../../../containerManagement/types'
import { TransferImageUpload } from './TransferImageUpload'

type Props = {
  target: Transfer | null
  submitting: boolean
  /**
   * 代确认：接收方在本系统没有账号，由转出方凭线下回单单方面确认。
   * 账务口径与接收方本人确认完全一致，差别是这一单没有对方的确认动作，所以要求留凭证。
   */
  proxy?: boolean
  onCancel: () => void
  onSubmit: (note: string, evidenceUrl: string | null) => Promise<boolean>
}

/** 数量磁贴：确认收货时最该被一眼看清的就是数字，所以放大加粗 */
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
  // 由父级用 key 按流转重挂载，无需 effect 重置
  const [note, setNote] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null)

  return (
    <Modal
      title={proxy ? '按回单确认收货' : '确认收货'}
      open={target !== null}
      onCancel={onCancel}
      destroyOnHidden
      width={520}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-left text-xs text-slate-500">
            {proxy ? '按申报数量整单入账，不可撤销。' : '数量不一致请改用「差异申报」。'}
          </span>
          <div className="flex shrink-0 gap-2">
            <Button onClick={onCancel} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" loading={submitting} onClick={() => void onSubmit(note, evidenceUrl)}>
              {proxy ? '确认并入账' : '确认收货'}
            </Button>
          </div>
        </div>
      }
    >
      {target ? (
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-lg bg-[var(--admin-sky-soft)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="tabular-nums">{formatTransferNo(target.id)}</span>
              <span>{transferKindLabel[target.kind]}</span>
              <span className="tabular-nums">{target.occurredAt}</span>
              {proxy ? (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                  代确认
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
                label={containerTypeLabel[item.containerType] ?? item.containerType}
                value={item.declaredQuantity}
              />
            ))}
            <QuantityTile label="合计入账" value={target.declaredTotal} accent />
          </div>

          {proxy ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-slate-700">回单凭证（选填）</span>
              <TransferImageUpload value={evidenceUrl} onChange={setEvidenceUrl} disabled={submitting} />
            </label>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-slate-700">{proxy ? '说明（选填）' : '备注（选填）'}</span>
            <Input.TextArea
              rows={2}
              value={note}
              maxLength={2000}
              placeholder={proxy ? '例如：清关行微信回单，已核对数量' : undefined}
              onChange={(e) => setNote(e.target.value)}
              allowClear
            />
          </label>
        </div>
      ) : null}
    </Modal>
  )
}
