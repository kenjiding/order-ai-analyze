import { Tabs, Tooltip } from 'antd'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('scannerEfficiency')
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
      setWarehouseError(err instanceof Error ? err.message : t('ai.failed'))
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
      setScannerError(err instanceof Error ? err.message : t('ai.failed'))
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
      <Tooltip title={t('tabs.needsAttendance')} placement="bottom">
        <span>{label}</span>
      </Tooltip>
    )
    const attendanceTab = (key: TabKey, label: string) => ({
      key,
      label: hasAttendance ? label : disabledLabel(label),
      disabled: !hasAttendance,
    })
    const items: { key: TabKey; label: ReactNode; disabled?: boolean }[] = [
      attendanceTab(TAB_KEYS.WAREHOUSE, t('tabs.warehouse')),
      // 一级分拣仅依赖到件扫描，不要求考勤
      { key: TAB_KEYS.SCANNER, label: t('tabs.scanner') },
      { key: TAB_KEYS.FRONT_DESK, label: t('tabs.frontDesk') },
      { key: TAB_KEYS.CANCEL_SCAN, label: t('tabs.cancelScan') },
      attendanceTab(TAB_KEYS.WEEKLY, t('tabs.weekly')),
    ]
    if (showPushTab) {
      items.push(attendanceTab(TAB_KEYS.PUSH, t('tabs.push')))
    }
    return items
  }, [attendanceResult, showPushTab, t])

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
                <h2 className="se-section-title mt-0">{t('empty.loadInboundFirst')}</h2>
                <p className="se-section-desc">
                  {t('empty.loadInboundDesc')}
                </p>
              </div>
              <div className="se-empty-steps px-5 pb-5">
                <div className="se-empty-step">
                  <div className="se-empty-step-num">1</div>
                  {t('empty.step1')}
                </div>
                <div className="se-empty-step">
                  <div className="se-empty-step-num">2</div>
                  {t('empty.step2')}
                </div>
                <div className="se-empty-step">
                  <div className="se-empty-step-num">3</div>
                  {t('empty.step3')}
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
                title={t('section.dailyVolumeTitle')}
                description={t('section.dailyVolumeDesc')}
              />
              <div className="grid gap-4 p-4 pt-0 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start">
                <div className="min-w-0">
                  <DataTable
                    boundedScroll
                    columns={dailyVolumeColumns}
                    rows={dailyRowsAsTable}
                    emptyText={t('empty.noInboundData')}
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
                  title={t('section.personHoursTitle')}
                  description={t('section.personHoursDesc')}
                />
                <div className="overflow-x-auto p-4 pt-0">
                  <DataTable
                    columns={attendancePersonColumns}
                    rows={attendancePersonAsTable}
                    emptyText={t('empty.noPersonHours')}
                  />
                </div>
              </section>
            </>
          )}

          {hasScanData && activeTab === TAB_KEYS.WAREHOUSE && !attendanceResult && (
            <section className="se-alert-warn overflow-hidden">
              <SectionTitle
                bare
                title={t('section.warehouseDisabledTitle')}
                description={t('section.warehouseDisabledDesc')}
              />
              <div className="px-5 py-4 text-sm leading-7">
                {t('section.warehouseDisabledBody')}
                <br />
                {t('section.warehouseDisabledStats', {
                  valid: formatInteger(attendanceSourceInfo.rowCount),
                  dropped: formatInteger(attendanceSourceInfo.droppedRows),
                })}
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
                  title={t('section.sortingDailyTitle')}
                  description={t('section.sortingDailyDesc')}
                />
                <div className="grid gap-4 p-4 pt-0 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start">
                  <div className="min-w-0">
                    <DataTable
                      boundedScroll
                      columns={scannerDailyColumns}
                      rows={scannerDailyAsTable}
                      emptyText={t('empty.noSortingDaily')}
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

                {attendanceResult && (
                  <ScannerPersonTotalEfficiencySection
                    columns={scannerTotalEfficiencyColumns}
                    rows={scannerTotalEfficiencyRows}
                  />
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
                title={t('section.sortingDisabledTitle')}
                description={t('section.sortingDisabledDesc')}
              />
              <div className="px-5 py-4 text-sm leading-7">
                {t('section.sortingDisabledBody')}
                <br />
                {t('section.sortingDisabledHint')}
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
              title={t('section.rulesTitle')}
              description={t('section.rulesDesc')}
            />
            <div className="grid gap-3 px-5 pb-5 lg:grid-cols-3">
              <div className="se-rules-card">
                {t('section.rulesOpenDay', { threshold: settings.openDayThreshold })}
                <br />
                {t('section.rulesNonOpenDay', { threshold: settings.openDayThreshold })}
              </div>
              <div className="se-rules-card">
                {t('section.rulesOpenEfficiency')}
                <br />
                {t('section.rulesOverallEfficiency')}
                <br />
                {t('section.rulesWindow')}
              </div>
              <div className="se-rules-card">
                {t('section.rulesDailyTable')}
                <br />
                {t('section.rulesCainiao')}
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
              title={t('section.efficiencyDetailComboTitle', { dimension: efficiencyDetailDimension === 'week' ? t('dimension.week') : t('dimension.day') })}
              description={t('section.efficiencyDetailComboDesc')}
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
