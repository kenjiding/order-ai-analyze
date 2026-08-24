import { useEffect, useState } from 'react'
import { Alert, Button, Input, Modal, Select } from 'antd'
import {
  SELECTABLE_TRANSFER_KINDS,
  transferKindLabel,
} from '../../../containerManagement/constants'
import type {
  ContainerAccount,
  Transfer,
  TransferKind,
  TransferLineDraft,
} from '../../../containerManagement/types'
import { TransferImageUpload } from './TransferImageUpload'
import { TransferLineItemsInput } from './TransferLineItemsInput'
import type { TransferDraft } from '../useContainerTransfersPage'

type Props = {
  open: boolean
  editing: Transfer | null
  ownAccounts: ContainerAccount[]
  counterparties: ContainerAccount[]
  allAccounts: ContainerAccount[]
  submitting: boolean
  onCancel: () => void
  onSubmit: (draft: TransferDraft) => Promise<boolean>
}

const emptyLines: TransferLineDraft[] = [{ containerType: 'BIG_BASKET', quantity: '' }]

export function TransferFormModal({
  open,
  editing,
  ownAccounts,
  counterparties,
  allAccounts,
  submitting,
  onCancel,
  onSubmit,
}: Props) {
  const [kind, setKind] = useState<TransferKind>('LEND')
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [lines, setLines] = useState<TransferLineDraft[]>(emptyLines)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const editable = editing === null || editing.status === 'PENDING_RECEIVER'

  useEffect(() => {
    if (!open) return
    setError(null)
    if (editing) {
      setKind(editing.kind)
      setFromAccountId(editing.fromAccountId)
      setToAccountId(editing.toAccountId)
      setLines(
        editing.items.map((item) => ({
          containerType: item.containerType,
          quantity: String(item.declaredQuantity),
        })),
      )
      setImageUrl(editing.imageUrl)
      setNote(editing.note ?? '')
      return
    }
    setKind('LEND')
    setFromAccountId(ownAccounts.length === 1 ? ownAccounts[0].id : '')
    setToAccountId('')
    setLines(emptyLines)
    setImageUrl(null)
    setNote('')
  }, [open, editing, ownAccounts])

  const validate = (): string | null => {
    if (!fromAccountId) return '请选择转出方'
    if (!toAccountId) return '请选择接收方'
    if (fromAccountId === toAccountId) return '转出方与接收方不能相同'
    if (lines.length === 0) return '至少需要一条流转明细'
    const seen = new Set<string>()
    for (const line of lines) {
      if (seen.has(line.containerType)) return '请勿重复选择品类'
      seen.add(line.containerType)
      const quantity = Number(line.quantity)
      if (!line.quantity.trim()) return '请填写数量'
      if (!Number.isInteger(quantity) || quantity < 1) return '数量必须为大于 0 的整数'
    }
    return null
  }

  const handleOk = async () => {
    const message = validate()
    if (message) {
      setError(message)
      return
    }
    setError(null)
    await onSubmit({ kind, fromAccountId, toAccountId, lines, imageUrl, note })
  }

  const toOptions = (editing ? allAccounts : counterparties).map((account) => ({
    value: account.id,
    label: account.name,
  }))

  return (
    <Modal
      title={editing ? '编辑流转记录' : '新增流转记录'}
      open={open}
      onCancel={onCancel}
      destroyOnHidden
      width={600}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button type="primary" loading={submitting} onClick={() => void handleOk()}>
            {editing ? '保存' : '提交'}
          </Button>
        </div>
      }
    >
      <p className="mt-4 text-sm text-slate-500">
        {editing
          ? '待接收方确认的记录可调整明细与图片；业务类型、双方主体与备注不可修改。'
          : '以数量记账。借出与归还需接收方确认后双方库存才变动；车牌、运单号等可写在备注中。'}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-700">
            业务类型 <span className="text-rose-500">*</span>
          </span>
          <Select
            value={kind}
            disabled={editing !== null}
            onChange={(value) => setKind(value as TransferKind)}
            options={SELECTABLE_TRANSFER_KINDS.map((item) => ({
              value: item,
              label: transferKindLabel[item],
            }))}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-700">凭证图片</span>
          <TransferImageUpload value={imageUrl} onChange={setImageUrl} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-700">
            转出方 <span className="text-rose-500">*</span>
          </span>
          <Select
            placeholder="选择…"
            showSearch
            optionFilterProp="label"
            value={fromAccountId || undefined}
            disabled={editing !== null || ownAccounts.length <= 1}
            onChange={setFromAccountId}
            options={(editing ? allAccounts : ownAccounts).map((account) => ({
              value: account.id,
              label: account.name,
            }))}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-700">
            接收方 <span className="text-rose-500">*</span>
          </span>
          <Select
            placeholder="选择…"
            showSearch
            optionFilterProp="label"
            value={toAccountId || undefined}
            disabled={editing !== null}
            onChange={setToAccountId}
            options={toOptions}
          />
        </label>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-sm text-slate-700">
            流转明细 <span className="text-rose-500">*</span>
          </span>
          <TransferLineItemsInput lines={lines} onChange={setLines} disabled={!editable} />
        </div>
        {editing === null ? (
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm text-slate-700">备注（可填写车牌、运单号等）</span>
            <Input.TextArea
              rows={3}
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              allowClear
            />
          </label>
        ) : null}
      </div>

      {error ? <Alert className="mt-4" type="error" showIcon message={error} /> : null}
    </Modal>
  )
}
