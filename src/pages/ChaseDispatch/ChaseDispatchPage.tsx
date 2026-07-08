import { Truck } from 'lucide-react'
import { ChaseDispatchSchedulePushConfig } from './components/ChaseDispatchSchedulePushConfig'
import { ChaseDispatchPushNowPanel } from './components/ChaseDispatchPushNowPanel'
import { ChaseDispatchSupplierSection } from './components/ChaseDispatchSupplierSection'
import { useChaseDispatchPage } from './useChaseDispatchPage'

export default function ChaseDispatchPage() {
  const v = useChaseDispatchPage()

  return (
    <div className="admin-page space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">Stagnant Order Chase</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <Truck className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              催派推送
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

      <ChaseDispatchSchedulePushConfig page={v} />

      <ChaseDispatchSupplierSection page={v} />

      <ChaseDispatchPushNowPanel
        disabled={v.catalog.loading}
        configs={v.scheduledPushConfigs}
        defaultBuckets={v.schedule?.stagnationBuckets ?? []}
      />
    </div>
  )
}
