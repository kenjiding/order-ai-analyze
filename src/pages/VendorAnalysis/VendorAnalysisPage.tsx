import { App as AntdApp, Button, Tooltip, Typography } from 'antd'
import { BarChart2, BrainCircuit, Camera, ExternalLink, Layers, SendHorizonal } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageSectionTabs, type PageSectionTabItem } from '../../components/PageSectionTabs'
import { SupplierPushConfigPanel } from '../../shared/supplierPushConfig'
import { PERMISSION_KEYS, usePermission } from '../../hooks/usePermission'
import { VendorFilterPanel } from './components/VendorFilterPanel'
import { VendorJobsTabContent } from './components/VendorJobsTabContent'
import { VendorMetricsPreview } from './components/VendorMetricsPreview'
import { useVendorShareLinks, buildVendorShareLinkColumn } from './components/VendorShareLinkColumn'
import { MetricConfigPanel } from './components/MetricConfigPanel'
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
  const canShare = usePermission(PERMISSION_KEYS.btnVendorAnalysisShare)
  const shareLinks = useVendorShareLinks(canShare, v.fetchedData?.before11Date ?? null)
  const { refetch: refetchShareLinks } = shareLinks

  const selectedPushCount = v.selectedPushConfigs.length
  const canTriggerPush = !!v.fetchedData && v.selectedStations.length > 0 && selectedPushCount > 0

  const openSnapshot = useCallback(async (autoPush: boolean) => {
    if (!v.fetchedData) return
    if (autoPush && selectedPushCount === 0) {
      message.warning('请先在下方启用要推送的供应商')
      return
    }
    const snapshot = buildVendorSnapshot({
      fetchedData: v.fetchedData,
      stations: v.selectedStations,
      vendorMetrics: v.vendorMetrics,
      driverPerformanceByVendor: v.driverPerformanceByVendor,
      configs: v.selectedPushConfigs,
      enabledMetricKeys: v.metricPrefs.enabledKeys,
      aiSummaryEnabled: v.metricPrefs.aiSummaryEnabled,
    })
    // AI 总开关关闭时完全不调用 AI 接口；开启时输入与快照渲染共用同一套勾选过滤
    if (v.metricPrefs.aiSummaryEnabled) {
      setAiLoading(true)
      try {
        const inputs = buildVendorAiInputsFromSnapshot(snapshot.vendors, v.metricPrefs.enabledSet)
        const result = await fetchVendorAiSummaries(inputs, locale, v.metricPrefs.enabledKeys)
        if (result.ok) {
          snapshot.aiSummaries = mergeAiSummariesForLocale(undefined, locale, result.data)
        }
      } finally {
        setAiLoading(false)
      }
    }
    saveVendorSnapshot(snapshot)
    // 发布日报到服务端，供外部供应商分享链接读取；失败不阻断快照页打开，但明确提示
    void postDailyReport(snapshot).then((result) => {
      if (!result.ok) {
        message.warning(`日报发布失败，外部分享链接数据未更新：${result.error}`)
        return
      }
      refetchShareLinks()
    })
    window.open(autoPush ? '/vendor-snapshot?autoPush=1' : '/vendor-snapshot', '_blank')
  }, [v.fetchedData, v.selectedStations, v.vendorMetrics, v.driverPerformanceByVendor, v.selectedPushConfigs, v.metricPrefs, selectedPushCount, locale, message, refetchShareLinks])

  const pushBtnTooltip = !v.fetchedData
    ? '请先点击「获取数据」'
    : v.selectedStations.length === 0
      ? '请先选择责任站点'
      : selectedPushCount === 0
        ? '请先在下方启用要推送的供应商'
        : '截图后推送到已启用的供应商飞书群'

  const tabItems: PageSectionTabItem[] = [
    { id: 'analyze', label: '供应商数据分析', icon: BarChart2 },
    {
      id: 'jobs',
      label: '任务队列',
      icon: Layers,
      badge: v.activeJobCount > 0 ? String(v.activeJobCount) : undefined,
    },
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
              选择时间范围并获取数据后，点击「供应商数据分析推送」将指标发送至各飞书群。
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

      {v.activeTab === 'jobs' && (
        <VendorJobsTabContent
          jobs={v.jobsList}
          isLoading={v.isJobsLoading}
          loadingJobId={v.loadingJobId}
          onRefresh={() => void v.refreshJobs()}
          onLoadResults={(jobId) => void v.loadJobResults(jobId)}
          onCancel={(jobId) => void v.cancelJobById(jobId)}
          onDelete={(jobId) => void v.deleteJobById(jobId)}
          onRetry={(job) => void v.retryJob(job)}
        />
      )}

      {v.activeTab === 'analyze' && (
        <>
          {/* 筛选区 */}
          <VendorFilterPanel
            referenceDate={v.referenceDate}
            onReferenceDateChange={v.setReferenceDate}
            complaintDateRange={v.complaintDateRange}
            onComplaintDateRangeChange={v.setComplaintDateRange}
            fetchedData={v.fetchedData}
            dataFetching={v.dataFetching}
            onFetchData={() => void v.fetchData()}
            jobProgress={v.jobProgress}
            jobError={v.jobError}
            jobReused={v.jobReused}
            missingMetricLabels={v.missingMetricLabels}
            extra={
              <MetricConfigPanel
                loading={v.metricPrefs.loading}
                saving={v.metricPrefs.saving}
                value={v.metricPrefs.value}
                onSave={v.metricPrefs.save}
                referenceDateIsToday={v.isReferenceDateToday}
              />
            }
          />

          {/* 指标预览（含各供应商的司机派件表现） */}
          {v.fetchedData && (
            <VendorMetricsPreview
              metrics={v.vendorMetrics}
              fetchedData={v.fetchedData}
              hasStations={v.selectedStations.length > 0}
              driverPerformanceByVendor={v.driverPerformanceByVendor}
              enabledMetricKeys={v.metricPrefs.enabledSet}
            />
          )}

          {/* 推送配置管理 */}
          <div className="admin-panel overflow-hidden">
            <div className="admin-section-title flex flex-wrap items-center justify-between gap-3 bg-[var(--admin-surface-soft)]">
              <div>
                <div className="admin-eyebrow">Push Configs</div>
                <h3 className="admin-title mt-0.5 text-base">供应商配置</h3>
                <p className="mt-1 text-xs text-slate-500">
                  统一在「飞书推送 → 车队供应商推送」维护 Webhook；本页「启用/禁用」控制是否参与数据分析推送。
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs tabular-nums text-slate-500">
                  已启用 {selectedPushCount} / {v.configs.length}
                </span>
                <Tooltip
                  title={
                    !v.fetchedData
                      ? '请先获取数据'
                      : aiLoading
                        ? 'AI 分析中...'
                        : v.metricPrefs.aiSummaryEnabled
                          ? '预览截图落地页（不自动推送）'
                          : '预览截图落地页（AI 分析已在指标配置中关闭）'
                  }
                >
                  <span>
                    <Button
                      icon={aiLoading ? <BrainCircuit className="h-4 w-4 animate-pulse" /> : <Camera className="h-4 w-4" />}
                      disabled={!v.fetchedData || aiLoading}
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
                <Link to="/push-notifications">
                  <Button icon={<ExternalLink className="h-4 w-4" />}>维护供应商配置</Button>
                </Link>
              </div>
            </div>

            {!v.fetchedData && (
              <div className="border-b border-[var(--admin-line)] bg-amber-50 px-5 py-2">
                <Typography.Text type="warning" className="text-xs">
                  提示：请在上方筛选条件区选择时间范围后点击「获取数据」，再进行推送。
                </Typography.Text>
              </div>
            )}

            <div className="px-5 py-4">
              <SupplierPushConfigPanel
                embedded
                configs={v.catalog.configs}
                loading={v.catalog.loading || v.scopeBinding.loading}
                scopeBinding={{
                  scopeKey: 'vendor-analysis.push',
                  enabledIds: v.scopeBinding.enabledIds,
                  onToggle: v.scopeBinding.toggle,
                  togglingId: v.scopeBinding.togglingId,
                  saving: v.scopeBinding.saving,
                }}
                extraColumns={canShare ? buildVendorShareLinkColumn(shareLinks) : []}
                scrollX={canShare ? 1200 : 960}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
