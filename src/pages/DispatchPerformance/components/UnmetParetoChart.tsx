import { Alert, Empty, Radio, Tag, Tooltip } from 'antd'
import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminColors } from '../../../theme/adminColors'
import { buildPareto, type ParetoDimension, type ParetoMetric } from '../paretoAnalytics'
import type { DispatchSupplierNode } from '../dispatchPerformanceTypes'

type Props = {
  suppliers: DispatchSupplierNode[]
  settled: boolean
}

const TOP_N = 12
const BAR_COLOR = '#dc2626'

const DIMENSIONS: ParetoDimension[] = ['driver', 'route', 'supplier']
const METRICS: ParetoMetric[] = ['priority', 'nextDay']

/**
 * 未达成单量的帕累托图：柱子按未达成量降序，排序即修复优先级。
 *
 * 按单量而不是按率排序：3 单错 1 单 = 66% 看着比 1000 单错 50 单刺眼，但后者才是该先修的。
 * 累计占比不画第二根轴，放进 tooltip 与上方的集中度标签——一个数字就够回答
 * 「是少数人拖的还是全员问题」，为此加一根双轴折线不值。
 */
export function UnmetParetoChart({ suppliers, settled }: Props) {
  const { t } = useTranslation('dispatchPerformance')
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimension, setDimension] = useState<ParetoDimension>('driver')
  const [metric, setMetric] = useState<ParetoMetric>('priority')

  const pareto = useMemo(
    () => buildPareto(suppliers, dimension, metric, TOP_N),
    [dimension, metric, suppliers],
  )

  const drawable = settled && pareto.items.length > 0
  const dataKey = useMemo(
    () => pareto.items.map((i) => `${i.key}:${i.unmet}`).join('|'),
    [pareto.items],
  )
  const height = Math.min(520, Math.max(220, 80 + pareto.items.length * 30))

  useEffect(() => {
    const el = containerRef.current
    if (!el || !drawable) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      height,
      theme: 'light',
      paddingTop: 16,
      paddingRight: 56,
      paddingBottom: 48,
      paddingLeft: 140,
    })

    const data = pareto.items
    chart.scale('x', { type: 'band', paddingInner: 0.3 })
    chart.scale('y', { type: 'linear', nice: true, domainMin: 0 })
    chart.axis('x', { title: false, labelFontSize: 11 })
    chart.axis('y', {
      title: t('pareto.axisUnmet'),
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: adminColors.line,
    })
    chart.interaction('tooltip', true)

    const interval = chart.interval()
    interval.coordinate({ transform: [{ type: 'transpose' }] })
    interval
      .data(data)
      .encode('x', 'label')
      .encode('y', 'unmet')
      .style('fill', BAR_COLOR)
      .style('fillOpacity', 0.85)
      .style('radius', 2)
      .label({ text: 'unmet', position: 'right', fontSize: 11, fill: adminColors.text })
      .tooltip({
        title: (d: (typeof data)[number]) => d.label,
        items: [
          { name: t('pareto.tooltipUnmet'), field: 'unmet' },
          { name: t('pareto.tooltipTotal'), field: 'total' },
          {
            name: t('pareto.tooltipRate'),
            field: 'rate',
            valueFormatter: (v: number | null) => (v == null ? '—' : `${v}%`),
          },
          {
            name: t('pareto.tooltipCumulative'),
            field: 'cumulativeShare',
            valueFormatter: (v: number) => `${v}%`,
          },
        ],
      })

    void chart.render()
    return () => {
      chart.destroy()
    }
  }, [dataKey, drawable, height, pareto.items, t])

  return (
    <section className="admin-panel space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="admin-title text-xl">{t('pareto.title')}</h3>
          <p className="mt-1 text-sm text-slate-500">{t('pareto.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Radio.Group
            value={metric}
            onChange={(e) => setMetric(e.target.value as ParetoMetric)}
            optionType="button"
            options={METRICS.map((m) => ({ label: t(`pareto.metric.${m}`), value: m }))}
          />
          <Radio.Group
            value={dimension}
            onChange={(e) => setDimension(e.target.value as ParetoDimension)}
            optionType="button"
            options={DIMENSIONS.map((d) => ({ label: t(`pareto.dimension.${d}`), value: d }))}
          />
        </div>
      </div>

      {!settled ? (
        <Alert type="info" showIcon message={t('pareto.settling')} />
      ) : pareto.items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('pareto.allMet')} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{t('pareto.unmetTotal', { count: pareto.unmetTotal, items: pareto.itemCount })}</span>
            {pareto.top20Share == null ? null : (
              <Tooltip title={t('pareto.top20Tooltip')}>
                <Tag
                  color={pareto.top20Share >= 50 ? 'red' : 'default'}
                  className="m-0 cursor-help text-xs"
                >
                  {t('pareto.top20', { share: pareto.top20Share })}
                </Tag>
              </Tooltip>
            )}
            {pareto.itemCount > TOP_N ? (
              <span>{t('pareto.truncated', { shown: TOP_N })}</span>
            ) : null}
          </div>
          <div ref={containerRef} role="img" aria-label={t('pareto.title')} />
        </>
      )}
    </section>
  )
}
