import { Button, Empty, Popconfirm, Switch, Tag } from 'antd'
import { Pencil, Send, Trash2 } from 'lucide-react'
import type { RegionClearancePushSchedule, WeekdayNum } from '../regionClearancePushTypes'

const WEEKDAY_LABEL: Record<WeekdayNum, string> = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' }

function summarizeSchedule(schedule: RegionClearancePushSchedule): { weekdaysText: string; timesText: string } {
  const weekdaysText = schedule.weekdays.map((d) => WEEKDAY_LABEL[d]).join('、') || '未设置'
  const timesText =
    [...schedule.pushTimes].sort((a, b) => a.time.localeCompare(b.time)).map((t) => t.time).join('、') || '未设置'
  return { weekdaysText, timesText }
}

type Props = {
  schedules: RegionClearancePushSchedule[]
  loading: boolean
  pushingId: string | null
  togglingIds: ReadonlySet<string>
  onEdit: (schedule: RegionClearancePushSchedule) => void
  onDelete: (id: string) => void
  onToggleEnabled: (schedule: RegionClearancePushSchedule, isEnabled: boolean) => void
  onPushNow: (schedule: RegionClearancePushSchedule) => void
}

export function RegionClearancePushScheduleList({
  schedules,
  loading,
  pushingId,
  togglingIds,
  onEdit,
  onDelete,
  onToggleEnabled,
  onPushNow,
}: Props) {
  if (!loading && schedules.length === 0) {
    return (
      <div className="admin-panel px-5 py-10">
        <Empty description="暂无推送配置" />
      </div>
    )
  }

  return (
    <div className="admin-panel divide-y divide-[var(--admin-line)] overflow-hidden">
      {schedules.map((schedule) => {
        const { weekdaysText, timesText } = summarizeSchedule(schedule)
        const isPushing = pushingId === schedule.id
        const isToggling = togglingIds.has(schedule.id)
        return (
          <div key={schedule.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-800">{schedule.regionName || schedule.regionCode}</span>
                <Tag color={schedule.isEnabled ? 'green' : 'default'}>{schedule.isEnabled ? '已启用' : '已停用'}</Tag>
                {!schedule.hasImileToken && <Tag color="orange">缺少 iMile token</Tag>}
              </div>
              <p className="truncate text-xs text-slate-500">
                站点 {schedule.stationCodes.length} 个 · 推送星期：{weekdaysText} · 推送时间：{timesText}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                checked={schedule.isEnabled}
                loading={isToggling}
                onChange={(checked) => onToggleEnabled(schedule, checked)}
                checkedChildren="启用"
                unCheckedChildren="停用"
              />
              <Popconfirm
                title="立即推送该配置？"
                description="将按已保存的大区/站点/群立即推送一次"
                onConfirm={() => onPushNow(schedule)}
                okText="立即推送"
                cancelText="取消"
              >
                <Button
                  type="primary"
                  icon={<Send className="h-3.5 w-3.5" />}
                  loading={isPushing}
                  disabled={Boolean(pushingId) && !isPushing}
                >
                  立即推送
                </Button>
              </Popconfirm>
              <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(schedule)}>
                编辑
              </Button>
              <Popconfirm title="确认删除该配置？" onConfirm={() => onDelete(schedule.id)} okText="删除" cancelText="取消">
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
