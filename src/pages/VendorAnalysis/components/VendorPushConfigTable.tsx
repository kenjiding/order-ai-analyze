import { App as AntdApp, Button, Empty, Popconfirm, Table, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Copy, Link2, PencilLine, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import {
  createShareLink,
  listShareLinks,
  resetShareLink,
  updateShareLink,
  type VendorShareLink,
} from '../vendorAnalysisApi'
import type { VendorPushConfig } from '../vendorAnalysisTypes'

function truncateMid(s: string, max: number): string {
  if (s.length <= max) return s
  const edge = Math.max(4, Math.floor((max - 1) / 2))
  return `${s.slice(0, edge)}…${s.slice(s.length - edge)}`
}

type LoadingState = { id: string; action: 'toggle' | 'delete' } | null

type Props = {
  configs: VendorPushConfig[]
  loading: boolean
  disabled: boolean
  onEdit: (config: VendorPushConfig) => void
  onDelete: (config: VendorPushConfig) => Promise<void>
  onToggleDisabled: (id: string, nextDisabled: boolean) => Promise<void>
}

function buildShareUrl(token: string): string {
  return `${window.location.origin}/vendor-daily/${token}`
}

/** 外部分享链接管理：按 vendorCode 维护，与推送配置行对齐展示 */
function useShareLinks(enabled: boolean) {
  const { message } = AntdApp.useApp()
  const [links, setLinks] = useState<Record<string, VendorShareLink>>({})
  const [busyVendor, setBusyVendor] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    void listShareLinks().then((result) => {
      if (result.ok) {
        setLinks(Object.fromEntries(result.data.map((l) => [l.vendorCode, l])))
      }
    })
  }, [enabled])

  const putLink = (link: VendorShareLink) => setLinks((prev) => ({ ...prev, [link.vendorCode]: link }))

  const run = async (vendorCode: string, action: () => Promise<void>) => {
    setBusyVendor(vendorCode)
    try { await action() } finally { setBusyVendor(null) }
  }

  const generate = (vendorCode: string, vendorName: string) =>
    run(vendorCode, async () => {
      const result = await createShareLink(vendorCode, vendorName)
      if (!result.ok) { message.error(`生成分享链接失败：${result.error}`); return }
      putLink(result.data)
      message.success('分享链接已生成')
    })

  const copy = async (link: VendorShareLink) => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(link.token))
      message.success('分享链接已复制')
    } catch {
      message.error('复制失败，请手动复制')
    }
  }

  const reset = (link: VendorShareLink) =>
    run(link.vendorCode, async () => {
      const result = await resetShareLink(link.id)
      if (!result.ok) { message.error(`重置失败：${result.error}`); return }
      putLink(result.data)
      message.success('链接已重置，旧链接立即失效')
    })

  const toggle = (link: VendorShareLink) =>
    run(link.vendorCode, async () => {
      const result = await updateShareLink(link.id, !link.isDisabled)
      if (!result.ok) { message.error(`更新失败：${result.error}`); return }
      putLink(result.data)
      message.success(result.data.isDisabled ? '链接已禁用' : '链接已启用')
    })

  return { links, busyVendor, generate, copy, reset, toggle }
}

export function VendorPushConfigTable({ configs, loading, disabled, onEdit, onDelete, onToggleDisabled }: Props) {
  const [loadingState, setLoadingState] = useState<LoadingState>(null)
  const canShare = usePermission(PERMISSION_KEYS.btnVendorAnalysisShare)
  const share = useShareLinks(canShare)

  const handleToggle = async (id: string, nextDisabled: boolean) => {
    setLoadingState({ id, action: 'toggle' })
    try { await onToggleDisabled(id, nextDisabled) } finally { setLoadingState(null) }
  }

  const handleDelete = async (config: VendorPushConfig) => {
    setLoadingState({ id: config.id, action: 'delete' })
    try { await onDelete(config) } finally { setLoadingState(null) }
  }

  const isBusy = disabled || loadingState != null

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
    ...(canShare
      ? ([
          {
            title: '分享链接',
            key: 'shareLink',
            width: 240,
            onCell: () => ({ style: { whiteSpace: 'nowrap' } }),
            render: (_, record) => {
              const link = share.links[record.vendorCode]
              const isRowBusy = share.busyVendor === record.vendorCode
              if (!link) {
                return (
                  <Button
                    type="link"
                    className="!px-1"
                    icon={<Link2 className="h-3.5 w-3.5" />}
                    loading={isRowBusy}
                    disabled={share.busyVendor != null && !isRowBusy}
                    onClick={() => void share.generate(record.vendorCode, record.vendorName)}
                  >
                    生成链接
                  </Button>
                )
              }
              return (
                <div className="flex flex-nowrap items-center gap-0">
                  <Tooltip title={buildShareUrl(link.token)}>
                    <Button
                      type="link"
                      className="!px-1"
                      icon={<Copy className="h-3.5 w-3.5" />}
                      disabled={isRowBusy}
                      onClick={() => void share.copy(link)}
                    >
                      复制
                    </Button>
                  </Tooltip>
                  <Popconfirm
                    title="确认重置分享链接？旧链接将立即失效。"
                    okText="重置"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void share.reset(link)}
                  >
                    <Button
                      type="link"
                      className="!px-1"
                      icon={<RotateCcw className="h-3.5 w-3.5" />}
                      loading={isRowBusy}
                      disabled={share.busyVendor != null && !isRowBusy}
                    >
                      重置
                    </Button>
                  </Popconfirm>
                  <Button
                    type="link"
                    className="!px-1"
                    danger={!link.isDisabled}
                    disabled={share.busyVendor != null && !isRowBusy}
                    onClick={() => void share.toggle(link)}
                  >
                    {link.isDisabled ? '启用' : '禁用'}
                  </Button>
                  {link.isDisabled && <span className="text-xs text-amber-600">已禁用</span>}
                </div>
              )
            },
          },
        ] satisfies ColumnsType<VendorPushConfig>)
      : []),
    {
      title: '操作',
      key: 'actions',
      width: 180,
      fixed: 'right',
      onCell: () => ({ style: { whiteSpace: 'nowrap' } }),
      render: (_, record) => {
        const isRowToggling = loadingState?.id === record.id && loadingState.action === 'toggle'
        const isRowDeleting = loadingState?.id === record.id && loadingState.action === 'delete'
        return (
          <div className="flex flex-nowrap items-center gap-0">
            <Button
              type="link"
              className="!px-1"
              disabled={isBusy && !isRowToggling}
              loading={isRowToggling}
              onClick={() => void handleToggle(record.id, !record.isDisabled)}
            >
              {record.isDisabled ? '启用' : '禁用'}
            </Button>
            <Button
              type="link"
              className="!px-1"
              icon={<PencilLine className="h-3.5 w-3.5" />}
              disabled={isBusy}
              onClick={() => onEdit(record)}
            >
              编辑
            </Button>
            <Popconfirm
              title="确认删除这条推送配置？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleDelete(record)}
            >
              <Button
                type="link"
                className="!px-1"
                danger
                icon={<Trash2 className="h-3.5 w-3.5" />}
                disabled={isBusy && !isRowDeleting}
                loading={isRowDeleting}
              >
                删除
              </Button>
            </Popconfirm>
          </div>
        )
      },
    },
  ]

  return (
    <Table<VendorPushConfig>
      rowKey="id"
      columns={columns}
      dataSource={configs}
      loading={loading}
      pagination={false}
      scroll={{ x: canShare ? 1100 : 860 }}
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
