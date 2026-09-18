import { Alert, Tag, Tooltip } from 'antd'
import { Chart } from '@antv/g2'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { adminColors } from '../../../theme/adminColors'
import { buildAttribution, type AttributionInput } from '../attributionBreakdown'

type Props = {
  title: string
  input: AttributionInput
  /** 派签未结算时整张图没有意义：次日达标数恒为 0，画出来是一片假的未达成 */
  settled: boolean
}

const HEIGHT = 200

/** 瀑布四段的配色：损失两段用告警色区分归属，达成用成功色 */
const BAR_COLORS = {
  total: adminColors.tableHeader,
  exitLate: '#dc2626',
  dispatchSlow: '#f59e0b',
  met: '#16a34a',
} as const

type Bar = {
  label: string
  /** 柱子的起止值，G2 的区间柱 */
  start: number
  end: number
  kind: keyof typeof BAR_COLORS
  /** 柱子上要显示的数：起止两段是减去的量，首尾两段是存量 */
  amount: number
  hint: string
}

/**
 * 次日达成率的归因瀑布：总量 → 减「出仓就晚了」→ 减「出仓准点却没派掉」→ 达成。
 *
 * 两段损失对应两个不同的部门：前者去催分拣出仓，后者去管司机与负载。
 * 「出仓晚但赶回来了」不单独占一段（它没造成损失），只在文案里作为杠杆的分子出现。
 */
export function AttributionWaterfall({ title, input, settled }: Props) {
  const { t } = useTranslation('dispatchPerformance')
  const containerRef = useRef<HTMLDivElement>(null)

  const b = useMemo(() => buildAttribution(input), [input])

  const bars: Bar[] = useMemo(() => {
    const afterExitLate = b.total - b.exitUnmetSignUnmet
    return [
      {
        label: t('attribution.barTotal'),
        start: 0,
        end: b.total,
        kind: 'total',
        amount: b.total,
        hint: t('attribution.hintTotal'),
      },
      {
        label: t('attribution.barExitLate'),
        start: afterExitLate,
        end: b.total,
        kind: 'exitLate',
        amount: b.exitUnmetSignUnmet,
        hint: t('attribution.hintExitLate'),
      },
      {
        label: t('attribution.barDispatchSlow'),
        start: afterExitLate - b.exitMetSignUnmet,
        end: afterExitLate,
        kind: 'dispatchSlow',
        amount: b.exitMetSignUnmet,
        hint: t('attribution.hintDispatchSlow'),
      },
      {
        label: t('attribution.barMet'),
        start: 0,
        end: b.met,
        kind: 'met',
        amount: b.met,
        hint: t('attribution.hintMet'),
      },
    ]
  }, [b, t])

  const drawable = settled && b.total > 0 && !b.inconsistent
  const barsKey = useMemo(() => bars.map((bar) => `${bar.start}-${bar.end}`).join('|'), [bars])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !drawable) return

    const chart = new Chart({
      container: el,
      autoFit: true,
      height: HEIGHT,
      theme: 'light',
      paddingTop: 20,
      paddingRight: 16,
      paddingBottom: 44,
      paddingLeft: 56,
    })

    chart.scale('x', { type: 'band', paddingInner: 0.4 })
    chart.scale('y', { type: 'linear', nice: true, domainMin: 0 })
    chart.axis('y', { title: false, grid: true, gridLineDash: [4, 4], gridStroke: adminColors.line })
    chart.axis('x', { title: false, labelFontSize: 11 })
    chart.interaction('tooltip', true)

    chart
      .interval()
      .data(bars)
      .encode('x', 'label')
      .encode('y', ['start', 'end'])
      .style('fill', (d: Bar) => BAR_COLORS[d.kind])
      .style('fillOpacity', 0.9)
      .style('radius', 3)
      .label({
        text: (d: Bar) => (d.kind === 'total' || d.kind === 'met' ? `${d.amount}` : `-${d.amount}`),
        position: 'top',
        fontSize: 12,
        fill: adminColors.text,
      })
      .tooltip({
        title: (d: Bar) => d.label,
        items: [
          { name: t('attribution.tooltipCount'), field: 'amount' },
          { name: t('attribution.tooltipMeaning'), field: 'hint' },
        ],
      })

    void chart.render()
    return () => {
      chart.destroy()
    }
  }, [bars, barsKey, drawable, t])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        {drawable ? (
          <span className="text-xs text-slate-500">
            {t('attribution.rateSummary', {
              rate: b.rate?.toFixed(2) ?? '—',
              met: b.met,
              total: b.total,
            })}
          </span>
        ) : null}
      </div>

      {!settled ? (
        <Alert type="info" showIcon message={t('attribution.settling')} />
      ) : b.inconsistent ? (
        <Alert type="warning" showIcon message={t('attribution.needsResettle')} />
      ) : b.total === 0 ? (
        <Alert type="info" showIcon message={t('attribution.noData')} />
      ) : (
        <>
          <div ref={containerRef} role="img" aria-label={title} />
          {b.lift == null ? null : (
            <Tooltip title={t('attribution.liftTooltip')}>
              <div className="flex cursor-help flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>
                  {t('attribution.liftExitMet', {
                    rate: b.rateWhenExitMet?.toFixed(2),
                    count: b.exitMetSignMet + b.exitMetSignUnmet,
                  })}
                </span>
                <span>
                  {t('attribution.liftExitUnmet', {
                    rate: b.rateWhenExitUnmet?.toFixed(2),
                    count: b.exitUnmetSignMet + b.exitUnmetSignUnmet,
                  })}
                </span>
                <Tag color={b.lift > 0 ? 'green' : 'default'} className="m-0 text-xs">
                  {t('attribution.liftValue', { lift: b.lift > 0 ? `+${b.lift}` : `${b.lift}` })}
                </Tag>
              </div>
            </Tooltip>
          )}
        </>
      )}
    </div>
  )
}
