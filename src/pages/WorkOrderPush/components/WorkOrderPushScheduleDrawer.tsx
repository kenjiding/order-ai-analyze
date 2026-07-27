import { Button, Checkbox, Drawer, TimePicker } from 'antd'
import dayjs from 'dayjs'
import { Clock, Save, Ticket } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Plus, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { StationSelect } from '../../../components/Layout/StationSelect'
import {
  SupplierPushSelectAllButtons,
  SupplierPushSelectionGrid,
  type SupplierPushConfig,
} from '../../../shared/supplierPushConfig'
import { showToast } from '../../../utils/toast'
import type { PushTimeSlot, WeekdayNum, WorkOrderPushSchedule, WorkOrderPushScheduleDraft } from '../workOrderPushTypes'

const WEEKDAYS: { value: WeekdayNum; label: string }[] = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
]

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
  const [stationCode, setStationCode] = useState('')
  const [weekdays, setWeekdays] = useState<WeekdayNum[]>([])
  const [pushTimes, setPushTimes] = useState<PushTimeSlot[]>([])
  const [pushConfigIds, setPushConfigIds] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setStationCode(editingSchedule?.stationCode ?? '')
    setWeekdays(editingSchedule?.weekdays ?? [])
    setPushTimes(editingSchedule?.pushTimes ?? [])
    setPushConfigIds(editingSchedule?.pushConfigIds ?? [])
  }, [open, editingSchedule])

  const handleAddTime = () => setPushTimes((prev) => [...prev, { id: generateId(), time: '09:00' }])
  const handleRemoveTime = (id: string) => setPushTimes((prev) => prev.filter((t) => t.id !== id))
  const handleTimeChange = (id: string, newTime: string) =>
    setPushTimes((prev) => prev.map((t) => (t.id === id ? { ...t, time: newTime } : t)))

  const enabledIdSet = new Set(pushConfigIds)
  const catalogIdSet = new Set(catalogConfigs.map((config) => config.id))

  const handleConfirm = async () => {
    if (!stationCode) {
      showToast('请选择站点', 'error')
      return
    }
    if (weekdays.length === 0) {
      showToast('请至少选择一个推送星期', 'error')
      return
    }
    if (pushTimes.length === 0) {
      showToast('请至少添加一个推送时间', 'error')
      return
    }
    const scopedPushConfigIds = pushConfigIds.filter((id) => catalogIdSet.has(id))
    if (scopedPushConfigIds.length === 0) {
      showToast('请至少选择一个供应商', 'error')
      return
    }
    const draft: WorkOrderPushScheduleDraft = {
      weekdays,
      pushTimes,
      isEnabled: true,
      stationCode,
      pushConfigIds: scopedPushConfigIds,
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
          <span>{editingSchedule ? '编辑工单推送' : '添加工单推送'}</span>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="primary" icon={<Save className="h-3.5 w-3.5" />} loading={saving} onClick={() => void handleConfirm()}>
            确定
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <FormSection icon={Ticket} title="站点">
          <StationSelect value={stationCode} onChange={setStationCode} disabled={saving} />
        </FormSection>

        <FormSection
          icon={Clock}
          title="定时推送配置"
          description="工单出现时间不可预测，在推送星期内的下方时间点各检查一次未处理工单，有未处理工单才会推送对应供应商，没有则跳过"
        >
          <div className="divide-y divide-[var(--admin-line)]">
            <div className="flex items-center gap-4 py-3 first:pt-0">
              <span className="w-16 shrink-0 text-xs font-medium text-slate-500">推送星期</span>
              <Checkbox.Group value={weekdays} disabled={saving} onChange={(vals) => setWeekdays(vals as WeekdayNum[])}>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {WEEKDAYS.map((day) => (
                    <Checkbox key={day.value} value={day.value}>
                      <span className="text-sm">{day.label}</span>
                    </Checkbox>
                  ))}
                </div>
              </Checkbox.Group>
            </div>

            <div className="flex items-start gap-4 py-3 last:pb-0">
              <span className="mt-1 w-16 shrink-0 text-xs font-medium text-slate-500">推送时间</span>
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
                    添加
                  </Button>
                )}
                {pushTimes.length === 0 && <span className="text-xs text-slate-400">暂无推送时间</span>}
              </div>
            </div>
          </div>
        </FormSection>

        <FormSection
          icon={Ticket}
          title="供应商配置"
          description="勾选参与该条工单推送的供应商"
          action={
            <SupplierPushSelectAllButtons
              configs={catalogConfigs}
              enabledIdSet={enabledIdSet}
              disabled={saving}
              saving={catalogLoading}
              onToggle={(id, next) =>
                setPushConfigIds((prev) => (next ? [...prev, id] : prev.filter((x) => x !== id)))
              }
            />
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
