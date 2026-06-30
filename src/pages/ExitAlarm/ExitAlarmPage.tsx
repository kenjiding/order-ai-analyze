import { AlarmClock } from 'lucide-react'
import { VendorPushConfigPanel } from '../../components/VendorPushPanel/VendorPushConfigPanel'
import { SchedulePushConfig } from './components/SchedulePushConfig'
import { PushNowPanel } from './components/PushNowPanel'
import { useExitAlarmPage } from './useExitAlarmPage'

export default function ExitAlarmPage() {
  const v = useExitAlarmPage()

  const enabledCount = v.configs.filter((c) => !c.isDisabled).length

  return (
    <div className="admin-page space-y-5">
      {/* 页面标题 */}
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">Out-of-warehouse Monitoring</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <AlarmClock className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              11点前出仓告警
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              监控各供应商11点前出仓率，在选定时间点自动获取昨日运单数据并推送飞书告警。
              数据筛选以 Header 责任站点为准，时区为阿德莱德（ACST/ACDT）。
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <div className="text-xs text-slate-500">已启用供应商</div>
            <div className="text-xl font-semibold tabular-nums text-slate-950">
              {enabledCount}
              <span className="ml-1 text-sm font-normal text-slate-400">/ {v.configs.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 定时推送配置 */}
      <SchedulePushConfig
        schedule={v.schedule}
        loading={v.scheduleLoading}
        saving={v.scheduleSaving}
        stationCode={v.selectedStations[0] ?? ''}
        onSave={v.saveSchedule}
      />

      {/* 供应商推送配置 */}
      <VendorPushConfigPanel
        configs={v.configs}
        vendors={v.vendors}
        vendorsLoading={v.vendorsLoading}
        loading={v.configsLoading}
        onAdd={v.addConfig}
        onEdit={v.editConfig}
        onDelete={v.deleteConfig}
        onToggleDisabled={v.toggleConfigDisabled}
      />

      {/* 立即推送 */}
      <PushNowPanel disabled={v.configsLoading || v.configs.filter((c) => !c.isDisabled).length === 0} />
    </div>
  )
}
