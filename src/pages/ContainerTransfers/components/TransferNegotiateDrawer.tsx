/**
 * 「协商」抽屉：状态与主张实收概览、转出方认可结算（内联二次确认）、
 * 当前申报原因与证据、接收方修改实收申报、协商留言。
 */
import { useState } from 'react'
import { Alert, Button, Image, Input, Tag } from 'antd'
import { Send } from 'lucide-react'
import { AdminDrawer } from '../../../components/Drawer/AdminDrawer'
import {
  containerTypeName,
  transferStatusColor,
  transferStatusLabel,
} from '../../../containerManagement/constants'
import type { TransferDetail, TransferLineDraft } from '../../../containerManagement/types'
import { TransferLineItemsInput } from './TransferLineItemsInput'

function declaredSummary(detail: TransferDetail): string {
  return detail.items
    .map((item) => `${containerTypeName(item.containerType)}：${item.declaredQuantity}`)
    .join(' · ')
}

function acceptConfirmDescription(detail: TransferDetail): string {
  const total = detail.receivedTotal
  if (total === null) return ''
  const details = detail.items
    .filter((item) => item.receivedQuantity !== null)
    .map((item) => `${containerTypeName(item.containerType)} ${item.receivedQuantity}`)
    .join('、')
  if (total === 0) return '确认按申报的 0 件结算？认可后本条将取消，双方库存不变。'
  return details
    ? `确认按接收方申报明细结算（${details}，共 ${total} 件）？认可后将立即落表。`
    : `确认按接收方申报的 ${total} 件结算？认可后将立即落表。`
}

type Props = {
  detail: TransferDetail | null
  open: boolean
  loading: boolean
  busy: boolean
  isSender: boolean
  isReceiver: boolean
  onClose: () => void
  onAcceptSettlement: (detail: TransferDetail) => Promise<boolean>
  onUpdateReport: (
    detail: TransferDetail,
    lines: TransferLineDraft[],
    reason: string,
  ) => Promise<boolean>
  onSendMessage: (transferId: string, body: string) => Promise<boolean>
}

