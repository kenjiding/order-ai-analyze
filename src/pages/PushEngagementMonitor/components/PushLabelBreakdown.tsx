import { useState } from 'react'
import { Empty, Tag, Tooltip } from 'antd'
import { ChevronRight, Eye, MousePointerClick, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { dedupeClickEvents, formatDateTime, groupKey, type LabelGroup } from '../pushEngagementGrouping'
import { clickActionLabel, PUSH_LABEL_COLOR, type DetailState, type PushClickEvent, type PushReadStatus } from '../pushEngagementTypes'

function ChipListSkeleton({ widths }: { widths: string[] }) {
  return (
    <div className="space-y-1.5">
      <div className="h-3 w-16 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
      <div className="flex flex-wrap gap-1.5">
        {widths.map((w) => (
          <div key={w} className={`h-6 ${w} animate-pulse rounded-md bg-slate-100 motion-reduce:animate-none`} />
        ))}
      </div>
    </div>
  )
}

function ReadStatusSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <ChipListSkeleton widths={['w-20', 'w-24', 'w-16']} />
      <ChipListSkeleton widths={['w-16', 'w-24']} />
    </div>
  )
}

const NAME_CHIP_TONE = {
  read: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  unread: 'bg-amber-50 text-amber-700 ring-amber-200',
  click: 'bg-[#1f6f68]/10 text-[#1f6f68] ring-[#1f6f68]/25',
} as const

const NAME_LABEL_TONE = {
  read: 'text-emerald-600',
  unread: 'text-amber-600',
  click: 'text-[#1f6f68]',
} as const

const NAME_CHIP_COLLAPSE_AT = 14

type NameChip = { key: string; name: string; tooltip: string; suffix?: string }

