/**
 * 流转记录表单。
 *
 * 新增时可以一次录入多组（每组是独立的一条流转），整批一个事务提交，
 * 任何一组不合法就整批失败，错误信息带组序号。编辑时固定单组。
 */
import { useEffect, useState } from 'react'
import { Alert, Button, DatePicker, Input, Modal, Select, Tooltip } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { Copy, Plus, Trash2 } from 'lucide-react'
import {
  SELECTABLE_TRANSFER_KINDS,
  transferKindLabel,
} from '../../../containerManagement/constants'
import type {
  ContainerAccount,
  Transfer,
  TransferKind,
} from '../../../containerManagement/types'
import { TransferLineItemsInput } from './TransferLineItemsInput'
import type { TransferDraft } from '../useContainerTransfersPage'

const MAX_GROUPS = 20

type Props = {
  open: boolean
  editing: Transfer | null
  ownAccounts: ContainerAccount[]
  /** 转出方下拉的取值：自己绑定的站点 + 外部方（外部方归还的单子由内部人员代录） */
  senderAccounts: ContainerAccount[]
  counterparties: ContainerAccount[]
  allAccounts: ContainerAccount[]
  submitting: boolean
  onCancel: () => void
  onSubmit: (drafts: TransferDraft[]) => Promise<boolean>
}

function todayIso(): string {
  return dayjs().format('YYYY-MM-DD')
}

function emptyDraft(fromAccountId: string): TransferDraft {
  return {
    kind: 'LEND',
    fromAccountId,
    toAccountId: '',
    lines: [{ containerType: 'BIG_BASKET', quantity: '' }],
    occurredAt: todayIso(),
    note: '',
  }
}

/** 单组校验，返回第一条错误；组序号由调用方补 */
function validateDraft(draft: TransferDraft): string | null {
  if (!draft.occurredAt) return '请选择日期'
  if (!draft.fromAccountId) return '请选择转出方'
  if (!draft.toAccountId) return '请选择接收方'
  if (draft.fromAccountId === draft.toAccountId) return '转出方与接收方不能相同'
  if (draft.lines.length === 0) return '至少需要一条流转明细'
  const seen = new Set<string>()
  for (const line of draft.lines) {
    if (seen.has(line.containerType)) return '请勿重复选择品类'
    seen.add(line.containerType)
    if (!line.quantity.trim()) return '请填写数量'
    const quantity = Number(line.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) return '数量必须为大于 0 的整数'
  }
  return null
}

