import { Trophy } from 'lucide-react'
import { useState } from 'react'
import {
  DEFAULT_RANKING_WEIGHTS,
  RANKING_METRIC_LABELS_ZH,
  type RankingPoolResult,
  type VendorRankingResult,
} from '../../../../shared/vendorAnalysis/rankingScore'

type Props = {
  pool: RankingPoolResult
  /** supplierKey → 展示名（同 vendorCode 可能有多家，只有 supplierKey 唯一） */
  nameByCode: Map<string, string>
}

function scoreTone(score: number): string {
  if (score >= 90) return 'text-emerald-600'
  if (score >= 70) return 'text-amber-600'
  return 'text-rose-600'
}

function RankBadge({ rank }: { rank: number }) {
  const cls =
    rank === 1
      ? 'bg-amber-400 text-white'
      : rank === 2
        ? 'bg-slate-400 text-white'
        : rank === 3
          ? 'bg-orange-400 text-white'
          : 'bg-slate-100 text-slate-600'
  return (
    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-black tabular-nums ${cls}`}>
      {rank}
    </span>
  )
}

function BreakdownPanel({ row }: { row: VendorRankingResult }) {
  return (
    <div className="border-t border-[var(--admin-line)] bg-slate-50/80 px-4 py-3">
      <div className="mb-2 text-[11px] font-semibold text-slate-500">
        分项贡献（权重已按启用指标重归一化）
        {row.sampleInsufficient && (
          <span className="ml-2 font-medium text-amber-600">样本不足，仅供参考</span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {row.breakdown.map((b) => (
          <div
            key={b.key}
            className={`rounded-lg border px-3 py-2 ${
              b.included ? 'border-slate-200 bg-white' : 'border-dashed border-slate-200 bg-slate-50 opacity-70'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">{b.label}</span>
              <span className="text-[11px] tabular-nums text-slate-400">
                {b.included ? `权 ${(b.weight * 100).toFixed(0)}%` : b.insufficientSample ? '样本不足' : '未启用'}
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-base font-bold tabular-nums ${b.score != null ? scoreTone(b.score) : 'text-slate-300'}`}>
                {b.score != null ? b.score.toFixed(1) : '—'}
              </span>
              {b.ticketsToGreen != null && b.ticketsToGreen > 0 && (
                <span className="text-[11px] font-medium text-rose-500">
                  {b.key === 'vendor.complaintRate' ? `超绿线 ${b.ticketsToGreen} 件` : `还差 ${b.ticketsToGreen} 票`}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 运营预览：勾选供应商综合排名榜 */
export function VendorRankingBoard({ pool, nameByCode }: Props) {
  const [expandedCode, setExpandedCode] = useState<string | null>(null)

  if (pool.poolSize < 2) {
    return (
      <div className="border-b border-[var(--admin-line)] px-5 py-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Trophy className="h-4 w-4 text-slate-400" aria-hidden />
          综合排名需至少勾选 2 家供应商才有对标意义
        </div>
      </div>
    )
  }

  const weightHint = Object.entries(DEFAULT_RANKING_WEIGHTS)
    .map(([k, w]) => `${RANKING_METRIC_LABELS_ZH[k as keyof typeof DEFAULT_RANKING_WEIGHTS]} ${(w * 100).toFixed(0)}%`)
    .join(' · ')

  return (
    <div className="border-b border-[var(--admin-line)]">
      <div className="flex flex-wrap items-end gap-3 bg-[var(--admin-surface-soft)] px-5 py-3">
        <div>
          <div className="admin-eyebrow">Ranking</div>
          <h4 className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Trophy className="h-4 w-4 text-amber-500" aria-hidden />
            供应商综合排名
          </h4>
        </div>
        <div className="ml-auto flex flex-wrap gap-3 text-xs text-slate-500">
          <span>
            池均分{' '}
            <span className="font-semibold tabular-nums text-slate-700">
              {pool.poolMedianScore != null ? pool.poolMedianScore.toFixed(1) : '—'}
            </span>
          </span>
          <span>
            榜首{' '}
            <span className="font-semibold tabular-nums text-emerald-600">
              {pool.topScore != null ? pool.topScore.toFixed(1) : '—'}
            </span>
          </span>
          <span>
            垫底{' '}
            <span className="font-semibold tabular-nums text-rose-600">
              {pool.bottomScore != null ? pool.bottomScore.toFixed(1) : '—'}
            </span>
          </span>
        </div>
      </div>
      <p className="border-b border-[var(--admin-line)] px-5 py-2 text-[11px] leading-relaxed text-slate-400">
        默认权重：{weightHint}。件数按千票密度归一；出仓/派签分母 &lt;30、客诉窗口运单 &lt;500 不参与加权。
      </p>
      <div className="divide-y divide-[var(--admin-line)]">
        {pool.rankings.map((row) => {
          const name = nameByCode.get(row.supplierKey) ?? row.vendorCode
          const open = expandedCode === row.supplierKey
          return (
            <div key={row.supplierKey}>
              <button
                type="button"
                onClick={() => setExpandedCode(open ? null : row.supplierKey)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50"
              >
                <RankBadge rank={row.rank} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-800">{name}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {row.vendorCode}
                    {row.sampleInsufficient ? ' · 样本不足' : null}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-black tabular-nums ${scoreTone(row.score)}`}>
                    {row.score.toFixed(1)}
                  </div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">综合分</div>
                </div>
              </button>
              {open && <BreakdownPanel row={row} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