function NameChipList({
  label,
  tone,
  chips,
}: {
  label: string
  tone: keyof typeof NAME_CHIP_TONE
  chips: NameChip[]
}) {
  const { t } = useTranslation('pushEngagement')
  const [expanded, setExpanded] = useState(false)
  const collapsed = chips.length > NAME_CHIP_COLLAPSE_AT && !expanded
  const visible = collapsed ? chips.slice(0, NAME_CHIP_COLLAPSE_AT) : chips

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className={`text-xs font-semibold ${NAME_LABEL_TONE[tone]}`}>{label}</span>
        <span className="text-xs tabular-nums text-slate-500">{t('people', { count: chips.length })}</span>
      </div>
      {chips.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {visible.map((chip) => (
            <Tooltip key={chip.key} title={chip.tooltip}>
              <span
                className={`inline-flex max-w-[12rem] items-center gap-1 rounded-md px-2 py-0.5 text-xs ring-1 ring-inset ${NAME_CHIP_TONE[tone]}`}
              >
                <span className="min-w-0 truncate">{chip.name}</span>
                {chip.suffix ? <span className="shrink-0 tabular-nums opacity-70">{chip.suffix}</span> : null}
              </span>
            </Tooltip>
          ))}
          {chips.length > NAME_CHIP_COLLAPSE_AT ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded-md px-1.5 py-0.5 text-xs text-slate-500 underline-offset-2 transition-colors hover:text-[#1f6f68] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f8f87]"
            >
              {collapsed ? t('expandRest', { count: chips.length - NAME_CHIP_COLLAPSE_AT }) : t('collapse')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SectionHeading({ icon: Icon, title }: { icon: typeof Eye; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      {title}
    </div>
  )
}

function ReadStatusRetry({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('pushEngagement')
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex items-center gap-1 rounded text-xs text-slate-500 transition-colors hover:text-[#1f6f68] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f8f87] active:translate-y-px"
    >
      <RotateCw className="h-3.5 w-3.5" />
      {t('retryQuery')}
    </button>
  )
}

function ReadStatusPanel({
  state,
  onLoad,
}: {
  state: DetailState<PushReadStatus> | undefined
  onLoad: () => void
}) {
  const { t } = useTranslation('pushEngagement')
  if (!state || state.status === 'loading') {
    return <ReadStatusSkeleton />
  }
  if (state.status === 'expired') {
    return <div className="text-sm text-slate-500">{t('readWindowExpired')}</div>
  }
  if (state.status === 'error') {
    return (
      <div>
        <div className="text-sm text-red-500">{state.error}</div>
        <ReadStatusRetry onClick={onLoad} />
      </div>
    )
  }
  const { readUsers, unreadUsers } = state.data
  return (
    <div className="space-y-3">
      {state.partialError ? <div className="text-xs text-amber-600">{state.partialError}</div> : null}
      <NameChipList
        label={t('read')}
        tone="read"
        chips={readUsers.map((u) => ({ key: u.userId, name: u.name || u.userId, tooltip: u.userId }))}
      />
      <NameChipList
        label={t('unread')}
        tone="unread"
        chips={unreadUsers.map((u) => ({ key: u.userId, name: u.name || u.userId, tooltip: u.userId }))}
      />
    </div>
  )
}

function ClickEventsPanel({ state }: { state: DetailState<PushClickEvent[]> | undefined }) {
  const { t } = useTranslation('pushEngagement')
  if (!state || state.status === 'loading') {
    return (
      <div aria-busy="true">
        <ChipListSkeleton widths={['w-20', 'w-16', 'w-24']} />
      </div>
    )
  }
  if (state.status === 'error') {
    return <div className="text-sm text-red-500">{state.error}</div>
  }
  if (state.status !== 'ready' || state.data.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noClickRecords')} className="!my-2" />
  }
  const byAction = new Map<string, PushClickEvent[]>()
  for (const e of state.data) {
    if (!byAction.has(e.actionType)) byAction.set(e.actionType, [])
    byAction.get(e.actionType)!.push(e)
  }
  return (
    <div className="space-y-3">
      {[...byAction.entries()].map(([actionType, events]) => {
        const deduped = dedupeClickEvents(events)
        return (
          <NameChipList
            key={actionType}
            label={clickActionLabel(actionType)}
            tone="click"
            chips={deduped.map((u) => ({
              key: u.openId,
              name: u.name || u.openId,
              tooltip: t('recentClick', { time: formatDateTime(u.lastClickedAt), id: u.openId }),
              suffix: u.count > 1 ? `×${u.count}` : undefined,
            }))}
          />
        )
      })}
    </div>
  )
}

function GroupSummary({
  readState,
  clickState,
}: {
  readState: DetailState<PushReadStatus> | undefined
  clickState: DetailState<PushClickEvent[]> | undefined
}) {
  const { t } = useTranslation('pushEngagement')
  if (readState?.status === 'expired') {
    return <span className="text-xs text-slate-500">{t('windowExpiredShort')}</span>
  }
  if (!readState || readState.status !== 'ready') return null
  const clickCount = clickState?.status === 'ready' ? clickState.data.length : null
  return (
    <span className="flex items-center gap-3 text-xs tabular-nums text-slate-500">
      <span>
        {t('readSummary', { read: readState.data.readCount, total: readState.data.totalMembers })}
      </span>
      {clickCount !== null ? <span>{t('clickSummary', { count: clickCount })}</span> : null}
    </span>
  )
}

function pushLabelDisplay(label: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  return String(t(`pushLabels.${label}`, { defaultValue: label }))
}

export function PushLabelBreakdown({
  date,
  labelGroups,
  expandedGroupKeys,
  readStatusByGroup,
  clickEventsByGroup,
  onExpandGroup,
  onRefreshGroup,
}: {
  date: string
  labelGroups: LabelGroup[]
  expandedGroupKeys: string[]
  readStatusByGroup: Record<string, DetailState<PushReadStatus>>
  clickEventsByGroup: Record<string, DetailState<PushClickEvent[]>>
  onExpandGroup: (expanded: boolean, date: string, labelGroup: LabelGroup) => void
  onRefreshGroup: (date: string, labelGroup: LabelGroup) => void
}) {
  const { t } = useTranslation('pushEngagement')
  return (
    <div className="divide-y divide-slate-200 border-y border-slate-200 bg-white">
      {labelGroups.map((group) => {
          const key = groupKey(date, group.pushLabel)
          const expanded = expandedGroupKeys.includes(key)
          const readState = readStatusByGroup[key]
          const loading = readState?.status === 'loading' || clickEventsByGroup[key]?.status === 'loading'
          const displayLabel = pushLabelDisplay(group.pushLabel, t)
          return (
            <div key={group.pushLabel}>
              <div className="flex items-center gap-2 pr-3 transition-colors hover:bg-slate-50">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`push-group-${key}`}
                  onClick={() => onExpandGroup(!expanded, date, group)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#2f8f87]"
                >
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
                  />
                  <Tag color={PUSH_LABEL_COLOR[group.pushLabel] ?? 'default'}>{displayLabel}</Tag>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">{t('pushCount', { count: group.rows.length })}</span>
                  <span className="ml-auto pl-3">
                    <GroupSummary readState={readState} clickState={clickEventsByGroup[key]} />
                  </span>
                </button>
                {expanded ? (
                  <button
                    type="button"
                    onClick={() => onRefreshGroup(date, group)}
                    disabled={loading}
                    aria-label={t('refreshAria', { label: displayLabel })}
                    className="shrink-0 rounded p-1.5 text-slate-400 transition-colors hover:text-[#1f6f68] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f8f87] active:translate-y-px disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />
                  </button>
                ) : null}
              </div>
              {expanded ? (
                <div
                  id={`push-group-${key}`}
                  className="grid grid-cols-1 divide-y divide-slate-200 border-t border-slate-100 bg-slate-50/40 md:grid-cols-2 md:divide-x md:divide-y-0"
                >
                  <section className="px-4 py-4">
                    <SectionHeading icon={Eye} title={t('readSection')} />
                    <ReadStatusPanel state={readState} onLoad={() => onRefreshGroup(date, group)} />
                  </section>
                  <section className="px-4 py-4">
                    <SectionHeading icon={MousePointerClick} title={t('clickSection')} />
                    <ClickEventsPanel state={clickEventsByGroup[key]} />
                  </section>
                </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
