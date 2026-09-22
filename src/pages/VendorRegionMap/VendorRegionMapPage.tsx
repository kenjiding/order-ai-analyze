import { useState } from 'react'
import { Gauge, MapPinned, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageSectionTabs } from '../../components/PageSectionTabs'
import { useVendorRegionMapPage } from './useVendorRegionMapPage'
import { useVendorVolumeTrend } from './useVendorVolumeTrend'
import { VendorRegionMapTab } from './components/VendorRegionMapTab'
import { VendorRouteDifficultyTab } from './components/VendorRouteDifficultyTab'
import { VendorVolumeTrendTab } from './components/VendorVolumeTrendTab'
import './vendorRegionMap.css'

type TabId = 'map' | 'trend' | 'difficulty'

export default function VendorRegionMapPage() {
  const { t } = useTranslation('vendorRegionMap')
  const [activeTab, setActiveTab] = useState<TabId>('map')
  // 切走的 tab 不卸载，只是隐藏——区域地图里的 maplibre 实例一旦重建，用户手动缩放/平移的视角就没了
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(() => new Set(['map']))
  const page = useVendorRegionMapPage()
  const trend = useVendorVolumeTrend()

  const handleChangeTab = (id: TabId) => {
    setActiveTab(id)
    setVisitedTabs((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }

  return (
    <div className="admin-page vrm-page space-y-5">
      <section className="admin-panel overflow-hidden">
        <div className="px-5 pt-4">
          <h1 className="vrm-head__title">{t('title')}</h1>
        </div>
        <PageSectionTabs
          activeId={activeTab}
          onChange={(id) => handleChangeTab(id as TabId)}
          items={[
            { id: 'map', label: t('tabMap'), icon: MapPinned },
            { id: 'trend', label: t('tabTrend'), icon: TrendingUp },
            { id: 'difficulty', label: t('tabDifficulty'), icon: Gauge },
          ]}
        />
      </section>

      {visitedTabs.has('map') && (
        <div hidden={activeTab !== 'map'}>
          <VendorRegionMapTab page={page} />
        </div>
      )}
      {visitedTabs.has('trend') && (
        <div hidden={activeTab !== 'trend'}>
          <VendorVolumeTrendTab trend={trend} />
        </div>
      )}
      {visitedTabs.has('difficulty') && (
        <div hidden={activeTab !== 'difficulty'}>
          <VendorRouteDifficultyTab page={page} />
        </div>
      )}
    </div>
  )
}
