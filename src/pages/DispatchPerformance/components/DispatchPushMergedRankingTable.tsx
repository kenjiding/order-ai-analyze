import { Award, Medal, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DISPATCH_RANKING_METRIC_KEYS,
  type DispatchRankingMetricKey,
  type DispatchRankingPoolResult,
} from '../../../../shared/dispatchPerformance/rankingScore'
import type { DispatchSupplierNode } from '../dispatchPerformanceTypes'
import { PUSH_MERGED_RANKING_SECTION_ID } from '../dispatchPushCapture'
import { dispatchPushMetricLabelKey, type DispatchPushMetricKey } from '../dispatchPushMetrics'
import { MetricValue } from './DispatchPushSupplierCard'

/** 前三名奖章图标，跟 DispatchPushSupplierCard 的 RANK_TIER 同一套配色含义，但这里是浅底表格，用深色图标 */
const RANK_MEDAL: Record<number, { Icon: typeof Trophy; color: string }> = {
  1: { Icon: Trophy, color: 'text-amber-500' },
  2: { Icon: Medal, color: 'text-slate-400' },
  3: { Icon: Award, color: 'text-orange-400' },
}

function RankCell({ rank }: { rank: number }) {
  const tier = RANK_MEDAL[rank]
  return (
    <span className="inline-flex items-center gap-1 font-mono text-sm font-semibold text-slate-700">
      {tier ? <tier.Icon className={`h-4 w-4 ${tier.color}`} aria-hidden /> : null}
      {rank}
    </span>
  )
}

/** 浅底表格上的分数配色，含义与 DispatchPushSupplierCard 的 scoreToneOnDark 一致，只是换成适配白底的深色调 */
function scoreTone(score: number): string {
  if (score >= 90) return 'text-emerald-600'
  if (score >= 70) return 'text-amber-600'
  return 'text-rose-600'
}

/**
 * 合并排名推送模式下的汇总表：全部供应商一张图，只展示排名/综合分/勾选指标，
 * 不展开路由码明细。推给哪些供应商群由外层勾选决定，这里显示的供应商范围固定不受那个勾选影响。
 */
export function DispatchPushMergedRankingTable({
  suppliers,
  rankingPool,
  metricKeys,
  dayCount,
  weights,
}: {
  /** 当前区间内有数据的供应商（= DispatchDataPushModal 的 pushableSuppliers） */
  suppliers: DispatchSupplierNode[]
  rankingPool: DispatchRankingPoolResult
  metricKeys: DispatchPushMetricKey[]
  dayCount: number
  /** 「供应商综合排名」当前生效的权重，印在图上让供应商知道分数怎么算出来的 */
  weights: Record<DispatchRankingMetricKey, number>
}) {
  const { t } = useTranslation('dispatchPerformance')
  const settlingLabel = t('breakdown.settling')
  const supplierByKey = new Map(suppliers.map((s) => [s.supplierKey, s]))
  const rows = rankingPool.rankings.filter((r) => supplierByKey.has(r.supplierKey))
  const weightSummary = DISPATCH_RANKING_METRIC_KEYS.map((key) => ({
    key,
    pct: Math.round((weights[key] ?? 0) * 100),
  }))
    .filter(({ pct }) => pct !== 0)
    .map(({ key, pct }) => `${t(`ranking.metrics.${key}`)} ${pct}%`)
    .join(' · ')

  return (
    <div
      id={PUSH_MERGED_RANKING_SECTION_ID}
      data-push-capture-root
      className="overflow-hidden rounded-xl bg-white shadow-md shadow-slate-900/10"
    >
      <div className="bg-gradient-to-br from-teal-500 via-emerald-500 to-teal-600 px-5 py-4">
        <div className="text-lg font-bold text-white">{t('push.mergedTableTitle')}</div>
        <div className="mt-1 text-xs font-medium text-teal-950">
          {t('push.mergedWeightPrefix')}
          {weightSummary}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-base">
          <thead>
            <tr className="border-b border-slate-200 bg-teal-50">
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-teal-800">
                {t('push.mergedRankColumn')}
              </th>
              <th className="min-w-[160px] whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-teal-800">
                {t('push.mergedSupplierColumn')}
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-teal-800">
                {t('push.mergedScoreColumn')}
              </th>
              {metricKeys.map((key) => (
                <th
                  key={key}
                  className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-teal-800"
                >
                  {t(dispatchPushMetricLabelKey(key))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((r, idx) => {
              const supplier = supplierByKey.get(r.supplierKey)!
              return (
                <tr key={r.supplierKey} className={idx % 2 === 1 ? 'bg-slate-50' : ''}>
                  <td className="px-4 py-2">
                    <RankCell rank={r.rank} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                    <div className="font-sans font-semibold">{supplier.supplierName}</div>
                    <div className="text-xs text-slate-400">{supplier.vendorCode}</div>
                  </td>
                  <td className={`px-4 py-2 text-right text-lg font-bold tabular-nums ${scoreTone(r.score)}`}>
                    {r.score.toFixed(1)}
                  </td>
                  {metricKeys.map((key) => (
                    <td key={key} className="px-4 py-2 text-right tabular-nums">
                      <MetricValue metricKey={key} row={supplier} dayCount={dayCount} settlingLabel={settlingLabel} />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
