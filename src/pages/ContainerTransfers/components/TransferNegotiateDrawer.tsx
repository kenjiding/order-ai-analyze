/**
 * 「协商」抽屉：概览指标、当前申报原因与证据、接收方修改实收申报。
 * 转出方的「认可结算」是本抽屉的唯一主操作，常驻底部并在原地二次确认。
 */
import { useState } from 'react'
import { Alert, Button, Image, Input, Tag } from 'antd'
import { ClipboardList, FileText, ShieldCheck } from 'lucide-react'
import { AdminDrawer } from '../../../components/Drawer/AdminDrawer'
import {
  containerTypeName,
  formatTransferNo,
  transferStatusColor,
  transferStatusLabel,
} from '../../../containerManagement/constants'
import type { TransferDetail, TransferLineDraft } from '../../../containerManagement/types'
import { TransferLineItemsInput } from './TransferLineItemsInput'

type MetricTone = 'neutral' | 'claim' | 'booked'

/** 概览三格与时间线共用一套状态色语言：接收方实收=琥珀、已入账=翠绿 */
const METRIC_TONE: Record<MetricTone, { value: string; chip: string }> = {
  neutral: { value: 'text-slate-900', chip: 'bg-slate-100 text-slate-600' },
  claim: { value: 'text-amber-700', chip: 'bg-amber-50 text-amber-700' },
  booked: { value: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-700' },
}

/** 一格指标：大数字 + 品类明细，未产生时统一显示占位符而不是留白 */
function Metric({
  label,
  total,
  breakdown,
  tone,
}: {
  label: string
  total: number | null
  breakdown: { containerType: string; quantity: number | null }[]
  tone: MetricTone
}) {
  const style = METRIC_TONE[tone]
  const lines = breakdown.filter((item) => item.quantity !== null)
  return (
    <div className="px-4 py-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="m-0 mt-1">
        {total === null ? (
          <span className="text-lg font-semibold tabular-nums text-slate-300">-</span>
        ) : (
          <span className={`text-lg font-semibold tabular-nums ${style.value}`}>{total}</span>
        )}
        {lines.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {lines.map((item) => (
              <span
                key={item.containerType}
                className={`rounded-md px-1.5 py-0.5 text-xs ${style.chip}`}
              >
                {containerTypeName(item.containerType)}
                <span className="ml-1 font-medium tabular-nums">{item.quantity}</span>
              </span>
            ))}
          </div>
        ) : null}
      </dd>
    </div>
  )
}

/** 与系统内其他抽屉一致的小节容器：accent 图标头 + 白底内容区 */
function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof FileText
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-[var(--admin-line)] bg-white">
      <header className="flex items-start gap-2.5 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
          {description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>
          ) : null}
        </div>
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  )
}

