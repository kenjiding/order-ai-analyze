import { Eye } from 'lucide-react'
import { Alert } from 'antd'
import { usePushEngagementMonitorPage } from './usePushEngagementMonitorPage'
import { PushEngagementFilterBar } from './components/PushEngagementFilterBar'
import { PushEngagementTable } from './components/PushEngagementTable'

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: 'default' | 'warn' }) {
  return (
    <div className="admin-panel-muted flex-1 min-w-[160px] px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone === 'warn' ? 'text-amber-600' : 'text-slate-900'}`}>{value}</div>
    </div>
  )
}

export default function PushEngagementMonitorPage() {
  const page = usePushEngagementMonitorPage()

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
            <Eye className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-950">推送数据监控</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              监控 11点出仓告警、24H派签告警、催派推送、工单推送 的已读与按钮点击情况，观察供应商对推送数据的关注度。
            </p>
          </div>
        </div>
      </header>

      <section className="flex flex-wrap gap-3">
        <StatCard label="所选条件内推送条数" value={page.summary.total} />
        <StatCard label="累计点击次数" value={page.summary.totalClicks} />
        <StatCard label="零点击条数" value={page.summary.noClickCount} tone={page.summary.noClickCount > 0 ? 'warn' : 'default'} />
      </section>

      <section className="admin-panel p-4 sm:p-5">
        <PushEngagementFilterBar
          dateRange={page.dateRange}
          onChangeDateRange={page.setDateRange}
          pushLabels={page.pushLabels}
          onChangePushLabels={page.setPushLabels}
          supplierConfigId={page.supplierConfigId}
          onChangeSupplierConfigId={page.setSupplierConfigId}
          supplierOptions={page.supplierOptions}
          suppliersLoading={page.suppliersLoading}
          regionCode={page.regionCode}
          onChangeRegionCode={page.setRegionCode}
        />
      </section>

      <section className="admin-panel p-4 sm:p-5">
        {page.rowsError ? (
          <Alert type="error" showIcon message={page.rowsError} className="mb-4" />
        ) : null}
        <PushEngagementTable
          dateGroups={page.dateGroups}
          loading={page.rowsLoading}
          expandedDates={page.expandedDates}
          onExpandDate={page.onExpandDate}
          expandedGroupKeys={page.expandedGroupKeys}
          readStatusByGroup={page.readStatusByGroup}
          clickEventsByGroup={page.clickEventsByGroup}
          onExpandGroup={page.onExpandGroup}
          onRefreshGroup={page.refreshGroup}
        />
      </section>
    </div>
  )
}
