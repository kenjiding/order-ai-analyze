import { Button, Tooltip, Typography } from 'antd'
import { BarChart2, Plus, SendHorizonal } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { PERMISSION_KEYS } from '../../hooks/usePermission'
import type { VendorPushConfig } from './vendorAnalysisTypes'
import { VendorFilterPanel } from './components/VendorFilterPanel'
import { VendorMetricsPreview } from './components/VendorMetricsPreview'
import { VendorPushConfigModal } from './components/VendorPushConfigModal'
import { VendorPushConfigTable } from './components/VendorPushConfigTable'
import { useVendorAnalysisPage } from './useVendorAnalysisPage'

export default function VendorAnalysisPage() {
  const { hasPermission } = useAuthStore()
  const canPush = hasPermission(PERMISSION_KEYS.btnVendorAnalysisPush)

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

  const enabledCount = v.configs.filter((c) => !c.isDisabled && c.webhookUrl.trim()).length
  const canTriggerPush = canPush && !!v.fetchedData && v.selectedStations.length > 0 && enabledCount > 0

  const pushBtnTooltip = !canPush
    ? '无操作权限'
    : !v.fetchedData
      ? '请先点击「获取数据」'
      : v.selectedStations.length === 0
        ? '请先选择责任站点'
        : enabledCount === 0
          ? '没有可用的推送配置'
          : ''

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
        dateRange={v.dateRange}
        onDateRangeChange={v.setDateRange}
        complaintDateRange={v.complaintDateRange}
        onComplaintDateRangeChange={v.setComplaintDateRange}
        fetchedData={v.fetchedData}
        dataFetching={v.dataFetching}
        onFetchData={() => void v.fetchData()}
      />

      {/* 指标预览 */}
      {v.fetchedData && (
        <VendorMetricsPreview
          metrics={v.vendorMetrics}
          fetchedData={v.fetchedData}
          hasStations={v.selectedStations.length > 0}
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
            <Tooltip title={pushBtnTooltip}>
              <span>
                <Button
                  type="primary"
                  icon={<SendHorizonal className="h-4 w-4" />}
                  loading={v.isPushingAll}
                  disabled={!canTriggerPush || v.isPushingAll}
                  onClick={() => void v.pushAll()}
                >
                  供应商数据分析推送
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
            onDelete={(config) => void v.removeConfig(config.id, config.vendorName)}
            onToggleDisabled={(id, next) => void v.toggleDisabled(id, next)}
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
