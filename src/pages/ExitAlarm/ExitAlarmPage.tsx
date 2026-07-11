import { Tabs } from 'antd'
import type { TabsProps } from 'antd'
import { AlarmClock, Gauge } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { PERMISSION_KEYS } from '../../hooks/usePermission'
import { SchedulePushConfig } from './components/SchedulePushConfig'
import { PushNowPanel } from './components/PushNowPanel'
import { ExitAlarmSupplierSection } from './components/ExitAlarmSupplierSection'
import { DispatchAlarmScheduleConfig } from './components/DispatchAlarmScheduleConfig'
import { DispatchAlarmSupplierSection } from './components/DispatchAlarmSupplierSection'
import { DispatchAlarmPushNowPanel } from './components/DispatchAlarmPushNowPanel'
import { useExitAlarmPage } from './useExitAlarmPage'
import { useDispatchAlarmPage } from './useDispatchAlarmPage'

const DEFAULT_DISPATCH_ALERT_THRESHOLD_PCT = 92

export default function ExitAlarmPage() {
  const v = useExitAlarmPage()
  const d = useDispatchAlarmPage()
  const { hasPermission } = useAuthStore()
  const canDispatchAlarm = hasPermission(PERMISSION_KEYS.btnExitAlarmDispatchAlarm)
  const [activeTab, setActiveTab] = useState<'exit' | 'dispatch'>('exit')

  const tabItems: TabsProps['items'] = useMemo(() => {
    const items: TabsProps['items'] = [
      {
        key: 'exit',
        label: (
          <span className="flex items-center gap-1.5">
            <AlarmClock className="h-4 w-4" aria-hidden />
            11点前出仓告警
          </span>
        ),
        children: (
          <div className="space-y-5">
            <SchedulePushConfig page={v} />
            <ExitAlarmSupplierSection page={v} />
            <PushNowPanel disabled={v.catalog.loading} configs={v.scheduledPushConfigs} />
          </div>
        ),
      },
    ]
    if (canDispatchAlarm) {
      items.push({
        key: 'dispatch',
        label: (
          <span className="flex items-center gap-1.5">
            <Gauge className="h-4 w-4" aria-hidden />
            24小时派签告警
          </span>
        ),
        children: (
          <div className="space-y-5">
            <DispatchAlarmScheduleConfig page={d} />
            <DispatchAlarmSupplierSection page={d} />
            <DispatchAlarmPushNowPanel
              disabled={d.catalog.loading}
              configs={d.scheduledPushConfigs}
              alertThresholdPct={d.schedule?.alertThresholdPct ?? DEFAULT_DISPATCH_ALERT_THRESHOLD_PCT}
            />
          </div>
        ),
      })
    }
    return items
  }, [v, d, canDispatchAlarm])

  return (
    <div className="admin-page space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">SLA Monitoring</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <AlarmClock className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              出仓 / 派签告警
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end gap-1 text-right">
              <div className="text-xs text-slate-500">出仓告警 已启用</div>
              <div className="text-xl font-semibold tabular-nums text-slate-950">
                {v.scheduledPushConfigs.length}
                <span className="ml-1 text-sm font-normal text-slate-400">/ {v.pushableConfigs.length}</span>
              </div>
            </div>
            {canDispatchAlarm && (
              <div className="flex flex-col items-end gap-1 text-right">
                <div className="text-xs text-slate-500">派签告警 已启用</div>
                <div className="text-xl font-semibold tabular-nums text-slate-950">
                  {d.scheduledPushConfigs.length}
                  <span className="ml-1 text-sm font-normal text-slate-400">/ {d.pushableConfigs.length}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {tabItems.length > 1 ? (
        <Tabs activeKey={activeTab} onChange={(key) => setActiveTab(key as 'exit' | 'dispatch')} items={tabItems} />
      ) : (
        tabItems[0]?.children
      )}
    </div>
  )
}