/** 与最终形态同构的骨架，加载完成时不跳版 */
function DrawerSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="rounded-xl border border-[var(--admin-line)] bg-white">
        <div className="h-10 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)]" />
        <div className="grid grid-cols-3 divide-x divide-[var(--admin-line)]">
          {['a', 'b', 'c'].map((key) => (
            <div key={key} className="space-y-2 px-4 py-3">
              <div className="h-3 w-12 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
              <div className="h-5 w-8 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </div>
      {['s1', 's2'].map((key) => (
        <div key={key} className="rounded-xl border border-[var(--admin-line)] bg-white">
          <div className="h-12 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)]" />
          <div className="space-y-2 px-4 py-4">
            <div className="h-4 w-full animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  )
}

function acceptConfirmDescription(detail: TransferDetail): string {
  const total = detail.receivedTotal
  if (total === null) return ''
  const details = detail.items
    .filter((item) => item.receivedQuantity !== null)
    .map((item) => `${containerTypeName(item.containerType)} ${item.receivedQuantity}`)
    .join('、')
  if (total === 0) return '确认按接收方实收 0 件结算？认可后本条将取消，双方库存不变。'
  return details
    ? `确认按接收方实收明细结算（${details}，共 ${total} 件）？认可后立即入账。`
    : `确认按接收方实收 ${total} 件结算？认可后立即入账。`
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
}: Props) {
  const [acceptConfirmOpen, setAcceptConfirmOpen] = useState(false)
  const [patchLines, setPatchLines] = useState<TransferLineDraft[] | null>(null)
  const [patchReason, setPatchReason] = useState<string | null>(null)
  const [patchError, setPatchError] = useState<string | null>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)

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
      setPatchError(null)
      setReasonError('请填写原因')
      return
    }
    setPatchError(null)
    setReasonError(null)
    const ok = await onUpdateReport(detail, lines, reason.trim())
    if (ok) {
      setPatchLines(null)
      setPatchReason(null)
    }
  }

  const canAccept = Boolean(detail) && detail?.status === 'DISPUTED' && isSender
  const showFooter = canAccept && detail !== null

  return (
    <AdminDrawer
      open={open}
      onClose={onClose}
      width={560}
      styles={{ footer: { padding: '12px 24px' } }}
      eyebrow={detail ? formatTransferNo(detail.id) : undefined}
      title="协商"
      subtitle={detail ? `${detail.fromAccountName} → ${detail.toAccountName}` : '加载中…'}
      footer={
        showFooter && detail ? (
          <div className="space-y-3">
            {acceptConfirmOpen ? (
              <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-800">
                {acceptConfirmDescription(detail)}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              {acceptConfirmOpen ? (
                <>
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
                </>
              ) : (
                <Button
                  type="primary"
                  icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
                  disabled={busy || detail.receivedTotal === null}
                  onClick={() => setAcceptConfirmOpen(true)}
                >
                  认可接收方实收
                </Button>
              )}
            </div>
          </div>
        ) : null
      }
    >
      {loading && !detail ? <DrawerSkeleton /> : null}

      {detail ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--admin-line)] bg-white">
            <div className="border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-2.5">
              <Tag color={transferStatusColor[detail.status]} className="!me-0">
                {transferStatusLabel[detail.status]}
              </Tag>
            </div>
            <dl className="m-0 grid grid-cols-3 divide-x divide-[var(--admin-line)]">
              <Metric
                label="转出方发出"
                total={detail.declaredTotal}
                breakdown={detail.items.map((item) => ({
                  containerType: item.containerType,
                  quantity: item.declaredQuantity,
                }))}
                tone="neutral"
              />
              <Metric
                label="接收方实收"
                total={detail.receivedTotal}
                breakdown={detail.items.map((item) => ({
                  containerType: item.containerType,
                  quantity: item.receivedQuantity,
                }))}
                tone="claim"
              />
              <Metric
                label="已入账"
                total={detail.settledTotal}
                breakdown={detail.items.map((item) => ({
                  containerType: item.containerType,
                  quantity: item.settledQuantity,
                }))}
                tone="booked"
              />
            </dl>
          </div>

          <Section icon={FileText} title="当前申报原因" description="接收方最近一次提交的说明与证据">
            {detail.receiverReportReason?.trim() ? (
              <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {detail.receiverReportReason.trim()}
              </p>
            ) : (
              <p className="m-0 text-sm text-slate-400">暂无申报原因</p>
            )}
            {detail.receiverReportImageUrl ? (
              <div className="mt-3 space-y-1.5 border-t border-[var(--admin-line)] pt-3">
                <p className="m-0 text-xs text-slate-500">申报证据</p>
                <Image
                  src={detail.receiverReportImageUrl}
                  alt="申报证据"
                  width={180}
                  className="rounded-lg"
                />
              </div>
            ) : null}
          </Section>

          {detail.status === 'DISPUTED' ? (
            <>
              {isReceiver ? (
                <Section
                  icon={ClipboardList}
                  title="修改实收申报"
                  description="数量不得超过转出方发出数，提交后转出方会看到你最新的实收数"
                >
                  <div className="space-y-4">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-slate-600">
                        实收明细（品类 + 数量） <span className="text-rose-500">*</span>
                      </span>
                      <TransferLineItemsInput
                        lines={lines}
                        onChange={(next) => {
                          setPatchLines(next)
                          if (patchError) setPatchError(null)
                        }}                        maxByType={maxByType}
                        minQuantity={0}
                        error={patchError}
                      />
                    </div>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-slate-600">
                        原因 <span className="text-rose-500">*</span>
                      </span>
                      <Input.TextArea
                        rows={2}
                        maxLength={2000}
                        placeholder="说明与发出数量不一致的原因"
                        status={reasonError ? 'error' : undefined}
                        value={reason}
                        onChange={(e) => {
                          setPatchReason(e.target.value)
                          if (reasonError) setReasonError(null)
                        }}
                      />
                      {reasonError ? (
                        <span className="text-xs text-rose-500">{reasonError}</span>
                      ) : null}
                    </label>
                    <div className="flex justify-end">
                      <Button loading={busy} onClick={() => void handleSubmitPatch()}>
                        更新实收申报
                      </Button>
                    </div>
                  </div>
                </Section>
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
