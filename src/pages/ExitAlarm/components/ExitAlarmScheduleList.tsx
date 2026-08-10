import { Button, Empty, Popconfirm, Switch, Tag } from 'antd'
import { FileDown, Pencil, Send, Trash2 } from 'lucide-react'
import { StationDisplayLabel } from '../../../components/Layout/StationDisplayLabel'
import { showToast } from '../../../utils/toast'
import type { ExitAlarmPushNowResult } from '../exitAlarmApi'
import { exportUnqualifiedWaybillsExcel } from '../exportUnqualifiedWaybillsExcel'
import type { ExitAlarmSchedule } from '../exitAlarmTypes'

const WEEKDAY_LABELS: Record<number, string> = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' }

function summarizeSchedule(schedule: ExitAlarmSchedule): { weekdaysText: string; timesText: string } {
  const weekdaysText = schedule.weekdays.map((d) => WEEKDAY_LABELS[d] ?? d).join('、') || '未设置'
  const timesText = [...schedule.pushTimes].sort((a, b) => a.time.localeCompare(b.time)).map((t) => t.time).join('、') || '未设置'
  return { weekdaysText, timesText }
}

type Props = {
  schedules: ExitAlarmSchedule[]
  loading: boolean
  pushingId: string | null
  togglingIds: ReadonlySet<string>
  pushResults: Record<string, ExitAlarmPushNowResult>
  onEdit: (schedule: ExitAlarmSchedule) => void
  onDelete: (id: string) => void
  onToggleEnabled: (schedule: ExitAlarmSchedule, isEnabled: boolean) => void
  onPushNow: (schedule: ExitAlarmSchedule) => void
}

export function ExitAlarmScheduleList({
  schedules,
  loading,
  pushingId,
  togglingIds,
  pushResults,
  onEdit,
  onDelete,
  onToggleEnabled,
  onPushNow,
}: Props) {
  if (!loading && schedules.length === 0) {
    return (
      <div className="admin-panel px-5 py-10">
        <Empty description="暂无出仓告警配置，点击右上角「添加出仓告警」新建" />
      </div>
    )
  }

  return (
    <div className="admin-panel divide-y divide-[var(--admin-line)] overflow-hidden">
      {schedules.map((schedule) => {
        const { weekdaysText, timesText } = summarizeSchedule(schedule)
        const isPushing = pushingId === schedule.id
        const isToggling = togglingIds.has(schedule.id)
        const pushResult = pushResults[schedule.id]
        const unqualifiedTotal =
          pushResult?.unqualifiedByVendor.reduce(
            (sum, v) => sum + v.waybillNos.length + v.whitelistWaybillNos.length,
            0,
          ) ?? 0
        return (
          <div key={schedule.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <StationDisplayLabel stationCode={schedule.stationCode} />
                <Tag color={schedule.isEnabled ? 'green' : 'default'}>{schedule.isEnabled ? '已启用' : '已停用'}</Tag>
                {!schedule.hasImileToken && <Tag color="orange">缺少 iMile token</Tag>}
              </div>
              <p className="truncate text-xs text-slate-500">
                每{weekdaysText}，在 <span className="font-mono">{timesText}</span> 自动获取前一日数据并推送告警 · 已选{' '}
                {schedule.pushConfigIds.length} 家供应商
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
              {pushResult && (
                <Button
                  icon={<FileDown className="h-3.5 w-3.5" />}
                  disabled={unqualifiedTotal === 0}
                  onClick={() => {
                    if (unqualifiedTotal === 0) {
                      showToast('本次推送所有运单均已在 11 点前出仓，无需导出', 'info')
                      return
                    }
                    void exportUnqualifiedWaybillsExcel(pushResult)
                  }}
                >
                  导出Excel（未达标 {unqualifiedTotal}）
                </Button>
              )}
              <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(schedule)}>
                编辑
              </Button>
              <Popconfirm title="确认删除该出仓告警配置？" onConfirm={() => onDelete(schedule.id)} okText="删除" cancelText="取消">
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
