import { Button, Checkbox, DatePicker, Drawer, InputNumber, TimePicker } from 'antd'
import dayjs from 'dayjs'
import { AlarmClock, Clock, Plus, Save, Settings, Truck, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { StationSelect } from '../../../components/Layout/StationSelect'
import {
  SupplierMentionToggle,
  SupplierPushSelectAllButtons,
  SupplierPushSelectionGrid,
  type SupplierPushConfig,
} from '../../../shared/supplierPushConfig'
import { showToast } from '../../../utils/toast'
import type {
  ExitAlarmSchedule,
  ExitAlarmScheduleDraft,
  PushTimeSlot,
  WeekdayNum,
} from '../exitAlarmTypes'

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
  editingSchedule: ExitAlarmSchedule | null
  catalogConfigs: SupplierPushConfig[]
  catalogLoading: boolean
  saving: boolean
  onSubmit: (draft: ExitAlarmScheduleDraft) => Promise<boolean>
}

function FormSection({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-[var(--admin-line)] bg-white">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
            {description && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  )
}

export function ExitAlarmScheduleDrawer({
  open,
  onClose,
  editingSchedule,
  catalogConfigs,
  catalogLoading,
  saving,
  onSubmit,
}: Props) {
  const { t } = useTranslation('exitAlarm')
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
  const [pushConfigIds, setPushConfigIds] = useState<string[]>([])
  const [mentionEnabled, setMentionEnabled] = useState(false)
  const [routeCodeWhitelistPushEnabled, setRouteCodeWhitelistPushEnabled] = useState(false)
  const [arrivalScanRange, setArrivalScanRange] = useState<[string, string]>([yesterday(), yesterday()])
  const [clearancePrice, setClearancePrice] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    setStationCode(editingSchedule?.stationCode ?? '')
    setSelectedWeekdays(editingSchedule?.weekdays ?? [])
    setPushTimes(editingSchedule?.pushTimes ?? [])
    setPushConfigIds(editingSchedule?.pushConfigIds ?? [])
    setMentionEnabled(editingSchedule?.mentionEnabled ?? false)
    setRouteCodeWhitelistPushEnabled(editingSchedule?.routeCodeWhitelistPushEnabled ?? false)
    const savedDates = editingSchedule?.arrivalScanDates ?? []
    setArrivalScanRange(
      savedDates.length > 0
        ? [savedDates[0], savedDates[savedDates.length - 1]]
        : [yesterday(), yesterday()],
    )
    setClearancePrice(editingSchedule?.clearancePrice ?? null)
  }, [open, editingSchedule])

  const handleAddTime = () => setPushTimes((prev) => [...prev, { id: generateId(), time: '11:00' }])
  const handleRemoveTime = (id: string) => setPushTimes((prev) => prev.filter((t) => t.id !== id))
  const handleTimeChange = (id: string, newTime: string) =>
    setPushTimes((prev) => prev.map((t) => (t.id === id ? { ...t, time: newTime } : t)))

  const enabledIdSet = new Set(pushConfigIds)
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
    const draft: ExitAlarmScheduleDraft = {
      weekdays: selectedWeekdays,
      pushTimes,
      isEnabled: true,
      stationCode,
      pushConfigIds: scopedPushConfigIds,
      mentionEnabled,
      routeCodeWhitelistPushEnabled,
      arrivalScanDates: expandDateRange(arrivalScanRange),
      clearancePrice,
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
          <AlarmClock className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
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
        <FormSection icon={AlarmClock} title={t('drawer.basicConfig')}>
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

            <div className="flex items-start gap-4 py-3 last:pb-0">
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
          </div>
        </FormSection>

        <FormSection icon={Settings} title={t('drawer.otherConfig')}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <SupplierMentionToggle value={mentionEnabled} onChange={setMentionEnabled} disabled={saving} />
            <Checkbox
              checked={routeCodeWhitelistPushEnabled}
              disabled={saving}
              onChange={(e) => setRouteCodeWhitelistPushEnabled(e.target.checked)}
            >
              <span className="text-sm">{t('drawer.routeWhitelistPush')}</span>
            </Checkbox>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm text-slate-600">{t('drawer.clearancePrice')}</span>
              <InputNumber
                value={clearancePrice}
                min={0}
                step={0.05}
                precision={2}
                prefix="$"
                placeholder={t('drawer.clearancePricePlaceholder')}
                disabled={saving}
                className="!w-44"
                onChange={(val) => setClearancePrice(typeof val === 'number' ? val : null)}
              />
            </div>
          </div>
        </FormSection>

        <FormSection
          icon={Truck}
          title={t('drawer.vendorConfig')}
          action={
            <div className="flex items-center gap-3">
              <SupplierPushSelectAllButtons
                configs={catalogConfigs}
                enabledIdSet={enabledIdSet}
                disabled={saving}
                saving={catalogLoading}
                onToggle={(id, next) =>
                  setPushConfigIds((prev) => (next ? [...prev, id] : prev.filter((x) => x !== id)))
                }
              />
            </div>
          }
        >
          <SupplierPushSelectionGrid
            configs={catalogConfigs}
            enabledIdSet={enabledIdSet}
            disabled={saving}
            saving={catalogLoading}
            columns={4}
            onToggle={(id, next) =>
              setPushConfigIds((prev) => (next ? [...prev, id] : prev.filter((x) => x !== id)))
            }
          />
        </FormSection>
      </div>
    </Drawer>
  )
}
