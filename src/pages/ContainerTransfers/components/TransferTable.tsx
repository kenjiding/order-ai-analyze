import { useMemo } from 'react'
import { Button, Dropdown, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { MenuProps } from 'antd'
import dayjs from 'dayjs'
import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatTransferNo, transferStatusColor } from '../../../containerManagement/constants'
import type { Transfer } from '../../../containerManagement/types'
import { TransferQuantityCell } from './TransferQuantityCell'

type Props = {
  transfers: Transfer[]
  loading: boolean
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number, pageSize: number) => void
  canActAs: (accountId: string) => boolean
  canProxyConfirm: boolean
  canVoid: boolean
  onConfirm: (transfer: Transfer) => void
  onProxyConfirm: (transfer: Transfer) => void
  onDispute: (transfer: Transfer) => void
  onTimeline: (transfer: Transfer) => void
  onNegotiate: (transfer: Transfer) => void
  onEdit: (transfer: Transfer) => void
  onDelete: (transfer: Transfer) => void
  onVoid: (transfer: Transfer) => void
}

export function TransferTable({
  transfers,
  loading,
  total,
  page,
  pageSize,
  onPageChange,
  canActAs,
  canProxyConfirm,
  canVoid,
  onConfirm,
  onProxyConfirm,
  onDispute,
  onTimeline,
  onNegotiate,
  onEdit,
  onDelete,
  onVoid,
}: Props) {
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')

  const buildMenu = useMemo(
    () =>
      (record: Transfer): MenuProps['items'] => {
        const isReceiver = canActAs(record.toAccountId)
        const isSender = canActAs(record.fromAccountId)
        const items: MenuProps['items'] = []

        if (record.status === 'PENDING_RECEIVER' && isReceiver) {
          items.push({ key: 'confirm', label: t('transfers.actionConfirm'), onClick: () => onConfirm(record) })
          items.push({ key: 'dispute', label: t('transfers.actionDispute'), onClick: () => onDispute(record) })
        }
        if (
          record.status === 'PENDING_RECEIVER' &&
          record.toAccountIsExternal &&
          isSender &&
          canProxyConfirm
        ) {
          items.push({
            key: 'proxy-confirm',
            label: t('transfers.actionProxyConfirm'),
            onClick: () => onProxyConfirm(record),
          })
        }
        if (record.status === 'DISPUTED' && (isSender || isReceiver)) {
          items.push({ key: 'negotiate', label: t('transfers.actionNegotiate'), onClick: () => onNegotiate(record) })
        }
        items.push({ key: 'timeline', label: t('transfers.actionTimeline'), onClick: () => onTimeline(record) })
        if (record.status === 'PENDING_RECEIVER' && isSender) {
          items.push({ key: 'edit', label: tc('edit'), onClick: () => onEdit(record) })
        }
        if (record.status !== 'CONFIRMED' && record.status !== 'VOIDED' && isSender) {
          items.push({ key: 'delete', label: tc('delete'), danger: true, onClick: () => onDelete(record) })
        }
        if (record.status === 'CONFIRMED' && canVoid && (isSender || isReceiver)) {
          items.push({ key: 'void', label: t('transfers.actionVoid'), danger: true, onClick: () => onVoid(record) })
        }
        return items
      },
    [
      canActAs,
      canProxyConfirm,
      canVoid,
      onConfirm,
      onProxyConfirm,
      onDispute,
      onTimeline,
      onNegotiate,
      onEdit,
      onDelete,
      onVoid,
      t,
      tc,
    ],
  )

  const columns: ColumnsType<Transfer> = useMemo(
    () => [
      {
        title: t('transfers.colTime'),
        dataIndex: 'occurredAt',
        key: 'occurredAt',
        width: 110,
        render: (value: string) => (
          <span className="whitespace-nowrap text-slate-500">{value}</span>
        ),
      },
      {
        title: t('transfers.colNo'),
        dataIndex: 'id',
        key: 'id',
        width: 110,
        render: (value: number) => (
          <span className="font-mono text-xs text-slate-500">{formatTransferNo(value)}</span>
        ),
      },
      {
        title: t('transfers.colKind'),
        dataIndex: 'kind',
        key: 'kind',
        width: 100,
        render: (value: Transfer['kind']) => t(`transferKind.${value}`),
      },
      {
        title: t('transfers.colStatus'),
        dataIndex: 'status',
        key: 'status',
        width: 158,
        render: (value: Transfer['status'], record) => (
          <span className="inline-flex flex-wrap items-center gap-1">
            <Tag color={transferStatusColor[value]}>{t(`transferStatus.${value}`)}</Tag>
            {record.proxyConfirmed ? <Tag color="cyan">{t('transfers.proxyConfirmedTag')}</Tag> : null}
          </span>
        ),
      },
      { title: t('transfers.colFrom'), dataIndex: 'fromAccountName', key: 'fromAccountName', width: 150 },
      { title: t('transfers.colTo'), dataIndex: 'toAccountName', key: 'toAccountName', width: 150 },
      {
        title: t('transfers.colCreatedAt'),
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 150,
        render: (value: string) => (
          <span className="whitespace-nowrap text-slate-500">
            {dayjs(value).format('YYYY-MM-DD HH:mm')}
          </span>
        ),
      },
      {
        title: t('transfers.colQuantity'),
        key: 'quantity',
        width: 190,
        align: 'right',
        render: (_, record) => <TransferQuantityCell transfer={record} />,
      },
      {
        title: t('transfers.colNote'),
        dataIndex: 'note',
        key: 'note',
        ellipsis: true,
        render: (value: string | null) =>
          value?.trim() ? (
            <Tooltip title={value}>
              <span className="text-slate-600">{value}</span>
            </Tooltip>
          ) : (
            <span className="text-slate-400">-</span>
          ),
      },
      {
        title: tc('actions'),
        key: 'actions',
        width: 80,
        fixed: 'right',
        align: 'right',
        render: (_, record) => (
          <Dropdown menu={{ items: buildMenu(record) }} trigger={['click']} placement="bottomRight">
            <Button
              type="text"
              icon={<MoreHorizontal className="h-4 w-4" aria-hidden />}
              aria-label={t('transfers.openActionsMenu')}
            />
          </Dropdown>
        ),
      },
    ],
    [buildMenu, t, tc],
  )

  return (
    <Table<Transfer>
      rowKey="id"
      columns={columns}
      dataSource={transfers}
      loading={loading}
      pagination={{
        current: page,
        pageSize,
        total,
        showSizeChanger: true,
        pageSizeOptions: [10, 20, 50, 100],
        showTotal: (rowTotal) => t('tableTotal', { total: rowTotal }),
        onChange: onPageChange,
      }}
      scroll={{ x: 1380 }}
      locale={{ emptyText: t('transfers.empty') }}
    />
  )
}
