import { Button, InputNumber, Popover, Slider } from 'antd'
import { ChevronDown, SlidersHorizontal, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DISPATCH_RANKING_METRIC_KEYS,
  rankDispatchSuppliers,
  type DispatchRankingMetricKey,
  type DispatchRankingResult,
} from '../../../../shared/dispatchPerformance/rankingScore'
import type { DispatchSupplierNode } from '../dispatchPerformanceTypes'
import { toDispatchRankingInput } from '../toDispatchRankingInput'

type Props = {
  suppliers: DispatchSupplierNode[]
  /** 权重交给页面持有：数据推送弹层要读同一份「调整权重后」的排名，不能各算各的 */
  weights: Record<DispatchRankingMetricKey, number>
  onWeightsChange: (weights: Record<DispatchRankingMetricKey, number>) => void
  onResetWeights: () => void
}

type Translate = (key: string, options?: Record<string, unknown>) => string

function scoreTone(score: number): string {
  if (score >= 90) return 'text-emerald-600'
  if (score >= 70) return 'text-amber-600'
  return 'text-rose-600'
}

export function RankBadge({ rank }: { rank: number }) {
  const cls =
    rank === 1
      ? 'bg-amber-400 text-white'
      : rank === 2
        ? 'bg-slate-400 text-white'
        : rank === 3
          ? 'bg-orange-400 text-white'
          : 'bg-slate-100 text-slate-600'
  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-black tabular-nums ${cls}`}
    >
      {rank}
    </span>
  )
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function WeightPanel({
  weights,
  onChange,
  onReset,
  t,
}: {
  weights: Record<DispatchRankingMetricKey, number>
  onChange: (key: DispatchRankingMetricKey, value: number) => void
  onReset: () => void
  t: Translate
}) {
  return (
    <div className="w-80 space-y-3 p-1">
      {DISPATCH_RANKING_METRIC_KEYS.map((key) => (
        <div key={key}>
          <div className="mb-1 text-xs font-medium text-slate-700">
            {t(`ranking.metrics.${key}`, { ns: 'dispatchPerformance' })}
          </div>
          <div className="flex items-center gap-2">
            <Slider
              className="flex-1"
              min={0}
              max={1}
              step={0.01}
              value={weights[key]}
              onChange={(value) => onChange(key, value as number)}
              tooltip={{ formatter: (value) => `${Math.round((value ?? 0) * 100)}%` }}
            />
            <InputNumber
              min={0}
              max={100}
              step={1}
              value={Math.round(weights[key] * 100)}
              onChange={(value) => onChange(key, (Number(value) || 0) / 100)}
              style={{ width: 68 }}
            />
            <span className="text-xs text-slate-500">%</span>
          </div>
        </div>
      ))}
      <Button block onClick={onReset}>
        {t('ranking.resetDefault', { ns: 'dispatchPerformance' })}
      </Button>
    </div>
  )
}

function BreakdownPanel({ row, t }: { row: DispatchRankingResult; t: Translate }) {
  return (
    <div className="border-t border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
        <span>{t('ranking.breakdownTitle', { ns: 'dispatchPerformance' })}</span>
        {row.sampleInsufficient && (
          <span className="font-medium text-amber-600">
            {t('ranking.sampleInsufficientHint', { ns: 'dispatchPerformance' })}
          </span>
        )}
        <span className="ml-auto font-medium text-slate-400">
          {t('breakdown.vendorProfit', { ns: 'dispatchPerformance' })} {formatMoney(row.vendorProfit)}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {row.breakdown.map((b) => (
          <div
            key={b.key}
            className={`rounded-lg border px-3 py-2 ${
              b.included
                ? 'border-[var(--admin-line)] bg-white'
                : 'border-dashed border-[var(--admin-line)] bg-slate-50 opacity-70'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700">{b.label}</span>
              <span className="text-[11px] tabular-nums text-slate-400">
                {b.included
                  ? t('ranking.weightPct', { ns: 'dispatchPerformance', pct: (b.weight * 100).toFixed(0) })
                  : b.insufficientSample
                    ? t('ranking.sampleInsufficient', { ns: 'dispatchPerformance' })
                    : t('ranking.notEnabled', { ns: 'dispatchPerformance' })}
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`text-base font-bold tabular-nums ${b.score != null ? scoreTone(b.score) : 'text-slate-300'}`}
              >
                {b.score != null ? b.score.toFixed(1) : '—'}
              </span>
              {b.rawValue != null && (
                <span className="text-[11px] text-slate-400">{(b.rawValue * 100).toFixed(2)}%</span>
              )}
              {b.ticketsToGreen != null && b.ticketsToGreen > 0 && (
                <span className="text-[11px] font-medium text-rose-500">
                  {t('ranking.ticketsToTarget', { ns: 'dispatchPerformance', count: b.ticketsToGreen })}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 站点内供应商综合评分排名，权重默认值可手动调整（仅本次会话生效） */
export function SupplierRankingBoard({ suppliers, weights, onWeightsChange, onResetWeights }: Props) {
  const { t } = useTranslation(['dispatchPerformance', 'common'])
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(true)

  const pool = useMemo(
    () => rankDispatchSuppliers(suppliers.map(toDispatchRankingInput), weights),
    [suppliers, weights],
  )

  const effectiveWeightHint = useMemo(() => {
    const sum = DISPATCH_RANKING_METRIC_KEYS.reduce((s, k) => s + weights[k], 0)
    if (sum <= 0) return ''
    return DISPATCH_RANKING_METRIC_KEYS.map(
      (k) => `${t(`ranking.metrics.${k}`, { ns: 'dispatchPerformance' })} ${Math.round((weights[k] / sum) * 100)}%`,
    ).join(' · ')
  }, [weights, t])

  const setWeight = (key: DispatchRankingMetricKey, value: number) =>
    onWeightsChange({ ...weights, [key]: value })

  if (pool.poolSize < 2) {
    return (
      <section className="admin-panel p-4">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Trophy className="h-4 w-4 text-slate-400" aria-hidden />
          {t('ranking.needTwo', { ns: 'dispatchPerformance' })}
        </div>
      </section>
    )
  }

  return (
    <section className="admin-panel overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed((v) => !v)
          }
        }}
        className="flex cursor-pointer flex-wrap items-end justify-between gap-3 bg-[var(--admin-surface-soft)] px-5 py-3"
      >
        <div>
          <div className="admin-eyebrow">Ranking</div>
          <h4 className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Trophy className="h-4 w-4 text-amber-500" aria-hidden />
            {t('ranking.title', { ns: 'dispatchPerformance' })}
          </h4>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-3 text-xs text-slate-500">
            <span>
              {t('ranking.poolMedian', { ns: 'dispatchPerformance' })}{' '}
              <span className="font-semibold tabular-nums text-slate-700">
                {pool.poolMedianScore != null ? pool.poolMedianScore.toFixed(1) : '—'}
              </span>
            </span>
            <span>
              {t('ranking.topScore', { ns: 'dispatchPerformance' })}{' '}
              <span className="font-semibold tabular-nums text-emerald-600">
                {pool.topScore != null ? pool.topScore.toFixed(1) : '—'}
              </span>
            </span>
            <span>
              {t('ranking.bottomScore', { ns: 'dispatchPerformance' })}{' '}
              <span className="font-semibold tabular-nums text-rose-600">
                {pool.bottomScore != null ? pool.bottomScore.toFixed(1) : '—'}
              </span>
            </span>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <Popover
              trigger="click"
              placement="bottomRight"
              content={<WeightPanel weights={weights} onChange={setWeight} onReset={onResetWeights} t={t} />}
            >
              <Button icon={<SlidersHorizontal className="h-4 w-4" />}>
                {t('ranking.weightSettings', { ns: 'dispatchPerformance' })}
              </Button>
            </Popover>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
              collapsed ? '' : 'rotate-180'
            }`}
          />
        </div>
      </div>
      {!collapsed && (
        <>
          <p className="border-b border-[var(--admin-line)] px-5 py-2 text-[11px] leading-relaxed text-slate-400">
            {t('ranking.weightHint', { ns: 'dispatchPerformance', weights: effectiveWeightHint })}
          </p>
          <div className="divide-y divide-[var(--admin-line)]">
            {pool.rankings.map((row) => {
              const open = expandedKey === row.supplierKey
              return (
                <div key={row.supplierKey}>
                  <button
                    type="button"
                    onClick={() => setExpandedKey(open ? null : row.supplierKey)}
                    className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left transition-colors hover:bg-[var(--admin-surface-soft)]"
                  >
                    <RankBadge rank={row.rank} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-sm font-semibold text-slate-800">{row.supplierName}</span>{' '}
                      <span className="text-[11px] text-slate-400">{row.vendorCode}</span>
                      {row.sampleInsufficient && (
                        <span className="text-[11px] text-amber-600">
                          {' '}
                          · {t('ranking.sampleInsufficient', { ns: 'dispatchPerformance' })}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      {t('ranking.compositeScore', { ns: 'dispatchPerformance' })}
                    </span>
                    <span className={`shrink-0 text-xl font-black tabular-nums ${scoreTone(row.score)}`}>
                      {row.score.toFixed(1)}
                    </span>
                  </button>
                  {open && <BreakdownPanel row={row} t={t} />}
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
