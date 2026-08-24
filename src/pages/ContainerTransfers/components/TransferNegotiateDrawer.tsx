/**
 * 「协商」抽屉：状态与主张实收概览、转出方认可结算（内联二次确认）、
 * 当前申报原因与证据、接收方修改实收申报。结构与原系统 TransferNegotiateDrawer 一致。
 */
import { useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { AdminDrawer } from '../../../components/Drawer/AdminDrawer'
import {
  containerTypeName,
  transferStatusLabel,
} from '../../../containerManagement/constants'
import type { TransferDetail, TransferLineDraft } from '../../../containerManagement/types'
import { TransferLineItemsInput } from './TransferLineItemsInput'

/** 与列表状态徽章同一套语义配色 */
function statusBadgeClass(status: TransferDetail['status']): string {
  switch (status) {
    case 'PENDING_RECEIVER':
      return 'bg-amber-500/10 text-amber-800'
    case 'DISPUTED':
      return 'bg-violet-500/10 text-violet-800'
    case 'CONFIRMED':
      return 'bg-emerald-500/10 text-emerald-800'
    case 'CANCELLED':
      return 'bg-slate-200/70 text-slate-600'
  }
}

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
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [patchLines, setPatchLines] = useState<TransferLineDraft[] | null>(null)
  const [patchReason, setPatchReason] = useState<string | null>(null)
  const [patchError, setPatchError] = useState<string | null>(null)

  // 首次渲染前拿不到 detail，用 null 表示「尚未从 detail 初始化」
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
              <span
                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${statusBadgeClass(detail.status)}`}
              >
                {transferStatusLabel[detail.status]}
              </span>
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
                  认可结算：{' '}
                  <span className="font-semibold tabular-nums text-slate-900">
                    {detail.settledTotal}
                  </span>
                </span>
              ) : null}
            </div>
            {detail.status === 'DISPUTED' && isSender && !acceptConfirmOpen ? (
              <div className="shrink-0 self-center">
                <button
                  type="button"
                  className="rounded bg-[#2f8f87] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#25746d] disabled:opacity-50"
                  disabled={busy || detail.receivedTotal === null}
                  onClick={() => setAcceptConfirmOpen(true)}
                >
                  认可申报数量
                </button>
              </div>
            ) : null}
          </div>

          {acceptConfirmOpen && detail.status === 'DISPUTED' && isSender ? (
            <div className="rounded border border-amber-500/35 bg-amber-50 p-3">
              <p className="text-sm leading-relaxed text-slate-900">
                {acceptConfirmDescription(detail)}
              </p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => setAcceptConfirmOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded bg-[#2f8f87] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#25746d] disabled:opacity-50"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await onAcceptSettlement(detail)
                    if (ok) setAcceptConfirmOpen(false)
                  }}
                >
                  {busy ? (
                    <>
                      <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                      处理中…
                    </>
                  ) : (
                    '确认认可'
                  )}
                </button>
              </div>
            </div>
          ) : null}

          <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="text-lg font-medium text-slate-900">当前申报原因</p>
            {detail.receiverReportReason?.trim() ? (
              <p className="mt-2 whitespace-pre-wrap rounded border border-slate-200 bg-white p-3 leading-relaxed text-slate-800">
                {detail.receiverReportReason.trim()}
              </p>
            ) : (
              <p className="mt-2 text-slate-500">暂无申报原因。</p>
            )}
            {detail.receiverReportImageUrl ? (
              <div className="mt-3 space-y-1.5">
                <p className="text-xs text-slate-500">申报证据</p>
                <a
                  href={detail.receiverReportImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-fit rounded border border-slate-200 bg-white p-1 transition hover:border-[#2f8f87]/45"
                >
                  <img
                    src={detail.receiverReportImageUrl}
                    alt="申报证据"
                    className="max-h-44 max-w-full rounded object-contain"
                  />
                </a>
              </div>
            ) : null}
          </div>

          {detail.status === 'DISPUTED' ? (
            <>
              {isReceiver ? (
                <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm">
                  <h2 className="mb-3 text-lg font-medium text-slate-900">修改申报</h2>
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
                      <textarea
                        rows={2}
                        maxLength={2000}
                        className="w-full resize-y rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#2f8f87]"
                        value={reason}
                        onChange={(e) => setPatchReason(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-white disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void handleSubmitPatch()}
                    >
                      {busy ? (
                        <>
                          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                          更新中…
                        </>
                      ) : (
                        '更新实收申报'
                      )}
                    </button>
                  </div>
                </div>
              ) : null}
              {isSender || isReceiver ? (
                <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm">
                  <h2 className="mb-3 text-lg font-medium text-slate-900">协商留言</h2>
                  {detail.messages.length > 0 ? (
                    <ul className="m-0 mb-3 list-none space-y-2 p-0">
                      {detail.messages.map((item) => (
                        <li key={item.id} className="rounded border border-slate-200 bg-white p-3">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-medium text-slate-900">
                              {item.authorUsername ?? '未知用户'}
                            </span>
                            <time
                              dateTime={item.createdAt}
                              className="font-mono text-[0.7rem] tabular-nums text-slate-500"
                            >
                              {new Date(item.createdAt).toLocaleString()}
                            </time>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap leading-relaxed text-slate-700">
                            {item.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mb-3 text-slate-500">暂无留言。</p>
                  )}
                  <textarea
                    rows={2}
                    maxLength={4000}
                    className="w-full resize-y rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#2f8f87]"
                    placeholder="补充说明、拍照复核结论等"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded bg-[#2f8f87] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#25746d] disabled:opacity-50"
                      disabled={sending || !message.trim()}
                      onClick={async () => {
                        setSending(true)
                        const ok = await onSendMessage(detail.id, message.trim())
                        setSending(false)
                        if (ok) setMessage('')
                      }}
                    >
                      {sending ? (
                        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                      ) : (
                        <Send className="size-3.5 shrink-0" aria-hidden />
                      )}
                      发送留言
                    </button>
                  </div>
                </div>
              ) : null}
              {!isSender && !isReceiver ? (
                <p className="text-slate-500">仅转出方与接收方可操作</p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </AdminDrawer>
  )
}