export function TransferNegotiateDrawer({
  detail,
  open,
  loading,
  busy,
  isSender,
  isReceiver,
  onClose,
  onAcceptSettlement,
  onUpdateReport,
  onSendMessage,
}: Props) {
  const [acceptConfirmOpen, setAcceptConfirmOpen] = useState(false)
  const [patchLines, setPatchLines] = useState<TransferLineDraft[] | null>(null)
  const [patchReason, setPatchReason] = useState<string | null>(null)
  const [patchError, setPatchError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  // null 表示尚未被用户改动，直接展示 detail 的当前值
  const lines: TransferLineDraft[] =
    patchLines ??
    (detail?.items ?? []).map((item) => ({
      containerType: item.containerType,
      quantity: String(item.receivedQuantity ?? item.declaredQuantity),
    }))
  const reason = patchReason ?? detail?.receiverReportReason ?? ''

  const maxByType = Object.fromEntries(
    (detail?.items ?? []).map((item) => [item.containerType, item.declaredQuantity]),
  )

  const handleSubmitPatch = async () => {
    if (!detail) return
    for (const line of lines) {
      if (!line.quantity.trim()) {
        setPatchError('请填写全部品类的实收数量')
        return
      }
      const quantity = Number(line.quantity)
      const max = maxByType[line.containerType]
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > max) {
        setPatchError(`实收数量须为 0～${max} 之间的整数`)
        return
      }
    }
    if (!reason.trim()) {
      setPatchError('请填写原因')
      return
    }
    setPatchError(null)
    const ok = await onUpdateReport(detail, lines, reason.trim())
    if (ok) {
      setPatchLines(null)
      setPatchReason(null)
    }
  }

  return (
    <AdminDrawer
      open={open}
      onClose={onClose}
      width={560}
      eyebrow={detail?.id}
      title="协商"
      subtitle={
        detail ? (
          <span className="flex flex-col gap-1">
            <span className="leading-snug">
              {detail.fromAccountName} → {detail.toAccountName}
            </span>
            <span className="leading-snug">数量：{declaredSummary(detail)}</span>
          </span>
        ) : (
          '加载中…'
        )
      }
    >
      {loading && !detail ? (
        <p className="py-12 text-center text-sm text-slate-500">加载中…</p>
      ) : null}

      {detail ? (
        <div className="space-y-5">
          <div className="flex w-full items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              <Tag color={transferStatusColor[detail.status]}>
                {transferStatusLabel[detail.status]}
              </Tag>
              {detail.receivedTotal !== null ? (
                <div className="text-sm text-slate-500">
                  <span>
                    接收方主张实收：{' '}
                    <span className="font-semibold tabular-nums text-slate-900">
                      {detail.receivedTotal}
                    </span>
                  </span>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    {detail.items
                      .filter((item) => item.receivedQuantity !== null)
                      .map((item) => (
                        <span
                          key={`${item.containerType}-reported`}
                          className="rounded-full bg-slate-100 px-2 py-0.5"
                        >
                          {containerTypeName(item.containerType)}：
                          <span className="tabular-nums text-slate-900">
                            {item.receivedQuantity}
                          </span>
                        </span>
                      ))}
                  </div>
                </div>
              ) : null}
              {detail.settledTotal !== null ? (
                <span className="text-sm text-slate-500">
                  已落表：{' '}
                  <span className="font-semibold tabular-nums text-slate-900">
                    {detail.settledTotal}
                  </span>
                </span>
              ) : null}
            </div>
            {detail.status === 'DISPUTED' && isSender && !acceptConfirmOpen ? (
              <Button
                type="primary"
                className="shrink-0 self-center"
                disabled={busy || detail.receivedTotal === null}
                onClick={() => setAcceptConfirmOpen(true)}
              >
                认可申报数量
              </Button>
            ) : null}
          </div>

          {acceptConfirmOpen && detail.status === 'DISPUTED' && isSender ? (
            <Alert
              type="warning"
              showIcon
              message={acceptConfirmDescription(detail)}
              action={
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => setAcceptConfirmOpen(false)}>
                    取消
                  </Button>
                  <Button
                    type="primary"
                    loading={busy}
                    onClick={async () => {
                      const ok = await onAcceptSettlement(detail)
                      if (ok) setAcceptConfirmOpen(false)
                    }}
                  >
                    确认认可
                  </Button>
                </div>
              }
            />
          ) : null}

          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-sm font-semibold text-slate-900">当前申报原因</h2>
            {detail.receiverReportReason?.trim() ? (
              <p className="mt-2 whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-700">
                {detail.receiverReportReason.trim()}
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-500">暂无申报原因。</p>
            )}
            {detail.receiverReportImageUrl ? (
              <div className="mt-3 space-y-1.5">
                <p className="text-xs text-slate-500">申报证据</p>
                <Image
                  src={detail.receiverReportImageUrl}
                  alt="申报证据"
                  width={180}
                  className="rounded-md"
                />
              </div>
            ) : null}
          </section>

          {detail.status === 'DISPUTED' ? (
            <>
              {isReceiver ? (
                <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h2 className="mb-3 text-sm font-semibold text-slate-900">修改申报</h2>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <span className="text-xs text-slate-500">
                        实收明细（品类 + 数量） <span className="text-rose-500">*</span>
                      </span>
                      <TransferLineItemsInput
                        lines={lines}
                        onChange={(next) => {
                          setPatchLines(next)
                          if (patchError) setPatchError(null)
                        }}
                        lockedTypes
                        maxByType={maxByType}
                        minQuantity={0}
                        error={patchError}
                      />
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-slate-500">
                        原因 <span className="text-rose-500">*</span>
                      </span>
                      <Input.TextArea
                        rows={2}
                        maxLength={2000}
                        value={reason}
                        onChange={(e) => setPatchReason(e.target.value)}
                      />
                    </label>
                    <Button loading={busy} onClick={() => void handleSubmitPatch()}>
                      更新实收申报
                    </Button>
                  </div>
                </section>
              ) : null}

              {isSender || isReceiver ? (
                <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h2 className="mb-3 text-sm font-semibold text-slate-900">协商留言</h2>
                  {detail.messages.length > 0 ? (
                    <ul className="m-0 mb-3 list-none space-y-2 p-0">
                      {detail.messages.map((item) => (
                        <li
                          key={item.id}
                          className="rounded-md border border-slate-200 bg-white p-3"
                        >
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-sm font-medium text-slate-900">
                              {item.authorUsername ?? '未知用户'}
                            </span>
                            <time
                              dateTime={item.createdAt}
                              className="font-mono text-xs tabular-nums text-slate-400"
                            >
                              {new Date(item.createdAt).toLocaleString()}
                            </time>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                            {item.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mb-3 text-sm text-slate-500">暂无留言。</p>
                  )}
                  <Input.TextArea
                    rows={2}
                    maxLength={4000}
                    placeholder="补充说明、拍照复核结论等"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      type="primary"
                      icon={<Send className="h-4 w-4" aria-hidden />}
                      loading={sending}
                      disabled={!message.trim()}
                      onClick={async () => {
                        setSending(true)
                        const ok = await onSendMessage(detail.id, message.trim())
                        setSending(false)
                        if (ok) setMessage('')
                      }}
                    >
                      发送留言
                    </Button>
                  </div>
                </section>
              ) : null}

              {!isSender && !isReceiver ? (
                <Alert type="info" showIcon message="仅转出方与接收方可操作" />
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </AdminDrawer>
  )
}
