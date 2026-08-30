import { Button, Modal } from 'antd'
import { Plus, TrendingUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { DispatchPerformanceConfigDrawer } from './components/DispatchPerformanceConfigDrawer'
import { DispatchPerformanceConfigList } from './components/DispatchPerformanceConfigList'
import { SettleNowResult } from './components/SettleNowResult'
import { useDispatchPerformancePage } from './useDispatchPerformancePage'
import { useSettleNow } from './useSettleNow'

export default function DispatchPerformancePage() {
  const v = useDispatchPerformancePage()
  const navigate = useNavigate()
  // 结算完刷新列表：出仓趟刚落库，latest 会从 null 变成有值，「查看明细」随之可点
  const settle = useSettleNow({ onSettled: v.reload })

  const enabledCount = v.configs.filter((c) => c.isEnabled).length

  return (
    <div className="admin-page space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-start justify-between gap-4 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">SLA Analytics</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              出仓派签达成分析
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              每个站点一条配置，到各自设定的「触发统计时间」自动统计 11点前出仓率 与 24小时派签率
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end gap-1 text-right">
              <div className="text-xs text-slate-500">已启用 / 总数</div>
              <div className="text-xl font-semibold tabular-nums text-slate-950">
                {enabledCount}
                <span className="ml-1 text-sm font-normal text-slate-400">/ {v.configs.length}</span>
              </div>
            </div>
            <Button type="primary" icon={<Plus className="h-4 w-4" />} onClick={v.openCreateDrawer}>
              添加统计站点
            </Button>
          </div>
        </div>
      </div>

      <DispatchPerformanceConfigList
        configs={v.configs}
        loading={v.loading}
        togglingIds={v.togglingIds}
        onView={(config) => navigate(`/dispatch-performance/${config.id}`)}
        onEdit={v.openEditDrawer}
        onDelete={v.removeConfig}
        onToggleEnabled={(config, enabled) => void v.toggleEnabled(config, enabled)}
        settlingId={settle.settlingId}
        onSettleNow={(config) => void settle.settleNow(config.id)}
      />

      <Modal
        open={settle.artifact != null}
        onCancel={settle.dismissArtifact}
        footer={null}
        width={720}
        title="立刻统计结果"
        destroyOnHidden
      >
        {settle.artifact ? (
          <SettleNowResult artifact={settle.artifact} onDismiss={settle.dismissArtifact} bare />
        ) : null}
      </Modal>

      <DispatchPerformanceConfigDrawer
        open={v.drawerOpen}
        onClose={v.closeDrawer}
        editing={v.editing}
        saving={v.saving}
        catalogConfigs={v.catalog.configs}
        catalogLoading={v.catalog.loading}
        onSubmit={v.submitDrawer}
      />
    </div>
  )
}
