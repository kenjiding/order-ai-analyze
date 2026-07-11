import { Button, TimePicker } from 'antd'
import { Clock, Pencil, Plus, Save, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { AU_REGIONS } from '../../ExitAlarm/exitAlarmTypes'
import type { PushTimeSlot, WorkOrderPushScheduleDraft } from '../workOrderPushTypes'
import type { useWorkOrderPushPage } from '../useWorkOrderPushPage'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

type Props = {
  page: ReturnType<typeof useWorkOrderPushPage>
}

export function WorkOrderPushScheduleConfig({ page }: Props) {
  const { schedule, scheduleSaving: saving, saveAll, editing, startEditing, cancelEditing } = page

  const [pushTimes, setPushTimes] = useState<PushTimeSlot[]>([])

  const syncFromSchedule = useCallback(() => {
    setPushTimes(schedule?.pushTimes ?? [])
  }, [schedule])

  useEffect(() => {
    if (schedule) syncFromSchedule()
  }, [schedule, syncFromSchedule])

  const handleAddTime = useCallback(() => {
    setPushTimes((prev) => [...prev, { id: generateId(), time: '09:00' }])
  }, [])

  const handleRemoveTime = useCallback((id: string) => {
    setPushTimes((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const handleTimeChange = useCallback((id: string, newTime: string) => {
    setPushTimes((prev) => prev.map((t) => (t.id === id ? { ...t, time: newTime } : t)))
  }, [])

  const handleSave = useCallback(async () => {
    const draft: WorkOrderPushScheduleDraft = { pushTimes, isEnabled: true }
    await saveAll(draft)
  }, [pushTimes, saveAll])

  const handleCancel = useCallback(() => {
    syncFromSchedule()
    cancelEditing()
  }, [syncFromSchedule, cancelEditing])

  const disabled = !editing
  const regionLabel = AU_REGIONS.find((r) => r.code === schedule?.regionCode)?.name ?? '阿德莱德（默认）'
  const summaryTimes = [...pushTimes].sort((a, b) => a.time.localeCompare(b.time)).map((t) => t.time)

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
            {pushTimes.length === 0 && <span className="text-xs text-slate-400">暂无推送时间</span>}
          </div>
        </div>

        {summaryTimes.length > 0 && (
          <div className="bg-[var(--admin-accent-soft)] px-5 py-2.5">
            <p className="text-xs text-slate-600">
              <span className="font-medium text-[var(--admin-accent)]">推送计划：</span>
              工单出现时间不可预测，每天在{' '}
              <span className="font-mono font-medium text-[var(--admin-accent)]">
                {summaryTimes.join('、')}
              </span>{' '}
              各检查一次未处理工单，有未处理工单才会推送对应供应商，没有则跳过。
              {schedule && !schedule.hasImileToken && (
                <span className="ml-1 text-amber-500">（尚未同步 iMile token，请重新点击保存）</span>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
