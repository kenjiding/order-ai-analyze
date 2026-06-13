import Tooltip from '@mui/material/Tooltip'
import { Gauge } from 'lucide-react'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'
import { ScanDataIntakePanel } from './ScanDataIntakePanel'

type Props = {
  vm: ScannerEfficiencyViewModel
}

export default function ScannerEfficiencyTopSection({ vm }: Props) {
  const { settings, handleSettingChange, openDayRuleTooltipText } = vm

  return (
    <section className="admin-panel overflow-hidden">
      <header className="border-b border-[var(--admin-line)] px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="admin-eyebrow">Warehouse Efficiency</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">仓库效率工作台</h1>
          </div>
          <div className="inline-flex items-center gap-2 rounded-md border border-[rgba(47,143,135,0.22)] bg-[var(--admin-accent-soft)] px-3 py-1.5 text-xs font-medium text-[#1f6f68]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2f8f87]" aria-hidden />
            到件必传 · 考勤可选
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] lg:divide-x lg:divide-[var(--admin-line)]">
        <div className="border-b border-[var(--admin-line)] px-5 py-4 sm:px-6 lg:border-b-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-950">开仓与脏数据过滤</h2>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Tooltip title={openDayRuleTooltipText} arrow enterDelay={200}>
                <label
                  htmlFor="openDayThresholdInput"
                  className="inline-flex cursor-help items-center gap-1 text-[11px] font-medium leading-tight text-slate-700"
                >
                  <Gauge className="h-3 w-3 shrink-0 text-[#2f8f87]" aria-hidden />
                  开仓人数
                </label>
              </Tooltip>
              <input
                id="openDayThresholdInput"
                type="number"
                min={1}
                step={1}
                value={settings.openDayThreshold}
                onChange={(event) => handleSettingChange('openDayThreshold', event.target.value)}
                className="box-border w-full rounded-md border border-[var(--admin-line)] bg-white px-2 py-1.5 text-center text-base font-semibold tabular-nums text-slate-950 outline-none focus:ring-2 focus:ring-[rgba(47,143,135,0.35)]"
              />
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <Tooltip
                title="某扫描员在某日扫描量低于此值，该扫描员当日数据整体剔除（不计入效率、汇总与按小时段）。"
                arrow
                enterDelay={200}
              >
                <label
                  htmlFor="minDayScanCountInput"
                  className="cursor-help text-[11px] font-medium leading-tight text-slate-700"
                >
                  脏数据阈值
                </label>
              </Tooltip>
              <input
                id="minDayScanCountInput"
                type="number"
                min={1}
                step={50}
                value={settings.minDayScanCount}
                onChange={(event) => handleSettingChange('minDayScanCount', event.target.value)}
                className="box-border w-full rounded-md border border-[var(--admin-line)] bg-white px-2 py-1.5 text-center text-base font-semibold tabular-nums text-slate-950 outline-none focus:ring-2 focus:ring-[rgba(47,143,135,0.35)]"
              />
            </div>
          </div>
        </div>

        <div className="min-w-0 px-5 py-4 sm:px-6">
          <ScanDataIntakePanel vm={vm} />
        </div>
      </div>
    </section>
  )
}
