import { Empty, Progress, Spin, Tag, Tooltip } from 'antd'
import { dedupeClickEvents, formatDateTime, groupKey, type LabelGroup } from '../pushEngagementGrouping'
import { clickActionLabel, PUSH_LABEL_COLOR, type DetailState, type PushClickEvent, type PushReadStatus } from '../pushEngagementTypes'

function ReadStatusPanel({ state }: { state: DetailState<PushReadStatus> | undefined }) {
  if (!state || state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 py-2">
        <Spin size="small" />
        <span className="text-sm text-slate-400">加载中...</span>
      </div>
    )
  }
  if (state.status === 'expired') {
    return <div className="text-sm text-slate-400">已超过飞书 7 天已读查询窗口，无法查询已读状态。</div>
  }
  if (state.status === 'error') {
    return <div className="text-sm text-red-500">{state.error}</div>
  }
  const { readCount, totalMembers, readUsers, unreadUsers } = state.data
  const pct = totalMembers > 0 ? Math.round((readCount / totalMembers) * 100) : 0
  return (
    <div>
      <Progress percent={pct} size="small" strokeColor={pct >= 80 ? '#2f8f87' : pct >= 40 ? '#d97706' : '#dc2626'} />
      <div className="mb-2 text-xs text-slate-500">
        已读 {readCount} / {totalMembers} 人
      </div>
      <div className="space-y-1.5">
        <div>
          <span className="mr-1 text-xs font-semibold text-emerald-600">已读：</span>
          {readUsers.length === 0 ? (
            <span className="text-xs text-slate-400">暂无</span>
          ) : (
            readUsers.map((u) => (
              <Tooltip key={u.userId} title={u.userId}>
                <Tag color="green" className="mb-1">
                  {u.name || u.userId}
                </Tag>
              </Tooltip>
            ))
          )}
        </div>
        <div>
          <span className="mr-1 text-xs font-semibold text-amber-600">未读：</span>
          {unreadUsers.length === 0 ? (
            <span className="text-xs text-slate-400">暂无</span>
          ) : (
            unreadUsers.map((u) => (
              <Tooltip key={u.userId} title={u.userId}>
                <Tag color="orange" className="mb-1">
                  {u.name || u.userId}
                </Tag>
              </Tooltip>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function ClickEventsPanel({ state }: { state: DetailState<PushClickEvent[]> | undefined }) {
  if (!state || state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 py-2">
        <Spin size="small" />
        <span className="text-sm text-slate-400">加载中...</span>
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
    <div className="space-y-2">
      {[...byAction.entries()].map(([actionType, events]) => {
        const deduped = dedupeClickEvents(events)
        return (
          <div key={actionType}>
            <span className="mr-1 text-xs font-semibold text-[#1f6f68]">
              {clickActionLabel(actionType)}（{events.length}）：
            </span>
            {deduped.map((u) => (
              <Tooltip key={u.openId} title={`最近点击 ${formatDateTime(u.lastClickedAt)} · ${u.openId}`}>
                <Tag color="blue" className="mb-1">
                  {(u.name || u.openId) + (u.count > 1 ? ` +${u.count}` : '')}
                </Tag>
              </Tooltip>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export function PushLabelBreakdown({
  date,
  labelGroups,
  readStatusByGroup,
  clickEventsByGroup,
}: {
  date: string
  labelGroups: LabelGroup[]
  readStatusByGroup: Record<string, DetailState<PushReadStatus>>
  clickEventsByGroup: Record<string, DetailState<PushClickEvent[]>>
}) {
  return (
    <div className="space-y-3 bg-[#f8fafc] px-4 py-4">
      {labelGroups.map((group) => {
        const key = groupKey(date, group.pushLabel)
        return (
          <div key={group.pushLabel} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <Tag color={PUSH_LABEL_COLOR[group.pushLabel] ?? 'default'}>{group.pushLabel}</Tag>
              <span className="text-xs text-slate-400">共 {group.rows.length} 条推送</span>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">已读情况</div>
                <ReadStatusPanel state={readStatusByGroup[key]} />
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">点击记录</div>
                <ClickEventsPanel state={clickEventsByGroup[key]} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
