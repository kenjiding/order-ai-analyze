import { Button, Checkbox, Drawer, TimePicker } from 'antd'
import dayjs from 'dayjs'
import { Clock, Save, Ticket } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Plus, X } from 'lucide-react'
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
import type { PushTimeSlot, WeekdayNum, WorkOrderPushSchedule, WorkOrderPushScheduleDraft } from '../workOrderPushTypes'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

type Props = {
  open: boolean
  onClose: () => void
  editingSchedule: WorkOrderPushSchedule | null
  catalogConfigs: SupplierPushConfig[]
  catalogLoading: boolean
  saving: boolean
  onSubmit: (draft: WorkOrderPushScheduleDraft) => Promise<boolean>
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

export function WorkOrderPushScheduleDrawer({
  open,
  onClose,
  editingSchedule,
  catalogConfigs,
  catalogLoading,
  saving,
  onSubmit,
}: Props) {
  const { t } = useTranslation('workOrderPush')
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

  useEffect(() => {
    if (!open) return
    setStationCode(editingSchedule?.stationCode ?? '')
    setSelectedWeekdays(editingSchedule?.weekdays ?? [])
    setPushTimes(editingSchedule?.pushTimes ?? [])
    setPushConfigIds(editingSchedule?.pushConfigIds ?? [])
    setMentionEnabled(editingSchedule?.mentionEnabled ?? false)
  }, [open, editingSchedule])

  const handleAddTime = () => setPushTimes((prev) => [...prev, { id: generateId(), time: '09:00' }])
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
    const draft: WorkOrderPushScheduleDraft = {
      weekdays: selectedWeekdays,
      pushTimes,
      isEnabled: true,
      stationCode,
      pushConfigIds: scopedPushConfigIds,
      mentionEnabled,
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
          <Ticket className="h-4 w-4 text-[var(--admin-accent)]" aria-hidden />
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
        <FormSection icon={Ticket} title={t('drawer.station')}>
          <StationSelect value={stationCode} onChange={setStationCode} disabled={saving} />
        </FormSection>

        <FormSection
          icon={Clock}
          title={t('drawer.scheduleConfig')}
          description={t('drawer.scheduleConfigDesc')}
        >
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

        <FormSection
          icon={Ticket}
          title={t('drawer.vendorConfig')}
          description={t('drawer.vendorConfigDesc')}
          action={
            <div className="flex items-center gap-3">
              <SupplierMentionToggle value={mentionEnabled} onChange={setMentionEnabled} disabled={saving} />
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
