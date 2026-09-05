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
  CONTAINER_TYPES,
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
  /** 转出方下拉的取值：本人绑定的站点，内部仓库与外部方一视同仁（外部方归还由负责它的人代录） */
  ownAccounts: ContainerAccount[]
  /** 接收方下拉的取值：全部站点 */
  counterparties: ContainerAccount[]
  allAccounts: ContainerAccount[]
  submitting: boolean
  onCancel: () => void
  onSubmit: (drafts: TransferDraft[]) => Promise<boolean>
}

function todayIso(): string {
  return dayjs().format('YYYY-MM-DD')
}

/** 品类固定两种，两行都摆出来，填哪个算哪个 */
function emptyLines(): TransferDraft['lines'] {
  return CONTAINER_TYPES.map((containerType) => ({ containerType, quantity: '' }))
}

function emptyDraft(fromAccountId: string): TransferDraft {
  return {
    kind: 'LEND',
    fromAccountId,
    toAccountId: '',
    lines: emptyLines(),
    occurredAt: todayIso(),
    note: '',
  }
}

/** 只提交填了数量的品类，空着的那一栏视为本单不涉及 */
function filledLines(draft: TransferDraft): TransferDraft['lines'] {
  return draft.lines.filter((line) => line.quantity.trim() !== '')
}

/** 单组校验，返回第一条错误；组序号由调用方补 */
function validateDraft(draft: TransferDraft): string | null {
  if (!draft.occurredAt) return '请选择日期'
  if (!draft.fromAccountId) return '请选择转出方'
  if (!draft.toAccountId) return '请选择接收方'
  if (draft.fromAccountId === draft.toAccountId) return '转出方与接收方不能相同'
  const lines = filledLines(draft)
  if (lines.length === 0) return '至少填写一个品类的数量'
  for (const line of lines) {
    const quantity = Number(line.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) return '数量必须为大于 0 的整数'
  }
  return null
}

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
          lines: CONTAINER_TYPES.map((containerType) => {
            const item = editing.items.find((entry) => entry.containerType === containerType)
            return { containerType, quantity: item ? String(item.declaredQuantity) : '' }
          }),
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
    await onSubmit(drafts.map((draft) => ({ ...draft, lines: filledLines(draft) })))
  }

  // 编辑时双方站点不可改，直接用全量保证能显示出原值；新增时转出方只给自己绑定的站点
  const fromOptions = (isEditing ? allAccounts : ownAccounts).map((account) => ({
    value: account.id,
    label: account.name,
  }))
  const toAccountPool = isEditing ? allAccounts : counterparties

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
                  disabled={isEditing || fromOptions.length <= 1}
                  onChange={(value) =>
                    // 接收方若正好是新选的转出方，留着会是个不在选项里的悬空值，直接清掉
                    update(index, {
                      fromAccountId: value,
                      ...(draft.toAccountId === value ? { toAccountId: '' } : {}),
                    })
                  }
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
                  options={toAccountPool
                    .filter((account) => account.id !== draft.fromAccountId)
                    .map((account) => ({ value: account.id, label: account.name }))}
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
