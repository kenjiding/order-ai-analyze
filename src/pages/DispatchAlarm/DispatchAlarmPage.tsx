import { Button } from 'antd'
import { Gauge, Plus } from 'lucide-react'
import { DispatchAlarmScheduleDrawer } from './components/DispatchAlarmScheduleDrawer'
import { DispatchAlarmScheduleList } from './components/DispatchAlarmScheduleList'
import { useDispatchAlarmPage } from './useDispatchAlarmPage'

export default function DispatchAlarmPage() {
  const v = useDispatchAlarmPage()

  const enabledCount = v.schedules.filter((s) => s.isEnabled).length

  return (
    <div className="admin-page space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">SLA Monitoring</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <Gauge className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              24小时派签告警
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end gap-1 text-right">
              <div className="text-xs text-slate-500">已启用 / 总数</div>
              <div className="text-xl font-semibold tabular-nums text-slate-950">
                {enabledCount}
                <span className="ml-1 text-sm font-normal text-slate-400">/ {v.schedules.length}</span>
              </div>
            </div>
            <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={v.openCreateDrawer}>
              添加派签告警
            </Button>
          </div>
        </div>
      </div>

      <DispatchAlarmScheduleList
        schedules={v.schedules}
        loading={v.schedulesLoading}
        pushingId={v.pushingId}
        togglingIds={v.togglingIds}
        onEdit={v.openEditDrawer}
        onDelete={(id) => void v.removeSchedule(id)}
        onToggleEnabled={(schedule, enabled) => void v.toggleEnabled(schedule, enabled)}
        onPushNow={(schedule) => void v.pushNow(schedule)}
      />

      <DispatchAlarmScheduleDrawer
        open={v.drawerOpen}
        onClose={v.closeDrawer}
        editingSchedule={v.editingSchedule}
        catalogConfigs={v.catalog.configs}
        catalogLoading={v.catalog.loading}
        saving={v.saving}
        onSubmit={v.submitDrawer}
      />
    </div>
  )
}
