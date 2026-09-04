import { useState } from 'react'
import { Alert, Button, Input, Modal } from 'antd'
import { formatTransferNo } from '../../../containerManagement/constants'
import type { Transfer } from '../../../containerManagement/types'

/**
 * 删除与作废共用这个弹窗：都是「填原因 + 二次确认」，只有文案与后果不同。
 * delete 针对没入过账的单，记录直接消失；void 针对已确认的单，记录留着、余额反向冲回。
 */
export type TransferRemoveMode = 'delete' | 'void'

type Props = {
  target: Transfer | null
  mode: TransferRemoveMode
  submitting: boolean
  onCancel: () => void
  onSubmit: (reason: string) => Promise<boolean>
}

const TEXT = {
  delete: {
    title: '删除流转记录',
    okText: '确认删除',
    reasonLabel: '删除原因',
    emptyError: '请填写删除原因',
    hint: '删除前会记录快照与原因，可在「变更记录」中查询。',
  },
  void: {
    title: '作废流转记录',
    okText: '确认作废',
    reasonLabel: '作废原因',
    emptyError: '请填写作废原因',
    hint: '记录不会被删除：原单转为「已作废」，与冲账流水一起留在台账和「变更记录」中可追溯。',
  },
} as const

export function TransferDeleteModal({ target, mode, submitting, onCancel, onSubmit }: Props) {
  // 由父级用 key 按流转重挂载，无需 effect 重置
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const text = TEXT[mode]

  const handleOk = async () => {
    if (!reason.trim()) {
      setError(text.emptyError)
      return
    }
    setError(null)
    await onSubmit(reason.trim())
  }

  return (
    <Modal
      title={text.title}
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
            {text.okText}
          </Button>
        </div>
      }
    >
      {target ? (
        <p className="mt-4 text-sm text-slate-600">
          将{mode === 'void' ? '作废' : '删除'}{' '}
          <span className="font-mono">{formatTransferNo(target.id)}</span>（{target.fromAccountName}{' '}
          → {target.toAccountName}）。
          {mode === 'void' ? (
            <>
              已入账的 <span className="font-semibold text-slate-900">{target.settledTotal ?? 0}</span>{' '}
              个容器将反向冲回：{target.toAccountName} 减少、{target.fromAccountName} 增加。
            </>
          ) : null}
        </p>
      ) : null}
      <Alert className="mt-3" type="warning" showIcon message={text.hint} />
      {mode === 'void' ? (
        <Alert
          className="mt-2"
          type="info"
          showIcon
          message="若接收方已把这批容器转给下家，冲回后余额可能变成负数。这是账实差异的信号，不是错误，需线下盘点后再平账。"
        />
      ) : null}
      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-sm text-slate-700">
          {text.reasonLabel} <span className="text-rose-500">*</span>
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
