import { BarChart3, ClipboardList, Layers, PackageSearch, Settings2, Warehouse } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PageSectionTabs } from '../../../components/PageSectionTabs'
import type { PageSectionTabItem } from '../../../components/PageSectionTabs'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import type { TabId } from '../useOrderExceptionManagementPage'

type Props = {
  activeTab: TabId
  onTabChange: (id: TabId) => void
  activeJobCount: number
}

export function OrderExceptionManagementHeader({
  activeTab,
  onTabChange,
  activeJobCount,
}: Props) {
  const { t } = useTranslation('orderException')
  const canViewUsageStats = usePermission(PERMISSION_KEYS.btnOrderExceptionUsageStats)

  const tabItems: PageSectionTabItem[] = useMemo(
    () => [
      { id: 'analyze', label: t('tabAnalyze'), icon: PackageSearch },
      { id: 'in-hub', label: t('tabInHub'), icon: Warehouse },
      {
        id: 'jobs',
        label: t('tabJobs'),
        icon: Layers,
        badge: activeJobCount > 0 ? String(activeJobCount) : undefined,
      },
      { id: 'warehouse-config', label: t('tabWarehouseConfig'), icon: Settings2 },
      { id: 'regression', label: t('tabRegression'), icon: ClipboardList },
      ...(canViewUsageStats
        ? [{ id: 'usage-analysis', label: t('tabUsageAnalysis'), icon: BarChart3 }]
        : []),
    ],
    [activeJobCount, canViewUsageStats, t],
  )

  return (
    <div className="admin-panel overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="admin-eyebrow">{t('eyebrow')}</div>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-950">
              <PackageSearch className="h-5 w-5 text-[#2f8f87]" aria-hidden />
              {t('title')}
            </h2>
          </div>
        </div>
      </div>

      <PageSectionTabs
        activeId={activeTab}
        onChange={(id: string) => onTabChange(id as TabId)}
        items={tabItems}
      />
    </div>
  )
}
