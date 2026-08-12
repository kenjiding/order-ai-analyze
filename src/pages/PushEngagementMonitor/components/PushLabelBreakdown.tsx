import { useState } from 'react'
import { Empty, Tag, Tooltip } from 'antd'
import { ChevronRight, Eye, MousePointerClick, RotateCw } from 'lucide-react'
import { dedupeClickEvents, formatDateTime, groupKey, type LabelGroup } from '../pushEngagementGrouping'
import { clickActionLabel, PUSH_LABEL_COLOR, type DetailState, type PushClickEvent, type PushReadStatus } from '../pushEngagementTypes'

/** 一段标题 + 一排名字 chip，跟最终形态同构，加载完成时不跳版 */
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

/** 已读面板的骨架：已读 / 未读两段列表 */
function ReadStatusSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <ChipListSkeleton widths={['w-20', 'w-24', 'w-16']} />
      <ChipListSkeleton widths={['w-16', 'w-24']} />
    </div>
  )
}

/**
 * 人名列表的三种语义：已读 / 未读是状态色，点击沿用页面主色，不再多引一个蓝。
 * 名字用 chip 平铺 + flex gap 拉开间距——原来是 inline 排版，名字之间只有一个空格，连成一片读不出边界。
 */
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

/** 一屏放不下几十个名字，超过这个数先折起来，避免一个分组把整页撑开 */
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
  const [expanded, setExpanded] = useState(false)
  const collapsed = chips.length > NAME_CHIP_COLLAPSE_AT && !expanded
  const visible = collapsed ? chips.slice(0, NAME_CHIP_COLLAPSE_AT) : chips

  return (
    <div>
      {/* 人数就是空状态本身：0 人不需要再补一句「全部已读」，同一件事说两遍 */}
      <div className="flex items-baseline gap-2">
        <span className={`text-xs font-semibold ${NAME_LABEL_TONE[tone]}`}>{label}</span>
        <span className="text-xs tabular-nums text-slate-500">{chips.length} 人</span>
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
              {collapsed ? `展开其余 ${chips.length - NAME_CHIP_COLLAPSE_AT} 人` : '收起'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** 两列的小标题：配图标是为了扫一眼就分得清左右两块，不是装饰 */
function SectionHeading({ icon: Icon, title }: { icon: typeof Eye; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
      <Icon className="h-3.5 w-3.5 text-slate-400" />
      {title}
    </div>
  )
}

/** ready / error 之后的再次查询入口：低视觉权重，不跟主内容抢注意力 */
function ReadStatusRetry({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex items-center gap-1 rounded text-xs text-slate-500 transition-colors hover:text-[#1f6f68] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f8f87] active:translate-y-px"
    >
      <RotateCw className="h-3.5 w-3.5" />
      {label}
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
  if (!state || state.status === 'loading') {
    return <ReadStatusSkeleton />
  }
  if (state.status === 'expired') {
    return <div className="text-sm text-slate-500">已超过飞书 7 天已读查询窗口，无法查询已读状态。</div>
  }
  if (state.status === 'error') {
    return (
      <div>
        <div className="text-sm text-red-500">{state.error}</div>
        <ReadStatusRetry label="重新查询" onClick={onLoad} />
      </div>
    )
  }
  // 进度条和"已读 x / y 人"都删掉了：比例在分组行的摘要里已经有，两个列表标题各自带人数，
  // 同一个数字在一屏里出现三次只会互相干扰。这里只保留「谁读了 / 谁没读」。
  const { readUsers, unreadUsers } = state.data
  return (
    <div className="space-y-3">
      {state.partialError ? <div className="text-xs text-amber-600">{state.partialError}</div> : null}
      <NameChipList
        label="已读"
        tone="read"
        chips={readUsers.map((u) => ({ key: u.userId, name: u.name || u.userId, tooltip: u.userId }))}
      />
      <NameChipList
        label="未读"
        tone="unread"
        chips={unreadUsers.map((u) => ({ key: u.userId, name: u.name || u.userId, tooltip: u.userId }))}
      />
    </div>
  )
}

function ClickEventsPanel({ state }: { state: DetailState<PushClickEvent[]> | undefined }) {
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
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无点击记录" className="!my-2" />
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
              tooltip: `最近点击 ${formatDateTime(u.lastClickedAt)} · ${u.openId}`,
              suffix: u.count > 1 ? `×${u.count}` : undefined,
            }))}
          />
        )
      })}
    </div>
  )
}

/** 折起时的摘要：不展开也能看到已读比例和点击数，展开只是为了看具体是谁 */
function GroupSummary({
  readState,
  clickState,
}: {
  readState: DetailState<PushReadStatus> | undefined
  clickState: DetailState<PushClickEvent[]> | undefined
}) {
  if (readState?.status === 'expired') {
    return <span className="text-xs text-slate-500">超出 7 天查询窗口</span>
  }
  if (!readState || readState.status !== 'ready') return null
  const clickCount = clickState?.status === 'ready' ? clickState.data.length : null
  return (
    <span className="flex items-center gap-3 text-xs tabular-nums text-slate-500">
      <span>
        已读 {readState.data.readCount} / {readState.data.totalMembers}
      </span>
      {clickCount !== null ? <span>点击 {clickCount}</span> : null}
    </span>
  )
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
  return (
    // 分组行放在同一个容器里用分隔线区分：折叠后是 4-5 行，每行再套一张卡会变成卡中卡。
    // 外层不再包一层带 padding 的底色容器，直接贴合展开行，避免和 antd 展开行自带的内边距叠成双层留白。
    <div className="divide-y divide-slate-200 border-y border-slate-200 bg-white">
      {labelGroups.map((group) => {
          const key = groupKey(date, group.pushLabel)
          const expanded = expandedGroupKeys.includes(key)
          const readState = readStatusByGroup[key]
          const loading = readState?.status === 'loading' || clickEventsByGroup[key]?.status === 'loading'
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
                  <Tag color={PUSH_LABEL_COLOR[group.pushLabel] ?? 'default'}>{group.pushLabel}</Tag>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">{group.rows.length} 条推送</span>
                  <span className="ml-auto pl-3">
                    <GroupSummary readState={readState} clickState={clickEventsByGroup[key]} />
                  </span>
                </button>
                {expanded ? (
                  <button
                    type="button"
                    onClick={() => onRefreshGroup(date, group)}
                    disabled={loading}
                    aria-label={`刷新 ${group.pushLabel} 的已读与点击数据`}
                    className="shrink-0 rounded p-1.5 text-slate-400 transition-colors hover:text-[#1f6f68] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f8f87] active:translate-y-px disabled:cursor-not-allowed disabled:text-slate-300"
                  >
                    <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />
                  </button>
                ) : null}
              </div>
              {expanded ? (
                // 两列内容同构（标题 + 一排 chip），只靠 gap 分不开：桌面用竖分隔线，窄屏塌成单列后换成横分隔线
                <div
                  id={`push-group-${key}`}
                  className="grid grid-cols-1 divide-y divide-slate-200 border-t border-slate-100 bg-slate-50/40 md:grid-cols-2 md:divide-x md:divide-y-0"
                >
                  <section className="px-4 py-4">
                    <SectionHeading icon={Eye} title="已读情况" />
                    <ReadStatusPanel state={readState} onLoad={() => onRefreshGroup(date, group)} />
                  </section>
                  <section className="px-4 py-4">
                    <SectionHeading icon={MousePointerClick} title="点击记录" />
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
