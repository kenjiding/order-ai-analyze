import { useTranslation } from 'react-i18next'
import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import type { RouteZoneGroup } from './cancelScanRouteZoneTable'
import { getZoneColorTheme } from './cancelScanZoneColors'

export type CancelScanZoneChartRow = {
  zone: string
  label: string
  count: number
  fill: string
  selected: boolean
  errorRateLabel?: string | null
}

type Props = {
  groups: RouteZoneGroup[]
  selectedZone: string | null
  onZoneSelect: (zone: string) => void
  className?: string
}

function zoneChartLabel(zone: string): string {
  return zone.replace(/区$/, '') || zone
}

function buildChartRows(groups: RouteZoneGroup[], selectedZone: string | null): CancelScanZoneChartRow[] {
  return groups.map((group) => ({
    zone: group.zone,
    label: zoneChartLabel(group.zone),
    count: group.zoneTotal,
    fill: getZoneColorTheme(group.zone).accent,
    selected: group.zone === selectedZone,
    errorRateLabel:
      group.errorRate != null && Number.isFinite(group.errorRate)
        ? `${(group.errorRate * 100).toFixed(2)}%`
        : null,
  }))
}

export default function CancelScanZoneBarChart({
  groups,
  selectedZone,
  onZoneSelect,
  className,
}: Props) {
  const { t } = useTranslation('scannerEfficiency')
  const containerRef = useRef<HTMLDivElement>(null)
  const onZoneSelectRef = useRef(onZoneSelect)

  useEffect(() => {
    onZoneSelectRef.current = onZoneSelect
  }, [onZoneSelect])

  const rows = useMemo(() => buildChartRows(groups, selectedZone), [groups, selectedZone])

  const rowsKey = useMemo(
    () => rows.map((row) => `${row.zone}\t${row.count}\t${row.selected}`).join('|'),
    [rows],
  )

  useEffect(() => {
    if (!rows.length) return
    const el = containerRef.current
    if (!el) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: 260,
      theme: 'light',
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 36,
      paddingLeft: 48,
    })

    chart.scale('x', { type: 'band', paddingInner: 0.28, paddingOuter: 0.12 })
    chart.scale('y', { type: 'linear', nice: true, domainMin: 0 })

    chart.axis('x', {
      title: false,
      labelFill: '#475569',
      labelFontSize: 13,
      labelFontWeight: 600,
    })

    chart.axis('y', {
      title: t('chart.cancelScanWaybillTitle'),
      titleFill: '#64748b',
      titleFontSize: 13,
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: '#e2e8f0',
      labelFill: '#64748b',
      labelFontSize: 15,
    })

    chart.interaction('tooltip', true)

    chart
      .interval()
      .data(rows)
      .encode('x', 'label')
      .encode('y', 'count')
      .style('fill', (d: CancelScanZoneChartRow) => d.fill)
      .style('fillOpacity', (d: CancelScanZoneChartRow) => (d.selected ? 0.95 : 0.62))
      .style('stroke', (d: CancelScanZoneChartRow) => (d.selected ? d.fill : 'transparent'))
      .style('lineWidth', (d: CancelScanZoneChartRow) => (d.selected ? 2 : 0))
      .style('radiusTopLeft', 6)
      .style('radiusTopRight', 6)
      .label({
        text: (d: CancelScanZoneChartRow) => {
          if (d.count <= 0) return ''
          if (d.errorRateLabel) return `${d.count}\n${d.errorRateLabel}`
          return String(d.count)
        },
        position: 'top',
        fill: 'black',
        fontSize: 18,
        fontWeight: 600,
        dy: -6,
      })

    chart.on('element:click', (event: { data?: { data?: CancelScanZoneChartRow } }) => {
      const zone = event.data?.data?.zone
      if (zone) onZoneSelectRef.current(zone)
    })

    void chart.render()

    return () => {
      chart.destroy()
    }
  }, [rows, rowsKey])

  if (!rows.length) {
    return (
      <div
        className={[
          'flex min-h-[220px] items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/80 text-sm text-slate-500',
          className ?? '',
        ].join(' ')}
      >
        {t('cancelScan.zoneChartEmpty')}
      </div>
    )
  }

  return (
    <div className={['cancel-scan-zone-chart', className ?? ''].join(' ')}>
      <div className="cancel-scan-zone-chart__caption">
        <span className="cancel-scan-zone-chart__title">{t('chart.cancelScanZoneTitle')}</span>
        <span className="cancel-scan-zone-chart__hint">
          {t('cancelScan.zoneChartClickHint')}
          {rows.some((row) => row.errorRateLabel) ? t('chart.cancelScanZoneShareHint') : ''}
        </span>
      </div>
      <div
        ref={containerRef}
        className="cancel-scan-zone-chart__canvas min-h-[260px] w-full cursor-pointer"
        role="img"
        aria-label={t('chart.cancelScanZoneAria')}
      />
    </div>
  )
}
