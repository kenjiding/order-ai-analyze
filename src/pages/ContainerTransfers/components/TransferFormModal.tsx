/**
 * 流转记录表单。
 *
 * 新增时可以一次录入多组（每组是独立的一条流转），整批一个事务提交，
 * 任何一组不合法就整批失败，错误信息带组序号。编辑时固定单组。
 */
import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, DatePicker, Input, Modal, Select, Tooltip } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { SELECTABLE_TRANSFER_KINDS } from '../../../containerManagement/constants'
import { useActiveContainerTypes } from '../../../containerManagement/containerTypeStore'
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

/** 启用中的品类各摆一行，填哪个算哪个 */
function emptyLines(codes: string[]): TransferDraft['lines'] {
  return codes.map((containerType) => ({ containerType, quantity: '' }))
}

function emptyDraft(fromAccountId: string, codes: string[]): TransferDraft {
  return {
    kind: 'LEND',
    fromAccountId,
    toAccountId: '',
    lines: emptyLines(codes),
    occurredAt: todayIso(),
    note: '',
  }
}

/** 只提交填了数量的品类，空着的那一栏视为本单不涉及 */
function filledLines(draft: TransferDraft): TransferDraft['lines'] {
  return draft.lines.filter((line) => line.quantity.trim() !== '')
}

/** 单组校验，返回第一条错误；组序号由调用方补 */
function validateDraft(draft: TransferDraft, t: TFunction<'container'>): string | null {
  if (!draft.occurredAt) return t('transfers.errSelectDate')
  if (!draft.fromAccountId) return t('transfers.errSelectFrom')
  if (!draft.toAccountId) return t('transfers.errSelectTo')
  if (draft.fromAccountId === draft.toAccountId) return t('transfers.errSameAccount')
  const lines = filledLines(draft)
  if (lines.length === 0) return t('transfers.errMinOneLine')
  for (const line of lines) {
    const quantity = Number(line.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) return t('transfers.errQuantityInt')
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
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
  const [drafts, setDrafts] = useState<TransferDraft[]>([])
  const [error, setError] = useState<string | null>(null)

  const isEditing = editing !== null
  const editable = editing === null || editing.status === 'PENDING_RECEIVER'
  const activeTypes = useActiveContainerTypes()
  const activeCodes = useMemo(() => activeTypes.map((type) => type.code), [activeTypes])

  useEffect(() => {
    if (!open) return
    setError(null)
    if (editing) {
      setDrafts([
        {
          kind: editing.kind,
          fromAccountId: editing.fromAccountId,
          toAccountId: editing.toAccountId,
          // 该单已有的品类必须保留 —— 编辑一笔含已停用品类的单时，漏掉它等于把那行数量清零
          lines: [
            ...activeCodes,
            ...editing.items
              .map((entry) => entry.containerType)
              .filter((code) => !activeCodes.includes(code)),
          ].map((containerType) => {
            const item = editing.items.find((entry) => entry.containerType === containerType)
            return { containerType, quantity: item ? String(item.declaredQuantity) : '' }
          }),
          occurredAt: editing.occurredAt,
          note: editing.note ?? '',
        },
      ])
      return
    }
    setDrafts([emptyDraft(ownAccounts.length === 1 ? ownAccounts[0].id : '', activeCodes)])
  }, [open, editing, ownAccounts, activeCodes])

  const update = (index: number, patch: Partial<TransferDraft>) => {
    setDrafts((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
    if (error) setError(null)
  }

  const addGroup = () => {
    setDrafts((prev) => [...prev, emptyDraft(prev.at(-1)?.fromAccountId ?? '', activeCodes)])
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
      const message = validateDraft(draft, t)
      if (message) {
        setError(drafts.length > 1 ? t('transfers.errGroupPrefix', { n: index + 1, message }) : message)
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
      title={isEditing ? t('transfers.modalEditTitle') : t('transfers.modalCreateTitle')}
      open={open}
      onCancel={onCancel}
      destroyOnHidden
      width={760}
      styles={{ body: { background: 'var(--admin-bg, #f7fbff)', padding: '16px 24px' } }}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {isEditing ? t('transfers.footerEditHint') : t('transfers.footerCreateHint', { count: drafts.length })}
          </span>
          <div className="flex gap-2">
            <Button onClick={onCancel} disabled={submitting}>
              {tc('cancel')}
            </Button>
            <Button type="primary" loading={submitting} onClick={() => void handleOk()}>
              {isEditing ? tc('save') : t('transfers.submitCount', { count: drafts.length })}
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
                <span className="text-sm font-semibold text-slate-800">{t('transfers.groupN', { n: index + 1 })}</span>
                <div className="flex items-center gap-1">
                  <Tooltip title={drafts.length >= MAX_GROUPS ? t('transfers.maxGroups', { max: MAX_GROUPS }) : t('transfers.copyGroup')}>
                    <Button
                      type="text"
                      disabled={drafts.length >= MAX_GROUPS}
                      icon={<Copy className="h-4 w-4" aria-hidden />}
                      onClick={() => duplicateGroup(index)}
                      aria-label={t('transfers.copyGroup')}
                    />
                  </Tooltip>
                  <Tooltip title={drafts.length === 1 ? t('transfers.keepOneGroup') : t('transfers.removeGroup')}>
                    <Button
                      type="text"
                      danger
                      disabled={drafts.length === 1}
                      icon={<Trash2 className="h-4 w-4" aria-hidden />}
                      onClick={() => removeGroup(index)}
                      aria-label={t('transfers.removeGroup')}
                    />
                  </Tooltip>
                </div>
              </header>
            ) : null}

            <div className="grid gap-x-4 gap-y-3 px-4 py-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-slate-700">
                  {t('transfers.fieldTime')} <span className="text-rose-500">*</span>
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
                  {t('transfers.fieldKind')} <span className="text-rose-500">*</span>
                </span>
                <Select
                  value={draft.kind}
                  disabled={isEditing}
                  onChange={(value) => update(index, { kind: value as TransferKind })}
                  options={SELECTABLE_TRANSFER_KINDS.map((item) => ({
                    value: item,
                    label: t(`transferKind.${item}`),
                  }))}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm text-slate-700">
                  {t('transfers.fieldFrom')} <span className="text-rose-500">*</span>
                </span>
                <Select
                  placeholder={t('selectPlaceholder')}
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
                  {t('transfers.fieldTo')} <span className="text-rose-500">*</span>
                </span>
                <Select
                  placeholder={t('selectPlaceholder')}
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
                  {t('transfers.fieldLines')} <span className="text-rose-500">*</span>
                </span>
                <TransferLineItemsInput
                  lines={draft.lines}
                  onChange={(lines) => update(index, { lines })}
                  disabled={!editable}
                />
              </div>
              {!isEditing ? (
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-sm text-slate-700">{t('transfers.fieldNote')}</span>
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
            {drafts.length >= MAX_GROUPS ? t('transfers.maxGroups', { max: MAX_GROUPS }) : t('transfers.addAnotherGroup')}
          </Button>
        ) : null}

        {error ? <Alert type="error" showIcon message={error} /> : null}
      </div>
    </Modal>
  )
}
