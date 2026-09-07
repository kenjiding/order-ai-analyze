import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { adminColors } from '../../../theme/adminColors'
import type { VendorTrendSupplier } from '../vendorRegionMapTypes'

type Props = {
  suppliers: VendorTrendSupplier[]
  comparableDays: number
  onSelect?: (supplierKey: string) => void
}

type Row = {
  supplierKey: string
  supplierName: string
  changeRate: number
  prevAvg: number
  recentAvg: number
}

const DROP_COLOR = '#dc2626'
const RISE_COLOR = '#16a34a'

export function VendorVolumeChangeBarChart({ suppliers, comparableDays, onSelect }: Props) {
  const { t } = useTranslation('vendorRegionMap')
  const containerRef = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelect)

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  const rows = useMemo<Row[]>(
    () =>
      suppliers
        .filter((supplier): supplier is VendorTrendSupplier & { changeRate: number } =>
          supplier.changeRate != null,
        )
        // 掉得最狠的排最上：这几家最可能先裁司机
        .map((supplier) => ({
          supplierKey: supplier.supplierKey,
          supplierName: supplier.supplierName,
          changeRate: supplier.changeRate,
          prevAvg: supplier.prevAvg,
          recentAvg: supplier.recentAvg,
        }))
        .sort((a, b) => a.changeRate - b.changeRate),
    [suppliers],
  )

  /** 区间内新增的供应商没有环比基数，单列出来而不是塞进排行里 */
  const newcomers = useMemo(
    () => suppliers.filter((supplier) => supplier.changeRate == null && supplier.totalCount > 0),
    [suppliers],
  )

  const rowsKey = useMemo(
    () => rows.map((r) => `${r.supplierName}\t${r.changeRate}`).join('|'),
    [rows],
  )
  const height = Math.min(520, Math.max(160, 60 + rows.length * 34))

  useEffect(() => {
    const el = containerRef.current
    if (!el || rows.length === 0) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      height,
      theme: 'light',
      paddingTop: 8,
      paddingRight: 24,
      paddingBottom: 32,
      paddingLeft: 128,
    })

    chart.scale('x', { type: 'band', paddingInner: 0.32 })
    chart.scale('y', { type: 'linear', nice: true })
    chart.axis('x', { title: false, labelFontSize: 11 })
    chart.axis('y', {
      title: t('trend.barMom'),
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: adminColors.line,
      labelFormatter: (v: number) => `${Math.round(v * 100)}%`,
    })
    chart.interaction('tooltip', true)
    chart.interaction('elementHighlight', true)

    chart
      .interval()
      .coordinate({ transform: [{ type: 'transpose' }] })
      .data(rows)
      .encode('x', 'supplierName')
      .encode('y', 'changeRate')
      .style('fill', (d: Row) => (d.changeRate < 0 ? DROP_COLOR : RISE_COLOR))
      .style('fillOpacity', 0.85)
      .tooltip({
        title: (d: Row) => d.supplierName,
        items: [
          {
            name: t('trend.barMom'),
            field: 'changeRate',
            valueFormatter: (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`,
          },
          { name: t('trend.barPrevAvg'), field: 'prevAvg', valueFormatter: (v: number) => v.toFixed(1) },
          { name: t('trend.barRecentAvg'), field: 'recentAvg', valueFormatter: (v: number) => v.toFixed(1) },
        ],
      })

    chart.on('element:click', (event: { data?: { data?: Row } }) => {
      const key = event.data?.data?.supplierKey
      if (key) onSelectRef.current?.(key)
    })

    void chart.render()
    return () => {
      chart.destroy()
    }
  }, [height, rows, rowsKey, t])

  if (rows.length === 0) {
    return (
      <div className="vrm-chart-empty">
        {comparableDays < 2 ? t('trend.barInsufficient') : t('trend.barAllNew')}
      </div>
    )
  }

  return (
    <div>
      <div
        ref={containerRef}
        className="vrm-chart vrm-chart--clickable"
        role="img"
        aria-label={t('trend.barAria')}
      />
      {newcomers.length > 0 ? (
        <p className="vrm-chart-note">
          {t('trend.newInRange')}
          {newcomers.map((supplier) => supplier.supplierName).join('、')}
        </p>
      ) : null}
    </div>
  )
}
