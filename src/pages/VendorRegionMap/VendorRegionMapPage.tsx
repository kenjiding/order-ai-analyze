import { useState } from 'react'
import { MapPinned, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageSectionTabs } from '../../components/PageSectionTabs'
import { useVendorRegionMapPage } from './useVendorRegionMapPage'
import { useVendorVolumeTrend } from './useVendorVolumeTrend'
import { VendorRegionMapTab } from './components/VendorRegionMapTab'
import { VendorVolumeTrendTab } from './components/VendorVolumeTrendTab'
import './vendorRegionMap.css'

type TabId = 'map' | 'trend'

export default function VendorRegionMapPage() {
  const { t } = useTranslation('vendorRegionMap')
  const [activeTab, setActiveTab] = useState<TabId>('map')
  const page = useVendorRegionMapPage()
  const trend = useVendorVolumeTrend()

  return (
    <div className="admin-page vrm-page space-y-5">
      <section className="admin-panel overflow-hidden">
        <div className="px-5 pt-4">
          <h1 className="vrm-head__title">{t('title')}</h1>
        </div>
        <PageSectionTabs
          activeId={activeTab}
          onChange={(id) => setActiveTab(id as TabId)}
          items={[
            { id: 'map', label: t('tabMap'), icon: MapPinned },
            { id: 'trend', label: t('tabTrend'), icon: TrendingUp },
          ]}
        />
      </section>

      {activeTab === 'map' ? (
        <VendorRegionMapTab page={page} />
      ) : (
        <VendorVolumeTrendTab trend={trend} />
      )}
    </div>
  )
}
