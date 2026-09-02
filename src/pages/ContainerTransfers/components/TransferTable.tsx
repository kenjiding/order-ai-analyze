import { Button, Dropdown, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { MenuProps } from 'antd'
import { MoreHorizontal } from 'lucide-react'
import {
  formatTransferNo,
  transferKindLabel,
  transferStatusColor,
  transferStatusLabel,
} from '../../../containerManagement/constants'
import type { Transfer } from '../../../containerManagement/types'
import { TransferQuantityCell } from './TransferQuantityCell'

type Props = {
  transfers: Transfer[]
  loading: boolean
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  canActAs: (accountId: string) => boolean
  /** 有代确认权限时，接收方无系统账号的单子才给「按回单确认」入口 */
  canProxyConfirm: boolean
  onConfirm: (transfer: Transfer) => void
  onProxyConfirm: (transfer: Transfer) => void
  onDispute: (transfer: Transfer) => void
  onTimeline: (transfer: Transfer) => void
  onNegotiate: (transfer: Transfer) => void
  onEdit: (transfer: Transfer) => void
  onDelete: (transfer: Transfer) => void
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
  onConfirm,
  onProxyConfirm,
  onDispute,
  onTimeline,
  onNegotiate,
  onEdit,
  onDelete,
}: Props) {
  const buildMenu = (record: Transfer): MenuProps['items'] => {
    const isReceiver = canActAs(record.toAccountId)
    const isSender = canActAs(record.fromAccountId)
    const items: MenuProps['items'] = []

    if (record.status === 'PENDING_RECEIVER' && isReceiver) {
      items.push({ key: 'confirm', label: '确认收货', onClick: () => onConfirm(record) })
      items.push({ key: 'dispute', label: '差异申报', onClick: () => onDispute(record) })
    }
    // 接收方登不进系统，这单只能由转出方凭线下回单推进，否则永久卡住并占着可用量
    if (
      record.status === 'PENDING_RECEIVER' &&
      record.toAccountIsExternal &&
      isSender &&
      canProxyConfirm
    ) {
      items.push({
        key: 'proxy-confirm',
        label: '按回单确认',
        onClick: () => onProxyConfirm(record),
      })
    }
    if (record.status === 'DISPUTED' && (isSender || isReceiver)) {
      items.push({ key: 'negotiate', label: '协商', onClick: () => onNegotiate(record) })
    }
    items.push({ key: 'timeline', label: '查看记录', onClick: () => onTimeline(record) })
    // 协商中改主张走「协商」抽屉，列表不提供「编辑」入口
    if (record.status === 'PENDING_RECEIVER' && isSender) {
      items.push({ key: 'edit', label: '编辑', onClick: () => onEdit(record) })
    }
    if (record.status !== 'CONFIRMED' && isSender) {
      items.push({ key: 'delete', label: '删除', danger: true, onClick: () => onDelete(record) })
    }
    return items
  }

  const columns: ColumnsType<Transfer> = [
    {
      title: '时间',
      dataIndex: 'occurredAt',
      key: 'occurredAt',
      width: 110,
      render: (value: string) => (
        <span className="whitespace-nowrap text-slate-500">{value}</span>
      ),
    },
    {
      title: '编号',
      dataIndex: 'id',
      key: 'id',
      width: 110,
      render: (value: number) => (
        <span className="font-mono text-xs text-slate-500">{formatTransferNo(value)}</span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      width: 100,
      render: (value: Transfer['kind']) => transferKindLabel[value] ?? value,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 158,
      render: (value: Transfer['status'], record) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Tag color={transferStatusColor[value]}>{transferStatusLabel[value]}</Tag>
          {/* 没有对方的确认动作，不能和对方本人确认的单子混在一起看 */}
          {record.proxyConfirmed ? <Tag color="cyan">代确认</Tag> : null}
        </span>
      ),
    },
    { title: '转出方', dataIndex: 'fromAccountName', key: 'fromAccountName', width: 150 },
    { title: '接收方', dataIndex: 'toAccountName', key: 'toAccountName', width: 150 },
    {
      title: '数量',
      key: 'quantity',
      width: 190,
      align: 'right',
      render: (_, record) => <TransferQuantityCell transfer={record} />,
    },
    {
      title: '备注',
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
      title: '操作',
      key: 'actions',
      width: 80,
      fixed: 'right',
      align: 'right',
      render: (_, record) => (
        <Dropdown menu={{ items: buildMenu(record) }} trigger={['click']} placement="bottomRight">
          <Button
            type="text"
            icon={<MoreHorizontal className="h-4 w-4" aria-hidden />}
            aria-label="打开操作菜单"
          />
        </Dropdown>
      ),
    },
  ]

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
        showSizeChanger: false,
        showTotal: (t) => `共 ${t} 条`,
        onChange: onPageChange,
      }}
      scroll={{ x: 1230 }}
      locale={{ emptyText: '暂无流转记录' }}
    />
  )
}
