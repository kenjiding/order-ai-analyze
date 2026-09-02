import { useRef, type ChangeEvent } from 'react'
import { Button, DatePicker, InputNumber, Tooltip } from 'antd'
import type { Dayjs } from 'dayjs'
import { FileSpreadsheet, Pause, Play, Search, Upload, Warehouse } from 'lucide-react'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import { OrderExceptionAnalysisResults } from '../../OrderExceptionManagement/components/OrderExceptionAnalysisResults'
import type { AnalysisRow, AnalyzeProgress } from '../../OrderExceptionManagement/analysisTypes'
import type { PostFilterConfig } from '../../OrderExceptionManagement/postFilter/types'
import type { InHubLossAnalytics } from '../inHubLossAnalytics'
import type { InHubPackageLossWaybills } from '../packageLossMonitorApi'
import type { PackageLossDateRange, PackageLossImportMeta } from '../usePackageLossMonitorPage'
import { InHubLossAnalyticsPanel } from './InHubLossAnalyticsPanel'

const MAX_QUERY_RANGE_DAYS = 31
const DATE_FORMAT = 'YYYY-MM-DD'

type Props = {
  stationCode?: string
  stationLabel: string
  dateRange: PackageLossDateRange
  onDateRangeChange: (next: PackageLossDateRange) => void
  lossTimeoutDays: number
  onLossTimeoutDaysChange: (value: number) => void
  isQuerying: boolean
  isAnalyzing: boolean
  isPaused: boolean
  onPauseAnalyze: () => void
  onResumeAnalyze: () => void
  queryMeta: InHubPackageLossWaybills | null
  importMeta: PackageLossImportMeta | null
  rows: AnalysisRow[]
  filteredRows: AnalysisRow[]
  analyzeProgress: AnalyzeProgress | null
  analytics: InHubLossAnalytics
  postFilterDraft: PostFilterConfig
  onPostFilterDraftChange: (next: PostFilterConfig) => void
  appliedPostFilter: PostFilterConfig
  onRunPostFilter: () => void
  exportPermission: string
  onAnalyze: () => void
  onImport: (file: File) => Promise<void>
}

