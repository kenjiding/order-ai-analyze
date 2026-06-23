import { Button, Empty, Popconfirm, Table, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PencilLine, Trash2 } from 'lucide-react'
import type { VendorPushConfig } from '../vendorAnalysisTypes'

function truncateMid(s: string, max: number): string {
  if (s.length <= max) return s
  const edge = Math.max(4, Math.floor((max - 1) / 2))
  return `${s.slice(0, edge)}…${s.slice(s.length - edge)}`
}

type Props = {
  configs: VendorPushConfig[]
  loading: boolean
  disabled: boolean
  onEdit: (config: VendorPushConfig) => void
  onDelete: (config: VendorPushConfig) => void
  onToggleDisabled: (id: string, nextDisabled: boolean) => void
}

export function VendorPushConfigTable({ configs, loading, disabled, onEdit, onDelete, onToggleDisabled }: Props) {
  const columns: ColumnsType<VendorPushConfig> = [
    {
      title: '供应商（责任单位）',
      key: 'vendor',
      width: 220,
      render: (_, row) => (
        <div>
          <div className="font-medium text-slate-800">{row.vendorName}</div>
          <div className="text-xs text-slate-400">{row.vendorCode}</div>
        </div>
      ),
    },
    {
      title: '群 Webhook',
      dataIndex: 'webhookUrl',
      key: 'webhookUrl',
      render: (url: string) => (
        <Tooltip title={url}>
          <span className="block max-w-[min(400px,45vw)] font-mono text-xs text-slate-600">
            {truncateMid(url || '', 52)}
          </span>
        </Tooltip>
      ),
    },
    {
      title: '签名密钥',
      key: 'signingSecret',
      width: 88,
      render: (_, row) =>
        row.signingSecret ? (
          <span className="text-[var(--admin-accent)]">已配置</span>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      title: '备注',
      dataIndex: 'pushDescription',
      key: 'pushDescription',
      ellipsis: true,
      render: (text: string | null) =>
        text ? text : <span className="text-slate-400">—</span>,
    },
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (_, row) =>
        row.isDisabled ? (
          <span className="text-amber-600">已禁用</span>
        ) : (
          <span className="text-emerald-600">已启用</span>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      fixed: 'right',
      onCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      render: (_, record) => (
        <div className="flex flex-nowrap items-center gap-0">
          <Button
            type="link"
            className="!px-1"
            disabled={disabled}
            onClick={() => onToggleDisabled(record.id, !record.isDisabled)}
          >
            {record.isDisabled ? '启用' : '禁用'}
          </Button>
          <Button
            type="link"
            className="!px-1"
            icon={<PencilLine className="h-3.5 w-3.5" />}
            disabled={disabled}
            onClick={() => onEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除这条推送配置？"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDelete(record)}
          >
            <Button
              type="link"
              className="!px-1"
              danger
              icon={<Trash2 className="h-3.5 w-3.5" />}
              disabled={disabled}
            >
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ]

  return (
    <Table<VendorPushConfig>
      rowKey="id"
      columns={columns}
      dataSource={configs}
      loading={loading}
      pagination={false}
      scroll={{ x: 860 }}
      locale={{
        emptyText: (
          <Empty
            className="py-12"
            description={
              <Typography.Text type="secondary">
                暂无推送配置，点击右上角「新增推送配置」开始。
              </Typography.Text>
            }
          />
        ),
      }}
    />
  )
}
