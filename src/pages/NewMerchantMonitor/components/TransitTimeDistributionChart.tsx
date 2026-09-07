import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { TransitBucket } from '../metrics'

type Props = {
  buckets: TransitBucket[]
}

const ACCENT = '#1f6f68'
const ACCENT_LIGHT = '#7BB8B1'

export default function TransitTimeDistributionChart({ buckets }: Props) {
  const { t } = useTranslation('newMerchant')
  const containerRef = useRef<HTMLDivElement>(null)

  const totalCount = useMemo(() => buckets.reduce((sum, b) => sum + b.count, 0), [buckets])
  const dataKey = useMemo(() => buckets.map((b) => `${b.label}:${b.count}`).join('|'), [buckets])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (totalCount === 0) return

    const data = buckets.map((b) => ({
      label: b.label,
      percent: Number(b.percent.toFixed(2)),
      count: b.count,
    }))

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: 280,
      theme: 'light',
      paddingTop: 24,
      paddingRight: 24,
      paddingBottom: 36,
      paddingLeft: 56,
    })

    chart.scale('x', { type: 'band', paddingInner: 0.4 })
    chart.scale('y', {
      type: 'linear',
      nice: true,
      domainMin: 0,
    })

    chart.axis('y', {
      title: t('transit.axisPercent'),
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: '#e2e8f0',
    })
    chart.axis('x', { title: t('transit.axisDuration') })

    chart.interaction('tooltip', true)

    chart
      .interval()
      .data(data)
      .encode('x', 'label')
      .encode('y', 'percent')
      .style('fill', (d: (typeof data)[number]) => (d.label === '>4D' ? ACCENT_LIGHT : ACCENT))
      .style('fillOpacity', 0.9)
      .style('radiusTopLeft', 6)
      .style('radiusTopRight', 6)
      .tooltip({
        title: (d: (typeof data)[number]) => d.label,
        items: [
          { name: t('transit.tooltipPercent'), field: 'percent', valueFormatter: (v: number) => `${v.toFixed(2)}%` },
          { name: t('transit.tooltipCount'), field: 'count' },
        ],
      })

    chart
      .text()
      .data(data)
      .encode('x', 'label')
      .encode('y', 'percent')
      .encode('text', (d: (typeof data)[number]) => `${d.percent.toFixed(1)}%`)
      .style('textAlign', 'center')
      .style('textBaseline', 'bottom')
      .style('dy', -6)
      .style('fontSize', 12)
      .style('fill', '#334155')

    void chart.render()

    return () => {
      chart.destroy()
    }
  }, [buckets, dataKey, totalCount, t])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-700">{t('transit.title')}</div>
          <div className="text-xs text-slate-500">{t('transit.subtitle')}</div>
        </div>
        <div className="text-xs text-slate-500">
          {t('transit.validSamples', { count: totalCount.toLocaleString('en-US') })}
        </div>
      </div>
      {totalCount === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400">{t('transit.empty')}</div>
      ) : (
        <div ref={containerRef} className="w-full" />
      )}
    </div>
  )
}
