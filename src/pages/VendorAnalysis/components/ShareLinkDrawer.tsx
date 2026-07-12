import { App as AntdApp, Button, Drawer, Popconfirm, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Copy, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { listShareLinks, resetShareLink, updateShareLink, type VendorShareLink } from '../vendorAnalysisApi'

/** 分享链接有效期：一周（与后端 retention / portal 校验一致） */
const SHARE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

function buildShareUrl(token: string): string {
  return `${window.location.origin}/vendor-daily/${token}`
}

/** navigator.clipboard 仅在安全上下文（HTTPS/localhost）可用，线上非 HTTPS 场景需要这个降级方案 */
function fallbackCopy(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(textarea)
  return ok
}

function formatExpiry(createdAt: string): string {
  const d = new Date(new Date(createdAt).getTime() + SHARE_LINK_TTL_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type Props = {
  open: boolean
  onClose: () => void
  /** 当前分享的任务；配合父层 key={jobId} 每任务独立挂载 */
  jobId: string | null
}

/**
 * 任务队列「分享」抽屉：展示并管理该任务的对外分享链接（每供应商一条）。
 * 链接在「数据预览 → 预览快照 / 截图推送」发布日报时自动开通，保留一周；此处负责复制 / 重置 / 启用禁用。
 */
export function ShareLinkDrawer({ open, onClose, jobId }: Props) {
  const { message } = AntdApp.useApp()
  const [links, setLinks] = useState<VendorShareLink[]>([])
  // 初值 true：父层按 jobId key 每任务独立挂载，打开即处于加载态，effect 里只做异步 setState（避免同步级联渲染）
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !jobId) return
    void listShareLinks(jobId).then((res) => {
      if (res.ok) setLinks(res.data)
      else message.error(`加载分享链接失败：${res.error}`)
      setLoading(false)
    })
  }, [open, jobId, message])

  const copy = async (link: VendorShareLink) => {
    const url = buildShareUrl(link.token)
    try {
      if (!navigator.clipboard) throw new Error('clipboard API unavailable')
      await navigator.clipboard.writeText(url)
      message.success('分享链接已复制')
    } catch {
      if (fallbackCopy(url)) {
        message.success('分享链接已复制')
      } else {
        message.error('复制失败，请手动复制')
      }
    }
  }

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id)
    try { await action() } finally { setBusyId(null) }
  }

  const putLink = (link: VendorShareLink) =>
    setLinks((prev) => prev.map((l) => (l.id === link.id ? link : l)))

  const reset = (link: VendorShareLink) =>
    run(link.id, async () => {
      const res = await resetShareLink(link.id)
      if (!res.ok) { message.error(`重置失败：${res.error}`); return }
      putLink(res.data)
      message.success('链接已重置，旧链接立即失效')
    })

  const toggle = (link: VendorShareLink) =>
    run(link.id, async () => {
      const res = await updateShareLink(link.id, !link.isDisabled)
      if (!res.ok) { message.error(`更新失败：${res.error}`); return }
      putLink(res.data)
      message.success(res.data.isDisabled ? '链接已禁用' : '链接已启用')
    })

  const columns: ColumnsType<VendorShareLink> = [
    {
      title: '供应商',
      key: 'vendor',
      render: (_, link) => (
        <span className="text-slate-700" title={link.vendorCode}>{link.vendorName || link.vendorCode}</span>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 88,
      render: (_, link) =>
        link.isDisabled
          ? <Tag color="default" className="mr-0">已禁用</Tag>
          : <Tag color="success" className="mr-0">有效</Tag>,
    },
    {
      title: '有效期至',
      key: 'expiry',
      width: 150,
      render: (_, link) => <span className="text-slate-500">{formatExpiry(link.createdAt)}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_, link) => {
        const isBusy = busyId === link.id
        const otherBusy = busyId != null && !isBusy
        return (
          <div className="flex flex-nowrap items-center gap-1">
            <Tooltip title={buildShareUrl(link.token)}>
              <Button type="link" className="!px-1" icon={<Copy className="h-3.5 w-3.5" />} disabled={isBusy} onClick={() => void copy(link)}>
                复制
              </Button>
            </Tooltip>
            <Popconfirm
              title="确认重置分享链接？旧链接将立即失效。"
              okText="重置"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void reset(link)}
            >
              <Button type="link" className="!px-1" icon={<RotateCcw className="h-3.5 w-3.5" />} loading={isBusy} disabled={otherBusy}>
                重置
              </Button>
            </Popconfirm>
            <Button type="link" className="!px-1" danger={!link.isDisabled} disabled={otherBusy} onClick={() => void toggle(link)}>
              {link.isDisabled ? '启用' : '禁用'}
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      size={640}
      title={
        <div className="flex items-center gap-2">
          <Copy className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
          <span>分享链接</span>
        </div>
      }
    >
      <div className="space-y-4">
        <Typography.Paragraph type="secondary" className="!mb-0 text-xs leading-relaxed">
          每个已启用推送的供应商一条对外链接（无需登录，凭链接访问本任务的日报），保留一周有效期。
          链接在「数据预览 → 预览快照 / 截图推送」发布日报时，按任务的「推送供应商配置」自动开通。
        </Typography.Paragraph>
        {links.length === 0 && !loading ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-700">
            该任务尚未生成分享链接。请先「查看数据」进入「数据预览」，点击「预览快照 / 截图推送」发布日报后即可在此管理链接。
          </div>
        ) : (
          <Table<VendorShareLink>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={links}
            pagination={false}
            locale={{ emptyText: '暂无分享链接' }}
          />
        )}
      </div>
    </Drawer>
  )
}
