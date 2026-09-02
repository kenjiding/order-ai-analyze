import { useState } from 'react'
import { Alert, Button, Input, Modal } from 'antd'
import { containerTypeLabel } from '../../../containerManagement/constants'
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
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button
            type="primary"
            loading={submitting}
            onClick={() => void onSubmit(note, evidenceUrl)}
          >
            {proxy ? '确认并入账' : '确认收货'}
          </Button>
        </div>
      }
    >
      {target ? (
        <>
          <p className="mt-4 text-sm text-slate-600">
            {proxy
              ? `${target.toAccountName} 没有本系统账号，确认后按下列明细直接入账：`
              : '与转出方申报一致，确认后立即按下列明细记账：'}
          </p>
          <ul className="mt-2 space-y-1 rounded-md bg-slate-50 p-3 text-sm">
            {target.items.map((item) => (
              <li key={item.containerType} className="flex justify-between">
                <span className="text-slate-600">
                  {containerTypeLabel[item.containerType] ?? item.containerType}
                </span>
                <span className="tabular-nums font-medium">{item.declaredQuantity}</span>
              </li>
            ))}
          </ul>
          {proxy ? (
            <Alert
              className="mt-3"
              type="warning"
              showIcon
              message="这一单没有对方的确认动作，入账后不可撤销。"
              description="只能按申报数量整单确认。若对方实收少于申报，请确认后再到容器台账做调整。"
            />
          ) : (
            <Alert
              className="mt-3"
              type="info"
              showIcon
              message="若实收与转出方发出数不一致，请改用「差异申报」进入协商流程。"
            />
          )}
          {proxy ? (
            <div className="mt-4 flex flex-col gap-1.5">
              <span className="text-sm text-slate-700">回单凭证（选填）</span>
              <p className="text-xs leading-relaxed text-slate-500">
                回单、签收单或聊天截图。不传也能提交，但日后对账起争议时只能靠备注追溯。
              </p>
              <TransferImageUpload value={evidenceUrl} onChange={setEvidenceUrl} disabled={submitting} />
            </div>
          ) : null}
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-sm text-slate-700">
              {proxy ? '说明（选填）' : '备注（选填）'}
            </span>
            <Input.TextArea
              rows={3}
              value={note}
              maxLength={2000}
              placeholder={proxy ? '例如：清关行微信回单，已核对数量' : undefined}
              onChange={(e) => setNote(e.target.value)}
              allowClear
            />
          </label>
        </>
      ) : null}
    </Modal>
  )
}
