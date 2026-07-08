import { Tabs, Tooltip } from 'antd'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  generateWarehouseInsight,
  generateScannerInsight,
  type EfficiencyAiAnalysis,
  type EfficiencyInsightAiProvider,
} from '../efficiencyInsightApi'
import type { ScannerLevel1FeishuPush } from '../useScannerLevel1FeishuPush'
import { TAB_KEYS, type TabKey } from '../constants'
import DailyTrendLineChart from '../DailyTrendLineChart'
import DailyEfficiencyComboChart, { isEfficiencyChartNonOpenDay } from '../DailyEfficiencyBubbleChart'
import { EfficiencyDailyDetailByDaySection } from '../EfficiencyDailyDetailByDaySection'
import { formatInteger } from '../formatAndParse'
import WeeklyReportPanel from '../WeeklyReportPanel'
import { FrontDeskSaturationSection } from './FrontDeskSaturationSection'
import { CancelScanAnalysisSection } from './CancelScanAnalysisSection'
import ScannerEfficiencyPushSection from './ScannerEfficiencyPushSection'
import { ScannerPersonSortingHourlySection } from './ScannerPersonSortingHourlySection'
import { ScannerPersonSortingSummarySection } from './ScannerPersonSortingSummarySection'
import { ScannerPersonTotalEfficiencySection } from './ScannerPersonTotalEfficiencySection'
import { EfficiencyAiInsightBlock } from './EfficiencyAiInsightBlock'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'
import { DataTable, LoadingPanel, Metric, SectionTitle } from './ui'

type Props = {
  vm: ScannerEfficiencyViewModel
  level1Push: ScannerLevel1FeishuPush
}

