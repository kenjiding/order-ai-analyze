import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import type { ScannerLevel1FeishuPush } from '../useScannerLevel1FeishuPush'
import { TAB_KEYS, type TabKey } from '../constants'
import DailyTrendLineChart from '../DailyTrendLineChart'
import DailyEfficiencyComboChart from '../DailyEfficiencyBubbleChart'
import { EfficiencyDailyDetailByDaySection } from '../EfficiencyDailyDetailByDaySection'
import { formatInteger } from '../formatAndParse'
import WeeklyReportPanel from '../WeeklyReportPanel'
import { FrontDeskSaturationSection } from './FrontDeskSaturationSection'
import { ScannerPersonSortingHourlySection } from './ScannerPersonSortingHourlySection'
import { ScannerPersonSortingSummarySection } from './ScannerPersonSortingSummarySection'
import type { ScannerEfficiencyViewModel } from '../useScannerEfficiencyPage'
import { DataTable, Metric, SectionTitle } from './ui'

type Props = {
  vm: ScannerEfficiencyViewModel
  level1Push: ScannerLevel1FeishuPush
}

export default function ScannerEfficiencyBody({ vm, level1Push }: Props) {
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
    frontDeskResult,
    activeTab,
    setActiveTab,
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
    hasScanData,
    dailyRowsAsTable,
    dailyVolumeTrendPoints,
    attendanceDayEfficiencyBubbleData,
    attendanceDailyAsTable,
    attendancePersonAsTable,
    frontDeskDailyAsTable,
    frontDeskDensityAsTable,
    scannerDailyAsTable,
    scannerHourlyPivotTables,
    scannerDailyEfficiencyTrendPoints,
    dailyCostPerTicketByDate,
  } = vm

  return (
    <>
      {loading && (
        <section className="admin-panel px-5 py-4 text-sm text-slate-600">
          正在读取并计算，请稍候…
        </section>
      )}

      {error && (
        <section className="rounded-lg border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {error}
        </section>
      )}

      {!hasScanData && !loading && !error && (
        <section className="admin-panel overflow-hidden">
          <SectionTitle
            eyebrow="Start Here"
            title="先上传到件扫描文件"
            description="可同时选多个到件扫描表，或分多次追加；合并去重后再按日期汇总货量，并根据是否上传考勤文件决定效率口径。"
          />
          <div className="grid gap-3 p-5 lg:grid-cols-3">
            <div className="rounded-lg bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
              只上传到件文件：先得到按日货量，若含「扫描员」可自动算分拣效率。支持多文件合并（单次多选或多次追加），运单号重复时保留最早扫描记录。
            </div>
            <div className="rounded-lg bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
              同时上传考勤：自动输出开仓效率与总体效率。
            </div>
            <div className="rounded-lg bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
              日期自动匹配：按到件文件日期去找对应考勤日期。
            </div>
          </div>
        </section>
      )}

      {hasScanData && scanAggregate && (
        <>
          <section>
            <Tabs
              value={activeTab}
              onChange={(_, next) => setActiveTab(next as TabKey)}
              textColor="primary"
              indicatorColor="primary"
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                minHeight: 48,
                px: 0.5,
                '& .MuiTabs-indicator': { height: 3, borderRadius: '0.5rem 0.5rem 0 0' },
                '& .MuiTab-root': { minHeight: 48, px: 2 },
              }}
            >
              <Tab label="开仓效率 / 总体效率" value={TAB_KEYS.WAREHOUSE} />
              <Tab label="一级分拣个人效率" value={TAB_KEYS.SCANNER} />
              <Tab label="前台饱和度分析" value={TAB_KEYS.FRONT_DESK} />
              <Tab label="周报生成器" value={TAB_KEYS.WEEKLY} />
            </Tabs>
          </section>

          {summaryMetrics.length > 0 && activeTab !== TAB_KEYS.WEEKLY && (
            <>
              <section
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
                    tone={index === 0 ? 'dark' : metric.tone ?? 'light'}
                  />
                ))}
              </section>
            </>
          )}

          {activeTab !== TAB_KEYS.WEEKLY && (
            <>
              {activeTab === TAB_KEYS.WAREHOUSE && (
                <section className="space-y-4">
                  <SectionTitle
                    eyebrow="Inbound Volume"
                    title="到件货量按日"
                    description="左侧为按日汇总表。右侧折线仅反映各日总货量（票）趋势，与表中「总货量」列一致。文件合并后先按运单号全局去重，再按日统计。"
                  />
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start">
                    <div className="min-w-0 px-4">
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

              {activeTab === TAB_KEYS.WAREHOUSE && attendanceResult && (
                <>
                  <EfficiencyDailyDetailByDaySection
                    variant="full"
                    attendanceMatchColumns={attendanceMatchColumns}
                    attendanceDailyAsTable={attendanceDailyAsTable}
                    attendanceDayEfficiencyBubbleData={attendanceDayEfficiencyBubbleData}
                  />

                  <section className="space-y-4">
                    <SectionTitle
                      eyebrow="Person Hours"
                      title="人员工时汇总"
                      description="按人员汇总统计窗口内（含无到件补录日）的考勤总工时、活跃与开仓参与天数。扫描量为一级分拣同源个人总票数（与「扫描员一级分拣效率汇总」一致）；在岗效率为扫描量÷总工时(小时)。扫描量与一级分拣效率均按「扫描员」与人员/昵称等名称匹配（忽略大小写）；扫描员为多级编码（如 ADL-DC-Abc）时，末段与考勤「昵称」（如 Abc）对应。无匹配时显示为 —。"
                    />
                    <div className="overflow-x-auto px-4">
                      <DataTable
                        columns={attendancePersonColumns}
                        rows={attendancePersonAsTable}
                        emptyText="暂无人员工时数据。"
                      />
                    </div>
                  </section>
                </>
              )}

              {activeTab === TAB_KEYS.SCANNER && scannerResult && (
                <>
                  <section className="space-y-4">
                    <SectionTitle
                      eyebrow="Scanner Efficiency"
                      title="一级分拣效率（按日合计）"
                      description="按日汇总所有扫描员的一级分拣扫描量与推算有效工时；与下方扫描员汇总、按小时段分布对照。左侧为表，右侧折线图为每日合计效率（票/小时），与表中「效率」列一致。"
                    />
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] xl:items-start">
                      <div className="min-w-0 px-4">
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

                  <div className="overflow-visible space-y-4 rounded-lg pb-8">
                    <div className="overflow-visible rounded-lg pb-2">
                      <ScannerPersonSortingSummarySection
                        columns={scannerPersonColumns}
                        scannerTotalRows={scannerResult.scannerTotalRows}
                      />
                    </div>

                    <div className="overflow-visible rounded-lg pb-2">
                      <ScannerPersonSortingHourlySection
                        expanded={scannerHourlyExpanded}
                        onExpandedChange={(next) => setScannerHourlyExpanded(next)}
                        pivotTables={scannerHourlyPivotTables}
                      />
                    </div>
                  </div>
                </>
              )}

              {activeTab === TAB_KEYS.FRONT_DESK && (
                <FrontDeskSaturationSection
                  result={frontDeskResult}
                  dailyRows={frontDeskDailyAsTable}
                  densityRows={frontDeskDensityAsTable}
                  afternoonStartHour={settings.frontDeskAfternoonStartHour}
                  allocationSourceInfo={vm.allocationSourceInfo}
                  onAllocationFileChange={vm.handleAllocationFileChange}
                  onClearAllocation={vm.clearAllocation}
                />
              )}
            </>
          )}

          {activeTab === TAB_KEYS.SCANNER && !scannerResult && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
              <SectionTitle
                eyebrow="Scanner Module"
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

          {activeTab === TAB_KEYS.WAREHOUSE && !attendanceResult && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
              <SectionTitle
                eyebrow="Warehouse Mode"
                title="开仓效率 / 总体效率模块未启用"
                description="当前尚未上传可识别的考勤数据，无法计算工时口径效率。"
              />
              <div className="px-5 py-4 text-sm leading-7">
                请上传“考勤记录报表.csv”或同结构文件（至少包含日期、总时长、人员），即可启用该标签页。
                <br />
                当前考勤识别：有效 {formatInteger(attendanceSourceInfo.rowCount)} 行，未识别{' '}
                {formatInteger(attendanceSourceInfo.droppedRows)} 行。
              </div>
            </section>
          )}

          {activeTab === TAB_KEYS.FRONT_DESK && !attendanceResult && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
              <SectionTitle
                eyebrow="Front Desk Mode"
                title="前台饱和度模块未启用"
                description="当前尚未上传可识别的考勤数据，无法识别前台/分拣下班基准。"
              />
              <div className="px-5 py-4 text-sm leading-7">
                请先上传“考勤记录报表.csv”或同结构文件（至少包含日期、总时长、人员），再在本标签页上传前台分配包裹表。
                <br />
                当前考勤识别：有效 {formatInteger(attendanceSourceInfo.rowCount)} 行，未识别{' '}
                {formatInteger(attendanceSourceInfo.droppedRows)} 行。
              </div>
            </section>
          )}

          {activeTab === TAB_KEYS.WEEKLY && (
            <WeeklyReportPanel
              key={weeklyPanelKey}
              scanAggregate={scanAggregate}
              attendanceResult={attendanceResult}
              scannerResult={scannerResult}
              scanSourceInfo={scanSourceInfo}
              attendanceSourceInfo={attendanceSourceInfo}
              settings={settings}
              dailyCostPerTicketByDate={dailyCostPerTicketByDate}
            />
          )}

          {/* ── 独立隐藏捕获区域：效率明细/天（表） ── */}
          {attendanceResult && (
            <div
              ref={attendanceTableCaptureRef}
              className="pointer-events-none fixed top-0 left-0 z-[-9999] w-[1280px] max-w-[100vw] -translate-x-full bg-white p-4 pb-8"
              aria-hidden
            >
              <EfficiencyDailyDetailByDaySection
                variant="tableOnly"
                attendanceMatchColumns={attendanceMatchColumns}
                attendanceDailyAsTable={attendanceDailyAsTable}
                attendanceDayEfficiencyBubbleData={attendanceDayEfficiencyBubbleData}
              />
            </div>
          )}

          {/* ── 独立隐藏捕获区域：效率明细/天（图） ── */}
          {attendanceResult && (
            <div
              ref={attendanceChartCaptureRef}
              className="pointer-events-none fixed top-0 left-0 z-[-9999] w-[1280px] max-w-[100vw] -translate-x-full bg-white p-4 pb-8"
              aria-hidden
            >
              <section className="space-y-3">
                <SectionTitle
                  eyebrow="Attendance Matching"
                  title="效率明细/天（组合图）"
                  description="蓝色柱为总货量（左轴），绿色面积折线为总工时（独立比例尺），橙线为当天效率（右轴）。"
                />
                <div className="admin-panel overflow-hidden p-4 sm:p-5">
                  <DailyEfficiencyComboChart data={attendanceDayEfficiencyBubbleData} />
                </div>
              </section>
            </div>
          )}

          {/* ── 独立隐藏捕获区域：扫描员汇总 ── */}
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

          {/* ── 独立隐藏捕获区域：按小时段 ── */}
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

          <section className="admin-panel overflow-hidden">
            <SectionTitle
              eyebrow="Rules"
              title="统计口径说明"
              description="页面遵循你给的业务规则，并对多文件、跨天数据做了统一处理。"
            />
            <div className="grid gap-3 p-5 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
                开仓日：分拣人数 &gt; {settings.openDayThreshold}。
                <br />
                不开仓日：分拣人数 ≤ {settings.openDayThreshold}。
                <br />
                脏数据过滤：扫描员单日扫描量 &lt; {settings.minDayScanCount} 票时，该扫描员当日数据不计入效率、汇总与按小时段。
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
                开仓效率 = 上传总货量 / 统计窗口内「开仓日」考勤总工时。
                <br />
                总体效率 = 上传总货量 / 统计窗口内全部考勤总工时（含不开仓、仅配送等日）。
                <br />
                统计窗口 = 到件最早日 ～ max(到件最迟日, 考勤中不早于最早日的最迟日)。
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
                日表在到件行之外，追加「统计窗口」内无到件、不开仓的日期（总货量 0，仍显示分拣人数与工时）。分母在窗口内按日汇总。人员表为考勤汇总，不含按票分摊。
              </div>
            </div>
          </section>
        </>
      )}
    </>
  )
}
