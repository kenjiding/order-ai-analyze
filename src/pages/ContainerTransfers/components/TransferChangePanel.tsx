import { useState } from 'react'
import { Button, DatePicker, Input, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import {
  containerTypeLabel,
  formatTransferNo,
  transferChangeActionLabel,
} from '../../../containerManagement/constants'
import type {
  TransferChange,
  TransferChangeAction,
  TransferItem,
  TransferSnapshot,
} from '../../../containerManagement/types'
import type { ChangeFilters } from '../useContainerTransfersPage'

const RANGE_PRESETS: { label: string; value: [Dayjs, Dayjs] }[] = [
  { label: '今天', value: [dayjs().startOf('day'), dayjs().endOf('day')] },
  { label: '近 7 天', value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] },
  { label: '近 30 天', value: [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')] },
]

function itemMap(items: TransferItem[]): Map<string, number> {
  return new Map(items.map((item) => [item.containerType, item.declaredQuantity]))
}

/** 逐字段对比快照，多品类按品类拆开显示数量差异 */
function buildChangeItems(before: TransferSnapshot, after: TransferSnapshot | null): string[] {
  if (!after) {
    const detail = before.items
      .map((item) => `${containerTypeLabel[item.containerType]} ${item.declaredQuantity}`)
      .join('、')
    return [`删除时明细：${detail || '无'}`]
  }

  const changes: string[] = []
  const beforeItems = itemMap(before.items)
  const afterItems = itemMap(after.items)
  for (const type of new Set([...beforeItems.keys(), ...afterItems.keys()])) {
    const prev = beforeItems.get(type)
    const next = afterItems.get(type)
    if (prev === next) continue
    const label = containerTypeLabel[type as TransferItem['containerType']] ?? type
    if (prev === undefined) changes.push(`新增品类 ${label}: ${next}`)
    else if (next === undefined) changes.push(`移除品类 ${label}（原 ${prev}）`)
    else changes.push(`${label}: ${prev} → ${next}`)
  }
  if (before.occurredAt !== after.occurredAt) {
    changes.push(`日期 ${before.occurredAt} → ${after.occurredAt}`)
  }
  if (before.note !== after.note) changes.push(`备注: ${before.note || '空'} → ${after.note || '空'}`)
  return changes.length > 0 ? changes : ['无字段变化']
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
  const [draft, setDraft] = useState<ChangeFilters>(filters)

  const columns: ColumnsType<TransferChange> = [
    {
      title: '时间',
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
      title: '记录编号',
      key: 'transferId',
      width: 120,
      render: (_, record) => (
        <span className="font-mono text-xs text-slate-500">
          {formatTransferNo(record.transferId ?? record.beforeData.id)}
        </span>
      ),
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      width: 90,
      render: (value: TransferChangeAction) => (
        <Tag color={value === 'DELETE' ? 'red' : 'gold'}>
          {transferChangeActionLabel[value] ?? value}
        </Tag>
      ),
    },
    {
      title: '变更字段',
      key: 'diff',
      render: (_, record) => (
        <div className="space-y-0.5 text-sm text-slate-700">
          {buildChangeItems(record.beforeData, record.afterData).map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ),
    },
    {
      title: '原因',
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
          <span className="text-slate-400">—</span>
        ),
    },
    {
      title: '操作者',
      dataIndex: 'actorUsername',
      key: 'actorUsername',
      width: 110,
      render: (value: string | null) => value ?? <span className="text-slate-400">—</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        记录流转的编辑与删除。已删除的记录仍保留删除前的完整快照与原因。
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">记录编号</span>
          <Input
            className="w-44 font-mono"
            placeholder="如 123 或 TR-000123"
            allowClear
            value={draft.transferId}
            onChange={(e) => setDraft((prev) => ({ ...prev, transferId: e.target.value }))}
            onPressEnter={() => onApply(draft)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">操作类型</span>
          <Select
            className="w-32"
            placeholder="全部"
            allowClear
            value={draft.action || undefined}
            onChange={(value) => setDraft((prev) => ({ ...prev, action: value ?? '' }))}
            options={[
              { value: 'UPDATE', label: '编辑' },
              { value: 'DELETE', label: '删除' },
            ]}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">时间范围</span>
          <DatePicker.RangePicker
            value={draft.range}
            onChange={(value) =>
              setDraft((prev) => ({ ...prev, range: (value as [Dayjs, Dayjs] | null) ?? null }))
            }
            presets={RANGE_PRESETS}
            allowClear
            inputReadOnly
          />
        </label>
        <Button type="primary" loading={loading} onClick={() => onApply(draft)}>
          搜索
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
          showTotal: (t) => `共 ${t} 条`,
          onChange: onPageChange,
        }}
        scroll={{ x: 960 }}
        locale={{ emptyText: '暂无变更记录' }}
      />
    </div>
  )
}
