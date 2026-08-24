import { Button, Dropdown, Image, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { MenuProps } from 'antd'
import { MoreHorizontal } from 'lucide-react'
import dayjs from 'dayjs'
import {
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
  onConfirm: (transfer: Transfer) => void
  onDispute: (transfer: Transfer) => void
  onDetail: (transfer: Transfer) => void
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
  onConfirm,
  onDispute,
  onDetail,
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
    items.push({ key: 'detail', label: '查看记录', onClick: () => onDetail(record) })
    // 协商中改主张走详情抽屉，列表不再单独提供「编辑」入口
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
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 110,
      render: (value: string) => (
        <span className="whitespace-nowrap text-slate-500">{dayjs(value).format('YYYY-MM-DD')}</span>
      ),
    },
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 120,
      render: (value: string) => <span className="font-mono text-xs text-slate-500">{value}</span>,
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
      width: 120,
      render: (value: Transfer['status']) => (
        <Tag color={transferStatusColor[value]}>{transferStatusLabel[value]}</Tag>
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
      title: '图片',
      dataIndex: 'imageUrl',
      key: 'imageUrl',
      width: 90,
      render: (value: string | null) =>
        value ? (
          <Image src={value} alt="流转凭证" width={64} height={48} className="rounded object-cover" />
        ) : (
          <span className="text-slate-400">—</span>
        ),
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
          <span className="text-slate-400">—</span>
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
    <Image.PreviewGroup>
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
        scroll={{ x: 1320 }}
        locale={{ emptyText: '暂无流转记录' }}
      />
    </Image.PreviewGroup>
  )
}
