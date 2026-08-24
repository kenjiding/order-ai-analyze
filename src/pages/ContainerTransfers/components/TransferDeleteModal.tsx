import { useState } from 'react'
import { Alert, Button, Input, Modal } from 'antd'
import type { Transfer } from '../../../containerManagement/types'

type Props = {
  target: Transfer | null
  submitting: boolean
  onCancel: () => void
  onSubmit: (reason: string) => Promise<boolean>
}

export function TransferDeleteModal({ target, submitting, onCancel, onSubmit }: Props) {
  // 由父级用 key 按流转重挂载，无需 effect 重置
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleOk = async () => {
    if (!reason.trim()) {
      setError('请填写删除原因')
      return
    }
    setError(null)
    await onSubmit(reason.trim())
  }

  return (
    <Modal
      title="删除流转记录"
      open={target !== null}
      onCancel={onCancel}
      destroyOnHidden
      width={520}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button danger type="primary" loading={submitting} onClick={() => void handleOk()}>
            确认删除
          </Button>
        </div>
      }
    >
      {target ? (
        <p className="mt-4 text-sm text-slate-600">
          将删除 <span className="font-mono">{target.id}</span>（{target.fromAccountName} →{' '}
          {target.toAccountName}）。
        </p>
      ) : null}
      <Alert
        className="mt-3"
        type="warning"
        showIcon
        message="删除前会记录快照与原因，可在「变更记录」中查询。"
      />
      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-sm text-slate-700">
          删除原因 <span className="text-rose-500">*</span>
        </span>
        <Input.TextArea
          rows={3}
          value={reason}
          maxLength={2000}
          placeholder="必填"
          onChange={(e) => setReason(e.target.value)}
          allowClear
        />
      </label>
      {error ? <Alert className="mt-3" type="error" showIcon message={error} /> : null}
    </Modal>
  )
}