export function InHubPackageLossTab({
  stationCode,
  stationLabel,
  dateRange,
  onDateRangeChange,
  lossTimeoutDays,
  onLossTimeoutDaysChange,
  isQuerying,
  isAnalyzing,
  isPaused,
  onPauseAnalyze,
  onResumeAnalyze,
  queryMeta,
  importMeta,
  rows,
  filteredRows,
  analyzeProgress,
  analytics,
  postFilterDraft,
  onPostFilterDraftChange,
  appliedPostFilter,
  onRunPostFilter,
  exportPermission,
  onAnalyze,
  onImport,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canAnalyze = usePermission(PERMISSION_KEYS.btnPackageLossMonitorAnalyze)
  const busy = isQuerying || isAnalyzing
  const timeoutInvalid = !Number.isFinite(lossTimeoutDays) || lossTimeoutDays < 1
  const dateRangeInvalid =
    !dateRange[0]?.isValid() || !dateRange[1]?.isValid() || dateRange[1].isBefore(dateRange[0])
  const exceedsRangeLimit =
    !dateRangeInvalid && dateRange[1].diff(dateRange[0], 'day', true) > MAX_QUERY_RANGE_DAYS
  // 分析进行中时主按钮改为暂停/继续开关，只有取号阶段才真正禁用
  const analyzeDisabled = isAnalyzing
    ? !canAnalyze
    : busy || !canAnalyze || !stationCode || timeoutInvalid || dateRangeInvalid || exceedsRangeLimit
  const importDisabled = busy || !canAnalyze
  const analyzeTooltip = !canAnalyze
    ? '无操作权限'
    : !stationCode
      ? '请先在右上角选择责任站点'
      : timeoutInvalid
        ? '请填写有效的超时天数'
        : dateRangeInvalid
          ? '请选择有效的时间范围'
          : exceedsRangeLimit
            ? '时间范围不能超过 1 个月'
            : undefined
  const importTooltip = !canAnalyze ? '无操作权限' : undefined
  const hasRunSurface = Boolean(queryMeta || importMeta || busy)
  const showIdleEmpty = !hasRunSurface && analytics.doneCount === 0 && rows.length === 0

  const onImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    void onImport(file)
  }

  const disableDateOutOfOneMonth = (current: Dayjs, info?: { from?: Dayjs }) => {
    const anchor = info?.from
    if (!anchor) return false
    return Math.abs(current.diff(anchor, 'day', true)) > MAX_QUERY_RANGE_DAYS
  }

  return (
    <div className="space-y-5">
      <section className="admin-panel overflow-hidden">
        <div className="package-loss-query">
          <div className="package-loss-query-head">
            <div className="min-w-0">
              <h3 className="package-loss-query-title">查询条件</h3>
              <p className="package-loss-query-desc">按站点与时间取号，超过无操作天数的运单进入分析。</p>
            </div>
            {stationCode ? (
              <span className="package-loss-station-badge">{stationLabel || stationCode}</span>
            ) : (
              <p className="package-loss-warn">请先在右上角选择责任站点</p>
            )}
          </div>

          <div className="package-loss-query-row">
            <div className="package-loss-query-fields">
              <div className="package-loss-field">
                <label className="package-loss-field-label" htmlFor="in-hub-date-range">
                  库内丢包时间范围
                </label>
                <DatePicker.RangePicker
                  id="in-hub-date-range"
                  value={dateRange}
                  format={DATE_FORMAT}
                  disabled={busy}
                  allowClear={false}
                  disabledDate={disableDateOutOfOneMonth}
                  onChange={(values) => {
                    if (!values || !values[0] || !values[1]) return
                    onDateRangeChange([values[0], values[1]])
                  }}
                  className="w-64"
                />
                <span className="package-loss-field-hint">最长 31 天</span>
              </div>

              <div className="package-loss-field">
                <label className="package-loss-field-label" htmlFor="in-hub-timeout-days">
                  无操作天数
                </label>
                <InputNumber
                  id="in-hub-timeout-days"
                  min={1}
                  value={lossTimeoutDays}
                  onChange={(value) => {
                    if (value == null) return
                    onLossTimeoutDaysChange(Number(value))
                  }}
                  disabled={busy}
                  className="w-28"
                  aria-label="订单分析的超时天数"
                />
                <span className="package-loss-field-hint">超过此天数视为丢包</span>
              </div>
            </div>

            <div className="package-loss-query-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                className="hidden"
                disabled={importDisabled}
                onChange={onImportFileChange}
              />
              <Tooltip title={importTooltip}>
                <span className={importDisabled ? 'inline-flex cursor-not-allowed' : 'inline-flex'}>
                  <Button
                    disabled={importDisabled}
                    icon={<Upload className="h-4 w-4" aria-hidden />}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    导入数据
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title={analyzeTooltip}>
                <span className={analyzeDisabled ? 'inline-flex cursor-not-allowed' : 'inline-flex'}>
                  <Button
                    type="primary"
                    danger={isAnalyzing && !isPaused}
                    disabled={analyzeDisabled}
                    loading={isQuerying}
                    icon={
                      isQuerying ? undefined : isAnalyzing ? (
                        isPaused ? (
                          <Play className="h-4 w-4" aria-hidden />
                        ) : (
                          <Pause className="h-4 w-4" aria-hidden />
                        )
                      ) : (
                        <Search className="h-4 w-4" aria-hidden />
                      )
                    }
                    onClick={() => {
                      if (!isAnalyzing) void onAnalyze()
                      else if (isPaused) onResumeAnalyze()
                      else onPauseAnalyze()
                    }}
                  >
                    {isQuerying ? '取号中' : isAnalyzing ? (isPaused ? '继续分析' : '暂停分析') : '查询并分析'}
                  </Button>
                </span>
              </Tooltip>
            </div>
          </div>
        </div>

        {hasRunSurface ? (
          <InHubRunStatus
            isQuerying={isQuerying}
            isAnalyzing={isAnalyzing}
            isPaused={isPaused}
            queryMeta={queryMeta}
            importMeta={importMeta}
            analyzeProgress={analyzeProgress}
          />
        ) : null}

        {showIdleEmpty ? (
          <div className="package-loss-idle">
            <Warehouse className="package-loss-idle-icon" aria-hidden />
            <p className="package-loss-idle-title">还没有库内丢包结果</p>
            <p className="package-loss-idle-desc">选择责任站点与时间后查询，或导入上次导出的 Excel。</p>
          </div>
        ) : null}

        {analytics.doneCount > 0 ? <InHubLossAnalyticsPanel analytics={analytics} /> : null}
      </section>

      <OrderExceptionAnalysisResults
        rows={rows}
        filteredRows={filteredRows}
        totalDoneRowCount={rows.filter((row) => row.status === 'done').length}
        isAnalyzing={isAnalyzing}
        analyzeProgress={analyzeProgress}
        postFilterDraft={postFilterDraft}
        onPostFilterDraftChange={onPostFilterDraftChange}
        appliedPostFilter={appliedPostFilter}
        onRunPostFilter={onRunPostFilter}
        exportPermission={exportPermission}
        emptyText="暂无明细。查询完成后单票结果会出现在这里。"
        showPushSection={false}
      />
    </div>
  )
}

