/**
 * 协商时间线：手写竖线布局，每个节点按状态用不同颜色醒目区分
 * （实心圆点 + 状态标签 + 数量明细左侧色条三处同色）。
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
import { useTranslation } from 'react-i18next'
import type { TransferDetail } from '../../../containerManagement/types'
import {
  buildNegotiationTimelineEvents,
  timelineTone,
  type NegotiationTimelineEvent,
  type TimelineTone,
} from './negotiationTimeline'

type ToneStyle = {
  /** 圆形节点：实心底色 + 白色图标，颜色对比拉满 */
  dot: string
  /** 圆点外发光，进一步强化状态色 */
  ring: string
  /** 状态标签 */
  chip: string
  /** 数量明细左侧色条 */
  bar: string
}

const TONE_STYLE: Record<TimelineTone, ToneStyle> = {
  create: {
    dot: 'bg-sky-500 text-white border-sky-500',
    ring: 'ring-4 ring-sky-500/15',
    chip: 'border-sky-200 bg-sky-50 text-sky-700',
    bar: 'border-sky-400',
  },
  report: {
    dot: 'bg-amber-500 text-white border-amber-500',
    ring: 'ring-4 ring-amber-500/15',
    chip: 'border-amber-200 bg-amber-50 text-amber-800',
    bar: 'border-amber-400',
  },
  accept: {
    dot: 'bg-violet-500 text-white border-violet-500',
    ring: 'ring-4 ring-violet-500/15',
    chip: 'border-violet-200 bg-violet-50 text-violet-700',
    bar: 'border-violet-400',
  },
  confirm: {
    dot: 'bg-teal-500 text-white border-teal-500',
    ring: 'ring-4 ring-teal-500/15',
    chip: 'border-teal-200 bg-teal-50 text-teal-700',
    bar: 'border-teal-400',
  },
  booked: {
    dot: 'bg-emerald-600 text-white border-emerald-600',
    ring: 'ring-4 ring-emerald-600/15',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    bar: 'border-emerald-500',
  },
  cancelled: {
    dot: 'bg-rose-500 text-white border-rose-500',
    ring: 'ring-4 ring-rose-500/15',
    chip: 'border-rose-200 bg-rose-50 text-rose-700',
    bar: 'border-rose-400',
  },
  neutral: {
    dot: 'bg-slate-400 text-white border-slate-400',
    ring: 'ring-4 ring-slate-400/15',
    chip: 'border-slate-200 bg-slate-100 text-slate-600',
    bar: 'border-slate-300',
  },
  pending: {
    dot: 'bg-[#2f8f87] text-white border-[#2f8f87]',
    ring: 'ring-4 ring-[#2f8f87]/15',
    chip: 'border-[#2f8f87]/30 bg-[#e1f5f1] text-[#1f6f68]',
    bar: 'border-[#2f8f87]',
  },
}

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
      return <ArrowRightLeft className="size-4" aria-hidden />
    case 'report':
      return <ClipboardList className="size-4" aria-hidden />
    case 'accept':
      return <BadgeCheck className="size-4" aria-hidden />
    case 'simple_confirm':
      return <CircleCheck className="size-4" aria-hidden />
    case 'finalize':
      if (ev.tone === 'destructive') return <XCircle className="size-4" aria-hidden />
      if (ev.tone === 'success') return <CircleCheck className="size-4" aria-hidden />
      return <Ban className="size-4" aria-hidden />
    case 'pending':
      return <Clock className="size-4 animate-pulse" aria-hidden />
    default:
      return <CircleCheck className="size-4" aria-hidden />
  }
}

type Props = {
  detail: TransferDetail | null
  loading: boolean
  error?: string | null
  /** inline：页面内嵌，带标题；drawer：抽屉内 */
  variant?: 'inline' | 'drawer'
}

export function NegotiationTimelinePanel({
  detail,
  loading,
  error,
  variant = 'drawer',
}: Props) {
  const { t } = useTranslation('container')

  if (loading) {
    return (
      <div className="animate-pulse space-y-5" aria-busy>
        <div className="h-3.5 w-28 rounded-full bg-slate-200" />
        <div className="space-y-3">
          <div className="h-16 rounded-lg bg-slate-200/70" />
          <div className="h-14 rounded-lg bg-slate-200/50" />
          <div className="h-20 rounded-lg bg-slate-200/70" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
        <p className="text-sm text-rose-600">{error}</p>
      </div>
    )
  }

  if (!detail) return null

  const events = buildNegotiationTimelineEvents(detail, t)

  return (
    <div className={cx('text-sm', variant === 'inline' && 'border-t border-slate-200 pt-4')}>
      {variant === 'inline' ? (
        <div className="mb-4 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-900">{t('transfers.timelineTitle')}</h4>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500">
            {t('transfers.timelineNodesInline', { count: events.length })}
          </span>
        </div>
      ) : (
        <p className="mb-4 text-xs text-slate-500">
          {t('transfers.timelineNodes', { count: events.length })}
        </p>
      )}

      <ol className="m-0 list-none space-y-0 p-0">
        {events.map((ev, index) => {
          const isLast = index === events.length - 1
          const tone = TONE_STYLE[timelineTone(ev, t)]
          const quantityLines =
            'quantityLines' in ev && ev.quantityLines?.length ? ev.quantityLines : undefined
          const evidenceSrc = 'evidenceImageUrl' in ev ? ev.evidenceImageUrl : undefined
          const evidenceLabel =
            ('evidenceLabel' in ev ? ev.evidenceLabel : undefined) ?? t('transfers.timelineEvidenceDefault')

          return (
            <li key={ev.key} className="flex gap-3 sm:gap-4">
              <div className="relative flex shrink-0 flex-col items-center self-stretch pt-0.5">
                {!isLast ? (
                  <span
                    className="absolute left-1/2 top-11 bottom-0 z-0 w-px -translate-x-1/2 bg-slate-200"
                    aria-hidden
                  />
                ) : null}
                <span
                  className={cx(
                    'relative z-[1] flex size-9 shrink-0 items-center justify-center rounded-full border shadow-sm',
                    tone.dot,
                    tone.ring,
                  )}
                >
                  {nodeIcon(ev)}
                </span>
              </div>

              <div className="min-w-0 flex-1 space-y-2 pb-6">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="font-semibold leading-tight text-slate-900">{ev.title}</span>
                  <span
                    className={cx(
                      'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
                      tone.chip,
                    )}
                  >
                    {ev.statusLabel}
                  </span>
                  {ev.kind !== 'pending' && ev.when ? (
                    <time
                      dateTime={ev.when}
                      className="font-mono text-xs tabular-nums text-slate-400"
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
                        tone.bar,
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
                    <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5">
                      <p className="text-xs font-medium text-amber-800">{t('transfers.timelineReportReason')}</p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                        {ev.receiverReportReason}
                      </p>
                    </div>
                  ) : null}

                  {evidenceSrc ? (
                    <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <p className="text-xs font-medium text-slate-600">{evidenceLabel}</p>
                      <a
                        href={evidenceSrc}
                        target="_blank"
                        rel="noreferrer"
                        className="block w-fit rounded-md border border-slate-200 bg-white p-1 transition hover:border-[#2f8f87]"
                      >
                        <img
                          src={evidenceSrc}
                          alt={t('transfers.timelineEvidenceAlt')}
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
