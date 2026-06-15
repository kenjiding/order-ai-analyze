import Tooltip from '@mui/material/Tooltip'
import { Button, InputNumber } from 'antd'
import { Gauge } from 'lucide-react'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'
import { ScanDataIntakePanel } from './ScanDataIntakePanel'

type Props = {
  vm: ScannerEfficiencyViewModel
}

export default function ScannerEfficiencyTopSection({ vm }: Props) {
  const {
    settings,
    handleSettingChange,
    openDayRuleTooltipText,
    snapshotRestore,
    dismissSnapshotRestore,
  } = vm

  return (
    <section className="admin-panel se-hero overflow-hidden">
      {snapshotRestore ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(47,143,135,0.22)] bg-[var(--admin-accent-soft)] px-5 py-3 sm:px-6">
          <div className="min-w-0 text-sm text-[#1f6f68]">
            <span className="font-semibold">记录查看模式</span>
            <span className="mx-2 text-[#2f8f87]/60" aria-hidden>
              |
            </span>
            正在查看 {snapshotRestore.restoredDate} 的效率考勤记录
            {snapshotRestore.restoredDates.length > 1
              ? `（${snapshotRestore.restoredDates.length} 天合并）`
              : ''}
            （只读快照，重新载入数据将退出此模式）
          </div>
          <Button type="default" onClick={dismissSnapshotRestore}>
            退出查看
          </Button>
        </div>
      ) : null}
      <header className="se-hero-head border-b border-[var(--admin-line)] px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <h1 className="se-page-title">仓库效率工作台</h1>
            <p className="se-page-lead">
              汇入到件扫描与考勤数据，计算开仓效率、分拣效率与包裹分配密度，支持周报与飞书推送。
            </p>
          </div>
          <div className="se-status-badge shrink-0">
            到件必传，考勤可选
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] lg:divide-x lg:divide-[var(--admin-line)]">
        <div className="se-settings-block border-b border-[var(--admin-line)] px-5 py-5 sm:px-6 lg:border-b-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--admin-text)]">开仓与脏数据过滤</h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--admin-muted)]">
              调整阈值后，下方图表与表格将自动重算。
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Tooltip title={openDayRuleTooltipText} arrow enterDelay={200}>
                <label
                  htmlFor="openDayThresholdInput"
                  className="inline-flex cursor-help items-center gap-1 text-xs font-medium text-[var(--admin-text)]"
                >
                  <Gauge className="h-3.5 w-3.5 shrink-0 text-[var(--admin-accent)]" aria-hidden />
                  开仓人数
                </label>
              </Tooltip>
              <InputNumber
                id="openDayThresholdInput"
                min={1}
                step={1}
                value={settings.openDayThreshold}
                disabled={Boolean(snapshotRestore)}
                onChange={(value) => handleSettingChange('openDayThreshold', String(value ?? ''))}
                className="w-full [&_.ant-input-number-input]:text-center [&_.ant-input-number-input]:font-semibold [&_.ant-input-number-input]:tabular-nums"
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
                  className="cursor-help text-xs font-medium text-[var(--admin-text)]"
                >
                  脏数据阈值
                </label>
              </Tooltip>
              <InputNumber
                id="minDayScanCountInput"
                min={1}
                step={50}
                value={settings.minDayScanCount}
                disabled={Boolean(snapshotRestore)}
                onChange={(value) => handleSettingChange('minDayScanCount', String(value ?? ''))}
                className="w-full [&_.ant-input-number-input]:text-center [&_.ant-input-number-input]:font-semibold [&_.ant-input-number-input]:tabular-nums"
              />
            </div>
          </div>
        </div>

        <div className="se-intake-shell min-w-0 px-5 py-5 sm:px-6">
          <ScanDataIntakePanel vm={vm} />
        </div>
      </div>
    </section>
  )
}
