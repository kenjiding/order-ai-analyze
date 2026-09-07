import { App as AntdApp, Alert, Button, Tooltip } from 'antd'
import { BarChart2, BrainCircuit, Camera, Eye, Plus, SendHorizonal } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageSectionTabs, type PageSectionTabItem } from '../../components/PageSectionTabs'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { PERMISSION_KEYS, usePermission } from '../../hooks/usePermission'
import { VendorJobsTabContent } from './components/VendorJobsTabContent'
import { EditJobConfigDrawer } from './components/EditJobConfigDrawer'
import { ShareLinkDrawer } from './components/ShareLinkDrawer'
import type { PublicJob } from './vendorAnalysisApi'
import { VendorMetricsPreview } from './components/VendorMetricsPreview'
import { NewAnalysisDrawer } from './components/NewAnalysisDrawer'
import { AnalysisErrorBanner } from './components/AnalysisProgress'
import { useVendorAnalysisPage, type TabId } from './useVendorAnalysisPage'
import { buildVendorSnapshot, saveVendorSnapshot } from './vendorSnapshotStorage'
import { buildVendorAiInputsFromSnapshot, mergeAiSummariesForLocale } from './vendorSnapshotAi'
import { fetchVendorAiSummaries, postDailyReport } from './vendorAnalysisApi'
import { useAppLocale } from '../../i18n/hooks'

