import { App as AntdApp, Alert, Button, Tooltip } from 'antd'
import { BarChart2, BrainCircuit, Camera, Eye, Plus, SendHorizonal } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
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
    if (!v.viewedJobId) { message.warning('请先从任务队列「查看数据」载入一条任务'); return }
    if (autoPush && selectedPushCount === 0) {
      message.warning('请先在「新建分析任务」中启用要推送的供应商')
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
        message.warning(`日报发布失败，外部分享链接数据未更新：${result.error}`)
      }
    })
    window.open(autoPush ? '/vendor-snapshot?autoPush=1' : '/vendor-snapshot', '_blank')
  }, [v.fetchedData, v.viewedJobId, v.selectedStations, v.vendorMetrics, v.driverPerformanceByVendor, v.selectedPushConfigs, v.viewedMetricKeys, v.viewedMetricSet, v.viewedAiSummaryEnabled, selectedPushCount, locale, message])

  const pushBtnTooltip = !v.fetchedData
    ? '请先获取数据'
    : v.selectedStations.length === 0
      ? '请先选择责任站点'
      : selectedPushCount === 0
        ? '请先在「新建分析任务」中启用要推送的供应商'
        : '截图后推送到已启用的供应商飞书群'

  const tabItems: PageSectionTabItem[] = [
    {
      id: 'analyze',
      label: '分析任务',
      icon: BarChart2,
      badge: v.activeJobCount > 0 ? String(v.activeJobCount) : undefined,
    },
    { id: 'preview', label: '数据预览', icon: Eye },
  ]

  return (
    <div className="vendor-analysis-page admin-page space-y-5">
      {/* 页面标题 */}
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">Analytics</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <BarChart2 className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              供应商数据分析
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              在「分析任务」点击「新建分析任务」配置并发起分析，完成后自动进入「数据预览」查看与推送。
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <div className="text-xs text-slate-500">推送配置总数</div>
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
                新建分析任务
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
            <p className="mt-3 text-sm text-slate-500">
              还没有可预览的数据。请到「分析任务」新建分析，或从任务队列点「查看数据」。
            </p>
            <Button className="mt-4" onClick={() => v.setActiveTab('analyze')}>
              去「分析任务」
            </Button>
          </div>
        ) : (
          <>
            {/* 快照 / 推送操作栏 */}
            <div className="admin-panel overflow-hidden">
              <div className="admin-section-title flex flex-wrap items-center justify-between gap-3 bg-[var(--admin-surface-soft)]">
                <div>
                  <div className="admin-eyebrow">Snapshot & Push</div>
                  <h3 className="admin-title mt-0.5 text-base">快照与推送</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    确认下方数据无误后，预览快照或截图推送到已启用的 {selectedPushCount} 个供应商飞书群。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Tooltip
                    title={
                      aiLoading
                        ? 'AI 分析中...'
                        : v.viewedAiSummaryEnabled
                          ? '预览截图落地页（不自动推送）'
                          : '预览截图落地页（AI 分析已关闭）'
                    }
                  >
                    <span>
                      <Button
                        icon={aiLoading ? <BrainCircuit className="h-4 w-4 animate-pulse" /> : <Camera className="h-4 w-4" />}
                        disabled={aiLoading}
                        loading={aiLoading}
                        onClick={() => void openSnapshot(false)}
                      >
                        {aiLoading ? 'AI 分析中...' : '预览快照'}
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip title={aiLoading ? 'AI 分析中，请稍候' : pushBtnTooltip}>
                    <span>
                      <Button
                        type="primary"
                        icon={aiLoading ? <BrainCircuit className="h-4 w-4 animate-pulse" /> : <SendHorizonal className="h-4 w-4" />}
                        disabled={!canTriggerPush || aiLoading}
                        loading={aiLoading}
                        onClick={() => void openSnapshot(true)}
                      >
                        {aiLoading ? 'AI 分析中...' : '截图并推送到飞书'}
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
                    message="当前未选择责任站点，指标将按全部站点统计。"
                    className="text-xs"
                  />
                </div>
              )}
            </div>

            {/* 指标预览（含各供应商的司机派件表现） */}
            <VendorMetricsPreview
              metrics={v.vendorMetrics}
              fetchedData={v.fetchedData}
              hasStations={v.selectedStations.length > 0}
              driverPerformanceByVendor={v.driverPerformanceByVendor}
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
