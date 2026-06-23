import { Alert } from 'antd'
import { CheckCircle2, ScanSearch, XCircle } from 'lucide-react'
import { useAppSettings } from '../../context/AppSettingsContext'
import AuditDetailDrawer from './components/AuditDetailDrawer'
import AuditFilterPanel from './components/AuditFilterPanel'
import ProblemPackageTable from './components/ProblemPackageTable'
import { useProblemPackageAuditPage } from './useProblemPackageAuditPage'

type StatCardProps = {
  value: number | string
  label: string
  valueColor?: string
  icon?: React.ReactNode
}

function StatCard({ value, label, valueColor = '#1e293b', icon }: StatCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-baseline gap-2">
        <span className="text-[22px] font-medium leading-none" style={{ color: valueColor }}>
          {value}
        </span>
        {icon && <span className="text-slate-300">{icon}</span>}
      </div>
      <span className="text-[11px] text-slate-400">{label}</span>
    </div>
  )
}

export default function ProblemPackageAuditPage() {
  const { imileToken } = useAppSettings()
  const {
    daCodeItems,
    auditMap,
    searchLoading,
    activeDaCode,
    drawerOpen,
    drawerDaCode,
    handleSearch,
    handleStartAnalysis,
    handlePause,
    handleLoadPackages,
    handleAnalyzeSinglePackage,
    handleViewDetail,
    handleCloseDrawer,
  } = useProblemPackageAuditPage()

  const drawerEntry = drawerDaCode ? (auditMap[drawerDaCode] ?? null) : null

  // Compute summary stats from loaded audit entries
  const allPackages = Object.values(auditMap).flatMap((e) => e.packages)
  const totalPackages = allPackages.length
  const qualifiedCount = allPackages.filter((p) => p.auditResult?.overallQualified === true).length
  const unqualifiedCount = allPackages.filter(
    (p) => p.auditResult?.overallQualified === false,
  ).length

  const showStats = daCodeItems.length > 0

  return (
    <div className="min-h-screen space-y-4 bg-slate-50 p-5">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50">
          <ScanSearch size={18} className="text-teal-700" />
        </div>
        <div>
          <h1 className="text-[16px] font-medium text-slate-800">AI 问题件审核</h1>
          <p className="text-[12px] text-slate-400">
            按站点查询问题件 · 按 DA 代码批量 AI 审核图片合格性 · 支持暂停与恢复
          </p>
        </div>
      </div>

      {/* Token warning */}
      {!imileToken && (
        <Alert
          type="warning"
          showIcon
          message="请先在右上角「设置」中配置 iMile Token，才能查询问题件数据"
        />
      )}

      {/* Summary stats — only show when data is loaded */}
      {showStats && (
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            value={daCodeItems.length}
            label="DA 代码总数"
            valueColor="#2f8f87"
          />
          <StatCard
            value={totalPackages > 0 ? totalPackages : '—'}
            label="问题件总数"
          />
          <StatCard
            value={qualifiedCount > 0 ? qualifiedCount : '—'}
            label="合格件数"
            valueColor="#3B6D11"
            icon={qualifiedCount > 0 ? <CheckCircle2 size={14} /> : undefined}
          />
          <StatCard
            value={unqualifiedCount > 0 ? unqualifiedCount : '—'}
            label="不合格件数"
            valueColor={unqualifiedCount > 0 ? '#A32D2D' : undefined}
            icon={unqualifiedCount > 0 ? <XCircle size={14} /> : undefined}
          />
        </div>
      )}

      {/* Filter */}
      <AuditFilterPanel
        loading={searchLoading}
        total={daCodeItems.length > 0 ? daCodeItems.length : undefined}
        onSearch={handleSearch}
      />

      {/* DA Code table */}
      <ProblemPackageTable
        daCodeItems={daCodeItems}
        auditMap={auditMap}
        searchLoading={searchLoading}
        activeDaCode={activeDaCode}
        onStartAnalysis={handleStartAnalysis}
        onPause={handlePause}
        onViewDetail={handleViewDetail}
      />

      {/* Detail drawer */}
      <AuditDetailDrawer
        open={drawerOpen}
        daCode={drawerDaCode}
        entry={drawerEntry}
        onClose={handleCloseDrawer}
        onLoadPackages={handleLoadPackages}
        onAnalyzeSingle={handleAnalyzeSinglePackage}
      />
    </div>
  )
}