export default function VendorAnalysisPage() {
  const { t } = useTranslation('vendorAnalysis')
  const v = useVendorAnalysisPage()
  const { locale } = useAppLocale()
  const { message } = AntdApp.useApp()

  const [aiLoading, setAiLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<PublicJob | null>(null)
  const [sharingJob, setSharingJob] = useState<PublicJob | null>(null)
  const canShare = usePermission(PERMISSION_KEYS.btnVendorAnalysisShare)

  // 预览推送：按当前查看的这份任务自身的推送范围；新建抽屉：按全局 scope（新任务的默认模板）
  const selectedPushCount = v.selectedPushConfigs.length
  const newAnalysisPushCount = v.scopeBinding.enabledPushable.length
  const canTriggerPush = !!v.fetchedData && v.selectedStations.length > 0 && selectedPushCount > 0

  // 指标预览只展示「推送供应商配置」中已勾选的供应商；无勾选时（老任务兜底）展示全部
  const previewMetrics = useMemo(() => {
    if (v.viewedPushEnabledIds.length === 0) return v.vendorMetrics
    const enabledSet = new Set(v.viewedPushEnabledIds)
    return v.vendorMetrics.filter((m) => enabledSet.has(m.id))
  }, [v.vendorMetrics, v.viewedPushEnabledIds])

  const previewDriverPerformanceByVendor = useMemo(() => {
    if (v.viewedPushEnabledIds.length === 0) return v.driverPerformanceByVendor
    const enabledUnitKeys = new Set(previewMetrics.map((m) => m.supplierKey))
    return Object.fromEntries(
      Object.entries(v.driverPerformanceByVendor).filter(([supplierKey]) => enabledUnitKeys.has(supplierKey)),
    )
  }, [v.driverPerformanceByVendor, v.viewedPushEnabledIds, previewMetrics])

  const stationOptions = useGlobalFilterStore((s) => s.stations)
  const stationNameMap = useMemo(
    () => Object.fromEntries(stationOptions.map((s) => [s.value, s.label])),
    [stationOptions],
  )

  // 提交分析：收起抽屉后沿用既有异步获取流程，进度/错误在「分析任务」页就地展示，
  // 成功后 hook 会自动切到「数据预览」。
  const startAnalysis = useCallback(() => {
    setDrawerOpen(false)
    void v.fetchData()
  }, [v])

  const openSnapshot = useCallback(async (autoPush: boolean) => {
    if (!v.fetchedData) return
    if (!v.viewedJobId) { message.warning(t('loadJobFirst')); return }
    if (autoPush && selectedPushCount === 0) {
      message.warning(t('enablePushVendors'))
      return
    }
    const snapshot = buildVendorSnapshot({
      fetchedData: v.fetchedData,
      stations: v.selectedStations,
      vendorMetrics: v.vendorMetrics,
      driverPerformanceByVendor: v.driverPerformanceByVendor,
      configs: v.selectedPushConfigs,
      enabledMetricKeys: v.viewedMetricKeys,
      aiSummaryEnabled: v.viewedAiSummaryEnabled,
      jobId: v.viewedJobId,
    })
    // AI 总开关关闭时完全不调用 AI 接口；开启时输入与快照渲染共用同一套勾选过滤
    if (v.viewedAiSummaryEnabled) {
      setAiLoading(true)
      try {
        const inputs = buildVendorAiInputsFromSnapshot(snapshot.vendors, v.viewedMetricSet)
        const result = await fetchVendorAiSummaries(inputs, locale, v.viewedMetricKeys)
        if (result.ok) {
          snapshot.aiSummaries = mergeAiSummariesForLocale(undefined, locale, result.data)
        }
      } finally {
        setAiLoading(false)
      }
    }
    saveVendorSnapshot(snapshot)
    // 发布日报到服务端（按本任务 jobId 绑定），供外部供应商分享链接读取；失败不阻断快照页打开，但明确提示
    void postDailyReport(v.viewedJobId, snapshot).then((result) => {
      if (!result.ok) {
        message.warning(t('dailyReportFailed', { error: result.error }))
      }
    })
    window.open(autoPush ? '/vendor-snapshot?autoPush=1' : '/vendor-snapshot', '_blank')
  }, [v.fetchedData, v.viewedJobId, v.selectedStations, v.vendorMetrics, v.driverPerformanceByVendor, v.selectedPushConfigs, v.viewedMetricKeys, v.viewedMetricSet, v.viewedAiSummaryEnabled, selectedPushCount, locale, message, t])

  const pushBtnTooltip = !v.fetchedData
    ? t('fetchDataFirst')
    : v.selectedStations.length === 0
      ? t('selectStationFirst')
      : selectedPushCount === 0
        ? t('enablePushVendors')
        : t('pushAfterScreenshot')

  const tabItems: PageSectionTabItem[] = useMemo(
    () => [
      {
        id: 'analyze',
        label: t('tabAnalyze'),
        icon: BarChart2,
        badge: v.activeJobCount > 0 ? String(v.activeJobCount) : undefined,
      },
      { id: 'preview', label: t('tabPreview'), icon: Eye },
    ],
    [t, v.activeJobCount],
  )

  return (
    <div className="vendor-analysis-page admin-page space-y-5">
      {/* 页面标题 */}
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">{t('eyebrow')}</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <BarChart2 className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              {t('title')}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{t('description')}</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <div className="text-xs text-slate-500">{t('pushConfigTotal')}</div>
            <div className="text-xl font-semibold tabular-nums text-slate-950">
              {v.configs.length}
            </div>
          </div>
        </div>

        <PageSectionTabs
          activeId={v.activeTab}
          onChange={(id) => v.setActiveTab(id as TabId)}
          items={tabItems}
        />
      </div>

      {/* Tab A：新建分析入口 + 任务队列 */}
      {v.activeTab === 'analyze' && (
        <>
          {!v.dataFetching && v.jobError && (
            <AnalysisErrorBanner error={v.jobError} onRetry={startAnalysis} />
          )}

          <VendorJobsTabContent
            jobs={v.jobsList}
            isLoading={v.isJobsLoading}
            loadingJobId={v.loadingJobId}
            onRefresh={() => void v.refreshJobs()}
            onLoadResults={(jobId) => void v.loadJobResults(jobId)}
            onEdit={(job) => setEditingJob(job)}
            onShare={canShare ? (job) => setSharingJob(job) : undefined}
            onCancel={(jobId) => void v.cancelJobById(jobId)}
            onDelete={(jobId) => void v.deleteJobById(jobId)}
            onRetry={(job) => void v.retryJob(job)}
            stationNameMap={stationNameMap}
            headerAction={
              <Button
                type="primary"
                icon={<Plus className="h-4 w-4" />}
                loading={v.dataFetching}
                onClick={() => setDrawerOpen(true)}
              >
                {t('newAnalysis')}
              </Button>
            }
          />
        </>
      )}

      {/* Tab B：数据预览（只读回放）+ 快照/推送操作 */}
      {v.activeTab === 'preview' && (
        !v.fetchedData ? (
          <div className="admin-panel px-6 py-16 text-center">
            <Eye className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
            <p className="mt-3 text-sm text-slate-500">{t('noPreviewData')}</p>
            <Button className="mt-4" onClick={() => v.setActiveTab('analyze')}>
              {t('goAnalyzeTab')}
            </Button>
          </div>
        ) : (
          <>
            {/* 快照 / 推送操作栏 */}
            <div className="admin-panel overflow-hidden">
              <div className="admin-section-title flex flex-wrap items-center justify-between gap-3 bg-[var(--admin-surface-soft)]">
                <div>
                  <div className="admin-eyebrow">{t('snapshotPushEyebrow')}</div>
                  <h3 className="admin-title mt-0.5 text-base">{t('snapshotPushTitle')}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {t('snapshotPushHint', { count: selectedPushCount })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Tooltip
                    title={
                      aiLoading
                        ? t('aiAnalyzing')
                        : v.viewedAiSummaryEnabled
                          ? t('previewSnapshotTooltipAi')
                          : t('previewSnapshotTooltipNoAi')
                    }
                  >
                    <span>
                      <Button
                        icon={aiLoading ? <BrainCircuit className="h-4 w-4 animate-pulse" /> : <Camera className="h-4 w-4" />}
                        disabled={aiLoading}
                        loading={aiLoading}
                        onClick={() => void openSnapshot(false)}
                      >
                        {aiLoading ? t('aiAnalyzing') : t('previewSnapshot')}
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip title={aiLoading ? t('aiAnalyzingWait') : pushBtnTooltip}>
                    <span>
                      <Button
                        type="primary"
                        icon={aiLoading ? <BrainCircuit className="h-4 w-4 animate-pulse" /> : <SendHorizonal className="h-4 w-4" />}
                        disabled={!canTriggerPush || aiLoading}
                        loading={aiLoading}
                        onClick={() => void openSnapshot(true)}
                      >
                        {aiLoading ? t('aiAnalyzing') : t('pushToFeishu')}
                      </Button>
                    </span>
                  </Tooltip>
                </div>
              </div>

              {v.selectedStations.length === 0 && (
                <div className="border-b border-[var(--admin-line)] px-5 py-3">
                  <Alert
                    type="warning"
                    showIcon
                    message={t('noStationWarning')}
                    className="text-xs"
                  />
                </div>
              )}
            </div>

            {/* 指标预览（仅展示推送供应商配置中已勾选的供应商） */}
            <VendorMetricsPreview
              metrics={previewMetrics}
              fetchedData={v.fetchedData}
              hasStations={v.selectedStations.length > 0}
              driverPerformanceByVendor={previewDriverPerformanceByVendor}
              enabledMetricKeys={v.viewedMetricSet}
            />
          </>
        )
      )}

      <NewAnalysisDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        referenceDate={v.referenceDate}
        onReferenceDateChange={v.setReferenceDate}
        complaintDateRange={v.complaintDateRange}
        onComplaintDateRangeChange={v.setComplaintDateRange}
        metricSelection={v.metricSelection}
        onMetricSelectionChange={v.setMetricSelection}
        referenceDateIsToday={v.isReferenceDateToday}
        aiSummaryEnabled={v.aiSummaryEnabled}
        onAiSummaryEnabledChange={v.setAiSummaryEnabled}
        selectedStations={v.selectedStations}
        catalogConfigs={v.catalog.configs}
        catalogLoading={v.catalog.loading}
        scopeBinding={v.scopeBinding}
        enabledPushCount={newAnalysisPushCount}
        dataFetching={v.dataFetching}
        onStart={startAnalysis}
      />

      <EditJobConfigDrawer
        open={!!editingJob}
        onClose={() => setEditingJob(null)}
        job={editingJob}
        catalogConfigs={v.catalog.configs}
        onSave={v.updateJobConfig}
      />

      <ShareLinkDrawer
        key={sharingJob?.id ?? 'none'}
        open={!!sharingJob}
        onClose={() => setSharingJob(null)}
        jobId={sharingJob?.id ?? null}
      />
    </div>
  )
}