function InHubRunStatus({
  isQuerying,
  isAnalyzing,
  isPaused,
  queryMeta,
  importMeta,
  analyzeProgress,
}: {
  isQuerying: boolean
  isAnalyzing: boolean
  isPaused: boolean
  queryMeta: InHubPackageLossWaybills | null
  importMeta: PackageLossImportMeta | null
  analyzeProgress: AnalyzeProgress | null
}) {
  const progressPercent =
    analyzeProgress && analyzeProgress.total > 0
      ? Math.round((analyzeProgress.completed / analyzeProgress.total) * 100)
      : 0

  if (importMeta) {
    return (
      <div className="package-loss-status" aria-live="polite">
        <div className="package-loss-counts package-loss-counts--import">
          <StatusMetric label="已导入" value={String(importMeta.total)} accent />
          <div className="package-loss-count">
            <span className="package-loss-count-label">文件</span>
            <span className="package-loss-count-file" title={importMeta.fileName}>
              <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {importMeta.fileName}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="package-loss-status" aria-live="polite">
      <div className="package-loss-counts">
        <StatusMetric label="取消扫描" value={String(queryMeta?.byScanType['1504'] ?? 0)} />
        <StatusMetric label="未取件" value={String(queryMeta?.byScanType['400'] ?? 0)} />
        <StatusMetric label="异常完结" value={String(queryMeta?.exceptionClosedCount ?? 0)} />
        <StatusMetric label="待分析" value={String(queryMeta?.total ?? 0)} accent />
        <StatusMetric
          label="已分析"
          value={analyzeProgress ? `${analyzeProgress.succeeded}/${analyzeProgress.total}` : '0'}
        />
      </div>
      {isQuerying || isAnalyzing ? (
        <div className="package-loss-progress-row">
          <div
            className={
              isQuerying
                ? 'package-loss-progress package-loss-progress--indeterminate'
                : 'package-loss-progress'
            }
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={isQuerying ? undefined : progressPercent}
            aria-label={isQuerying ? '正在取号' : '分析进度'}
          >
            <span
              className="package-loss-progress-value"
              style={isQuerying ? undefined : { width: `${progressPercent}%` }}
            />
          </div>
          <span className="package-loss-progress-label">
            {isQuerying
              ? '正在取号'
              : `${analyzeProgress?.completed ?? 0} / ${analyzeProgress?.total ?? 0}${isPaused ? '（已暂停）' : ''}`}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function StatusMetric({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className={accent ? 'package-loss-count package-loss-count--accent' : 'package-loss-count'}>
      <span className="package-loss-count-label">{label}</span>
      <span className="package-loss-count-value">{value}</span>
    </div>
  )
}
