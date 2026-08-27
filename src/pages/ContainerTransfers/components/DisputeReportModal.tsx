import { useState } from 'react'
import { Alert, Button, Input, Modal } from 'antd'
import type { Transfer, TransferLineDraft } from '../../../containerManagement/types'
import { TransferImageUpload } from './TransferImageUpload'
import { TransferLineItemsInput } from './TransferLineItemsInput'

type Props = {
  target: Transfer | null
  /** 协商中修改已提交的实收申报 */
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
  // 由父级用 key 按流转重挂载，初始值直接取当前申报
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
        setError('请填写全部品类的实收数量')
        return
      }
      const quantity = Number(line.quantity)
      const max = maxByType[line.containerType]
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > max) {
        setError(`实收数量须为 0～${max} 之间的整数`)
        return
      }
    }
    if (!reason.trim()) {
      setError('请填写原因')
      return
    }
    setError(null)
    await onSubmit(lines, reason.trim(), imageUrl, isUpdate, target.id)
  }

  return (
    <Modal
      title={isUpdate ? '修改实收申报' : '差异 / 拒收申报'}
      open
      onCancel={onCancel}
      destroyOnHidden
      width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button type="primary" loading={submitting} onClick={() => void handleOk()}>
            提交申报
          </Button>
        </div>
      }
    >
      <Alert
        className="mt-4"
        type="warning"
        showIcon
        message="申报后进入协商，库存暂不变动；待转出方认可你的实收数量后才会入账。"
      />

      <div className="mt-4 flex flex-col gap-1.5">
        <span className="text-sm text-slate-700">
          实际收到数量 <span className="text-rose-500">*</span>
        </span>
        <p className="text-xs text-slate-500">
          品类固定为转出方申报的明细，每项可填 0 ~ 申报数；全部填 0 表示整批未收到。
        </p>
        <TransferLineItemsInput
          lines={lines}
          onChange={setLines}
          lockedTypes
          maxByType={maxByType}
          minQuantity={0}
        />
      </div>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-sm text-slate-700">
          原因 <span className="text-rose-500">*</span>
        </span>
        <Input.TextArea
          rows={3}
          value={reason}
          maxLength={2000}
          placeholder="例如：清点后少 3 个大篮筐"
          onChange={(e) => setReason(e.target.value)}
          allowClear
        />
      </label>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-sm text-slate-700">申报证据（选填）</span>
        <TransferImageUpload value={imageUrl} onChange={setImageUrl} />
      </label>

      {error ? <Alert className="mt-4" type="error" showIcon message={error} /> : null}
    </Modal>
  )
}
