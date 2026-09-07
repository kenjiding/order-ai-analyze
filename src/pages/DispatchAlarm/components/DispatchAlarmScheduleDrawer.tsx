import { Button, Checkbox, DatePicker, Drawer, Input, InputNumber, TimePicker } from 'antd'
import dayjs from 'dayjs'
import { Clock, Gauge, Plus, Save, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormSection } from '../../../components/FormSection'
import { StationSelect } from '../../../components/Layout/StationSelect'
import {
  SupplierMentionToggle,
  SupplierPushConfigSection,
  type SupplierPushConfig,
} from '../../../shared/supplierPushConfig'
import { showToast } from '../../../utils/toast'
import type {
  DispatchAlarmSchedule,
  DispatchAlarmScheduleDraft,
} from '../dispatchAlarmTypes'
import type { PushTimeSlot, WeekdayNum } from '../../ExitAlarm/exitAlarmTypes'

const DEFAULT_ALERT_THRESHOLD_PCT = 92

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function yesterday(): string {
  return dayjs().subtract(1, 'day').format('YYYY-MM-DD')
}

/** 到件扫描时间区间的最大跨度（天）；与后端 MAX_ARRIVAL_SCAN_DATES 对齐——每多一天就多一轮 iMile 拉数 */
const MAX_ARRIVAL_SCAN_DAYS = 7

/** 区间展开成逐日日期（含首尾），后端按这些到件日逐日拉数后合并统计 */
function expandDateRange([start, end]: [string, string]): string[] {
  const dates: string[] = []
  for (let d = dayjs(start, 'YYYY-MM-DD'); !d.isAfter(dayjs(end, 'YYYY-MM-DD'), 'day'); d = d.add(1, 'day')) {
    dates.push(d.format('YYYY-MM-DD'))
  }
  return dates
}

type Props = {
  open: boolean
  onClose: () => void
  editingSchedule: DispatchAlarmSchedule | null
  catalogConfigs: SupplierPushConfig[]
  catalogLoading: boolean
  saving: boolean
  onSubmit: (draft: DispatchAlarmScheduleDraft) => Promise<boolean>
}

