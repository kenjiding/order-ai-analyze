import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Card, Empty, Spin } from 'antd'
import { fetchVendorPortalDriverMap, type VendorPortalDriverMap } from '../VendorAnalysis/vendorAnalysisApi'
import {
  DEFAULT_DRIVER_MAP_STATUS_FILTER,
  DriverMapLegend,
  DriverMapStatusCounts,
} from '../VendorAnalysis/components/DriverMap/DriverMapLegend'
import { DriverFilterBar } from '../VendorAnalysis/components/DriverMap/DriverFilterBar'
import type { DriverMapPointStatus } from '../VendorAnalysis/components/DriverMap/driverMapTypes'

/** maplibre-gl 体积较大（约 250KB gzip），懒加载避免所有页面都被迫下载 */
const DriverMapView = lazy(() =>
  import('../VendorAnalysis/components/DriverMap/DriverMapView').then((m) => ({ default: m.DriverMapView })),
)

type DataState =
  | { status: 'loading' }
  | { status: 'unavailable' } // 未勾选司机地图模块 → 整块不渲染
  | { status: 'ready'; data: VendorPortalDriverMap }
  | { status: 'error' }

/**
 * 分享链接门户的司机地图：每个供应商 token 各自一份（后端已按 vendorCode 过滤）。
 * 打开时后端按本供应商补地理编码（有时间预算，一次可能补不全）；若仍有地址无坐标会自动再拉几次。
 * 默认只展示「未签收 + 问题件」，标题右侧数量可点击切换筛选。
 */
export function PortalDriverMapSection({ token }: { token: string }) {
  const [state, setState] = useState<DataState>({ status: 'loading' })
  const [courierCode, setCourierCode] = useState<string | undefined>(undefined)
  const [statusFilter, setStatusFilter] = useState<Set<DriverMapPointStatus>>(
    () => new Set(DEFAULT_DRIVER_MAP_STATUS_FILTER),
  )
  const [geocodePass, setGeocodePass] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void fetchVendorPortalDriverMap(token).then((res) => {
      if (cancelled) return
      if (!res.ok) setState({ status: 'error' })
      else if (!res.data) setState({ status: 'unavailable' })
      else setState({ status: 'ready', data: res.data })
    })
    return () => {
      cancelled = true
    }
  }, [token, geocodePass])

  // 有运单但本轮未出点：后端 geocode 有时间预算，自动再请求几次把坐标补齐
  useEffect(() => {
    if (state.status !== 'ready') return
    if (state.data.drivers.length > 0) return
    const { totalCount, pendingCount, geocodedCount } = state.data
    const hasRowsNeedingCoords = totalCount + pendingCount > 0 && geocodedCount === 0
    if (!hasRowsNeedingCoords) return
    if (geocodePass >= 4) return
    const timer = window.setTimeout(() => setGeocodePass((n) => n + 1), 1200)
    return () => window.clearTimeout(timer)
  }, [state, geocodePass])

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

  if (state.status === 'loading') {
    return (
      <Card title="司机地图" extra={statusExtra} className="mt-6 sm:mt-8 mb-6">
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <Spin />
          <div className="text-sm text-slate-500">正在解析收件地址坐标，请稍候…</div>
        </div>
      </Card>
    )
  }

  if (state.data.drivers.length === 0) {
    const { totalCount, geocodedCount, pendingCount } = state.data
    const ungeocodedTerminal = totalCount > 0 && geocodedCount === 0
    const ungeocodedPending = pendingCount > 0 && geocodedCount === 0
    const stillRetrying = (ungeocodedTerminal || ungeocodedPending) && geocodePass < 4
    return (
      <Card title="司机地图" extra={statusExtra} className="mt-6 sm:mt-8 mb-6">
        {stillRetrying ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Spin />
            <div className="text-sm text-slate-500">
              {ungeocodedTerminal
                ? `已有 ${totalCount} 单签收/问题件，正在解析坐标（${geocodePass + 1}/5）…`
                : `已有 ${pendingCount} 单未签收地址，正在解析坐标（${geocodePass + 1}/5）…`}
            </div>
          </div>
        ) : (
          <Empty
            description={
              ungeocodedTerminal
                ? `已有 ${totalCount} 单签收/问题件地址，但坐标仍未解析完，请稍后刷新页面`
                : ungeocodedPending
                  ? `已有 ${pendingCount} 单未签收运单，但坐标仍未解析完（与「11点前出仓」不是同一套坐标流程）。请稍后刷新页面`
                  : '暂无运单轨迹点（需分析任务已同步司机地图，且收件地址能解析出坐标）'
            }
          />
        )}
      </Card>
    )
  }

  return (
    <Card title="司机地图" extra={statusExtra} className="mt-6 sm:mt-8 mb-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DriverMapLegend />
          <DriverFilterBar drivers={driverOptions} courierCode={courierCode} onCourierChange={setCourierCode} />
        </div>
        {filteredDrivers.length === 0 ? (
          <Empty description="当前筛选下暂无坐标点，请点击右上角状态标签切换" />
        ) : (
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-16">
                <Spin />
              </div>
            }
          >
            <DriverMapView drivers={filteredDrivers} />
          </Suspense>
        )}
      </div>
    </Card>
  )
}
