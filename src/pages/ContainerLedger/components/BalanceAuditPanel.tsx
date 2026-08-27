import { useState } from 'react'
import { Button, DatePicker, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { Link } from 'react-router-dom'
import {
  CONTAINER_TYPES,
  balanceAuditActionLabel,
  balanceReasonTypeLabel,
  containerTypeLabel,
  formatTransferNo,
} from '../../../containerManagement/constants'
import type {
  BalanceAudit,
  BalanceAuditAction,
  ContainerAccount,
} from '../../../containerManagement/types'
import { ReasonTypeSelect } from './ReasonTypeSelect'
import type { AuditFilters } from '../useContainerLedgerPage'

const ACTION_COLOR: Record<BalanceAuditAction, string> = {
  CREATE: 'blue',
  UPDATE: 'gold',
  DELETE: 'red',
  TRANSFER: 'green',
}

const RANGE_PRESETS: { label: string; value: [Dayjs, Dayjs] }[] = [
  { label: '今天', value: [dayjs().startOf('day'), dayjs().endOf('day')] },
  { label: '近 7 天', value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] },
  { label: '近 30 天', value: [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')] },
]

type Props = {
  accounts: ContainerAccount[]
  audits: BalanceAudit[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  filters: AuditFilters
  onPageChange: (page: number) => void
  onApply: (filters: AuditFilters) => void
}

export function BalanceAuditPanel({
  accounts,
  audits,
  total,
  page,
  pageSize,
  loading,
  filters,
  onPageChange,
  onApply,
}: Props) {
  const [draft, setDraft] = useState<AuditFilters>(filters)

  const columns: ColumnsType<BalanceAudit> = [
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
    { title: '站点账户', dataIndex: 'accountName', key: 'accountName', width: 150 },
    {
      title: '品类',
      dataIndex: 'containerType',
      key: 'containerType',
      width: 90,
      render: (value: BalanceAudit['containerType']) => containerTypeLabel[value] ?? value,
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      width: 80,
      render: (value: BalanceAuditAction) => (
        <Tag color={ACTION_COLOR[value] ?? 'default'}>{balanceAuditActionLabel[value] ?? value}</Tag>
      ),
    },
    {
      title: '旧值',
      dataIndex: 'prevQuantity',
      key: 'prevQuantity',
      width: 70,
      align: 'right',
      render: (value: number | null) => (value ?? '—'),
    },
    {
      title: '新值',
      dataIndex: 'newQuantity',
      key: 'newQuantity',
      width: 70,
      align: 'right',
      render: (value: number | null) => (value ?? '—'),
    },
    {
      title: '差值',
      dataIndex: 'delta',
      key: 'delta',
      width: 80,
      align: 'right',
      render: (value: number | null) => {
        if (value === null) return '—'
        const tone = value > 0 ? 'text-emerald-700' : value < 0 ? 'text-rose-700' : 'text-slate-500'
        return (
          <span className={`tabular-nums font-medium ${tone}`}>
            {value > 0 ? `+${value}` : value}
          </span>
        )
      },
    },
    {
      title: '原因类型',
      dataIndex: 'reasonType',
      key: 'reasonType',
      width: 105,
      render: (value: BalanceAudit['reasonType']) => balanceReasonTypeLabel[value] ?? value,
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
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
      title: '关联流转',
      dataIndex: 'transferId',
      key: 'transferId',
      width: 130,
      render: (value: number | null) =>
        value ? (
          <Link
            className="font-mono text-xs text-[#2f8f87] hover:underline"
            to={`/container/transfers?transferId=${value}`}
          >
            {formatTransferNo(value)}
          </Link>
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
        记录每次库存变更，包含手工调账与流转确认入账；流转产生的记录可点「关联流转」追溯来源。
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">站点账户</span>
          <Select
            className="w-44"
            placeholder="全部"
            allowClear
            showSearch
            optionFilterProp="label"
            value={draft.accountId || undefined}
            onChange={(value) => setDraft((prev) => ({ ...prev, accountId: value ?? '' }))}
            options={accounts.map((account) => ({ value: account.id, label: account.name }))}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">品类</span>
          <Select
            className="w-32"
            placeholder="全部"
            allowClear
            value={draft.containerType || undefined}
            onChange={(value) => setDraft((prev) => ({ ...prev, containerType: value ?? '' }))}
            options={CONTAINER_TYPES.map((type) => ({
              value: type,
              label: containerTypeLabel[type],
            }))}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">操作</span>
          <Select
            className="w-28"
            placeholder="全部"
            allowClear
            value={draft.action || undefined}
            onChange={(value) => setDraft((prev) => ({ ...prev, action: value ?? '' }))}
            options={(Object.keys(balanceAuditActionLabel) as BalanceAuditAction[]).map((key) => ({
              value: key,
              label: balanceAuditActionLabel[key],
            }))}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">原因类型</span>
          <ReasonTypeSelect
            className="w-40"
            includeAll
            placeholder="全部"
            value={(draft.reasonType || undefined) as never}
            onChange={(value) => setDraft((prev) => ({ ...prev, reasonType: value ?? '' }))}
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

      <Table<BalanceAudit>
        rowKey="id"
        columns={columns}
        dataSource={audits}
        loading={loading}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 条`,
          onChange: onPageChange,
        }}
        scroll={{ x: 1280 }}
        locale={{ emptyText: '暂无变更记录' }}
      />
    </div>
  )
}
