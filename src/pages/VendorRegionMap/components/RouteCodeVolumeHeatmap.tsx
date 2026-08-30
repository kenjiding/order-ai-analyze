import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import type { VendorTrendRoutePoint } from '../vendorRegionMapTypes'

type Props = {
  dates: string[]
  routeDaily: VendorTrendRoutePoint[]
  supplierKey: string
  supplierName: string
}

type Cell = { date: string; routeCode: string; count: number }

const ROW_HEIGHT = 22

/**
 * 路由码 × 日期 热力图。一个路由码≈一条司机线路，所以：
 * 某一行由深转浅直至断掉 = 这条线路没货了（司机要走）；新出现的行 = 扩容。
 */
export function RouteCodeVolumeHeatmap({ dates, routeDaily, supplierKey, supplierName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  const { cells, routeCodes } = useMemo(() => {
    const mine = routeDaily.filter((row) => row.supplierKey === supplierKey)
    const totals = new Map<string, number>()
    for (const row of mine) totals.set(row.routeCode, (totals.get(row.routeCode) ?? 0) + row.count)
    const ordered = [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([routeCode]) => routeCode)
    return {
      cells: mine.map((row) => ({ date: row.date, routeCode: row.routeCode, count: row.count })),
      routeCodes: ordered,
    }
  }, [routeDaily, supplierKey])

  const cellsKey = useMemo(
    () => `${supplierKey}|${cells.map((c) => `${c.date}\t${c.routeCode}\t${c.count}`).join('|')}`,
    [cells, supplierKey],
  )
  const height = Math.min(640, Math.max(180, 60 + routeCodes.length * ROW_HEIGHT))

  useEffect(() => {
    const el = containerRef.current
    if (!el || cells.length === 0) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      height,
      theme: 'light',
      paddingTop: 8,
      paddingRight: 72,
      paddingBottom: 36,
      paddingLeft: 104,
    })

    chart.scale('y', { type: 'band', domain: routeCodes })
    chart.scale('color', { type: 'sequential', palette: 'blues', domainMin: 0 })
    chart.axis('x', { title: false, labelAutoHide: true, labelAutoRotate: false,
      labelFormatter: (v: string) => (v.length >= 10 ? v.slice(5) : v) })
    chart.axis('y', { title: false, labelFontSize: 11 })
    chart.legend('color', { position: 'right', title: '票量' })
    chart.interaction('tooltip', true)

    chart
      .cell()
      .data(cells)
      .encode('x', 'date')
      .encode('y', 'routeCode')
      .encode('color', 'count')
      .style('inset', 1)
      .style('radius', 2)
      .tooltip({
        title: (d: Cell) => `${d.routeCode} · ${d.date}`,
        items: [{ name: '票量', field: 'count' }],
      })

    void chart.render()
    return () => {
      chart.destroy()
    }
  }, [cells, cellsKey, height, routeCodes])

  if (cells.length === 0) {
    return (
      <div className="vrm-chart-empty">
        {dates.length === 0 ? '点「查询」后显示路由码分布。' : `${supplierName} 在该区间内没有路由码数据。`}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="vrm-chart"
      role="img"
      aria-label={`${supplierName} 路由码按日货量热力图`}
    />
  )
}
