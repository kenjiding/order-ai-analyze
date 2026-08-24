import { useState } from 'react'
import { Alert, Button, Input, Modal } from 'antd'
import { containerTypeLabel } from '../../../containerManagement/constants'
import type { Transfer } from '../../../containerManagement/types'

type Props = {
  target: Transfer | null
  submitting: boolean
  onCancel: () => void
  onSubmit: (note: string) => Promise<boolean>
}

export function ConfirmReceiptModal({ target, submitting, onCancel, onSubmit }: Props) {
  // 由父级用 key 按流转重挂载，无需 effect 重置
  const [note, setNote] = useState('')

  return (
    <Modal
      title="确认收货"
      open={target !== null}
      onCancel={onCancel}
      destroyOnHidden
      width={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button type="primary" loading={submitting} onClick={() => void onSubmit(note)}>
            确认收货
          </Button>
        </div>
      }
    >
      {target ? (
        <>
          <p className="mt-4 text-sm text-slate-600">
            与转出方申报一致，确认后立即按下列明细记账：
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
          <Alert
            className="mt-3"
            type="info"
            showIcon
            message="若实收与申报不一致，请改用「差异申报」进入协商流程。"
          />
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-sm text-slate-700">备注（选填）</span>
            <Input.TextArea
              rows={3}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              allowClear
            />
          </label>
        </>
      ) : null}
    </Modal>
  )
}
