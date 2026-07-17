import { Button, Empty, Popconfirm, Switch, Tag } from 'antd'
import { Pencil, Send, Trash2 } from 'lucide-react'
import { StationDisplayLabel } from '../../../components/Layout/StationDisplayLabel'
import { STAGNATION_BUCKET_OPTIONS, type ChaseDispatchSchedule } from '../chaseDispatchTypes'

const WEEKDAY_LABELS: Record<number, string> = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' }

function summarizeSchedule(schedule: ChaseDispatchSchedule): {
  weekdaysText: string
  timesText: string
  bucketsText: string
} {
  const weekdaysText = schedule.weekdays.map((d) => WEEKDAY_LABELS[d] ?? d).join('、') || '未设置'
  const timesText = [...schedule.pushTimes].sort((a, b) => a.time.localeCompare(b.time)).map((t) => t.time).join('、') || '未设置'
  const bucketsText =
    STAGNATION_BUCKET_OPTIONS.filter((b) => schedule.stagnationBuckets.includes(b.value))
      .map((b) => b.label)
      .join('、') || '未设置'
  return { weekdaysText, timesText, bucketsText }
}

type Props = {
  schedules: ChaseDispatchSchedule[]
  loading: boolean
  pushingId: string | null
  onEdit: (schedule: ChaseDispatchSchedule) => void
  onDelete: (id: string) => void
  onToggleEnabled: (schedule: ChaseDispatchSchedule, isEnabled: boolean) => void
  onPushNow: (schedule: ChaseDispatchSchedule) => void
}

export function ChaseDispatchScheduleList({
  schedules,
  loading,
  pushingId,
  onEdit,
  onDelete,
  onToggleEnabled,
  onPushNow,
}: Props) {
  if (!loading && schedules.length === 0) {
    return (
      <div className="admin-panel px-5 py-10">
        <Empty description="暂无催派推送配置，点击右上角「添加催派推送」新建" />
      </div>
    )
  }

  return (
    <div className="admin-panel divide-y divide-[var(--admin-line)] overflow-hidden">
      {schedules.map((schedule) => {
        const { weekdaysText, timesText, bucketsText } = summarizeSchedule(schedule)
        const isPushing = pushingId === schedule.id
        return (
          <div key={schedule.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <StationDisplayLabel stationCode={schedule.stationCode} />
                <Tag color={schedule.isEnabled ? 'green' : 'default'}>{schedule.isEnabled ? '已启用' : '已停用'}</Tag>
                {!schedule.hasImileToken && <Tag color="orange">缺少 iMile token</Tag>}
              </div>
              <p className="truncate text-xs text-slate-500">
                每{weekdaysText}，在 <span className="font-mono">{timesText}</span> 统计滞留{' '}
                <span className="font-mono">{bucketsText}</span> 的滞留订单 · 已选{' '}
                {schedule.pushConfigIds.length} 家供应商
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                checked={schedule.isEnabled}
                onChange={(checked) => onToggleEnabled(schedule, checked)}
                checkedChildren="启用"
                unCheckedChildren="停用"
              />
              <Popconfirm
                title="确认立刻推送？"
                description="将按该配置直接拉数推送，不参考推送时间。"
                onConfirm={() => onPushNow(schedule)}
                okText="立刻推送"
                cancelText="取消"
              >
                <Button
                  type="primary"
                  icon={<Send className="h-3.5 w-3.5" />}
                  loading={isPushing}
                  disabled={Boolean(pushingId) && !isPushing}
                >
                  立刻推送
                </Button>
              </Popconfirm>
              <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(schedule)}>
                编辑
              </Button>
              <Popconfirm title="确认删除该催派推送配置？" onConfirm={() => onDelete(schedule.id)} okText="删除" cancelText="取消">
                <Button danger icon={<Trash2 className="h-3.5 w-3.5" />}>
                  删除
                </Button>
              </Popconfirm>
            </div>
          </div>
        )
      })}
    </div>
  )
}
