import { App as AntdApp, Button, Popconfirm, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Copy, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { SupplierPushConfig } from '../../../shared/supplierPushConfig'
import { listShareLinks, resetShareLink, updateShareLink, type VendorShareLink } from '../vendorAnalysisApi'

function buildShareUrl(token: string): string {
  return `${window.location.origin}/vendor-daily/${token}`
}

/**
 * 外部分享链接管理（仅供应商数据分析使用）：按 (vendorCode, reportDate) 绑定。
 * 链接由发布日报时后端自动开通，这里只负责按当前 reportDate 查询、复制、重置、启用禁用。
 */
export function useVendorShareLinks(enabled: boolean, reportDate: string | null) {
  const { message } = AntdApp.useApp()
  const [links, setLinks] = useState<Record<string, VendorShareLink>>({})
  const [busyVendor, setBusyVendor] = useState<string | null>(null)

  const refetch = useCallback(() => {
    if (!enabled || !reportDate) return
    void listShareLinks(reportDate).then((result) => {
      if (result.ok) {
        setLinks(Object.fromEntries(result.data.map((l) => [l.vendorCode, l])))
      }
    })
  }, [enabled, reportDate])

  useEffect(() => {
    setLinks({})
    refetch()
  }, [refetch])

  const putLink = (link: VendorShareLink) => setLinks((prev) => ({ ...prev, [link.vendorCode]: link }))

  const run = async (vendorCode: string, action: () => Promise<void>) => {
    setBusyVendor(vendorCode)
    try { await action() } finally { setBusyVendor(null) }
  }

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

  return { links, busyVendor, reportDate, refetch, copy, reset, toggle }
}

/** 「分享链接」列：复制 / 重置 / 启用禁用，插入供应商配置表的 extraColumns */
export function buildVendorShareLinkColumn(
  share: ReturnType<typeof useVendorShareLinks>,
): ColumnsType<SupplierPushConfig> {
  return [
    {
      title: (
        <Tooltip title="链接与发布当天的数据一一对应，仅保留最近 7 天">
          <span>分享链接</span>
        </Tooltip>
      ),
      key: 'shareLink',
      width: 240,
      onCell: () => ({ style: { whiteSpace: 'nowrap' as const } }),
      render: (_, record) => {
        if (!share.reportDate) {
          return <span className="text-xs text-slate-400">请先获取数据</span>
        }
        const link = share.links[record.vendorCode]
        const isRowBusy = share.busyVendor === record.vendorCode
        if (!link) {
          return <span className="text-xs text-slate-400">发布后自动生成</span>
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
  ]
}
