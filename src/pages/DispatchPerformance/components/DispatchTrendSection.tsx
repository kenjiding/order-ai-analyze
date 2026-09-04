import { Alert, Select, Spin } from 'antd'
import type { Dayjs } from 'dayjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchDispatchPerformanceTrend } from '../dispatchPerformanceApi'
import type {
  DispatchPerformanceSupplierOption,
  DispatchTrendResult,
} from '../dispatchPerformanceTypes'
import { buildVendorColorMap, colorFromMap } from '../../VendorRegionMap/vendorColors'
import { DispatchRateTrendChart } from './DispatchRateTrendChart'

type Props = {
  configId: string
  range: [Dayjs, Dayjs]
  supplierKeys: string[]
  supplierOptions?: DispatchPerformanceSupplierOption[]
}

function buildSupplierLabels(
  suppliers: DispatchPerformanceSupplierOption[],
): Map<string, string> {
  const nameCounts = new Map<string, number>()
  for (const supplier of suppliers) {
    nameCounts.set(supplier.supplierName, (nameCounts.get(supplier.supplierName) ?? 0) + 1)
  }
  return new Map(
    suppliers.map((supplier) => [
      supplier.supplierKey,
      (nameCounts.get(supplier.supplierName) ?? 0) > 1 && supplier.vendorCode
        ? `${supplier.supplierName}（${supplier.vendorCode}）`
        : supplier.supplierName,
    ]),
  )
}

