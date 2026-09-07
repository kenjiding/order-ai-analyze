import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { adminColors } from '../../../theme/adminColors'
import { colorFromMap } from '../vendorColors'
import type { VendorTrendDailyPoint, VendorTrendSupplier } from '../vendorRegionMapTypes'

type Props = {
  dates: string[]
  daily: VendorTrendDailyPoint[]
  suppliers: VendorTrendSupplier[]
  selectedSupplierKeys: string[]
  colorMap: Map<string, string>
  /** 'line' 看单家变化，'stack' 看总盘子与份额结构 */
  mode: 'line' | 'stack'
}

type Row = { date: string; supplierName: string; count: number }

const HEIGHT = 320

export function VendorDailyVolumeLineChart({
  dates,
  daily,
  suppliers,
  selectedSupplierKeys,
  colorMap,
  mode,
}: Props) {
  const { t } = useTranslation('vendorRegionMap')
  const containerRef = useRef<HTMLDivElement>(null)

  const { rows, domain, range } = useMemo(() => {
    const selected = new Set(selectedSupplierKeys)
    const picked = suppliers.filter((supplier) => selected.has(supplier.supplierKey))

    // 折线按名字分组，重名的两家（同名不同 vendorCode）会被并成一条线、颜色也错位，
    // 所以重名时补上 vendorCode 才能当作系列标识
    const nameCounts = new Map<string, number>()
    for (const supplier of picked) {
      nameCounts.set(supplier.supplierName, (nameCounts.get(supplier.supplierName) ?? 0) + 1)
    }
    const labelByKey = new Map(
      picked.map((supplier) => [
        supplier.supplierKey,
        (nameCounts.get(supplier.supplierName) ?? 0) > 1 && supplier.vendorCode
          ? `${supplier.supplierName}（${supplier.vendorCode}）`
          : supplier.supplierName,
      ]),
    )

    const list: Row[] = []
    for (const point of daily) {
      const supplierName = labelByKey.get(point.supplierKey)
      if (!supplierName) continue
      list.push({ date: point.date, supplierName, count: point.count })
    }
    return {
      rows: list,
      domain: picked.map((s) => labelByKey.get(s.supplierKey) ?? s.supplierName),
      range: picked.map((s) => colorFromMap(colorMap, s.supplierKey)),
    }
  }, [colorMap, daily, selectedSupplierKeys, suppliers])

  const rowsKey = useMemo(
    () => `${mode}|${rows.map((r) => `${r.date}\t${r.supplierName}\t${r.count}`).join('|')}`,
    [mode, rows],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el || rows.length === 0) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: HEIGHT,
      theme: 'light',
      paddingTop: 12,
      paddingRight: 16,
      paddingBottom: 28,
      paddingLeft: 60,
    })

    chart.scale('x', { type: 'point', padding: 0.4 })
    chart.scale('y', { nice: true, domainMin: 0 })
    // 锁死配色：同一家供应商在地图 Tab 和这里必须同色
    chart.scale('color', { type: 'ordinal', domain, range })
    // 供应商 chips 已经是图例兼选择器，再画一份内置图例是重复的
    chart.legend(false)

    chart.axis('x', {
      title: false,
      labelAutoHide: true,
      labelAutoRotate: false,
      labelFormatter: (v: string) => (v.length >= 10 ? v.slice(5) : v),
    })
    chart.axis('y', {
      title: t('trend.chartVolume'),
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: adminColors.line,
    })
    chart.interaction('tooltip', { shared: true })

    if (mode === 'stack') {
      chart
        .area()
        .data(rows)
        .transform({ type: 'stackY' })
        .encode('x', 'date')
        .encode('y', 'count')
        .encode('color', 'supplierName')
        .style('fillOpacity', 0.75)
    } else {
      chart
        .line()
        .data(rows)
        .encode('x', 'date')
        .encode('y', 'count')
        .encode('color', 'supplierName')
        .style('lineWidth', 2.25)
        .style('lineCap', 'round')
        .style('lineJoin', 'round')
      chart
        .point()
        .data(rows)
        .encode('x', 'date')
        .encode('y', 'count')
        .encode('color', 'supplierName')
        .encode('shape', 'point')
        .style('r', 2.5)
        .tooltip(false)
    }

    void chart.render()
    return () => {
      chart.destroy()
    }
  }, [domain, mode, range, rows, rowsKey, t])

  if (dates.length === 0 || rows.length === 0) {
    return (
      <div className="vrm-chart-empty">
        {dates.length === 0 ? t('trend.chartEmptyQuery') : t('trend.chartEmptySelection')}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="vrm-chart"
      role="img"
      aria-label={t('trend.chartAria')}
    />
  )
}
