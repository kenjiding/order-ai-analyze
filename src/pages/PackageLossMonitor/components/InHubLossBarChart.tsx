import { Button } from 'antd'
import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { adminColors } from '../../../theme/adminColors'
import type { CountDatum, DrillCrumb } from '../inHubLossAnalytics'
import { categoryColorMap } from '../lossChartColors'

type Props<TPath> = {
  title: string
  caption?: string
  data: CountDatum[]
  emptyText: string
  ariaLabel: string
  crumbs?: DrillCrumb<TPath>[]
  /** true 时柱形竖立（类目在 x 轴），默认横向 */
  vertical?: boolean
  /** true 时每个类目取不同颜色，与桑基图共用同一套色板 */
  colorByKey?: boolean
  onBarClick?: (key: string) => void
  onCrumbClick?: (path: TPath) => void
}

const VERTICAL_HEIGHT = 320

export function InHubLossBarChart<TPath>({
  title,
  caption,
  data,
  emptyText,
  ariaLabel,
  crumbs,
  vertical = false,
  colorByKey = false,
  onBarClick,
  onCrumbClick,
}: Props<TPath>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onBarClickRef = useRef(onBarClick)
  const height = vertical ? VERTICAL_HEIGHT : Math.min(480, Math.max(160, 80 + data.length * 36))
  const dataKey = useMemo(() => data.map((d) => `${d.key}:${d.count}`).join('|'), [data])
  const interactive = Boolean(onBarClick)
  const colors = useMemo(
    () => (colorByKey ? categoryColorMap(data.map((d) => d.key)) : null),
    [colorByKey, data],
  )

  useEffect(() => {
    onBarClickRef.current = onBarClick
  }, [onBarClick])

  useEffect(() => {
    const el = containerRef.current
    if (!el || data.length === 0) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      height,
      theme: 'light',
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: vertical ? 64 : 12,
      paddingLeft: vertical ? 48 : 108,
    })

    chart.scale('x', { type: 'band', paddingInner: 0.28 })
    chart.scale('y', { type: 'linear', nice: true, domainMin: 0 })
    chart.axis('y', {
      title: false,
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: adminColors.line,
    })
    chart.axis('x', {
      title: false,
      labelFontSize: 11,
      labelAutoRotate: vertical,
      labelAutoHide: vertical,
    })
    chart.interaction('tooltip', true)
    if (interactive) chart.interaction('elementHighlight', true)

    const interval = chart.interval()
    if (!vertical) interval.coordinate({ transform: [{ type: 'transpose' }] })
    interval
      .data(data)
      .encode('x', 'key')
      .encode('y', 'count')
      .style('fill', (d: CountDatum) => colors?.get(d.key) ?? adminColors.accent)
      .style('fillOpacity', 0.9)
      .tooltip({
        title: (d: CountDatum) => d.key,
        items: [
          { name: '单量', field: 'count' },
          {
            name: '占比',
            field: 'share',
            valueFormatter: (v: number) => `${Math.round(v * 100)}%`,
          },
        ],
      })

    if (interactive) {
      chart.on('element:click', (event: { data?: { data?: CountDatum } }) => {
        const key = event.data?.data?.key
        if (key) onBarClickRef.current?.(key)
      })
    }

    void chart.render()
    return () => {
      chart.destroy()
    }
  }, [colors, data, dataKey, height, interactive, vertical])

  return (
    <div>
      <h4 className="package-loss-viz-kicker">{title}</h4>
      {caption ? <p className="package-loss-viz-caption">{caption}</p> : null}
      {crumbs && crumbs.length > 0 ? (
        <nav className="package-loss-viz-crumbs" aria-label={`${title}下钻路径`}>
          {crumbs.map((crumb, index) => {
            const isCurrent = index === crumbs.length - 1
            return (
              <span key={`${crumb.label}-${index}`} className="package-loss-viz-crumb">
                {index > 0 ? <span className="package-loss-viz-crumb-sep">/</span> : null}
                {isCurrent || !onCrumbClick ? (
                  <span className="package-loss-viz-crumb-current">{crumb.label}</span>
                ) : (
                  <Button type="link" onClick={() => onCrumbClick(crumb.path)}>
                    {crumb.label}
                  </Button>
                )}
              </span>
            )
          })}
        </nav>
      ) : null}
      {data.length === 0 ? (
        <p className="package-loss-viz-empty">{emptyText}</p>
      ) : (
        <div
          ref={containerRef}
          className={interactive ? 'package-loss-bar-chart--interactive' : undefined}
          role="img"
          aria-label={ariaLabel}
        />
      )}
    </div>
  )
}
