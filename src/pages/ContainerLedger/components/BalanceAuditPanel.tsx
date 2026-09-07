import { useMemo, useState } from 'react'
import { Button, DatePicker, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BALANCE_AUDIT_ACTIONS,
  formatTransferNo,
} from '../../../containerManagement/constants'
import type {
  BalanceAudit,
  BalanceAuditAction,
  ContainerAccount,
} from '../../../containerManagement/types'
import { useContainerTypes } from '../../../containerManagement/containerTypeStore'
import { ReasonTypeSelect } from './ReasonTypeSelect'
import type { AuditFilters } from '../useContainerLedgerPage'

const ACTION_COLOR: Record<BalanceAuditAction, string> = {
  CREATE: 'blue',
  UPDATE: 'gold',
  DELETE: 'red',
  TRANSFER: 'green',
}

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
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
  const [draft, setDraft] = useState<AuditFilters>(filters)
  // 筛选要含停用品类，否则它们的历史流水筛不出来
  const allTypes = useContainerTypes()

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

  const columns: ColumnsType<BalanceAudit> = useMemo(
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
      { title: t('ledger.colAccount'), dataIndex: 'accountName', key: 'accountName', width: 150 },
      {
        title: t('ledger.colType'),
        dataIndex: 'containerType',
        key: 'containerType',
        width: 90,
        render: (value: BalanceAudit['containerType']) => t(`containerType.${value}`),
      },
      {
        title: t('ledger.colAction'),
        dataIndex: 'action',
        key: 'action',
        width: 80,
        render: (value: BalanceAuditAction) => (
          <Tag color={ACTION_COLOR[value] ?? 'default'}>{t(`balanceAuditAction.${value}`)}</Tag>
        ),
      },
      {
        title: t('ledger.colPrev'),
        dataIndex: 'prevQuantity',
        key: 'prevQuantity',
        width: 70,
        align: 'right',
        render: (value: number | null) => value ?? t('dash'),
      },
      {
        title: t('ledger.colNew'),
        dataIndex: 'newQuantity',
        key: 'newQuantity',
        width: 70,
        align: 'right',
        render: (value: number | null) => value ?? t('dash'),
      },
      {
        title: t('ledger.colDelta'),
        dataIndex: 'delta',
        key: 'delta',
        width: 80,
        align: 'right',
        render: (value: number | null) => {
          if (value === null) return t('dash')
          const tone = value > 0 ? 'text-emerald-700' : value < 0 ? 'text-rose-700' : 'text-slate-500'
          return (
            <span className={`tabular-nums font-medium ${tone}`}>
              {value > 0 ? `+${value}` : value}
            </span>
          )
        },
      },
      {
        title: t('ledger.colReasonType'),
        dataIndex: 'reasonType',
        key: 'reasonType',
        width: 105,
        render: (value: BalanceAudit['reasonType']) => t(`balanceReasonType.${value}`),
      },
      {
        title: t('ledger.colReason'),
        dataIndex: 'reason',
        key: 'reason',
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
        title: t('ledger.colLinkedTransfer'),
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
      <p className="text-sm text-slate-600">{t('ledger.auditIntro')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">{t('ledger.colAccount')}</span>
          <Select
            className="w-44"
            placeholder={tc('all')}
            allowClear
            showSearch
            optionFilterProp="label"
            value={draft.accountId || undefined}
            onChange={(value) => setDraft((prev) => ({ ...prev, accountId: value ?? '' }))}
            options={accounts.map((account) => ({ value: account.id, label: account.name }))}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">{t('ledger.colType')}</span>
          <Select
            className="w-32"
            placeholder={tc('all')}
            allowClear
            value={draft.containerType || undefined}
            onChange={(value) => setDraft((prev) => ({ ...prev, containerType: value ?? '' }))}
            options={allTypes.map((type) => ({
              value: type.code,
              label: t(`containerType.${type.code}`),
            }))}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">{t('ledger.colAction')}</span>
          <Select
            className="w-28"
            placeholder={tc('all')}
            allowClear
            value={draft.action || undefined}
            onChange={(value) => setDraft((prev) => ({ ...prev, action: value ?? '' }))}
            options={BALANCE_AUDIT_ACTIONS.map((key) => ({
              value: key,
              label: t(`balanceAuditAction.${key}`),
            }))}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-slate-500">{t('ledger.colReasonType')}</span>
          <ReasonTypeSelect
            className="w-40"
            includeAll
            placeholder={tc('all')}
            value={(draft.reasonType || undefined) as never}
            onChange={(value) => setDraft((prev) => ({ ...prev, reasonType: value ?? '' }))}
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
          showTotal: (rowTotal) => t('tableTotal', { total: rowTotal }),
          onChange: onPageChange,
        }}
        scroll={{ x: 1280 }}
        locale={{ emptyText: t('ledger.emptyAudits') }}
      />
    </div>
  )
}
