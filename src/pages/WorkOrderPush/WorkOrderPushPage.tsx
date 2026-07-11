import { Ticket } from 'lucide-react'
import { WorkOrderPushScheduleConfig } from './components/WorkOrderPushScheduleConfig'
import { WorkOrderPushNowPanel } from './components/WorkOrderPushNowPanel'
import { WorkOrderPushSupplierSection } from './components/WorkOrderPushSupplierSection'
import { useWorkOrderPushPage } from './useWorkOrderPushPage'

export default function WorkOrderPushPage() {
  const v = useWorkOrderPushPage()

  return (
    <div className="admin-page space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">Unprocessed Work Order Push</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <Ticket className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              工单推送
            </h2>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <div className="text-xs text-slate-500">定时已启用 / 可推送</div>
            <div className="text-xl font-semibold tabular-nums text-slate-950">
              {v.scheduledPushConfigs.length}
              <span className="ml-1 text-sm font-normal text-slate-400">/ {v.pushableConfigs.length}</span>
            </div>
          </div>
        </div>
      </div>

      <WorkOrderPushScheduleConfig page={v} />

      <WorkOrderPushSupplierSection page={v} />

      <WorkOrderPushNowPanel disabled={v.catalog.loading} configs={v.scheduledPushConfigs} />
    </div>
  )
}
