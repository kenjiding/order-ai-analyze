import { useMemo, useState } from 'react'
import { Button, DatePicker, Input, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  TRANSFER_CHANGE_ACTIONS,
  formatTransferNo,
} from '../../../containerManagement/constants'
import type {
  TransferChange,
  TransferChangeAction,
  TransferItem,
  TransferSnapshot,
} from '../../../containerManagement/types'
import type { ChangeFilters } from '../useContainerTransfersPage'

function itemMap(items: TransferItem[]): Map<string, number> {
  return new Map(items.map((item) => [item.containerType, item.declaredQuantity]))
}

function buildChangeItems(
  before: TransferSnapshot,
  after: TransferSnapshot | null,
  action: TransferChangeAction,
  t: TFunction<'container'>,
): string[] {
  if (action === 'VOID') {
    const detail = before.items
      .map((item) => `${t(`containerType.${item.containerType}`)} ${item.settledQuantity ?? 0}`)
      .join('、')
    return [t('transfers.changeVoidDetail', { detail: detail || t('transfers.changeVoidNone') })]
  }
  if (!after) {
    const detail = before.items
      .map((item) => `${t(`containerType.${item.containerType}`)} ${item.declaredQuantity}`)
      .join('、')
    return [t('transfers.changeDeleteDetail', { detail: detail || t('transfers.changeVoidNone') })]
  }

  const changes: string[] = []
  const beforeItems = itemMap(before.items)
  const afterItems = itemMap(after.items)
  for (const type of new Set([...beforeItems.keys(), ...afterItems.keys()])) {
    const prev = beforeItems.get(type)
    const next = afterItems.get(type)
    if (prev === next) continue
    const label = t(`containerType.${type as TransferItem['containerType']}`)
    if (prev === undefined) changes.push(t('transfers.changeAddType', { type: label, qty: next }))
    else if (next === undefined) changes.push(t('transfers.changeRemoveType', { type: label, prev }))
    else changes.push(t('transfers.changeQtyDiff', { type: label, prev, next }))
  }
  if (before.occurredAt !== after.occurredAt) {
    changes.push(t('transfers.changeDateDiff', { prev: before.occurredAt, next: after.occurredAt }))
  }
  if (before.note !== after.note) {
    changes.push(
      t('transfers.changeNoteDiff', {
        prev: before.note || t('emptyNote'),
        next: after.note || t('emptyNote'),
      }),
    )
  }
  return changes.length > 0 ? changes : [t('transfers.changeNoDiff')]
}

type Props = {
  changes: TransferChange[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  filters: ChangeFilters
  onPageChange: (page: number) => void
  onApply: (filters: ChangeFilters) => void
}

export function TransferChangePanel({
  changes,
  total,
  page,
  pageSize,
  loading,
  filters,
  onPageChange,
  onApply,
}: Props) {
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
  const [draft, setDraft] = useState<ChangeFilters>(filters)

  const rangePresets = useMemo(
    () => [
      { label: t('datePresetToday'), value: [dayjs().startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs] },
      {
        label: t('datePreset7d'),
        value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
      },
      {
        label: t('datePreset30d'),
        value: [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
      },
    ],
    [t],
  )

  const columns: ColumnsType<TransferChange> = useMemo(
    () => [
      {
        title: t('ledger.colTime'),
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 165,
        render: (value: string) => (
          <span className="whitespace-nowrap text-slate-500">
            {dayjs(value).format('YYYY-MM-DD HH:mm')}
          </span>
        ),
      },
      {
        title: t('transfers.changeColNo'),
        key: 'transferId',
        width: 120,
        render: (_, record) => (
          <span className="font-mono text-xs text-slate-500">
            {formatTransferNo(record.transferId ?? record.beforeData.id)}
          </span>
        ),
      },
      {
        title: t('ledger.colAction'),
        dataIndex: 'action',
        key: 'action',
        width: 90,
        render: (value: TransferChangeAction) => (
          <Tag color={value === 'UPDATE' ? 'gold' : 'red'}>{t(`transferChangeAction.${value}`)}</Tag>
        ),
      },
      {
        title: t('transfers.changeColDiff'),
        key: 'diff',
        render: (_, record) => (
          <div className="space-y-0.5 text-sm text-slate-700">
            {buildChangeItems(record.beforeData, record.afterData, record.action, t).map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ),
      },
      {
        title: t('ledger.colReason'),
        dataIndex: 'reason',
        key: 'reason',
        width: 180,
        ellipsis: true,
        render: (value: string) =>
          value.trim() ? (
            <Tooltip title={value}>
              <span className="text-slate-600">{value}</span>
            </Tooltip>
          ) : (
            <span className="text-slate-400">{t('dash')}</span>
          ),
      },
      {
        title: t('ledger.colActor'),
        dataIndex: 'actorUsername',
        key: 'actorUsername',
        width: 110,
        render: (value: string | null) => value ?? <span className="text-slate-400">{t('dash')}</span>,
      },
    ],
    [t],
  )

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('transfers.changeIntro')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">{t('transfers.filterTransferId')}</span>
          <Input
            className="w-44 font-mono"
            placeholder={t('transfers.filterTransferIdPlaceholder')}
            allowClear
            value={draft.transferId}
            onChange={(e) => setDraft((prev) => ({ ...prev, transferId: e.target.value }))}
            onPressEnter={() => onApply(draft)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">{t('transfers.changeFilterAction')}</span>
          <Select
            className="w-32"
            placeholder={tc('all')}
            allowClear
            value={draft.action || undefined}
            onChange={(value) => setDraft((prev) => ({ ...prev, action: value ?? '' }))}
            options={TRANSFER_CHANGE_ACTIONS.map((action) => ({
              value: action,
              label: t(`transferChangeAction.${action}`),
            }))}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">{t('ledger.colTime')}</span>
          <DatePicker.RangePicker
            value={draft.range}
            onChange={(value) =>
              setDraft((prev) => ({ ...prev, range: (value as [Dayjs, Dayjs] | null) ?? null }))
            }
            presets={rangePresets}
            allowClear
            inputReadOnly
          />
        </label>
        <Button type="primary" loading={loading} onClick={() => onApply(draft)}>
          {tc('search')}
        </Button>
      </div>

      <Table<TransferChange>
        rowKey="id"
        columns={columns}
        dataSource={changes}
        loading={loading}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: false,
          showTotal: (rowTotal) => t('tableTotal', { total: rowTotal }),
          onChange: onPageChange,
        }}
        scroll={{ x: 960 }}
        locale={{ emptyText: t('transfers.changeEmpty') }}
      />
    </div>
  )
}
