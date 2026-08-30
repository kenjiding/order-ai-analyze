import { Tooltip } from 'antd'
import type { DispatchQuadrant } from '../dispatchPerformanceTypes'

type Props = {
  quadrant: DispatchQuadrant
  total: number
}

/**
 * 四象限堆叠条：一眼看出「未达标的单是卡在仓库还是卡在司机」。
 *
 * 颜色语义按归因责任排，不是按好坏排：
 *   绿 = 双达标；橙 = 出仓达标但派签没跟上（司机侧）；
 *   蓝 = 出仓晚了但司机赶回来了；红 = 双未达标（仓库晚出仓拖垮派签）。
 * 橙和红是运营真正要动的两块，所以给了最醒目的两个色。
 */
const SEGMENTS = [
  { key: 'exitMetSignMet', label: '准时出仓·按时派签', color: 'var(--admin-success, #16a34a)' },
  { key: 'exitMetSignUnmet', label: '准时出仓·派签超时（司机侧）', color: '#f59e0b' },
  { key: 'exitUnmetSignMet', label: '出仓超时·派签仍达标', color: '#3b82f6' },
  { key: 'exitUnmetSignUnmet', label: '出仓超时·派签超时（连锁）', color: '#dc2626' },
] as const

export function QuadrantBar({ quadrant, total }: Props) {
  if (total <= 0) return <span className="text-slate-300">—</span>

  const pct = (value: number) => (value / total) * 100

  return (
    <Tooltip
      title={
        <div className="space-y-1">
          {SEGMENTS.map((seg) => {
            const value = quadrant[seg.key]
            return (
              <div key={seg.key} className="flex items-center gap-2 whitespace-nowrap">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: seg.color }}
                  aria-hidden
                />
                <span className="flex-1">{seg.label}</span>
                <span className="tabular-nums font-medium">
                  {value} ({pct(value).toFixed(1)}%)
                </span>
              </div>
            )
          })}
        </div>
      }
    >
      <div
        className="flex h-2.5 w-full min-w-[120px] overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={`四象限分布，共 ${total} 单`}
      >
        {SEGMENTS.map((seg) => {
          const value = quadrant[seg.key]
          if (value <= 0) return null
          return (
            <div
              key={seg.key}
              style={{ width: `${pct(value)}%`, backgroundColor: seg.color }}
              aria-hidden
            />
          )
        })}
      </div>
    </Tooltip>
  )
}

/** 图例：放在表头附近，让四条色带的含义不必靠悬停才知道 */
export function QuadrantLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
      {SEGMENTS.map((seg) => (
        <span key={seg.key} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: seg.color }}
            aria-hidden
          />
          {seg.label}
        </span>
      ))}
    </div>
  )
}
