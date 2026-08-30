import { useState } from 'react'
import { MapPinned, TrendingUp } from 'lucide-react'
import { PageSectionTabs } from '../../components/PageSectionTabs'
import { useVendorRegionMapPage } from './useVendorRegionMapPage'
import { useVendorVolumeTrend } from './useVendorVolumeTrend'
import { VendorRegionMapTab } from './components/VendorRegionMapTab'
import { VendorVolumeTrendTab } from './components/VendorVolumeTrendTab'
import './vendorRegionMap.css'

type TabId = 'map' | 'trend'

export default function VendorRegionMapPage() {
  const [activeTab, setActiveTab] = useState<TabId>('map')
  // 两个 Tab 的状态都提到这里：切 Tab 时子组件卸载，已查到的数据不能跟着丢
  const page = useVendorRegionMapPage()
  const trend = useVendorVolumeTrend()

  return (
    <div className="admin-page vrm-page space-y-5">
      <section className="admin-panel overflow-hidden">
        <div className="px-5 pt-4">
          <h1 className="vrm-head__title">供应商区域地图</h1>
        </div>
        <PageSectionTabs
          activeId={activeTab}
          onChange={(id) => setActiveTab(id as TabId)}
          items={[
            { id: 'map', label: '区域地图', icon: MapPinned },
            { id: 'trend', label: '供应商货量趋势', icon: TrendingUp },
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