export function DispatchTrendSection({ configId, range, supplierKeys, supplierOptions }: Props) {
  const startDate = range[0].format('YYYY-MM-DD')
  const endDate = range[1].format('YYYY-MM-DD')

  const [result, setResult] = useState<DispatchTrendResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [routeSupplierKey, setRouteSupplierKey] = useState<string>('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    void fetchDispatchPerformanceTrend(
      { configId, startDate, endDate, supplierKeys },
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setResult(data)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
        setError(err instanceof Error ? err.message : '趋势查询失败')
        setResult(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [configId, endDate, startDate, supplierKeys])

  const suppliers = useMemo(
    () => result?.suppliers ?? supplierOptions ?? [],
    [result?.suppliers, supplierOptions],
  )

  useEffect(() => {
    if (suppliers.length === 0) {
      if (routeSupplierKey) setRouteSupplierKey('')
      return
    }
    if (routeSupplierKey && suppliers.some((supplier) => supplier.supplierKey === routeSupplierKey)) return
    setRouteSupplierKey(suppliers[0].supplierKey)
  }, [routeSupplierKey, suppliers])

  const supplierLabels = useMemo(() => buildSupplierLabels(suppliers), [suppliers])
  const supplierColorMap = useMemo(
    () => buildVendorColorMap(suppliers.map((supplier) => supplier.supplierKey)),
    [suppliers],
  )

  const supplierSeries = useMemo(
    () =>
      suppliers.map((supplier) => ({
        key: supplier.supplierKey,
        label: supplierLabels.get(supplier.supplierKey) ?? supplier.supplierName,
        color: colorFromMap(supplierColorMap, supplier.supplierKey),
      })),
    [supplierColorMap, supplierLabels, suppliers],
  )

  const supplierBefore11Points = useMemo(
    () =>
      (result?.supplierDaily ?? []).map((point) => ({
        date: point.date,
        seriesKey: point.supplierKey,
        rate: point.before11Rate,
      })),
    [result?.supplierDaily],
  )
  const supplierSignPoints = useMemo(
    () =>
      (result?.supplierDaily ?? []).map((point) => ({
        date: point.date,
        seriesKey: point.supplierKey,
        rate: point.signRate,
      })),
    [result?.supplierDaily],
  )

  const routeRows = useMemo(
    () => (result?.routeDaily ?? []).filter((row) => row.supplierKey === routeSupplierKey),
    [result?.routeDaily, routeSupplierKey],
  )

  const routeMeta = useMemo(() => {
    const byRoute = new Map<string, { total: number; hasWhitelist: boolean }>()
    for (const row of routeRows) {
      const current = byRoute.get(row.routeCode) ?? { total: 0, hasWhitelist: false }
      current.total += row.total
      current.hasWhitelist ||= row.isWhitelist
      byRoute.set(row.routeCode, current)
    }
    return [...byRoute.entries()]
      .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
      .map(([routeCode, meta]) => ({ routeCode, ...meta }))
  }, [routeRows])

  const routeColorMap = useMemo(
    () => buildVendorColorMap(routeMeta.map((route) => route.routeCode)),
    [routeMeta],
  )

  const routeSeries = useMemo(
    () =>
      routeMeta.map((route) => ({
        key: route.routeCode,
        label: route.hasWhitelist ? `${route.routeCode}（白名单）` : route.routeCode,
        color: colorFromMap(routeColorMap, route.routeCode),
      })),
    [routeColorMap, routeMeta],
  )

  const routeBefore11Points = useMemo(
    () =>
      routeRows.map((point) => ({
        date: point.date,
        seriesKey: point.routeCode,
        rate: point.before11Rate,
      })),
    [routeRows],
  )
  const routeSignPoints = useMemo(
    () =>
      routeRows.map((point) => ({
        date: point.date,
        seriesKey: point.routeCode,
        rate: point.signRate,
      })),
    [routeRows],
  )

  const routeSupplierName =
    suppliers.find((supplier) => supplier.supplierKey === routeSupplierKey)?.supplierName ?? ''

  return (
    <section className="admin-panel space-y-4 p-4">
      <div>
        <h3 className="admin-title text-xl">趋势变化</h3>
        <p className="mt-1 text-sm text-slate-500">
          按到件日查看供应商与供应商路由码的 11 点前出仓率、24H 派签率变化。
        </p>
      </div>

      {loading ? (
        <div className="flex h-[140px] items-center justify-center">
          <Spin />
        </div>
      ) : null}

      {error ? <Alert type="error" showIcon message={error} /> : null}

      {!loading && !error && result && result.dates.length === 0 ? (
        <Alert type="info" showIcon message="当前筛选区间没有可展示的趋势数据" />
      ) : null}

      {!loading && !error && result && result.dates.length > 0 ? (
        <>
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">供应商维度</h4>
              <p className="text-xs text-slate-500">
                当前跟随页面上方供应商筛选（已选 {suppliers.length} 家）。
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <DispatchRateTrendChart
                dates={result.dates}
                series={supplierSeries}
                points={supplierBefore11Points}
                yTitle="11点前出仓率"
                ariaLabel="供应商11点前出仓率趋势图"
                emptyText="当前区间没有可展示的供应商出仓率趋势。"
              />
              <DispatchRateTrendChart
                dates={result.dates}
                series={supplierSeries}
                points={supplierSignPoints}
                yTitle="24H派签率"
                ariaLabel="供应商24H派签率趋势图"
                emptyText="当前区间没有可展示的供应商派签率趋势。"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">供应商路由码维度</h4>
                <p className="text-xs text-slate-500">
                  先选供应商，再看该供应商下各路由码的每日变化。
                </p>
              </div>
              <Select
                value={routeSupplierKey || undefined}
                onChange={setRouteSupplierKey}
                placeholder="选择供应商"
                className="min-w-[260px]"
                options={suppliers.map((supplier) => ({
                  value: supplier.supplierKey,
                  label: supplierLabels.get(supplier.supplierKey) ?? supplier.supplierName,
                }))}
              />
            </div>
            {routeSupplierKey ? (
              <p className="text-xs text-slate-500">
                当前供应商：{routeSupplierName || routeSupplierKey}（共 {routeSeries.length} 条路由码）
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <DispatchRateTrendChart
                dates={result.dates}
                series={routeSeries}
                points={routeBefore11Points}
                yTitle="11点前出仓率"
                ariaLabel="路由码11点前出仓率趋势图"
                emptyText="请选择供应商后查看路由码出仓率趋势。"
              />
              <DispatchRateTrendChart
                dates={result.dates}
                series={routeSeries}
                points={routeSignPoints}
                yTitle="24H派签率"
                ariaLabel="路由码24H派签率趋势图"
                emptyText="请选择供应商后查看路由码派签率趋势。"
              />
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
