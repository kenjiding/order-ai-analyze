import { Button, Checkbox, InputNumber, TimePicker } from 'antd'
import { Clock, Gauge, Pencil, Plus, Save, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { AU_REGIONS, type PushTimeSlot, type WeekdayNum } from '../exitAlarmTypes'
import type { DispatchAlarmScheduleDraft } from '../dispatchAlarmTypes'
import type { useDispatchAlarmPage } from '../useDispatchAlarmPage'

const WEEKDAYS: { value: WeekdayNum; label: string }[] = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
]

const DEFAULT_ALERT_THRESHOLD_PCT = 92

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

type Props = {
  page: ReturnType<typeof useDispatchAlarmPage>
}

export function DispatchAlarmScheduleConfig({ page }: Props) {
  const { schedule, scheduleSaving: saving, selectedStations, saveAll, editing, startEditing, cancelEditing } = page
  const stationCode = selectedStations[0] ?? ''

  const [weekdays, setWeekdays] = useState<WeekdayNum[]>([])
  const [pushTimes, setPushTimes] = useState<PushTimeSlot[]>([])
  const [isEnabled, setIsEnabled] = useState(true)
  const [alertThresholdPct, setAlertThresholdPct] = useState<number | null>(DEFAULT_ALERT_THRESHOLD_PCT)

  const syncFromSchedule = useCallback(() => {
    setWeekdays(schedule?.weekdays ?? [])
    setPushTimes(schedule?.pushTimes ?? [])
    setIsEnabled(schedule?.isEnabled ?? true)
    setAlertThresholdPct(schedule?.alertThresholdPct ?? DEFAULT_ALERT_THRESHOLD_PCT)
  }, [schedule])

  useEffect(() => {
    if (schedule) syncFromSchedule()
  }, [schedule, syncFromSchedule])

  const handleAddTime = useCallback(() => {
    setPushTimes((prev) => [...prev, { id: generateId(), time: '09:30' }])
  }, [])

  const handleRemoveTime = useCallback((id: string) => {
    setPushTimes((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const handleTimeChange = useCallback((id: string, newTime: string) => {
    setPushTimes((prev) => prev.map((t) => (t.id === id ? { ...t, time: newTime } : t)))
  }, [])

  const handleSave = useCallback(async () => {
    const draft: DispatchAlarmScheduleDraft = {
      weekdays,
      pushTimes,
      isEnabled,
      stationCode,
      alertThresholdPct: alertThresholdPct ?? DEFAULT_ALERT_THRESHOLD_PCT,
    }
    await saveAll(draft)
  }, [weekdays, pushTimes, isEnabled, stationCode, alertThresholdPct, saveAll])

  const handleCancel = useCallback(() => {
    syncFromSchedule()
    cancelEditing()
  }, [syncFromSchedule, cancelEditing])

  const disabled = !editing

  const summaryWeekdays = WEEKDAYS.filter((d) => weekdays.includes(d.value)).map((d) => d.label)
  const summaryTimes = [...pushTimes].sort((a, b) => a.time.localeCompare(b.time)).map((t) => t.time)
  const regionLabel = AU_REGIONS.find((r) => r.code === schedule?.regionCode)?.name ?? '阿德莱德（默认）'

  return (
    <div className="admin-panel overflow-hidden">
      <div className="admin-section-title flex items-center justify-between gap-3 bg-[var(--admin-surface-soft)]">
        <h3 className="admin-title flex items-center gap-1.5 text-base">
          <Clock className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
          定时推送配置
          <span className="ml-1 text-xs font-normal text-slate-400">{regionLabel} 时区（跟随本账号州/区域）</span>
        </h3>
        {editing ? (
          <div className="flex items-center gap-2">
            {schedule && (
              <Button onClick={handleCancel} disabled={saving}>
                取消
              </Button>
            )}
            <Button
              type="primary"
              icon={<Save className="h-3.5 w-3.5" />}
              loading={saving}
              onClick={() => void handleSave()}
            >
              保存
            </Button>
          </div>
        ) : (
          <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={startEditing}>
            编辑
          </Button>
        )}
      </div>

      <div className="divide-y divide-[var(--admin-line)]">
        {/* 推送星期 */}
        <div className="flex items-center gap-4 px-5 py-3">
          <span className="w-16 shrink-0 text-xs font-medium text-slate-500">推送星期</span>
          <Checkbox.Group
            value={weekdays}
            disabled={disabled}
            onChange={(vals) => setWeekdays(vals as WeekdayNum[])}
          >
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {WEEKDAYS.map((day) => (
                <Checkbox key={day.value} value={day.value}>
                  <span className="text-sm">{day.label}</span>
                </Checkbox>
              ))}
            </div>
          </Checkbox.Group>
        </div>

        {/* 推送时间点 */}
        <div className="flex items-center gap-4 px-5 py-3">
          <span className="w-16 shrink-0 text-xs font-medium text-slate-500">推送时间</span>
          <div className="flex flex-wrap items-center gap-2">
            {pushTimes.map((slot) => (
              <div
                key={slot.id}
                className="flex items-center gap-0.5 rounded-md border border-[var(--admin-line)] bg-[var(--admin-surface-soft)] pl-1 pr-0.5 transition-colors hover:border-[var(--admin-accent)]/40"
              >
                <TimePicker
                  value={dayjs(slot.time, 'HH:mm')}
                  format="HH:mm"
                  minuteStep={5}
                  allowClear={false}
                  variant="borderless"
                  disabled={disabled}
                  className="!w-24"
                  onChange={(val) => {
                    if (val) handleTimeChange(slot.id, val.format('HH:mm'))
                  }}
                />
                {!disabled && (
                  <button
                    onClick={() => handleRemoveTime(slot.id)}
                    className="flex h-5 w-5 items-center justify-center rounded text-slate-300 transition-colors hover:bg-red-50 hover:text-red-400"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
            {!disabled && (
              <Button
                type="dashed"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={handleAddTime}
                className="!border-[var(--admin-accent)]/40 !text-xs !text-[var(--admin-accent)] hover:!border-[var(--admin-accent)] hover:!bg-[var(--admin-accent-soft)]"
              >
                添加
              </Button>
            )}
            {pushTimes.length === 0 && (
              <span className="text-xs text-slate-400">暂无推送时间</span>
            )}
          </div>
        </div>

        {/* 预警阈值 */}
        <div className="flex items-center gap-4 px-5 py-3">
          <span className="w-26 shrink-0 text-xs font-medium text-slate-500 flex items-center gap-1">
            <Gauge className="h-3.5 w-3.5 text-[var(--admin-accent)]" aria-hidden />
            预警阈值
          </span>
          <InputNumber
            value={alertThresholdPct}
            min={0}
            max={100}
            disabled={disabled}
            addonAfter="%"
            className="!w-28"
            onChange={(val) => setAlertThresholdPct(typeof val === 'number' ? val : null)}
          />
          <span className="text-xs text-slate-400">24H 派签率低于该值的供应商，卡片中标红并列出未达标运单号</span>
        </div>

        {/* 推送计划摘要 */}
        {summaryWeekdays.length > 0 && summaryTimes.length > 0 && (
          <div className="bg-[var(--admin-accent-soft)] px-5 py-2.5">
            <p className="text-xs text-slate-600">
              <span className="font-medium text-[var(--admin-accent)]">推送计划：</span>
              {stationCode && (
                <span className="font-mono font-medium text-[var(--admin-accent)]">
                  {stationCode}{' '}
                </span>
              )}
              每{summaryWeekdays.join('、')}，在{' '}
              <span className="font-mono font-medium text-[var(--admin-accent)]">
                {summaryTimes.join('、')}
              </span>{' '}
              自动获取前一日司机运单，计算 24 小时派签率，低于{' '}
              <span className="font-mono font-medium text-[var(--admin-accent)]">
                {alertThresholdPct ?? DEFAULT_ALERT_THRESHOLD_PCT}%
              </span>{' '}
              的供应商标红告警。
              {!stationCode && (
                <span className="ml-1 text-amber-500">（Header 未选择站点，定时推送不会执行）</span>
              )}
              {stationCode && schedule && !schedule.hasImileToken && (
                <span className="ml-1 text-amber-500">
                  （尚未同步 iMile token，请重新点击保存）
                </span>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
