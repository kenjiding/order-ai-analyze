import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Empty, Spin, message } from 'antd'
import { RefreshCw } from 'lucide-react'
import { PermissionGate, PERMISSION_KEYS } from '../../../../hooks/usePermission'
import { useGoogleMapsLoader } from './useGoogleMapsLoader'
import { useDriverMapData } from './useDriverMapData'
import { getDriverMapBrowserKey } from './driverMapApi'
import { DriverMapView } from './DriverMapView'
import { DriverMapLegend } from './DriverMapLegend'
import { DriverFilterBar } from './DriverFilterBar'

/** 内部授权页面自行拉取受限浏览器端 key（外部分享链接门户走自己的公开接口，不复用这个 hook） */
function useAuthedBrowserMapsKey(): string | null | undefined {
  const [browserKey, setBrowserKey] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await getDriverMapBrowserKey()
      if (cancelled) return
      setBrowserKey(res.ok ? res.data.browserKey : null)
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return browserKey
}

function DriverMapBody({
  stationCode,
  dataDate,
  refreshing,
  onRefresh,
  dataState,
}: {
  stationCode: string
  dataDate: string
  refreshing: boolean
  onRefresh: () => Promise<boolean>
  dataState: ReturnType<typeof useDriverMapData>
}) {
  const browserKey = useAuthedBrowserMapsKey()
  const loaderState = useGoogleMapsLoader(browserKey)
  const [courierCode, setCourierCode] = useState<string | undefined>(undefined)

  const driverOptions = useMemo(() => {
    if (dataState.status !== 'ready') return []
    return dataState.data.drivers.map((d) => ({ courierCode: d.courierCode, courierName: d.courierName }))
  }, [dataState])

  if (loaderState.status === 'no-key') {
    return <Alert type="warning" showIcon message="地图功能未配置" description="请联系管理员在后端配置 Google Maps API Key 后再使用司机地图。" />
  }
  if (loaderState.status === 'error') {
    return <Alert type="error" showIcon message="地图加载失败" description={loaderState.message} />
  }
  if (loaderState.status === 'loading' || dataState.status === 'loading') {
    return (
      <div className="flex items-center justify-center py-16">
        <Spin />
      </div>
    )
  }
  if (dataState.status === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <Alert type="error" showIcon message="数据加载失败" description={dataState.message} />
        <div>
          <Button loading={refreshing} icon={<RefreshCw className="h-4 w-4" />} onClick={() => void onRefresh()}>
            重新刷新
          </Button>
        </div>
      </div>
    )
  }

  if (dataState.data.drivers.length === 0) {
    const { totalCount, geocodedCount, pendingCount } = dataState.data
    if (totalCount > 0 && geocodedCount === 0) {
      return (
        <Alert
          type="warning"
          showIcon
          message={`已有 ${totalCount} 单签收/问题件，但未能解析出地图坐标`}
          description="请确认后端已配置可用的 Google Geocoding Key（GOOGLE_MAPS_SERVER_API_KEY），然后再次点击「刷新」。地址较多时需多次刷新逐步补全坐标。"
        />
      )
    }
    return (
      <Empty
        description={
          <span>
            当前站点在昨日到件日（{dataDate}）暂无已定位的轨迹点
            {pendingCount > 0 ? `（另有 ${pendingCount} 单尚无签收/问题件）` : ''}。
            <br />
            点击右上角「刷新」拉取运单并更新地图（数据源与「11点前出仓率」相同，均为昨天）。
          </span>
        }
      />
    )
  }

  const filteredDrivers = courierCode
    ? dataState.data.drivers.filter((d) => d.courierCode === courierCode)
    : dataState.data.drivers

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DriverMapLegend />
        <DriverFilterBar drivers={driverOptions} courierCode={courierCode} onCourierChange={setCourierCode} />
      </div>
      <DriverMapView drivers={filteredDrivers} />
      <div className="text-xs text-slate-400">
        共 {dataState.data.totalCount} 单，已定位 {dataState.data.geocodedCount} 单，待签收/问题件{' '}
        {dataState.data.pendingCount} 单 · {stationCode} / {dataDate}
      </div>
    </div>
  )
}

/**
 * 司机地图卡片：唯一对外入口。无权限时完全不挂载（不发起任何地图/数据请求）。
 * 旁侧「刷新」按钮触发与 24H 派签告警相同的增量同步（跳过已达标/已超窗口单号）。
 */
export function DriverMapCard({ stationCode, dataDate }: { stationCode: string; dataDate: string }) {
  const dataState = useDriverMapData({ stationCode, dataDate })

  const handleRefresh = async () => {
    const ok = await dataState.refresh()
    if (ok) message.success('司机地图已增量刷新（地址较多时可再次点击「刷新」继续补坐标）')
    else message.error('刷新失败，请稍后重试')
    return ok
  }

  return (
    <PermissionGate permission={PERMISSION_KEYS.btnVendorAnalysisDriverMap}>
      <Card
        title="司机地图"
        className="mb-6"
        extra={
          stationCode ? (
            <Button
              icon={<RefreshCw className="h-4 w-4" />}
              loading={dataState.refreshing}
              onClick={() => void handleRefresh()}
            >
              刷新
            </Button>
          ) : null
        }
      >
        {stationCode ? (
          <DriverMapBody
            stationCode={stationCode}
            dataDate={dataDate}
            refreshing={dataState.refreshing}
            onRefresh={handleRefresh}
            dataState={dataState}
          />
        ) : (
          <Empty description="当前日报未关联站点编码，无法展示司机地图" />
        )}
      </Card>
    </PermissionGate>
  )
}
