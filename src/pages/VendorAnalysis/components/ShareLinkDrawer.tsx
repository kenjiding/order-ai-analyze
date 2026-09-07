import { App as AntdApp, Button, Drawer, Popconfirm, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Copy, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { copyTextToClipboard } from '../../../utils/clipboard'
import { listShareLinks, resetShareLink, updateShareLink, type VendorShareLink } from '../vendorAnalysisApi'

const SHARE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

function buildShareUrl(token: string): string {
  return `${window.location.origin}/vendor-daily/${token}`
}

function formatExpiry(createdAt: string): string {
  const d = new Date(new Date(createdAt).getTime() + SHARE_LINK_TTL_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type Props = {
  open: boolean
  onClose: () => void
  jobId: string | null
}

export function ShareLinkDrawer({ open, onClose, jobId }: Props) {
  const { t } = useTranslation('vendorAnalysis')
  const { t: tc } = useTranslation('common')
  const { message } = AntdApp.useApp()
  const [links, setLinks] = useState<VendorShareLink[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !jobId) return
    void listShareLinks(jobId).then((res) => {
      if (res.ok) setLinks(res.data)
      else message.error(t('shareLoadFailed', { error: res.error }))
      setLoading(false)
    })
  }, [open, jobId, message, t])

  const copy = async (link: VendorShareLink) => {
    const url = buildShareUrl(link.token)
    const ok = await copyTextToClipboard(url)
    if (ok) message.success(t('shareCopied'))
    else message.error(tc('copyFailed'))
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
      if (!res.ok) { message.error(t('shareResetFailed', { error: res.error })); return }
      putLink(res.data)
      message.success(t('shareResetOk'))
    })

  const toggle = (link: VendorShareLink) =>
    run(link.id, async () => {
      const res = await updateShareLink(link.id, !link.isDisabled)
      if (!res.ok) { message.error(t('shareUpdateFailed', { error: res.error })); return }
      putLink(res.data)
      message.success(res.data.isDisabled ? t('linkDisabled') : t('linkEnabled'))
    })

  const columns: ColumnsType<VendorShareLink> = [
    {
      title: tc('vendor'),
      key: 'vendor',
      render: (_, link) => (
        <span className="text-slate-700" title={link.vendorCode}>{link.vendorName || link.vendorCode}</span>
      ),
    },
    {
      title: tc('status'),
      key: 'status',
      width: 88,
      render: (_, link) =>
        link.isDisabled
          ? <Tag color="default" className="mr-0">{tc('disabled')}</Tag>
          : <Tag color="success" className="mr-0">{tc('active')}</Tag>,
    },
    {
      title: tc('validUntil'),
      key: 'expiry',
      width: 150,
      render: (_, link) => <span className="text-slate-500">{formatExpiry(link.createdAt)}</span>,
    },
    {
      title: tc('actions'),
      key: 'actions',
      width: 220,
      render: (_, link) => {
        const isBusy = busyId === link.id
        const otherBusy = busyId != null && !isBusy
        return (
          <div className="flex flex-nowrap items-center gap-1">
            <Button
              type="link"
              className="!px-1"
              icon={<Copy className="h-3.5 w-3.5" />}
              disabled={isBusy}
              title={buildShareUrl(link.token)}
              onClick={() => void copy(link)}
            >
              {tc('copy')}
            </Button>
            <Popconfirm
              title={t('shareResetConfirm')}
              okText={tc('resetLink')}
              cancelText={tc('cancel')}
              okButtonProps={{ danger: true }}
              onConfirm={() => void reset(link)}
            >
              <Button type="link" className="!px-1" icon={<RotateCcw className="h-3.5 w-3.5" />} loading={isBusy} disabled={otherBusy}>
                {tc('resetLink')}
              </Button>
            </Popconfirm>
            <Button type="link" className="!px-1" danger={!link.isDisabled} disabled={otherBusy} onClick={() => void toggle(link)}>
              {link.isDisabled ? tc('enable') : tc('disabled')}
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
          <span>{t('shareTitle')}</span>
        </div>
      }
    >
      <div className="space-y-4">
        <Typography.Paragraph type="secondary" className="!mb-0 text-xs leading-relaxed">
          {t('shareIntro')}
        </Typography.Paragraph>
        {links.length === 0 && !loading ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-700">
            {t('shareEmpty')}
          </div>
        ) : (
          <Table<VendorShareLink>
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={links}
            pagination={false}
            locale={{ emptyText: t('shareEmptyTable') }}
          />
        )}
      </div>
    </Drawer>
  )
}
