import { useEffect, useMemo, useState } from 'react'
import { Card, Empty, Spin } from 'antd'
import { fetchVendorPortalDriverMap, type VendorPortalDriverMap } from '../VendorAnalysis/vendorAnalysisApi'
import { useGoogleMapsLoader } from '../VendorAnalysis/components/DriverMap/useGoogleMapsLoader'
import { DriverMapView } from '../VendorAnalysis/components/DriverMap/DriverMapView'
import {
  DEFAULT_DRIVER_MAP_STATUS_FILTER,
  DriverMapLegend,
  DriverMapStatusCounts,
} from '../VendorAnalysis/components/DriverMap/DriverMapLegend'
import { DriverFilterBar } from '../VendorAnalysis/components/DriverMap/DriverFilterBar'
import type { DriverMapPointStatus } from '../VendorAnalysis/components/DriverMap/driverMapTypes'

type DataState =
  | { status: 'loading' }
  | { status: 'unavailable' } // 未勾选司机地图模块 → 整块不渲染
  | { status: 'ready'; data: VendorPortalDriverMap }
  | { status: 'error' }

/**
 * 分享链接门户的司机地图：每个供应商 token 各自一份（后端已按 vendorCode 过滤）。
 * 打开时后端会按本供应商把已有地址 geocode 成坐标；有模块勾选即展示卡片。
 * 默认只展示「未签收 + 问题件」，标题右侧数量可点击切换筛选。
 */
export function PortalDriverMapSection({ token }: { token: string }) {
  const [state, setState] = useState<DataState>({ status: 'loading' })
  const [courierCode, setCourierCode] = useState<string | undefined>(undefined)
  const [statusFilter, setStatusFilter] = useState<Set<DriverMapPointStatus>>(
    () => new Set(DEFAULT_DRIVER_MAP_STATUS_FILTER),
  )

  useEffect(() => {
    let cancelled = false
    void fetchVendorPortalDriverMap(token).then((res) => {
      if (cancelled) return
      if (!res.ok) setState({ status: 'error' })
      else if (!res.data) setState({ status: 'unavailable' })
      else setState({ status: 'ready', data: res.data })
    })
    return () => {
      cancelled = true
    }
  }, [token])

  const loaderState = useGoogleMapsLoader(state.status === 'ready' ? state.data.browserMapsKey : undefined)

  const toggleStatus = (status: DriverMapPointStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const filteredDrivers = useMemo(() => {
    if (state.status !== 'ready') return []
    return state.data.drivers
      .filter((d) => !courierCode || d.courierCode === courierCode)
      .map((d) => ({
        ...d,
        points: d.points.filter((p) => statusFilter.has(p.status)),
      }))
      .filter((d) => d.points.length > 0)
  }, [state, courierCode, statusFilter])

  const driverOptions = useMemo(() => {
    if (state.status !== 'ready') return []
    // 司机下拉里仍列全量司机；地图按状态+司机双重过滤
    return state.data.drivers.map((d) => ({ courierCode: d.courierCode, courierName: d.courierName }))
  }, [state])

  const statusExtra =
    state.status === 'ready' ? (
      <DriverMapStatusCounts
        completedCount={state.data.completedCount ?? 0}
        pendingCount={state.data.pendingCount ?? 0}
        problemCount={state.data.problemCount ?? 0}
        selected={statusFilter}
        onToggle={toggleStatus}
      />
    ) : null

  if (state.status === 'unavailable' || state.status === 'error') return null

  if (state.status === 'loading' || loaderState.status === 'loading') {
    return (
      <Card title="司机地图" extra={statusExtra} className="mb-6">
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <Spin />
          <div className="text-sm text-slate-500">正在解析收件地址坐标，请稍候…</div>
        </div>
      </Card>
    )
  }

  if (loaderState.status === 'no-key' || loaderState.status === 'error') {
    return (
      <Card title="司机地图" extra={statusExtra} className="mb-6">
        <Empty description="地图未能加载，请稍后刷新重试" />
      </Card>
    )
  }

  if (state.data.drivers.length === 0) {
    const { totalCount, geocodedCount } = state.data
    return (
      <Card title="司机地图" extra={statusExtra} className="mb-6">
        <Empty
          description={
            totalCount > 0 && geocodedCount === 0
              ? `已有 ${totalCount} 单签收/问题件地址，但坐标解析尚未完成，请刷新页面重试`
              : '暂无已签收或问题件的司机轨迹点'
          }
        />
      </Card>
    )
  }

  return (
    <Card title="司机地图" extra={statusExtra} className="mb-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DriverMapLegend />
          <DriverFilterBar drivers={driverOptions} courierCode={courierCode} onCourierChange={setCourierCode} />
        </div>
        {filteredDrivers.length === 0 ? (
          <Empty description="当前筛选下暂无坐标点，请点击右上角状态标签切换" />
        ) : (
          <DriverMapView drivers={filteredDrivers} />
        )}
      </div>
    </Card>
  )
}
