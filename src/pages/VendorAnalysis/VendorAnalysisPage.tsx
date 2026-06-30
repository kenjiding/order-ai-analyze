import { Button, Tooltip, Typography } from 'antd'
import { BarChart2, BrainCircuit, Camera, Plus, SendHorizonal } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { VendorPushConfig } from './vendorAnalysisTypes'
import { VendorFilterPanel } from './components/VendorFilterPanel'
import { VendorMetricsPreview } from './components/VendorMetricsPreview'
import { VendorPushConfigModal } from './components/VendorPushConfigModal'
import { VendorPushConfigTable } from './components/VendorPushConfigTable'
import { useVendorAnalysisPage } from './useVendorAnalysisPage'
import { buildVendorSnapshot, saveVendorSnapshot } from './vendorSnapshotStorage'
import { fetchVendorAiSummaries } from './vendorAnalysisApi'

export default function VendorAnalysisPage() {
  const v = useVendorAnalysisPage()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<VendorPushConfig | null>(null)

  const openCreate = useCallback(() => {
    setEditingConfig(null)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((config: VendorPushConfig) => {
    setEditingConfig(config)
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingConfig(null)
  }, [])

  const handleCommit = useCallback(
    async (draft: Parameters<typeof v.addConfig>[0]) => {
      if (editingConfig) return v.editConfig(editingConfig.id, draft)
      return v.addConfig(draft)
    },
    [editingConfig, v],
  )

  const [aiLoading, setAiLoading] = useState(false)

  const enabledCount = v.configs.filter((c) => !c.isDisabled && c.webhookUrl.trim()).length
  const canTriggerPush = !!v.fetchedData && v.selectedStations.length > 0 && enabledCount > 0

  const openSnapshot = useCallback(async (autoPush: boolean) => {
    if (!v.fetchedData) return
    setAiLoading(true)
    let aiSummaries: Record<string, string> | undefined
    try {
      const inputs = v.vendorMetrics.map((m) => {
        const dispatchRate24h = m.dispatchRate24hText ? parseFloat(m.dispatchRate24hText) / 100 : null
        const rawDrivers = v.driverPerformanceByVendor[m.vendorCode] ?? []
        // 按归班预警降序、再按派签率升序，取前 30 条，让模型聚焦最需关注的司机
        const sortedDrivers = [...rawDrivers].sort(
          (a, b) =>
            b.returnWarningCount - a.returnWarningCount ||
            (a.dispatchRate24h ?? 1) - (b.dispatchRate24h ?? 1),
        ).slice(0, 30)
        return {
          vendorCode: m.vendorCode,
          vendorName: m.vendorName,
          before11ExitRate: m.before11ExitRate,
          dispatchRate24h,
          complaintRate: m.complaintRate,
          complaintCount: m.complaintCount,
          waybillCount: m.waybillCount,
          unprocessedTicketCount: m.unprocessedTicketCount,
          longTailCount: m.longTailCount,
          drivers: sortedDrivers.map((d) => ({
            courierName: d.courierName,
            courierCode: d.courierCode,
            routeCode: d.routeCode,
            ofdCount: d.ofdCount,
            before11ExitRate: d.ofdCount > 0 ? d.before11OfdCount / d.ofdCount : null,
            dispatchRate24h: d.dispatchRate24h,
            dispatch24hCount: d.dispatch24hCount,
            totalDispatchCount: d.totalDispatchCount,
            returnWarningCount: d.returnWarningCount,
          })),
        }
      })
      const result = await fetchVendorAiSummaries(inputs)
      if (result.ok) aiSummaries = result.data
    } finally {
      setAiLoading(false)
    }
    const snapshot = buildVendorSnapshot({
      fetchedData: v.fetchedData,
      stations: v.selectedStations,
      vendorMetrics: v.vendorMetrics,
      driverPerformanceByVendor: v.driverPerformanceByVendor,
      configs: v.configs,
      aiSummaries,
    })
    saveVendorSnapshot(snapshot)
    window.open(autoPush ? '/vendor-snapshot?autoPush=1' : '/vendor-snapshot', '_blank')
  }, [v.fetchedData, v.selectedStations, v.vendorMetrics, v.driverPerformanceByVendor, v.configs])

  const pushBtnTooltip = !v.fetchedData
    ? '请先点击「获取数据」'
    : v.selectedStations.length === 0
      ? '请先选择责任站点'
      : enabledCount === 0
        ? '没有可用的推送配置'
        : '截图后推送到各供应商飞书群'

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
      </div>

      {/* 筛选区 */}
      <VendorFilterPanel
        referenceDate={v.referenceDate}
        onReferenceDateChange={v.setReferenceDate}
        complaintDateRange={v.complaintDateRange}
        onComplaintDateRangeChange={v.setComplaintDateRange}
        fetchedData={v.fetchedData}
        dataFetching={v.dataFetching}
        onFetchData={() => void v.fetchData()}
      />

      {/* 指标预览（含各供应商的司机派件表现） */}
      {v.fetchedData && (
        <VendorMetricsPreview
          metrics={v.vendorMetrics}
          fetchedData={v.fetchedData}
          hasStations={v.selectedStations.length > 0}
          driverPerformanceByVendor={v.driverPerformanceByVendor}
        />
      )}

      {/* 推送配置管理 */}
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-center justify-between gap-3 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">Push Configs</div>
            <h3 className="admin-title mt-0.5 text-base">飞书推送配置</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip title={!v.fetchedData ? '请先获取数据' : aiLoading ? 'AI 分析中...' : '预览截图落地页（不自动推送）'}>
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
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={openCreate}
              disabled={v.isPushingAll}
            >
              新增推送配置
            </Button>
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
          <VendorPushConfigTable
            configs={v.configs}
            loading={v.configsLoading}
            disabled={v.isPushingAll}
            onEdit={openEdit}
            onDelete={(config) => v.removeConfig(config.id, config.vendorName)}
            onToggleDisabled={(id, next) => v.toggleDisabled(id, next)}
          />
        </div>
      </div>

      <VendorPushConfigModal
        open={modalOpen}
        editing={editingConfig}
        vendors={v.vendors}
        vendorsLoading={v.vendorsLoading}
        onCancel={closeModal}
        onCommit={handleCommit}
      />
    </div>
  )
}
