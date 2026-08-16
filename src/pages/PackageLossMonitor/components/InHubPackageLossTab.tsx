import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Button, InputNumber, Select, Tooltip } from 'antd'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import { OrderExceptionAnalysisResults } from '../../OrderExceptionManagement/components/OrderExceptionAnalysisResults'
import type { AnalysisRow, AnalyzeProgress } from '../../OrderExceptionManagement/analysisTypes'
import type { PostFilterConfig } from '../../OrderExceptionManagement/postFilter/types'
import {
  canonicalizeExcludedRouteCodes,
  uniqueRouteCodes,
  type InHubLossAnalytics,
} from '../inHubLossAnalytics'
import type { InHubPackageLossWaybills } from '../packageLossMonitorApi'
import type { PackageLossImportMeta } from '../usePackageLossMonitorPage'
import { InHubLossAnalyticsPanel } from './InHubLossAnalyticsPanel'

const DEFAULT_MIN_ROUTE_COUNT = 2

type Props = {
  stationCode?: string
  stationLabel: string
  lossTimeoutDays: number
  onLossTimeoutDaysChange: (value: number) => void
  isQuerying: boolean
  isAnalyzing: boolean
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
  lossTimeoutDays,
  onLossTimeoutDaysChange,
  isQuerying,
  isAnalyzing,
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
  const [minRouteCount, setMinRouteCount] = useState(DEFAULT_MIN_ROUTE_COUNT)
  const [excludedRouteCodes, setExcludedRouteCodes] = useState<string[]>([])
  const routeCodeOptions = useMemo(() => uniqueRouteCodes(analytics.flows), [analytics.flows])
  const analyzeDisabled = busy || !canAnalyze || !stationCode || timeoutInvalid
  const importDisabled = busy || !canAnalyze
  const analyzeTooltip = !canAnalyze
    ? '无操作权限'
    : !stationCode
      ? '请先在右上角选择责任站点'
      : timeoutInvalid
        ? '请填写有效的超时天数'
        : undefined
  const importTooltip = !canAnalyze ? '无操作权限' : undefined

  const onImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    void onImport(file)
  }

  return (
    <div className="space-y-5">
      <section className="admin-panel overflow-hidden">
        <div className="package-loss-command">
          <div className="package-loss-command-meta">
            {stationCode ? (
              <span className="package-loss-station">{stationLabel || stationCode}</span>
            ) : (
              <p className="package-loss-warn">请先在右上角选择责任站点</p>
            )}
          </div>
          <div className="package-loss-command-actions">
            <InputNumber
              min={1}
              value={lossTimeoutDays}
              onChange={(value) => {
                if (value == null) return
                onLossTimeoutDaysChange(Number(value))
              }}
              addonBefore="无操作天数"
              disabled={busy}
              className="w-16"
              aria-label="订单分析的超时天数"
            />
            <Tooltip title="例如AA091有1单, BB087有2单, 填 2 表示只显示BB087, 不显示AA091。">
              <span className="inline-flex">
                <InputNumber
                  min={1}
                  precision={0}
                  value={minRouteCount}
                  onChange={(value) => {
                    if (value == null) return
                    setMinRouteCount(Number(value))
                  }}
                  addonBefore="路由码丢失数量 ≥"
                  className="w-16"
                  aria-label="路由码丢失数量下限"
                />
              </span>
            </Tooltip>
            <Select
              mode="tags"
              allowClear
              value={excludedRouteCodes}
              options={routeCodeOptions.map((code) => ({ value: code, label: code }))}
              onChange={(values) => {
                setExcludedRouteCodes(canonicalizeExcludedRouteCodes(values, routeCodeOptions))
              }}
              tokenSeparators={[',', '，', ' ']}
              placeholder="剔除路由码"
              className="package-loss-exclude-routes-select"
              aria-label="剔除路由码"
            />
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
                <Button disabled={importDisabled} onClick={() => fileInputRef.current?.click()}>
                  导入数据
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={analyzeTooltip}>
              <span className={analyzeDisabled ? 'inline-flex cursor-not-allowed' : 'inline-flex'}>
                <Button type="primary" disabled={analyzeDisabled} loading={busy} onClick={() => void onAnalyze()}>
                  {isQuerying ? '取号中' : isAnalyzing ? '分析中' : '查询并分析'}
                </Button>
              </span>
            </Tooltip>
          </div>
        </div>

        {importMeta ? (
          <div className="package-loss-counts package-loss-counts--import" aria-live="polite">
            <div className="package-loss-count package-loss-count--accent">
              <span className="package-loss-count-label">已导入</span>
              <span className="package-loss-count-value">{importMeta.total}</span>
            </div>
            <div className="package-loss-count">
              <span className="package-loss-count-label">文件</span>
              <span className="package-loss-count-file" title={importMeta.fileName}>
                {importMeta.fileName}
              </span>
            </div>
          </div>
        ) : queryMeta ? (
          <div className="package-loss-counts" aria-live="polite">
            <div className="package-loss-count">
              <span className="package-loss-count-label">scanType 1504</span>
              <span className="package-loss-count-value">{queryMeta.byScanType['1504'] ?? 0}</span>
            </div>
            <div className="package-loss-count">
              <span className="package-loss-count-label">scanType 400</span>
              <span className="package-loss-count-value">{queryMeta.byScanType['400'] ?? 0}</span>
            </div>
            <div className="package-loss-count package-loss-count--accent">
              <span className="package-loss-count-label">去重后</span>
              <span className="package-loss-count-value">{queryMeta.total}</span>
            </div>
            <div className="package-loss-count">
              <span className="package-loss-count-label">已分析</span>
              <span className="package-loss-count-value">
                {analyzeProgress ? `${analyzeProgress.succeeded}/${analyzeProgress.total}` : '0'}
              </span>
            </div>
          </div>
        ) : null}

        {analytics.doneCount > 0 ? (
          <InHubLossAnalyticsPanel
            analytics={analytics}
            minRouteCount={minRouteCount}
            excludedRouteCodes={excludedRouteCodes}
          />
        ) : null}
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
        emptyText="暂无结果。选择责任站点后点击查询并分析，或导入上次导出的 Excel。"
        showPushSection={false}
      />
    </div>
  )
}
