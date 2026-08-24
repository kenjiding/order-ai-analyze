import { useMemo, useState } from 'react'
import { Alert, Button, Descriptions, Image, Input, Tag, Timeline } from 'antd'
import dayjs from 'dayjs'
import { Send } from 'lucide-react'
import { AdminDrawer } from '../../../components/Drawer/AdminDrawer'
import {
  containerTypeLabel,
  transferKindLabel,
  transferStatusColor,
  transferStatusLabel,
} from '../../../containerManagement/constants'
import type { Transfer, TransferDetail } from '../../../containerManagement/types'

type TimelineEvent = { time: string; title: string; description?: string; color: string }

type Props = {
  detail: TransferDetail | null
  loading: boolean
  canActAs: (accountId: string) => boolean
  submitting: boolean
  onClose: () => void
  onSendMessage: (transferId: string, body: string) => Promise<boolean>
  onEditReport: (transfer: Transfer) => void
  onAcceptSettlement: (transfer: Transfer) => void
}

function buildTimeline(detail: TransferDetail): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      time: detail.createdAt,
      title: `${detail.fromAccountName} 申报${transferKindLabel[detail.kind]}`,
      description: detail.items
        .map((item) => `${containerTypeLabel[item.containerType]} ${item.declaredQuantity}`)
        .join('、'),
      color: 'blue',
    },
  ]

  if (detail.receiverReportReason) {
    events.push({
      time: detail.respondedAt ?? detail.createdAt,
      title: `${detail.toAccountName} 提交差异申报`,
      description: `实收 ${detail.items
        .map((item) => `${containerTypeLabel[item.containerType]} ${item.receivedQuantity ?? 0}`)
        .join('、')}；原因：${detail.receiverReportReason}`,
      color: 'purple',
    })
  }

  for (const message of detail.messages) {
    events.push({
      time: message.createdAt,
      title: `${message.authorUsername ?? '未知用户'} 留言`,
      description: message.body,
      color: 'gray',
    })
  }

  if (detail.senderAcceptedAt) {
    events.push({
      time: detail.senderAcceptedAt,
      title: `${detail.fromAccountName} 认可结算数量`,
      description:
        detail.status === 'CANCELLED'
          ? '认可实收 0，本条流转已取消，双方库存不变'
          : `按实收记账，合计 ${detail.settledTotal ?? 0}`,
      color: detail.status === 'CANCELLED' ? 'red' : 'green',
    })
  } else if (detail.status === 'CONFIRMED') {
    events.push({
      time: detail.respondedAt ?? detail.createdAt,
      title: `${detail.toAccountName} 确认收货`,
      description: detail.responseNote ?? `已按申报数量记账，合计 ${detail.settledTotal ?? 0}`,
      color: 'green',
    })
  }

  return events.sort((a, b) => dayjs(a.time).valueOf() - dayjs(b.time).valueOf())
}

export function TransferDetailDrawer({
  detail,
  loading,
  canActAs,
  submitting,
  onClose,
  onSendMessage,
  onEditReport,
  onAcceptSettlement,
}: Props) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const events = useMemo(() => (detail ? buildTimeline(detail) : []), [detail])
  if (!detail) return null

  const isSender = canActAs(detail.fromAccountId)
  const isReceiver = canActAs(detail.toAccountId)
  const negotiating = detail.status === 'DISPUTED'

  const handleSend = async () => {
    if (!message.trim()) return
    setSending(true)
    const ok = await onSendMessage(detail.id, message.trim())
    setSending(false)
    if (ok) setMessage('')
  }

  return (
    <AdminDrawer
      open
      onClose={onClose}
      width={620}
      loading={loading}
      eyebrow={detail.id}
      title={`${detail.fromAccountName} → ${detail.toAccountName}`}
      subtitle={`${transferKindLabel[detail.kind]} · 创建于 ${dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')}`}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Tag color={transferStatusColor[detail.status]}>{transferStatusLabel[detail.status]}</Tag>
          {detail.createdByUsername ? (
            <span className="text-xs text-slate-500">创建人 {detail.createdByUsername}</span>
          ) : null}
        </div>

        <Descriptions bordered column={1} size="middle">
          <Descriptions.Item label="流转明细">
            <div className="space-y-1">
              {detail.items.map((item) => (
                <div key={item.containerType} className="flex justify-between gap-4">
                  <span className="text-slate-600">
                    {containerTypeLabel[item.containerType] ?? item.containerType}
                  </span>
                  <span className="tabular-nums">
                    申报 {item.declaredQuantity}
                    {item.receivedQuantity !== null ? ` · 实收 ${item.receivedQuantity}` : ''}
                    {item.settledQuantity !== null ? ` · 落表 ${item.settledQuantity}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </Descriptions.Item>
          {detail.note ? <Descriptions.Item label="备注">{detail.note}</Descriptions.Item> : null}
          {detail.imageUrl ? (
            <Descriptions.Item label="凭证图片">
              <Image src={detail.imageUrl} alt="流转凭证" width={160} className="rounded-md" />
            </Descriptions.Item>
          ) : null}
          {detail.receiverReportImageUrl ? (
            <Descriptions.Item label="申报证据">
              <Image
                src={detail.receiverReportImageUrl}
                alt="差异申报证据"
                width={160}
                className="rounded-md"
              />
            </Descriptions.Item>
          ) : null}
        </Descriptions>

        {negotiating ? (
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-4">
            <p className="text-sm font-medium text-violet-900">协商中</p>
            <p className="mt-1 text-sm text-violet-800">
              接收方主张实收合计 {detail.receivedTotal ?? 0}（申报 {detail.declaredTotal}）。
              转出方认可后按各品类实收数量记账。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {isReceiver ? (
                <Button onClick={() => onEditReport(detail)}>修改实收申报</Button>
              ) : null}
              {isSender ? (
                <Button
                  type="primary"
                  loading={submitting}
                  onClick={() => onAcceptSettlement(detail)}
                >
                  认可结算数量
                </Button>
              ) : null}
            </div>
            {!isSender && !isReceiver ? (
              <Alert
                className="mt-3"
                type="info"
                showIcon
                message="你不是本条流转的参与方，仅可查看。"
              />
            ) : null}
          </div>
        ) : null}

        <div>
          <h3 className="text-sm font-semibold text-slate-900">协商与流转记录</h3>
          <Timeline
            className="mt-3"
            items={events.map((event) => ({
              color: event.color,
              children: (
                <div>
                  <div className="text-sm font-medium text-slate-900">{event.title}</div>
                  {event.description ? (
                    <div className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">
                      {event.description}
                    </div>
                  ) : null}
                  <div className="mt-0.5 text-xs text-slate-400">
                    {dayjs(event.time).format('YYYY-MM-DD HH:mm')}
                  </div>
                </div>
              ),
            }))}
          />
        </div>

        {negotiating && (isSender || isReceiver) ? (
          <div className="flex flex-col gap-2">
            <Input.TextArea
              rows={3}
              value={message}
              maxLength={4000}
              placeholder="补充说明、拍照复核结论等"
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="flex justify-end">
              <Button
                type="primary"
                loading={sending}
                icon={<Send className="h-4 w-4" aria-hidden />}
                onClick={() => void handleSend()}
              >
                发送留言
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </AdminDrawer>
  )
}