export function TransferFormModal({
  open,
  editing,
  ownAccounts,
  senderAccounts,
  counterparties,
  allAccounts,
  submitting,
  onCancel,
  onSubmit,
}: Props) {
  const [drafts, setDrafts] = useState<TransferDraft[]>([])
  const [error, setError] = useState<string | null>(null)

  const isEditing = editing !== null
  const editable = editing === null || editing.status === 'PENDING_RECEIVER'

  useEffect(() => {
    if (!open) return
    setError(null)
    if (editing) {
      setDrafts([
        {
          kind: editing.kind,
          fromAccountId: editing.fromAccountId,
          toAccountId: editing.toAccountId,
          lines: editing.items.map((item) => ({
            containerType: item.containerType,
            quantity: String(item.declaredQuantity),
          })),
          occurredAt: editing.occurredAt,
          note: editing.note ?? '',
        },
      ])
      return
    }
    setDrafts([emptyDraft(ownAccounts.length === 1 ? ownAccounts[0].id : '')])
  }, [open, editing, ownAccounts])

  const update = (index: number, patch: Partial<TransferDraft>) => {
    setDrafts((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
    if (error) setError(null)
  }

  const addGroup = () => {
    setDrafts((prev) => [...prev, emptyDraft(prev.at(-1)?.fromAccountId ?? '')])
    setError(null)
  }

  /** 同一批往往只有接收方或数量不同，复制一组比重填快得多 */
  const duplicateGroup = (index: number) => {
    setDrafts((prev) => {
      const source = prev[index]
      const copy: TransferDraft = { ...source, lines: source.lines.map((line) => ({ ...line })) }
      return [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)]
    })
    setError(null)
  }

  const removeGroup = (index: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== index))
    setError(null)
  }

  const handleOk = async () => {
    for (const [index, draft] of drafts.entries()) {
      const message = validateDraft(draft)
      if (message) {
        setError(drafts.length > 1 ? `第 ${index + 1} 组：${message}` : message)
        return
      }
    }
    setError(null)
    await onSubmit(drafts)
  }

  const fromOptions = (isEditing ? allAccounts : senderAccounts).map((account) => ({
    value: account.id,
    label: account.name,
  }))
  const toOptions = (isEditing ? allAccounts : counterparties).map((account) => ({
    value: account.id,
    label: account.name,
  }))

  return (
    <Modal
      title={isEditing ? '编辑流转记录' : '新增流转记录'}
      open={open}
      onCancel={onCancel}
      destroyOnHidden
      width={760}
      styles={{ body: { background: 'var(--admin-bg, #f7fbff)', padding: '16px 24px' } }}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {isEditing
              ? '待接收方确认的记录可调整日期与明细；业务类型与双方站点不可修改。'
              : `共 ${drafts.length} 组，一起提交；任何一组不合法则整批不创建。`}
          </span>
          <div className="flex gap-2">
            <Button onClick={onCancel} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" loading={submitting} onClick={() => void handleOk()}>
              {isEditing ? '保存' : `提交 ${drafts.length} 条`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {drafts.map((draft, index) => (
          <section
            key={index}
            className="rounded-xl border border-[var(--admin-line)] bg-white"
          >
            {!isEditing ? (
              <header className="flex items-center justify-between gap-3 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-2">
                <span className="text-sm font-semibold text-slate-800">第 {index + 1} 组</span>
                <div className="flex items-center gap-1">
                  <Tooltip title={drafts.length >= MAX_GROUPS ? `最多 ${MAX_GROUPS} 组` : '复制这一组'}>
                    <Button
                      type="text"
                      disabled={drafts.length >= MAX_GROUPS}
                      icon={<Copy className="h-4 w-4" aria-hidden />}
                      onClick={() => duplicateGroup(index)}
                      aria-label="复制这一组"
                    />
                  </Tooltip>
                  <Tooltip title={drafts.length === 1 ? '至少保留一组' : '删除这一组'}>
                    <Button
                      type="text"
                      danger
                      disabled={drafts.length === 1}
                      icon={<Trash2 className="h-4 w-4" aria-hidden />}
                      onClick={() => removeGroup(index)}
                      aria-label="删除这一组"
                    />
                  </Tooltip>
                </div>
              </header>
            ) : null}

            <div className="grid gap-x-4 gap-y-3 px-4 py-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-slate-700">
                  时间 <span className="text-rose-500">*</span>
                </span>
                <DatePicker
                  className="w-full"
                  allowClear={false}
                  disabled={!editable}
                  value={draft.occurredAt ? dayjs(draft.occurredAt) : null}
                  onChange={(value: Dayjs | null) =>
                    update(index, { occurredAt: value ? value.format('YYYY-MM-DD') : '' })
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-slate-700">
                  业务类型 <span className="text-rose-500">*</span>
                </span>
                <Select
                  value={draft.kind}
                  disabled={isEditing}
                  onChange={(value) => update(index, { kind: value as TransferKind })}
                  options={SELECTABLE_TRANSFER_KINDS.map((item) => ({
                    value: item,
                    label: transferKindLabel[item],
                  }))}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-slate-700">
                  转出方 <span className="text-rose-500">*</span>
                </span>
                <Select
                  placeholder="选择…"
                  showSearch
                  optionFilterProp="label"
                  value={draft.fromAccountId || undefined}
                  disabled={isEditing || senderAccounts.length <= 1}
                  onChange={(value) => update(index, { fromAccountId: value })}
                  options={fromOptions}
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
                  value={draft.toAccountId || undefined}
                  disabled={isEditing}
                  onChange={(value) => update(index, { toAccountId: value })}
                  options={toOptions}
                />
              </label>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-sm text-slate-700">
                  流转明细 <span className="text-rose-500">*</span>
                </span>
                <TransferLineItemsInput
                  lines={draft.lines}
                  onChange={(lines) => update(index, { lines })}
                  disabled={!editable}
                />
              </div>
              {!isEditing ? (
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-sm text-slate-700">备注（可填写车牌、运单号等）</span>
                  <Input.TextArea
                    rows={2}
                    value={draft.note}
                    maxLength={2000}
                    onChange={(e) => update(index, { note: e.target.value })}
                    allowClear
                  />
                </label>
              ) : null}
            </div>
          </section>
        ))}

        {!isEditing ? (
          <Button
            block
            type="dashed"
            disabled={drafts.length >= MAX_GROUPS}
            icon={<Plus className="h-4 w-4" aria-hidden />}
            onClick={addGroup}
          >
            {drafts.length >= MAX_GROUPS ? `最多 ${MAX_GROUPS} 组` : '再加一组'}
          </Button>
        ) : null}

        {error ? <Alert type="error" showIcon message={error} /> : null}
      </div>
    </Modal>
  )
}
