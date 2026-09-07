import { PackageMinus, Warehouse, Truck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageSectionTabs } from '../../components/PageSectionTabs'
import { InHubPackageLossTab } from './components/InHubPackageLossTab'
import { OutHubPackageLossTab } from './components/OutHubPackageLossTab'
import { usePackageLossMonitorPage, type PackageLossTabId } from './usePackageLossMonitorPage'
import './packageLossMonitor.css'

export default function PackageLossMonitorPage() {
  const { t } = useTranslation('packageLoss')
  const v = usePackageLossMonitorPage()

  return (
    <div className="admin-page package-loss-page space-y-5">
      <section className="admin-panel overflow-hidden">
        <div className="package-loss-pagehead">
          <h1 className="package-loss-title">
            <PackageMinus className="h-5 w-5 shrink-0 text-[#2f8f87]" aria-hidden />
            {t('title')}
          </h1>
          <p className="package-loss-lead">
            {v.activeTab === 'in-hub' ? t('leadInHub') : t('leadOutHub')}
          </p>
        </div>
        <PageSectionTabs
          activeId={v.activeTab}
          onChange={(id) => v.setActiveTab(id as PackageLossTabId)}
          items={[
            { id: 'in-hub', label: t('tabInHub'), icon: Warehouse },
            { id: 'out-hub', label: t('tabOutHub'), icon: Truck },
          ]}
        />
      </section>

      {v.activeTab === 'in-hub' ? (
        <InHubPackageLossTab
          stationCode={v.stationCode}
          stationLabel={v.stationLabel}
          dateRange={v.dateRange}
          onDateRangeChange={v.setDateRange}
          isQuerying={v.isQuerying}
          isAnalyzing={v.isAnalyzing}
          isPaused={v.isPaused}
          onPauseAnalyze={v.onPauseAnalyze}
          onResumeAnalyze={v.onResumeAnalyze}
          queryMeta={v.queryMeta}
          rows={v.analysisRows}
          filteredRows={v.filteredAnalysisRows}
          analyzeProgress={v.analyzeProgress}
          analytics={v.inHubLossAnalytics}
          postFilterDraft={v.postFilterDraft}
          onPostFilterDraftChange={v.setPostFilterDraft}
          appliedPostFilter={v.appliedPostFilter}
          onRunPostFilter={v.runPostFilter}
          exportPermission={v.exportPermission}
          onAnalyze={v.onAnalyzeInHub}
          onImport={v.onImportAnalysisResults}
          lossTimeoutDays={v.lossTimeoutDays}
          onLossTimeoutDaysChange={v.setLossTimeoutDays}
          importMeta={v.importMeta}
        />
      ) : (
        <OutHubPackageLossTab />
      )}
    </div>
  )
}
