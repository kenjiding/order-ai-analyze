import { Button, Empty, Popconfirm, Switch, Tag } from 'antd'
import { Pencil, Send, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { StationDisplayLabel } from '../../../components/Layout/StationDisplayLabel'
import type { DispatchAlarmSchedule } from '../dispatchAlarmTypes'
import type { WeekdayNum } from '../../ExitAlarm/exitAlarmTypes'

function summarizeSchedule(
  schedule: DispatchAlarmSchedule,
  weekdayLabel: (d: WeekdayNum) => string,
  notSet: string,
  separator: string,
): { weekdaysText: string; timesText: string } {
  const weekdaysText = schedule.weekdays.map((d) => weekdayLabel(d)).join(separator) || notSet
  const timesText =
    [...schedule.pushTimes].sort((a, b) => a.time.localeCompare(b.time)).map((t) => t.time).join(separator) || notSet
  return { weekdaysText, timesText }
}

type Props = {
  schedules: DispatchAlarmSchedule[]
  loading: boolean
  pushingId: string | null
  togglingIds: ReadonlySet<string>
  onEdit: (schedule: DispatchAlarmSchedule) => void
  onDelete: (id: string) => void
  onToggleEnabled: (schedule: DispatchAlarmSchedule, isEnabled: boolean) => void
  onPushNow: (schedule: DispatchAlarmSchedule) => void
}

export function DispatchAlarmScheduleList({
  schedules,
  loading,
  pushingId,
  togglingIds,
  onEdit,
  onDelete,
  onToggleEnabled,
  onPushNow,
}: Props) {
  const { t } = useTranslation('dispatchAlarm')
  const { t: tc } = useTranslation('common')

  const weekdayLabel = useMemo(
    () => (d: WeekdayNum) => t(`weekday.${d}`),
    [t],
  )

  if (!loading && schedules.length === 0) {
    return (
      <div className="admin-panel px-5 py-10">
        <Empty description={t('list.empty')} />
      </div>
    )
  }

  const separator = t('listSeparator')
  const notSet = t('notSet')

  return (
    <div className="admin-panel divide-y divide-[var(--admin-line)] overflow-hidden">
      {schedules.map((schedule) => {
        const { weekdaysText, timesText } = summarizeSchedule(schedule, weekdayLabel, notSet, separator)
        const isPushing = pushingId === schedule.id
        const isToggling = togglingIds.has(schedule.id)
        return (
          <div key={schedule.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <StationDisplayLabel stationCode={schedule.stationCode} />
                <Tag color={schedule.isEnabled ? 'green' : 'default'}>
                  {schedule.isEnabled ? t('list.enabled') : t('list.disabled')}
                </Tag>
                {!schedule.hasImileToken && <Tag color="orange">{t('list.missingImileToken')}</Tag>}
              </div>
              <p className="truncate text-xs text-slate-500">
                {t('list.scheduleSummary', {
                  weekdays: weekdaysText,
                  times: timesText,
                  threshold: schedule.alertThresholdPct,
                  vendorCount: schedule.pushConfigIds.length,
                })}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                checked={schedule.isEnabled}
                loading={isToggling}
                onChange={(checked) => onToggleEnabled(schedule, checked)}
                checkedChildren={t('list.switchOn')}
                unCheckedChildren={t('list.switchOff')}
              />
              <Popconfirm
                title={t('list.pushNowConfirmTitle')}
                description={t('list.pushNowConfirmDesc')}
                onConfirm={() => onPushNow(schedule)}
                okText={t('list.pushNow')}
                cancelText={tc('cancel')}
              >
                <Button
                  type="primary"
                  icon={<Send className="h-3.5 w-3.5" />}
                  loading={isPushing}
                  disabled={Boolean(pushingId) && !isPushing}
                >
                  {t('list.pushNow')}
                </Button>
              </Popconfirm>
              <Button icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(schedule)}>
                {tc('edit')}
              </Button>
              <Popconfirm
                title={t('list.deleteConfirm')}
                onConfirm={() => onDelete(schedule.id)}
                okText={tc('delete')}
                cancelText={tc('cancel')}
              >
                <Button danger icon={<Trash2 className="h-3.5 w-3.5" />}>
                  {tc('delete')}
                </Button>
              </Popconfirm>
            </div>
          </div>
        )
      })}
    </div>
  )
}
