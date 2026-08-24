/**
 * 协商时间线面板。结构与样式对齐原 box-tracking 系统的 NegotiationHistoryPanel：
 * 手写竖线时间线（非组件库 Timeline），左侧圆形节点带连接线，右侧标题 + 时间 +
 * 描述 + 带色条的数量明细，差异申报节点额外展示原因与证据图。
 */
import type { ReactNode } from 'react'
import {
  ArrowRightLeft,
  BadgeCheck,
  Ban,
  CircleCheck,
  ClipboardList,
  Clock,
  XCircle,
} from 'lucide-react'
import type { TransferDetail } from '../../../containerManagement/types'
import {
  buildNegotiationTimelineEvents,
  quantityListBorderClass,
  timelineNodeClass,
  type NegotiationTimelineEvent,
} from './negotiationTimeline'

function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function nodeIcon(ev: NegotiationTimelineEvent): ReactNode {
  switch (ev.kind) {
    case 'create':
      return <ArrowRightLeft className="size-3.5 sm:size-4" aria-hidden />
    case 'report':
      return <ClipboardList className="size-3.5 sm:size-4" aria-hidden />
    case 'accept':
      return <BadgeCheck className="size-3.5 sm:size-4" aria-hidden />
    case 'simple_confirm':
      return <CircleCheck className="size-3.5 sm:size-4" aria-hidden />
    case 'finalize':
      if (ev.tone === 'destructive') return <XCircle className="size-3.5 sm:size-4" aria-hidden />
      if (ev.tone === 'success') return <CircleCheck className="size-3.5 sm:size-4" aria-hidden />
      return <Ban className="size-3.5" aria-hidden />
    case 'pending':
      return <Clock className="size-3.5 animate-pulse sm:size-4" aria-hidden />
    default:
      return <CircleCheck className="size-3.5 sm:size-4" aria-hidden />
  }
}

type Props = {
  detail: TransferDetail | null
  loading: boolean
  error?: string | null
  /** inline：表格展开区，带顶边线与标题；drawer：侧栏内嵌 */
  variant?: 'inline' | 'drawer'
}

export function NegotiationTimelinePanel({
  detail,
  loading,
  error,
  variant = 'drawer',
}: Props) {
  const shell = variant === 'drawer' ? 'border-0 bg-transparent' : 'border-t border-slate-200'
  const pad = variant === 'drawer' ? 'px-0 py-0' : 'px-3 py-4 sm:px-5'
  const innerPad = variant === 'drawer' ? 'px-0 py-0' : 'px-4 py-5 sm:px-5'

  if (loading) {
    return (
      <div className={cx(shell, 'bg-gradient-to-b from-slate-100/60 to-transparent', innerPad)} aria-busy>
        <div className="animate-pulse space-y-5">
          <div className="h-3.5 w-28 rounded-full bg-slate-200" />
          <div className="space-y-3">
            <div className="h-16 rounded bg-slate-200/70" />
            <div className="h-14 rounded bg-slate-200/50" />
            <div className="h-20 rounded bg-slate-200/70" />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className={cx(
          variant === 'drawer'
            ? 'border-0 bg-rose-50/60 px-0 py-3'
            : 'border-t border-rose-200 bg-rose-50/60 px-4 py-3 sm:px-5',
        )}
      >
        <p className="text-sm text-rose-600">{error}</p>
      </div>
    )
  }

  if (!detail) return null

  const events = buildNegotiationTimelineEvents(detail)

  return (
    <div className={cx(shell, 'text-sm', pad)}>
      {variant === 'inline' ? (
        <div className="mb-4 flex items-center justify-between gap-2">
          <h4 className="text-[0.8125rem] font-semibold uppercase tracking-[0.14em] text-slate-500">
            协商时间线
          </h4>
          <span className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[0.65rem] text-slate-500">
            {events.length} 个节点
          </span>
        </div>
      ) : (
        <p className="mb-3 text-xs text-slate-500">
          共 <span className="font-mono tabular-nums">{events.length}</span> 个节点
        </p>
      )}

      <ol className="m-0 list-none space-y-0 p-0">
        {events.map((ev, index) => {
          const isLast = index === events.length - 1
          const quantityLines =
            'quantityLines' in ev && ev.quantityLines?.length ? ev.quantityLines : undefined
          const evidenceSrc = ev.kind === 'report' ? ev.receiverReportImageUrl : undefined

          const iconWrap = cx(
            'flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-white shadow-sm sm:size-9',
            ev.kind === 'finalize'
              ? ev.tone === 'success'
                ? 'border-emerald-500/50 bg-emerald-500/[0.1] text-emerald-700'
                : ev.tone === 'destructive'
                  ? 'border-rose-500/45 bg-rose-500/[0.08] text-rose-600'
                  : 'border-slate-300 bg-slate-100 text-slate-500'
              : timelineNodeClass(ev.kind),
          )

          return (
            <li key={ev.key} className="flex gap-3 sm:gap-4">
              <div className="relative flex shrink-0 flex-col items-center self-stretch pt-0.5">
                {!isLast ? (
                  <span
                    className="absolute left-1/2 top-[calc(0.125rem+2rem)] bottom-0 z-0 w-px -translate-x-1/2 bg-slate-200 sm:top-[calc(0.125rem+2.25rem)]"
                    aria-hidden
                  />
                ) : null}
                <span className={cx(iconWrap, 'relative z-[1]')}>{nodeIcon(ev)}</span>
              </div>

              <div className="min-w-0 flex-1 space-y-1.5 pb-5">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="font-semibold leading-tight text-slate-900">{ev.title}</span>
                  {ev.kind === 'pending' && ev.pendingLabel ? (
                    <span className="inline-flex h-5 items-center rounded bg-slate-100 px-1.5 text-[0.65rem] font-normal text-slate-600">
                      {ev.pendingLabel}
                    </span>
                  ) : null}
                  {ev.kind !== 'pending' && ev.when ? (
                    <time
                      dateTime={ev.when}
                      className="font-mono text-[0.7rem] tabular-nums text-slate-500"
                    >
                      {formatTime(ev.when)}
                    </time>
                  ) : null}
                </div>

                <div className="max-w-prose space-y-2 leading-relaxed text-slate-500">
                  {ev.description.trim() ? <p>{ev.description}</p> : null}

                  {quantityLines ? (
                    <ul
                      className={cx(
                        'm-0 list-none space-y-1 border-l-2 py-0.5 pl-3',
                        quantityListBorderClass(ev),
                      )}
                    >
                      {quantityLines.map((text, li) => (
                        <li
                          key={`${ev.key}-${text}-${li}`}
                          className="text-[0.8125rem] tabular-nums text-slate-800"
                        >
                          {text}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {ev.kind === 'report' && ev.receiverReportReason ? (
                    <div className="space-y-1 rounded bg-slate-100/70 px-3 py-2.5">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-slate-500">
                        申报原因
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-red-600">
                        {ev.receiverReportReason}
                      </p>
                    </div>
                  ) : null}

                  {evidenceSrc ? (
                    <div className="space-y-1 rounded bg-slate-100/70 px-3 py-2.5">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-slate-500">
                        申报证据
                      </p>
                      <a
                        href={evidenceSrc}
                        target="_blank"
                        rel="noreferrer"
                        className="block w-fit rounded border border-slate-200 bg-white p-1 transition hover:border-[#2f8f87]/45"
                      >
                        <img
                          src={evidenceSrc}
                          alt="申报证据"
                          className="max-h-40 max-w-full rounded object-contain"
                        />
                      </a>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