export default function ScannerEfficiencyBody({ vm, level1Push }: Props) {
  // AI 分析状态提升到此处，切换 tab 不会重置
  const [warehouseAiProvider, setWarehouseAiProvider] = useState<EfficiencyInsightAiProvider>('deepseek')
  const [warehouseLoading, setWarehouseLoading] = useState(false)
  const [warehouseError, setWarehouseError] = useState('')
  const [warehouseAnalysis, setWarehouseAnalysis] = useState<EfficiencyAiAnalysis | null>(null)

  const [scannerAiProvider, setScannerAiProvider] = useState<EfficiencyInsightAiProvider>('deepseek')
  const [scannerLoading, setScannerLoading] = useState(false)
  const [scannerError, setScannerError] = useState('')
  const [scannerAnalysis, setScannerAnalysis] = useState<EfficiencyAiAnalysis | null>(null)

  const handleWarehouseGenerate = useCallback(async () => {
    if (!vm.attendanceResult) return
    setWarehouseLoading(true)
    setWarehouseError('')
    try {
      const result = await generateWarehouseInsight(vm.attendanceResult, warehouseAiProvider)
      setWarehouseAnalysis(result)
    } catch (err) {
      setWarehouseError(err instanceof Error ? err.message : 'AI 分析失败，请稍后重试。')
    } finally {
      setWarehouseLoading(false)
    }
  }, [vm.attendanceResult, warehouseAiProvider])

  const handleScannerGenerate = useCallback(async () => {
    if (!vm.scannerResult) return
    setScannerLoading(true)
    setScannerError('')
    try {
      const result = await generateScannerInsight(vm.scannerResult, scannerAiProvider, vm.scannerTotalEfficiencyRows)
      setScannerAnalysis(result)
    } catch (err) {
      setScannerError(err instanceof Error ? err.message : 'AI 分析失败，请稍后重试。')
    } finally {
      setScannerLoading(false)
    }
  }, [vm.scannerResult, vm.scannerTotalEfficiencyRows, scannerAiProvider])
  const {
    attendanceTableCaptureRef,
    attendanceChartCaptureRef,
    scannerSummaryCaptureRef,
    scannerHourlyCaptureRef,
  } = level1Push

  const {
    loading,
    error,
    scannerHourlyExpanded,
    setScannerHourlyExpanded,
    scanAggregate,
    attendanceResult,
    scannerResult,
    activeTab,
    setActiveTab,
    showPushTab,
    weeklyPanelKey,
    summaryMetrics,
    settings,
    scanSourceInfo,
    attendanceSourceInfo,
    dailyVolumeColumns,
    attendanceMatchColumns,
    attendancePersonColumns,
    scannerDailyColumns,
    scannerPersonColumns,
    scannerTotalEfficiencyColumns,
    scannerTotalEfficiencyRows,
    hasScanData,
    dailyRowsAsTable,
    dailyVolumeTrendPoints,
    attendanceDayEfficiencyBubbleData,
    attendanceDailyAsTable,
    attendanceWeeklyAsTable,
    attendancePersonAsTable,
    allocationDensityAsTable,
    frontDeskClockOutAsTable,
    scannerDailyAsTable,
    scannerHourlyPivotTables,
    scannerDailyEfficiencyTrendPoints,
    dailyCostPerTicketByDate,
    dailyTotalLaborCostByDate,
    efficiencyDetailDimension,
    handleEfficiencyDetailDimensionChange,
    efficiencyChartOpenDaysOnly,
    handleEfficiencyChartOpenDaysOnlyChange,
    efficiencyDetailExpandedWeekKeys,
    handleEfficiencyDetailWeekRowClick,
  } = vm

  const chartBubbleData = useMemo(() => {
    if (!efficiencyChartOpenDaysOnly) return attendanceDayEfficiencyBubbleData
    return attendanceDayEfficiencyBubbleData.filter((row) => !isEfficiencyChartNonOpenDay(row))
  }, [attendanceDayEfficiencyBubbleData, efficiencyChartOpenDaysOnly])

  const tabItems = useMemo(() => {
    const hasAttendance = Boolean(attendanceResult)
    const disabledLabel = (label: string): ReactNode => (
      <Tooltip title="此部分数据需要上传考勤数据" placement="bottom">
        <span>{label}</span>
      </Tooltip>
    )
    const attendanceTab = (key: TabKey, label: string) => ({
      key,
      label: hasAttendance ? label : disabledLabel(label),
      disabled: !hasAttendance,
    })
    const items: { key: TabKey; label: ReactNode; disabled?: boolean }[] = [
      attendanceTab(TAB_KEYS.WAREHOUSE, '开仓效率 / 总体效率'),
      attendanceTab(TAB_KEYS.SCANNER, '分拣员个人效率'),
      { key: TAB_KEYS.FRONT_DESK, label: '包裹分配密度' },
      { key: TAB_KEYS.CANCEL_SCAN, label: '细分错误率分析' },
      attendanceTab(TAB_KEYS.WEEKLY, '周报生成器'),
    ]
    if (showPushTab) {
      items.push(attendanceTab(TAB_KEYS.PUSH, '推送'))
    }
    return items
  }, [attendanceResult, showPushTab])

  return (
    <>
      {loading && <LoadingPanel />}

      {error && (
        <section className="se-alert-error px-5 py-4 text-sm">
          {error}
        </section>
      )}

      <section className="se-workspace">
        <section className="se-tabs-panel">
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as TabKey)}
            items={tabItems}
          />
        </section>

        {hasScanData && summaryMetrics.length > 0 &&
          activeTab !== TAB_KEYS.WEEKLY &&
          activeTab !== TAB_KEYS.PUSH &&
          activeTab !== TAB_KEYS.CANCEL_SCAN && (
          <div className="se-metrics-strip">
            <div
              className={`grid gap-4 ${
                summaryMetrics.length <= 2
                  ? 'md:grid-cols-2'
                  : summaryMetrics.length > 4
                    ? 'xl:grid-cols-5'
                    : 'xl:grid-cols-4'
              }`}
            >
              {summaryMetrics.map((metric, index) => (
                <Metric
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  hint={metric.hint}
                  featured={index === 0 || metric.tone === 'dark'}
                />
              ))}
            </div>
          </div>
        )}

        <div className="se-workspace-body">
          {/* 未载入扫描数据时的引导（仅对依赖扫描数据的 tab 显示） */}
          {!hasScanData && !loading && !error &&
            activeTab !== TAB_KEYS.CANCEL_SCAN &&
            activeTab !== TAB_KEYS.FRONT_DESK && (
            <section className="se-empty-panel overflow-hidden">
              <div className="se-section-head border-b-0 bg-transparent">
                <h2 className="se-section-title mt-0">先载入到件扫描数据</h2>
                <p className="se-section-desc">
                  上传 Excel 或通过 API 拉取到件记录后，即可查看货量趋势与效率分析。
                </p>
              </div>
              <div className="se-empty-steps px-5 pb-5">
                <div className="se-empty-step">
                  <div className="se-empty-step-num">1</div>
                  只载入到件数据：先得到按日货量，含扫描员信息时可自动算分拣效率。支持多文件或多次 API 合并，运单号重复时保留最早扫描记录。
                </div>
                <div className="se-empty-step">
                  <div className="se-empty-step-num">2</div>
                  同时上传考勤：自动输出开仓效率与总体效率。
                </div>
                <div className="se-empty-step">
                  <div className="se-empty-step-num">3</div>
                  日期自动匹配：按到件文件日期去找对应考勤日期。
                </div>
              </div>
            </section>
          )}

          {/* 开仓效率 / 总体效率 */}
          {hasScanData && activeTab === TAB_KEYS.WAREHOUSE && attendanceResult && (
            <EfficiencyAiInsightBlock
              tab="warehouse"
              aiProvider={warehouseAiProvider}
              onProviderChange={setWarehouseAiProvider}
              loading={warehouseLoading}
              error={warehouseError}
              analysis={warehouseAnalysis}
              onGenerate={handleWarehouseGenerate}
            />
          )}

          {hasScanData && activeTab === TAB_KEYS.WAREHOUSE && (
            <section className="admin-panel overflow-hidden space-y-0">
              <SectionTitle
                title="到件货量按日"
                description="左侧为按日汇总表（含菜鸟票与菜鸟占比：运单号以 3 开头）。右侧折线仅反映各日总货量（票）趋势。文件合并后先按运单号全局去重，再按日统计；开仓/总体效率口径不变。"
              />
              <div className="grid gap-4 p-4 pt-0 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start">
                <div className="min-w-0">
                  <DataTable
                    boundedScroll
                    columns={dailyVolumeColumns}
                    rows={dailyRowsAsTable}
                    emptyText="暂无到件数据。"
                  />
                </div>
                <div className="admin-panel min-w-0 overflow-hidden p-4 sm:p-5">
                  <DailyTrendLineChart variant="volume" points={dailyVolumeTrendPoints} />
                </div>
              </div>
            </section>
          )}

          {hasScanData && activeTab === TAB_KEYS.WAREHOUSE && attendanceResult && (
            <>
              <EfficiencyDailyDetailByDaySection
                variant="full"
                dimension={efficiencyDetailDimension}
                onDimensionChange={handleEfficiencyDetailDimensionChange}
                expandedWeekKeys={efficiencyDetailExpandedWeekKeys}
                onWeekRowClick={handleEfficiencyDetailWeekRowClick}
                attendanceMatchColumns={attendanceMatchColumns}
                attendanceDailyAsTable={attendanceDailyAsTable}
                attendanceWeeklyAsTable={attendanceWeeklyAsTable}
                attendanceDayEfficiencyBubbleData={attendanceDayEfficiencyBubbleData}
                attendanceDailyRows={attendanceResult.dailyRows}
                chartOpenDaysOnly={efficiencyChartOpenDaysOnly}
                onChartOpenDaysOnlyChange={handleEfficiencyChartOpenDaysOnlyChange}
              />

              <section className="admin-panel overflow-hidden">
                <SectionTitle
                  title="人员工时汇总"
                  description="按人员汇总统计窗口内（含无到件补录日）的考勤总工时、活跃与开仓参与天数。扫描量为一级分拣同源个人总票数（与「扫描员一级分拣效率汇总」一致）；在岗效率为扫描量÷总工时(小时)。扫描员与考勤「昵称」匹配：忽略大小写；多级编码（如 ADL-DC-Serene）取末段与昵称精确或前缀对应（如 Serene、pan↔PanPan）。无匹配时显示为 —。"
                />
                <div className="overflow-x-auto p-4 pt-0">
                  <DataTable
                    columns={attendancePersonColumns}
                    rows={attendancePersonAsTable}
                    emptyText="暂无人员工时数据。"
                  />
                </div>
              </section>
            </>
          )}

          {hasScanData && activeTab === TAB_KEYS.WAREHOUSE && !attendanceResult && (
            <section className="se-alert-warn overflow-hidden">
              <SectionTitle
                bare
                title="开仓效率 / 总体效率模块未启用"
                description="当前尚未上传可识别的考勤数据，无法计算工时口径效率。"
              />
              <div className="px-5 py-4 text-sm leading-7">
                请上传"考勤记录报表.csv"或同结构文件（至少包含日期、人员；有「工作时长」则优先使用，否则使用「总时长」），即可启用该标签页。
                <br />
                当前考勤识别：有效 {formatInteger(attendanceSourceInfo.rowCount)} 行，未识别{' '}
                {formatInteger(attendanceSourceInfo.droppedRows)} 行。
              </div>
            </section>
          )}

          {/* 分拣员个人效率 */}
          {hasScanData && activeTab === TAB_KEYS.SCANNER && scannerResult && (
            <>
              <EfficiencyAiInsightBlock
                tab="scanner"
                aiProvider={scannerAiProvider}
                onProviderChange={setScannerAiProvider}
                loading={scannerLoading}
                error={scannerError}
                analysis={scannerAnalysis}
                onGenerate={handleScannerGenerate}
              />
              <section className="admin-panel overflow-hidden">
                <SectionTitle
                  title="一级分拣效率（按日合计）"
                  description="按日汇总所有扫描员的一级分拣扫描量与推算有效工时；与下方扫描员汇总、按小时段分布对照。左侧为表，右侧折线图为每日合计效率（票/小时），与表中「效率」列一致。"
                />
                <div className="grid gap-4 p-4 pt-0 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start">
                  <div className="min-w-0">
                    <DataTable
                      boundedScroll
                      columns={scannerDailyColumns}
                      rows={scannerDailyAsTable}
                      emptyText="暂无分拣按日效率。"
                    />
                  </div>
                  <div className="admin-panel min-w-0 overflow-hidden p-4 sm:p-5">
                    <DailyTrendLineChart
                      variant="sortingEfficiency"
                      points={scannerDailyEfficiencyTrendPoints}
                    />
                  </div>
                </div>
              </section>

              <div className="space-y-4">
                <ScannerPersonSortingSummarySection
                  columns={scannerPersonColumns}
                  scannerTotalRows={scannerResult.scannerTotalRows}
                />

                {attendanceResult ? (
                  <ScannerPersonTotalEfficiencySection
                    columns={scannerTotalEfficiencyColumns}
                    rows={scannerTotalEfficiencyRows}
                  />
                ) : (
                  <section className="se-alert-warn overflow-hidden">
                    <SectionTitle
                      bare
                      title="分拣员总效率未启用"
                      description="需同时上传考勤文件，才能计算扫描量 ÷ 总工时的分拣员总效率。"
                    />
                  </section>
                )}

                <ScannerPersonSortingHourlySection
                  expanded={scannerHourlyExpanded}
                  onExpandedChange={(next) => setScannerHourlyExpanded(next)}
                  pivotTables={scannerHourlyPivotTables}
                />
              </div>
            </>
          )}

          {hasScanData && activeTab === TAB_KEYS.SCANNER && !scannerResult && (
            <section className="se-alert-warn overflow-hidden">
              <SectionTitle
                bare
                title="一级分拣模块未启用"
                description="当前到件文件可用于开仓/总体效率，但未满足一级分拣同源列要求。"
              />
              <div className="px-5 py-4 text-sm leading-7">
                一级分拣模块同源列：扫描时间 / 运单号 / 扫描员。
                <br />
                只要这三列可识别，就会自动恢复个人效率统计。
              </div>
            </section>
          )}

          {/* 包裹分配密度 — 不依赖扫描数据，始终可渲染 */}
          {activeTab === TAB_KEYS.FRONT_DESK && (
            <FrontDeskSaturationSection
              densityRows={allocationDensityAsTable}
              clockOutRows={frontDeskClockOutAsTable}
              allocationSourceInfo={vm.allocationSourceInfo}
              loadingAllocationApi={vm.loadingAllocationApi}
              onAllocationFileChange={vm.handleAllocationFileChange}
              onClearAllocation={vm.clearAllocation}
              onApiFetch={vm.handleAllocationApiFetch}
              readOnly={Boolean(vm.snapshotRestore)}
            />
          )}

          {/* 细分错误率分析 — 不依赖扫描数据，始终可渲染 */}
          {activeTab === TAB_KEYS.CANCEL_SCAN && (
            <CancelScanAnalysisSection
              analysis={vm.cancelScanAnalysis}
              loading={vm.loadingCancelScanAnalysis}
              onFetch={vm.handleCancelScanApiFetch}
              zoneInboundScanTotals={vm.zoneInboundScanTotals}
            />
          )}

          {/* 周报生成器 */}
          {hasScanData && activeTab === TAB_KEYS.WEEKLY && (
            <WeeklyReportPanel
              key={weeklyPanelKey}
              scanAggregate={scanAggregate!}
              attendanceResult={attendanceResult}
              scannerResult={scannerResult}
              scanSourceInfo={scanSourceInfo}
              attendanceSourceInfo={attendanceSourceInfo}
              settings={settings}
              dailyCostPerTicketByDate={dailyCostPerTicketByDate}
              dailyTotalLaborCostByDate={dailyTotalLaborCostByDate}
            />
          )}

          {/* 推送 */}
          {hasScanData && showPushTab && activeTab === TAB_KEYS.PUSH && (
            <ScannerEfficiencyPushSection
              vm={{
                attendanceResult,
                scannerResult,
              }}
              level1Push={level1Push}
            />
          )}
        </div>

        {hasScanData && (
          <section className="se-workspace-footer">
            <SectionTitle
              title="统计口径说明"
              description="页面遵循你给的业务规则，并对多文件、跨天数据做了统一处理。"
            />
            <div className="grid gap-3 px-5 pb-5 lg:grid-cols-3">
              <div className="se-rules-card">
                开仓日：分拣人数 &gt; {settings.openDayThreshold}。
                <br />
                不开仓日：分拣人数 ≤ {settings.openDayThreshold}。
                <br />
                脏数据过滤：扫描员单日扫描量 &lt; {settings.minDayScanCount} 票时，该扫描员当日数据不计入效率、汇总与按小时段。
              </div>
              <div className="se-rules-card">
                开仓效率 = 上传总货量 / 统计窗口内「开仓日」考勤总工时。
                <br />
                总体效率 = 上传总货量 / 统计窗口内全部考勤总工时（含不开仓、仅配送等日）。
                <br />
                统计窗口 = 到件最早日 ～ max(到件最迟日, 考勤中不早于最早日的最迟日)。
              </div>
              <div className="se-rules-card">
                日表在到件行之外，追加「统计窗口」内无到件、不开仓的日期（总货量 0，仍显示分拣人数与工时）。分母在窗口内按日汇总。人员表为考勤汇总，不含按票分摊。
                <br />
                菜鸟件：运单号以 3 开头，仅作结构观测（占比），不参与开仓/总体效率计算。
              </div>
            </div>
          </section>
        )}
      </section>

      {attendanceResult && (
        <div
          ref={attendanceTableCaptureRef}
          className="pointer-events-none fixed top-0 left-0 z-[-9999] w-[1280px] max-w-[100vw] -translate-x-full bg-white p-4 pb-8"
          aria-hidden
        >
          <EfficiencyDailyDetailByDaySection
            variant="tableOnly"
            dimension={efficiencyDetailDimension}
            onDimensionChange={handleEfficiencyDetailDimensionChange}
            expandedWeekKeys={efficiencyDetailExpandedWeekKeys}
            onWeekRowClick={handleEfficiencyDetailWeekRowClick}
            attendanceMatchColumns={attendanceMatchColumns}
            attendanceDailyAsTable={attendanceDailyAsTable}
            attendanceWeeklyAsTable={attendanceWeeklyAsTable}
            attendanceDayEfficiencyBubbleData={attendanceDayEfficiencyBubbleData}
            attendanceDailyRows={attendanceResult.dailyRows}
            chartOpenDaysOnly={efficiencyChartOpenDaysOnly}
            onChartOpenDaysOnlyChange={handleEfficiencyChartOpenDaysOnlyChange}
          />
        </div>
      )}

      {attendanceResult && (
        <div
          ref={attendanceChartCaptureRef}
          className="pointer-events-none fixed top-0 left-0 z-[-9999] w-[1280px] max-w-[100vw] -translate-x-full bg-white p-4 pb-8"
          aria-hidden
        >
          <section className="space-y-3">
            <SectionTitle
              eyebrow="Attendance Matching"
              title={`效率明细/天（组合图·${efficiencyDetailDimension === 'week' ? '周维度' : '日维度'}）`}
              description="蓝色柱为总货量（左轴），绿色面积折线为分拣人数（独立比例尺），橙线为当天效率（右轴）。"
            />
            <div className="admin-panel overflow-hidden p-4 sm:p-5">
              <DailyEfficiencyComboChart
                data={chartBubbleData}
                dimension={efficiencyDetailDimension}
                attendanceDailyRows={attendanceResult.dailyRows}
              />
            </div>
          </section>
        </div>
      )}

      {scannerResult && (
        <div
          ref={scannerSummaryCaptureRef}
          className="pointer-events-none fixed top-0 left-0 z-[-9999] w-[1280px] max-w-[100vw] -translate-x-full bg-white p-4 pb-8"
          aria-hidden
        >
          <ScannerPersonSortingSummarySection
            columns={scannerPersonColumns}
            scannerTotalRows={scannerResult.scannerTotalRows}
          />
        </div>
      )}

      {scannerResult && (
        <div
          ref={scannerHourlyCaptureRef}
          className="pointer-events-none fixed top-0 left-0 z-[-9999] w-[1280px] max-w-[100vw] -translate-x-full bg-white p-4 pb-8"
          aria-hidden
        >
          <ScannerPersonSortingHourlySection
            forStaticCapture
            expanded
            onExpandedChange={() => {}}
            pivotTables={scannerHourlyPivotTables}
          />
        </div>
      )}
    </>
  )
}