export function DispatchAlarmScheduleDrawer({
  open,
  onClose,
  editingSchedule,
  catalogConfigs,
  catalogLoading,
  saving,
  onSubmit,
}: Props) {
  const { t } = useTranslation('dispatchAlarm')
  const { t: tc } = useTranslation('common')

  const weekdays = useMemo(
    () =>
      ([1, 2, 3, 4, 5, 6, 7] as WeekdayNum[]).map((value) => ({
        value,
        label: t(`weekday.${value}`),
      })),
    [t],
  )

  const [stationCode, setStationCode] = useState('')
  const [selectedWeekdays, setSelectedWeekdays] = useState<WeekdayNum[]>([])
  const [pushTimes, setPushTimes] = useState<PushTimeSlot[]>([])
  const [alertThresholdPct, setAlertThresholdPct] = useState<number | null>(DEFAULT_ALERT_THRESHOLD_PCT)
  const [pushConfigIds, setPushConfigIds] = useState<string[]>([])
  const [arrivalScanRange, setArrivalScanRange] = useState<[string, string]>([yesterday(), yesterday()])
  const [mentionEnabled, setMentionEnabled] = useState(false)
  const [showDriverMap, setShowDriverMap] = useState(false)
  const [importantNotice, setImportantNotice] = useState('')

  useEffect(() => {
    if (!open) return
    setStationCode(editingSchedule?.stationCode ?? '')
    setSelectedWeekdays(editingSchedule?.weekdays ?? [])
    setPushTimes(editingSchedule?.pushTimes ?? [])
    setAlertThresholdPct(editingSchedule?.alertThresholdPct ?? DEFAULT_ALERT_THRESHOLD_PCT)
    setPushConfigIds(editingSchedule?.pushConfigIds ?? [])
    const savedDates = editingSchedule?.arrivalScanDates ?? []
    setArrivalScanRange(
      savedDates.length > 0
        ? [savedDates[0], savedDates[savedDates.length - 1]]
        : [yesterday(), yesterday()],
    )
    setMentionEnabled(editingSchedule?.mentionEnabled ?? false)
    setShowDriverMap(editingSchedule?.showDriverMap ?? false)
    setImportantNotice(editingSchedule?.importantNotice ?? '')
  }, [open, editingSchedule])

  const handleAddTime = () => setPushTimes((prev) => [...prev, { id: generateId(), time: '09:30' }])
  const handleRemoveTime = (id: string) => setPushTimes((prev) => prev.filter((t) => t.id !== id))
  const handleTimeChange = (id: string, newTime: string) =>
    setPushTimes((prev) => prev.map((t) => (t.id === id ? { ...t, time: newTime } : t)))

  const catalogIdSet = new Set(catalogConfigs.map((config) => config.id))

  const handleConfirm = async () => {
    if (!stationCode) {
      showToast(t('validation.selectStation'), 'error')
      return
    }
    if (selectedWeekdays.length === 0) {
      showToast(t('validation.selectWeekday'), 'error')
      return
    }
    if (pushTimes.length === 0) {
      showToast(t('validation.addPushTime'), 'error')
      return
    }
    const scopedPushConfigIds = pushConfigIds.filter((id) => catalogIdSet.has(id))
    if (scopedPushConfigIds.length === 0) {
      showToast(t('validation.selectVendor'), 'error')
      return
    }
    const draft: DispatchAlarmScheduleDraft = {
      weekdays: selectedWeekdays,
      pushTimes,
      isEnabled: true,
      stationCode,
      alertThresholdPct: alertThresholdPct ?? DEFAULT_ALERT_THRESHOLD_PCT,
      pushConfigIds: scopedPushConfigIds,
      arrivalScanDates: expandDateRange(arrivalScanRange),
      mentionEnabled,
      showDriverMap,
      importantNotice: importantNotice.trim() || null,
    }
    const ok = await onSubmit(draft)
    if (ok) onClose()
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      size={640}
      maskClosable={!saving}
      title={
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
          <span>{editingSchedule ? t('drawer.editTitle') : t('drawer.addTitle')}</span>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose} disabled={saving}>
            {tc('cancel')}
          </Button>
          <Button type="primary" icon={<Save className="h-3.5 w-3.5" />} loading={saving} onClick={() => void handleConfirm()}>
            {tc('confirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <FormSection icon={Gauge} title={t('drawer.basicConfig')}>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs font-medium text-slate-500">{t('drawer.station')}</span>
                <StationSelect value={stationCode} onChange={setStationCode} disabled={saving} className="w-[150px]" />
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <span className="shrink-0 text-xs font-medium text-slate-500">{t('drawer.arrivalScanTime')}</span>
                <DatePicker.RangePicker
                  className="w-full min-w-0"
                  value={[dayjs(arrivalScanRange[0], 'YYYY-MM-DD'), dayjs(arrivalScanRange[1], 'YYYY-MM-DD')]}
                  format="YYYY-MM-DD"
                  inputReadOnly
                  allowClear={false}
                  disabled={saving}
                  disabledDate={(current, info) => {
                    if (current.isAfter(dayjs().endOf('day'))) return true
                    if (info?.from) return Math.abs(current.diff(info.from, 'day')) >= MAX_ARRIVAL_SCAN_DAYS
                    return false
                  }}
                  onChange={(vals) => {
                    if (vals?.[0] && vals[1]) {
                      setArrivalScanRange([vals[0].format('YYYY-MM-DD'), vals[1].format('YYYY-MM-DD')])
                    }
                  }}
                />
              </div>
            </div>
            <p className="text-right text-xs text-slate-400">{t('drawer.arrivalScanHint')}</p>
          </div>
        </FormSection>

        <FormSection icon={Clock} title={t('drawer.scheduleConfig')} description={t('drawer.scheduleConfigDesc')}>
          <div className="divide-y divide-[var(--admin-line)]">
            <div className="flex items-center gap-4 py-3 first:pt-0">
              <span className="w-16 shrink-0 text-xs font-medium text-slate-500">{t('drawer.pushWeekdays')}</span>
              <Checkbox.Group
                value={selectedWeekdays}
                disabled={saving}
                onChange={(vals) => setSelectedWeekdays(vals as WeekdayNum[])}
              >
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {weekdays.map((day) => (
                    <Checkbox key={day.value} value={day.value}>
                      <span className="text-sm">{day.label}</span>
                    </Checkbox>
                  ))}
                </div>
              </Checkbox.Group>
            </div>

            <div className="flex items-start gap-4 py-3">
              <span className="mt-1 w-16 shrink-0 text-xs font-medium text-slate-500">{t('drawer.pushTimes')}</span>
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
                      disabled={saving}
                      className="!w-24"
                      onChange={(val) => {
                        if (val) handleTimeChange(slot.id, val.format('HH:mm'))
                      }}
                    />
                    {!saving && (
                      <button
                        onClick={() => handleRemoveTime(slot.id)}
                        className="flex h-5 w-5 items-center justify-center rounded text-slate-300 transition-colors hover:bg-red-50 hover:text-red-400"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
                {!saving && (
                  <Button
                    type="dashed"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={handleAddTime}
                    className="!border-[var(--admin-accent)]/40 !text-xs !text-[var(--admin-accent)] hover:!border-[var(--admin-accent)] hover:!bg-[var(--admin-accent-soft)]"
                  >
                    {tc('add')}
                  </Button>
                )}
                {pushTimes.length === 0 && <span className="text-xs text-slate-400">{t('drawer.noPushTimes')}</span>}
              </div>
            </div>

            <div className="flex items-center gap-4 py-3">
              <span className="flex w-16 shrink-0 items-center gap-1 text-xs font-medium text-slate-500">
                {t('drawer.alertThreshold')}
              </span>
              <InputNumber
                value={alertThresholdPct}
                min={0}
                max={100}
                disabled={saving}
                addonAfter="%"
                className="!w-28"
                onChange={(val) => setAlertThresholdPct(typeof val === 'number' ? val : null)}
              />
            </div>

            <div className="flex items-center gap-4 py-3 last:pb-0">
              <span className="w-16 shrink-0 text-xs font-medium text-slate-500">{t('drawer.pushOptions')}</span>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <SupplierMentionToggle value={mentionEnabled} onChange={setMentionEnabled} disabled={saving} />
                <Checkbox checked={showDriverMap} disabled={saving} onChange={(e) => setShowDriverMap(e.target.checked)}>
                  <span className="text-sm">{t('drawer.driverMap')}</span>
                </Checkbox>
              </div>
            </div>

            <div className="flex items-start gap-4 py-3 last:pb-0">
              <span className="mt-1 w-16 shrink-0 text-xs font-medium leading-tight text-slate-500">
                {t('drawer.importantNotice')}
              </span>
              <Input.TextArea
                value={importantNotice}
                disabled={saving}
                rows={3}
                maxLength={500}
                showCount
                placeholder={t('drawer.importantNoticePlaceholder')}
                onChange={(e) => setImportantNotice(e.target.value)}
              />
            </div>
          </div>
        </FormSection>

        <SupplierPushConfigSection
          configs={catalogConfigs}
          value={pushConfigIds}
          onChange={setPushConfigIds}
          disabled={saving}
          catalogLoading={catalogLoading}
          title={t('drawer.vendorConfig')}
        />
      </div>
    </Drawer>
  )
}
