import { Button } from 'antd'
import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { adminColors } from '../../../theme/adminColors'
import type { CountDatum, ScopeDrillCrumb, ScopeDrillPath } from '../inHubLossAnalytics'

type Props = {
  title: string
  caption?: string
  data: CountDatum[]
  emptyText: string
  ariaLabel: string
  crumbs?: ScopeDrillCrumb[]
  onBarClick?: (key: string) => void
  onCrumbClick?: (path: ScopeDrillPath) => void
}

export function InHubLossBarChart({
  title,
  caption,
  data,
  emptyText,
  ariaLabel,
  crumbs,
  onBarClick,
  onCrumbClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onBarClickRef = useRef(onBarClick)
  const height = Math.min(480, Math.max(160, 80 + data.length * 36))
  const dataKey = useMemo(() => data.map((d) => `${d.key}:${d.count}`).join('|'), [data])
  const interactive = Boolean(onBarClick)

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
      paddingBottom: 12,
      paddingLeft: 108,
    })

    chart.scale('x', { type: 'band', paddingInner: 0.28 })
    chart.scale('y', { type: 'linear', nice: true, domainMin: 0 })
    chart.axis('y', {
      title: false,
      grid: true,
      gridLineDash: [4, 4],
      gridStroke: adminColors.line,
    })
    chart.axis('x', { title: false, labelFontSize: 11 })
    chart.interaction('tooltip', true)
    if (interactive) chart.interaction('elementHighlight', true)

    chart
      .interval()
      .coordinate({ transform: [{ type: 'transpose' }] })
      .data(data)
      .encode('x', 'key')
      .encode('y', 'count')
      .style('fill', adminColors.accent)
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
  }, [data, dataKey, height, interactive])

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
