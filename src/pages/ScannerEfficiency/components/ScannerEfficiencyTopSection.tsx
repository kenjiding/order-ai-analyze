import Tooltip from '@mui/material/Tooltip'
import { Select } from 'antd'
import { Gauge, Send } from 'lucide-react'
import { TAB_KEYS } from '../constants'
import { formatInteger } from '../formatAndParse'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'
import {
  PUSH_CHART_ALL_KEYS,
  PUSH_CHART_LABELS,
  getAvailableChartKeys,
  type PushChartKey,
  type ScannerLevel1FeishuPush,
} from '../useScannerLevel1FeishuPush'
import { ExportButton } from './ui'

type Props = {
  vm: ScannerEfficiencyViewModel
  level1Push: ScannerLevel1FeishuPush
}

export default function ScannerEfficiencyTopSection({ vm, level1Push }: Props) {
  const {
    settings,
    hasScanData,
    scanAggregate,
    scannerResult,
    attendanceResult,
    handleExport,
    activeTab,
    handleSettingChange,
    handleScanFileChange,
    handleAttendanceFileChange,
    scanSourceInfo,
    clearAttendance,
    clearAll,
    openDayRuleTooltipText,
  } = vm

  const {
    level1PushWorking,
    selectedChartKeys,
    setSelectedChartKeys,
    pushLevel1EfficiencyScreenshots,
  } = level1Push

  const availableChartKeys = getAvailableChartKeys(Boolean(attendanceResult), Boolean(scannerResult))
  const pushToFeishuDisabled = !scannerResult || level1PushWorking || !selectedChartKeys.length

  const chartSelectOptions = PUSH_CHART_ALL_KEYS.map((key) => ({
    value: key,
    label: PUSH_CHART_LABELS[key],
    disabled: !availableChartKeys.includes(key),
  }))
  return (
    <section className="overflow-hidden rounded-lg border border-[#cfe3ec] bg-[linear-gradient(135deg,#ffffff_0%,#eef8fb_48%,#e8f7f3_100%)] text-slate-900 shadow-[0_18px_48px_rgba(47,83,105,0.08)]">
      <div className="border-b border-[#d8e6ee] px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Warehouse Efficiency
            </div>
            <div className="mt-1 text-lg font-semibold">仓库效率工作台</div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="rounded-md border border-[#b8ddd7] bg-white/70 px-3 py-1 text-xs font-medium text-[#1f6f68]">
              到件必传 · 考勤可选
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-5 py-5 sm:px-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2f8f87]">
              Operational Metrics
            </div>
            <h1 className="mt-3 max-w-4xl text-2xl font-semibold tracking-tight sm:text-3xl">
              到件、考勤、分拣效率统一核算
            </h1>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">核算配置</h3>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-stretch">
              <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <Tooltip title={openDayRuleTooltipText} arrow enterDelay={200}>
                  <div
                    className="flex w-full min-w-0 cursor-help gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 [-webkit-tap-highlight-color:transparent]"
                    tabIndex={0}
                    aria-label={openDayRuleTooltipText}
                  >
                    <Gauge className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-blue-950">核算阈值配置</span>
                    </div>
                  </div>
                </Tooltip>
                <div className="grid grid-cols-2 gap-3 border-t border-blue-200/80 pt-3">
                  <div className="w-full min-w-0">
                    <label htmlFor="openDayThresholdInput" className="mb-1 block text-[11px] font-medium text-blue-700">
                      开仓人数阈值
                    </label>
                    <input
                      id="openDayThresholdInput"
                      type="number"
                      min={1}
                      step={1}
                      value={settings.openDayThreshold}
                      onChange={(event) =>
                        handleSettingChange('openDayThreshold', event.target.value)
                      }
                      className="box-border w-full rounded-md border border-blue-300 bg-white px-3 py-2 text-center text-2xl font-semibold tabular-nums text-blue-950 outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                    />
                  </div>
                  <div className="w-full min-w-0">
                    <Tooltip
                      title="某扫描员在某日扫描量低于此值，该扫描员当日数据整体剔除（不计入效率、汇总与按小时段）。用于过滤未全程参与分拣的异常数据。"
                      arrow
                      enterDelay={200}
                    >
                      <label htmlFor="minDayScanCountInput" className="mb-1 block min-w-0 max-w-full cursor-help truncate text-[11px] font-medium text-blue-700">
                        日扫描量脏数据阈值（票）
                      </label>
                    </Tooltip>
                    <input
                      id="minDayScanCountInput"
                      type="number"
                      min={1}
                      step={50}
                      value={settings.minDayScanCount}
                      onChange={(event) =>
                        handleSettingChange('minDayScanCount', event.target.value)
                      }
                      className="box-border w-full rounded-md border border-blue-300 bg-white px-3 py-2 text-center text-2xl font-semibold tabular-nums text-blue-950 outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                    />
                  </div>
                </div>
              </div>

              {hasScanData && scanAggregate && (
                <>
                  <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
                    <Tooltip
                      title={
                        !scannerResult
                          ? '请先保证到件文件包含一级分拣所需列（扫描时间、运单号、扫描员），解析出个人汇总后再推送。'
                          : ''
                      }
                      disableHoverListener={Boolean(scannerResult)}
                      arrow
                      enterDelay={200}
                    >
                      <div className="flex gap-3">
                        <Send className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-violet-950">飞书推送图表</span>
                        </div>
                      </div>
                    </Tooltip>
                    <div className="space-y-2 border-t border-violet-200/80 pt-3">
                      <div className="text-[11px] font-medium text-violet-700">选择推送内容</div>
                      <Select
                        mode="multiple"
                        size="small"
                        placeholder="选择推送图表"
                        value={selectedChartKeys}
                        onChange={(keys) => setSelectedChartKeys(keys as PushChartKey[])}
                        options={chartSelectOptions}
                        disabled={!scannerResult || level1PushWorking}
                        maxTagCount="responsive"
                        className="w-full text-xs"
                        popupMatchSelectWidth={false}
                      />
                      <ExportButton
                        className="w-full"
                        onClick={() => {
                          void pushLevel1EfficiencyScreenshots()
                        }}
                        disabled={pushToFeishuDisabled}
                        label={level1PushWorking ? '正在推送截图…' : '推送图表'}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-[#d8e6ee] bg-white/75 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Upload Console
          </div>

          <label className="group flex cursor-pointer flex-col rounded-lg border border-dashed border-[#b8ddd7] bg-[#f7fbff] px-4 py-4 text-left transition hover:border-[#2f8f87] hover:bg-white">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">必传</div>
            <div className="mt-1 text-base font-semibold text-slate-950">上传到件扫描文件</div>
            <input
              type="file"
              accept=".xlsx,.xls"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleScanFileChange(event.target.files)
                event.target.value = ''
              }}
            />
          </label>

          <label className="group flex cursor-pointer flex-col rounded-lg border border-dashed border-[#b8ddd7] bg-[#f7fbff] px-4 py-4 text-left transition hover:border-[#2f8f87] hover:bg-white">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">可选</div>
            <div className="mt-1 text-base font-semibold text-slate-950">上传考勤记录文件</div>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              multiple
              className="hidden"
              onChange={(event) => void handleAttendanceFileChange(event.target.files)}
            />
          </label>

          {hasScanData && scanSourceInfo.fileNames.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
              到件已载入 {scanSourceInfo.fileNames.join('、')}：计入统计{' '}
              {formatInteger(scanSourceInfo.rowCount)} 条
              {scanSourceInfo.droppedRows > 0 && (
                <>，解析跳过 {formatInteger(scanSourceInfo.droppedRows)} 行</>
              )}
              {scanSourceInfo.duplicateWaybillRows > 0 && (
                <>，运单号重复剔除 {formatInteger(scanSourceInfo.duplicateWaybillRows)} 条</>
              )}
              。
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={clearAttendance}
              className="inline-flex items-center rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:border-rose-400 hover:bg-rose-50"
            >
              清空考勤
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center rounded-lg border border-[#c8deee] bg-white px-4 py-2 text-sm text-slate-700 transition hover:border-[#2f8f87]"
            >
              清空全部
            </button>
            {hasScanData && scanAggregate && (
              <ExportButton
                onClick={handleExport}
                disabled={
                  !scanAggregate ||
                  activeTab === TAB_KEYS.WEEKLY ||
                  activeTab === TAB_KEYS.PUSH ||
                  activeTab === TAB_KEYS.FRONT_DESK ||
                  (activeTab === TAB_KEYS.SCANNER && !scannerResult) ||
                  (activeTab === TAB_KEYS.WAREHOUSE && !attendanceResult)
                }
              />
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
