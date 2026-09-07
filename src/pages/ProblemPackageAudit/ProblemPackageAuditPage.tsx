import { Alert } from 'antd'
import { CheckCircle2, ScanSearch, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('problemPackage')
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

  const allPackages = Object.values(auditMap).flatMap((e) => e.packages)
  const totalPackages = allPackages.length
  const qualifiedCount = allPackages.filter((p) => p.auditResult?.overallQualified === true).length
  const unqualifiedCount = allPackages.filter(
    (p) => p.auditResult?.overallQualified === false,
  ).length

  const showStats = daCodeItems.length > 0

  return (
    <div className="min-h-screen space-y-4 bg-slate-50 p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50">
          <ScanSearch size={18} className="text-teal-700" />
        </div>
        <div>
          <h1 className="text-[16px] font-medium text-slate-800">{t('title')}</h1>
          <p className="text-[12px] text-slate-400">{t('description')}</p>
        </div>
      </div>

      {!imileToken && (
        <Alert type="warning" showIcon message={t('tokenWarning')} />
      )}

      {showStats && (
        <div className="grid grid-cols-4 gap-3">
          <StatCard value={daCodeItems.length} label={t('statDaCodes')} valueColor="#2f8f87" />
          <StatCard value={totalPackages > 0 ? totalPackages : '—'} label={t('statTotal')} />
          <StatCard
            value={qualifiedCount > 0 ? qualifiedCount : '—'}
            label={t('statQualified')}
            valueColor="#3B6D11"
            icon={qualifiedCount > 0 ? <CheckCircle2 size={14} /> : undefined}
          />
          <StatCard
            value={unqualifiedCount > 0 ? unqualifiedCount : '—'}
            label={t('statUnqualified')}
            valueColor={unqualifiedCount > 0 ? '#A32D2D' : undefined}
            icon={unqualifiedCount > 0 ? <XCircle size={14} /> : undefined}
          />
        </div>
      )}

      <AuditFilterPanel
        loading={searchLoading}
        total={daCodeItems.length > 0 ? daCodeItems.length : undefined}
        onSearch={handleSearch}
      />

      <ProblemPackageTable
        daCodeItems={daCodeItems}
        auditMap={auditMap}
        searchLoading={searchLoading}
        activeDaCode={activeDaCode}
        onStartAnalysis={handleStartAnalysis}
        onPause={handlePause}
        onViewDetail={handleViewDetail}
      />

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
