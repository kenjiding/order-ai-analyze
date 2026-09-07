import { DollarSign, Scale, Settings, Upload, Users, GitCompareArrows } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PageSectionTabs } from '../../../components/PageSectionTabs'
import type { PageSectionTabItem } from '../../../components/PageSectionTabs'

type Statistics = { totalWages: number; totalHours: number; totalRecords: number } | null

type Props = {
  statistics: Statistics
  activeTab: string
  onTabChange: (tabId: string) => void
  onOpenRateSettings: () => void
  onOpenActualWorkerRates: () => void
}

export function WageSalaryPageHeader({
  statistics,
  activeTab,
  onTabChange,
  onOpenRateSettings,
  onOpenActualWorkerRates,
}: Props) {
  const { t } = useTranslation('wageSalary')

  const wageTabs = useMemo<PageSectionTabItem[]>(
    () => [
      { id: 'upload', label: t('tabs.upload'), icon: Upload },
      { id: 'reconciliation', label: t('tabs.reconciliation'), icon: GitCompareArrows },
      { id: 'employees', label: t('tabs.employees'), icon: Users },
    ],
    [t],
  )

  return (
    <div className="admin-panel overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="admin-eyebrow">{t('page.eyebrow')}</div>
              <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-950">
                <DollarSign className="h-5 w-5 text-[#2f8f87]" />
                {t('page.title')}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {statistics && (
                <>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                    <div className="text-xs font-medium text-slate-500">{t('page.totalWages')}</div>
                    <div className="mt-1 text-xl font-semibold text-[#2f8f87]">
                      ${statistics.totalWages.toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                    <div className="text-xs font-medium text-slate-500">{t('page.totalHours')}</div>
                    <div className="mt-1 text-xl font-semibold text-slate-950">
                      {statistics.totalHours.toFixed(2)}h
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                    <div className="text-xs font-medium text-slate-500">{t('page.recordCount')}</div>
                    <div className="mt-1 text-xl font-semibold text-slate-950">{statistics.totalRecords}</div>
                  </div>
                </>
              )}
              <button type="button" onClick={onOpenRateSettings} className="admin-btn admin-btn-dark">
                <Settings className="w-4 h-4" />
                {t('page.rateSettings')}
              </button>
              <button
                type="button"
                onClick={onOpenActualWorkerRates}
                className="admin-btn border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50"
                title={t('page.actualRatesTitle')}
              >
                <Scale className="w-4 h-4" />
                {t('page.actualRates')}
              </button>
            </div>
          </div>
        </div>

        <PageSectionTabs activeId={activeTab} items={wageTabs} onChange={onTabChange} />
    </div>
  )
}
