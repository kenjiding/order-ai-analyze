import { Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table/interface'
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart2,
  CheckCircle2,
  Clock,
  Cpu,
  Lightbulb,
  Package,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdminDrawer } from '../../components/Drawer/AdminDrawer'
import {
  type EfficiencyAiAnalysis,
  type EfficiencyInsightAiProvider,
  generateCompareInsight,
} from '../ScannerEfficiency/efficiencyInsightApi'
import { formatNumber } from '../ScannerEfficiency/formatAndParse'
import {
  buildDaySnapshots,
  computeCompareAnalysis,
  selectComparableRecords,
  type CompareAnalysisResult,
  type RootCauseFactor,
} from './compareAnalysis'
import type { EfficiencyAttendanceDayRecord } from '../ScannerEfficiency/dailyEfficiencyRecordSnapshot'

type Props = {
  open: boolean
  onClose: () => void
  records: EfficiencyAttendanceDayRecord[]
}

// ─── 颜色常量 ──────────────────────────────────────────────────────────────────
const C_ACCENT = '#2f8f87'
const C_ACCENT_SOFT = '#e1f5f1'
const C_RED = '#ef4444'
const C_BLUE = '#3b82f6'
const C_GRAY = '#94a3b8'
const C_ORANGE = '#f59e0b'

const FACTOR_ICONS: Record<RootCauseFactor, React.ReactNode> = {
  volume: <Package className="h-4 w-4" />,
  hoursPerPerson: <Clock className="h-4 w-4" />,
  cainiaoShare: <TrendingUp className="h-4 w-4" />,
  personalEfficiency: <Users className="h-4 w-4" />,
  frontDeskRatio: <Users className="h-4 w-4" />,
  residual: <Zap className="h-4 w-4" />,
}

const AI_PROVIDER_OPTIONS: { value: EfficiencyInsightAiProvider; label: string }[] = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openai', label: 'OpenAI' },
]

// ─── 工具函数 ──────────────────────────────────────────────────────────────────
function fmtHours(n: number): string {
  return formatNumber(n, 2) + 'h'
}
function fmtNum(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return formatNumber(n, 0)
}
function fmtEff(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return formatNumber(n, 1)
}

// ─── 区块 A：效率总览（差距摘要 + 条形图）───────────────────────────────────
function EfficiencyChart({ result }: { result: CompareAnalysisResult }) {
  const { t } = useTranslation('efficiencyRecords')
  const metrics = useMemo(
    () => [
      { key: 'dayEfficiency' as const, label: t('compare.metrics.dayEfficiency') },
      { key: 'openEfficiency' as const, label: t('compare.metrics.openEfficiency') },
      { key: 'overallEfficiency' as const, label: t('compare.metrics.overallEfficiency') },
    ],
    [t],
  )
  const parcelsPerHour = t('format.parcelsPerHour')
  const parcels = t('format.parcels')
  const people = t('format.people')
  const maxEff = useMemo(() => {
    let max = 0
    for (const d of result.dayMetrics) {
      for (const m of metrics) {
        const v = d[m.key]
        if (v != null && v > max) max = v
      }
    }
    return max || 1
  }, [result, metrics])

  const worstDay = result.dayMetrics.find((d) => d.isWorst)
  const bestDay = result.dayMetrics.find((d) => d.isBest)
  const worstEff = worstDay ? (worstDay.dayEfficiency ?? worstDay.overallEfficiency) : null
  const bestEff = bestDay ? (bestDay.dayEfficiency ?? bestDay.overallEfficiency) : null

  return (
    <div>
      {/* 差距核心摘要 */}
      {worstDay && bestDay && (
        <div className="mb-5 grid grid-cols-3 divide-x divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="bg-red-50/70 px-4 py-3 text-center">
            <div className="text-[11px] font-medium text-red-400">{t('compare.chart.worstDay')}</div>
            <div className="mt-0.5 text-[11px] font-semibold tabular-nums text-red-500">{result.worstDate}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-red-600">{fmtEff(worstEff)}</div>
            <div className="text-xs text-slate-400">{parcelsPerHour}</div>
            <div className="mt-1.5 flex flex-wrap justify-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-slate-500">
              <span>{worstDay.volume} {parcels}</span>
              <span>{t('format.cainiaoShare', { pct: formatNumber(worstDay.cainiaoShare * 100, 0) })}</span>
              <span>{worstDay.sorterCount} {people}</span>
            </div>
          </div>
          <div className="flex flex-col items-center justify-center px-3 py-3">
            <div className="text-[11px] text-slate-400">{t('compare.chart.efficiencyGap')}</div>
            <div className="mt-0.5 text-3xl font-black tabular-nums text-slate-800">
              {formatNumber(result.efficiencyGapAbs, 1)}
            </div>
            <div className="text-xs text-slate-400">{parcelsPerHour}</div>
            <div className="mt-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
              {formatNumber(result.efficiencyGapPct, 1)}%
            </div>
          </div>
          <div className="bg-[#e1f5f1]/50 px-4 py-3 text-center">
            <div className="text-[11px] font-medium" style={{ color: C_ACCENT }}>{t('compare.chart.bestDay')}</div>
            <div className="mt-0.5 text-[11px] font-semibold tabular-nums" style={{ color: C_ACCENT }}>{result.bestDate}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: C_ACCENT }}>{fmtEff(bestEff)}</div>
            <div className="text-xs text-slate-400">{parcelsPerHour}</div>
            <div className="mt-1.5 flex flex-wrap justify-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-slate-500">
              <span>{bestDay.volume} {parcels}</span>
              <span>{t('format.cainiaoShare', { pct: formatNumber(bestDay.cainiaoShare * 100, 0) })}</span>
              <span>{bestDay.sorterCount} {people}</span>
            </div>
          </div>
        </div>
      )}

      {/* 图例 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-red-400" />{t('compare.chart.legendWorst')}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ backgroundColor: C_ACCENT }} />{t('compare.chart.legendBest')}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-slate-300" />{t('compare.chart.legendOther')}</span>
      </div>

      {/* 每天一组条形 */}
      <div className="space-y-5">
        {result.dayMetrics.map((d) => {
          const isWorst = d.isWorst
          const isBest = d.isBest
          const barBaseColor = isWorst ? C_RED : isBest ? C_ACCENT : C_GRAY

          return (
            <div key={d.date} className={['rounded-lg p-3', isWorst ? 'bg-red-50/60 border border-red-100' : isBest ? 'border bg-[#e1f5f1]/30' : 'bg-white border border-slate-100'].join(' ')} style={isBest ? { borderColor: `${C_ACCENT}40` } : undefined}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={['text-sm font-semibold tabular-nums', isWorst ? 'text-red-600' : isBest ? 'text-[#1f6f68]' : 'text-slate-700'].join(' ')}>
                    {isWorst ? '▼ ' : isBest ? '▲ ' : ''}{d.date}
                  </span>
                  {isBest && <span className="rounded-full bg-[#e1f5f1] px-1.5 text-[10px] font-medium text-[#1f6f68]">{t('compare.chart.highestEfficiency')}</span>}
                  {isWorst && <span className="rounded-full bg-red-100 px-1.5 text-[10px] font-medium text-red-600">{t('compare.chart.lowestEfficiency')}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-slate-400">
                  <span>{t('compare.chart.volumeLabel')} <b className="text-slate-600">{d.volume}</b> {parcels}</span>
                  <span><b className={d.cainiaoShare > 0.1 ? 'text-[#2f8f87]' : 'text-slate-600'}>{t('format.cainiaoShare', { pct: formatNumber(d.cainiaoShare * 100, 0) })}</b></span>
                  <span>{t('compare.chart.totalHours')} <b className="text-slate-600">{fmtHours(d.totalHours)}</b></span>
                  <span><b className="text-slate-600">{d.sorterCount}</b> {people}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                {metrics.map((m) => {
                  const val = d[m.key]
                  if (val == null || !Number.isFinite(val)) return null
                  const widthPct = (val / maxEff) * 100
                  return (
                    <div key={m.key} className="flex items-center gap-2">
                      <span className="w-[52px] shrink-0 text-right text-[11px] text-slate-400">{m.label}</span>
                      <div className={['relative flex-1 overflow-hidden rounded-sm', isWorst ? 'bg-red-100/50' : 'bg-slate-100'].join(' ')} style={{ height: 20 }}>
                        <div
                          className="absolute inset-y-0 left-0 rounded-sm"
                          style={{ width: `${widthPct}%`, backgroundColor: barBaseColor, opacity: isWorst ? 0.75 : 0.82 }}
                        />
                        <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-[11px] font-bold tabular-nums text-white" style={{ lineHeight: '20px' }}>
                          {formatNumber(val, 1)} {parcelsPerHour}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 区块 E：根因诊断 — 有向瀑布图 ───────────────────────────────────────────
function RootCauseSection({ result }: { result: CompareAnalysisResult }) {
  const { t } = useTranslation('efficiencyRecords')
  const parcelsPerHour = t('format.parcelsPerHour')
  const { rootCauses, bestDate, worstDate, efficiencyGapAbs, bestNormalizedEff, worstNormalizedEff } = result
  const normalizedGap = bestNormalizedEff - worstNormalizedEff

  const maxAbs = Math.max(...rootCauses.map((c) => Math.abs(c.contributionAbs)), 1)

  // 拖累因素（按贡献量降序）
  const hurtCauses = rootCauses.filter((c) => c.direction === 'hurts' && c.isSignificant)
  // 弥补因素
  const helpCauses = rootCauses.filter((c) => c.direction === 'helps' && c.isSignificant)

  return (
    <div className="space-y-4">
      {/* 总差距摘要 + 纯运营差距对比 */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
        <div className="grid grid-cols-2 divide-x divide-slate-200">
          <div className="px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t('compare.rootCause.visibleGap')}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl font-black tabular-nums text-slate-800">{formatNumber(efficiencyGapAbs, 1)}</span>
              <span className="text-sm text-slate-500">{parcelsPerHour}</span>
              <span className="text-xs text-slate-400">({formatNumber(result.efficiencyGapPct, 1)}%)</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              <span className="font-medium" style={{ color: C_ACCENT }}>{bestDate}</span> vs <span className="font-medium text-red-500">{worstDate}</span>
            </div>
          </div>
          <div className="bg-amber-50/80 px-4 py-3">
            <div className="text-[11px] font-medium text-amber-700">{t('compare.rootCause.normalizedGapTitle')}</div>
            <div className="mt-1 flex items-center gap-2 text-sm tabular-nums">
              <span className="font-bold" style={{ color: C_ACCENT }}>{formatNumber(bestNormalizedEff, 1)}</span>
              <ArrowRight className="h-3 w-3 text-slate-300" />
              <span className="font-bold text-red-600">{formatNumber(worstNormalizedEff, 1)}</span>
              <span className="font-bold text-amber-800">= {formatNumber(normalizedGap, 1)} {parcelsPerHour}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-amber-600">
              {normalizedGap > efficiencyGapAbs
                ? t('compare.rootCause.normalizedGapMasked', { amount: formatNumber(normalizedGap - efficiencyGapAbs, 1) })
                : t('compare.rootCause.normalizedGapMinor')}
            </div>
          </div>
        </div>
        <div className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400">
          <span className="mr-3"><span className="font-medium text-red-500">{t('compare.rootCause.legendHurts')}</span>{t('compare.rootCause.legendHurtsDesc')}</span>
          <span><span className="font-medium" style={{ color: C_ACCENT }}>{t('compare.rootCause.legendHelps')}</span>{t('compare.rootCause.legendHelpsDesc')}</span>
        </div>
      </div>

      {/* 拖累因素（突出显示） */}
      {hurtCauses.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-500">
            <ArrowDown className="h-3.5 w-3.5" />{t('compare.rootCause.hurtFactors')}
          </div>
          <div className="space-y-2">
            {hurtCauses.map((cause, i) => {
              const isTop = i === 0
              const barW = Math.max(3, (Math.abs(cause.contributionAbs) / maxAbs) * 100)
              return (
                <div
                  key={cause.factor}
                  className={['rounded-lg border p-3', isTop ? 'border-red-200 bg-red-50' : 'border-red-100 bg-red-50/50'].join(' ')}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white" style={{ backgroundColor: C_RED }}>
                      {FACTOR_ICONS[cause.factor]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-red-700">{cause.label}</span>
                          {isTop && <Tag bordered={false} color="red" className="mr-0 py-0 text-[10px] leading-4">{t('compare.rootCause.topHurt')}</Tag>}
                        </div>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-red-600">
                          {t('compare.rootCause.contributionPositive', { amount: formatNumber(cause.contributionAbs, 1) })}
                        </span>
                      </div>
                      <div className="mb-1.5 h-2 w-full overflow-hidden rounded-full bg-red-100">
                        <div className="h-full rounded-full" style={{ width: `${barW}%`, backgroundColor: C_RED, opacity: 0.8 }} />
                      </div>
                      <p className="text-xs leading-relaxed text-red-700/70">{cause.detail}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 弥补因素 */}
      {helpCauses.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: C_ACCENT }}>
            <ArrowUp className="h-3.5 w-3.5" />{t('compare.rootCause.helpFactors')}
          </div>
          <div className="space-y-2">
            {helpCauses.map((cause) => {
              const barW = Math.max(3, (Math.abs(cause.contributionAbs) / maxAbs) * 100)
              return (
                <div key={cause.factor} className="rounded-lg border p-3" style={{ borderColor: `${C_ACCENT}30`, backgroundColor: C_ACCENT_SOFT }}>
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white" style={{ backgroundColor: C_ACCENT }}>
                      {FACTOR_ICONS[cause.factor]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold" style={{ color: '#1f6f68' }}>{cause.label}</span>
                          <Tag bordered={false} color="green" className="mr-0 py-0 text-[10px] leading-4">{t('compare.rootCause.helpsGap')}</Tag>
                        </div>
                        <span className="shrink-0 text-sm font-bold tabular-nums" style={{ color: C_ACCENT }}>
                          {t('compare.rootCause.contributionNegative', { amount: formatNumber(Math.abs(cause.contributionAbs), 1) })}
                        </span>
                      </div>
                      <div className="mb-1.5 h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: `${C_ACCENT}20` }}>
                        <div className="h-full rounded-full" style={{ width: `${barW}%`, backgroundColor: C_ACCENT, opacity: 0.7 }} />
                      </div>
                      <p className="text-xs leading-relaxed" style={{ color: '#2f6b68' }}>{cause.detail}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 无显著影响的因素（折叠展示） */}
      {rootCauses.filter((c) => !c.isSignificant).length > 0 && (
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          <div className="text-[11px] text-slate-400">
            {t('compare.rootCause.noSignificant', { labels: rootCauses.filter((c) => !c.isSignificant).map((c) => c.label).join(' · ') })}
          </div>
        </div>
      )}

      {/* 合计校验 */}
      <div className="flex items-center justify-end gap-2 text-[11px] text-slate-400">
        <span>{t('compare.rootCause.factorsSum')}</span>
        <span className="font-semibold tabular-nums text-slate-600">
          ≈ {formatNumber(rootCauses.reduce((s, c) => s + c.contributionAbs, 0), 1)} {parcelsPerHour}
        </span>
        <span>{t('compare.rootCause.approxTotalGap', { amount: formatNumber(efficiencyGapAbs, 1) })}</span>
      </div>
    </div>
  )
}

// ─── 改善建议 ──────────────────────────────────────────────────────────────────
function SuggestionsSection({ result }: { result: CompareAnalysisResult }) {
  if (!result.suggestions.length) return null
  return (
    <div className="space-y-2">
      {result.suggestions.map((s, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border border-orange-100 bg-orange-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: C_ORANGE }} />
          <p className="text-sm leading-relaxed text-orange-900">{s}</p>
        </div>
      ))}
    </div>
  )
}

// ─── 区块 B：工时结构分析 ─────────────────────────────────────────────────────
function HoursStructureSection({ result }: { result: CompareAnalysisResult }) {
  const { t } = useTranslation('efficiencyRecords')
  const parcelsPerHour = t('format.parcelsPerHour')
  const people = t('format.people')
  const hoursSuffix = t('format.hoursSuffix')
  const worstDay = result.dayMetrics.find((d) => d.isWorst)
  const bestDay = result.dayMetrics.find((d) => d.isBest)

  const compareItems = useMemo(
    () => [
      {
        label: t('compare.hours.frontDeskShare'),
        worst: worstDay?.frontDeskSharePct ?? null,
        best: bestDay?.frontDeskSharePct ?? null,
        fmt: (v: number) => `${formatNumber(v * 100, 1)}%`,
        higherIsBad: true,
      },
      {
        label: t('compare.hours.outputPerSorterHour'),
        worst: worstDay && worstDay.sorterHours > 0 ? worstDay.volume / worstDay.sorterHours : null,
        best: bestDay && bestDay.sorterHours > 0 ? bestDay.volume / bestDay.sorterHours : null,
        fmt: (v: number) => `${formatNumber(v, 1)} ${parcelsPerHour}`,
        higherIsBad: false,
      },
      {
        label: t('compare.hours.hoursPerSorter'),
        worst: worstDay?.hoursPerSorter ?? null,
        best: bestDay?.hoursPerSorter ?? null,
        fmt: (v: number) => `${formatNumber(v, 2)}${hoursSuffix}`,
        higherIsBad: true,
      },
      {
        label: t('compare.hours.sorterCount'),
        worst: worstDay?.sorterCount ?? null,
        best: bestDay?.sorterCount ?? null,
        fmt: (v: number) => `${v} ${people}`,
        higherIsBad: false,
      },
    ],
    [bestDay, hoursSuffix, parcelsPerHour, people, t, worstDay],
  )

  return (
    <div className="space-y-3">
      {/* 跨日关键对比行 */}
      {worstDay && bestDay && (worstDay.totalHours > 0 || bestDay.totalHours > 0) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {compareItems.map((item) => {
            if (item.worst == null || item.best == null) return null
            const worstIsWorse = item.higherIsBad ? item.worst > item.best : item.worst < item.best
            const delta = item.worst - item.best
            return (
              <div key={item.label} className={['rounded-lg border p-3', worstIsWorse ? 'border-red-100 bg-red-50/60' : 'border-slate-100 bg-slate-50'].join(' ')}>
                <div className="text-[11px] text-slate-400">{item.label}</div>
                <div className="mt-1 flex items-baseline justify-between">
                  <div>
                    <div className={['text-base font-bold tabular-nums', worstIsWorse ? 'text-red-600' : 'text-slate-700'].join(' ')}>
                      {item.fmt(item.worst)}
                    </div>
                    <div className="text-[10px] text-red-400">{t('compare.hours.worstDay')}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-bold tabular-nums" style={{ color: C_ACCENT }}>
                      {item.fmt(item.best)}
                    </div>
                    <div className="text-[10px]" style={{ color: C_ACCENT }}>{t('compare.hours.bestDay')}</div>
                  </div>
                </div>
                {worstIsWorse && (
                  <div className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-red-500">
                    <ArrowDown className="h-3 w-3" />
                    {t('compare.hours.deltaUnfavorable', { delta: item.fmt(Math.abs(delta)) })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-slate-400">{t('compare.hours.footnote')}</p>

      {/* 每日堆叠条 */}
      {result.dayMetrics.map((d) => {
        const total = d.totalHours || 1
        const sorterPct = (d.sorterHours / total) * 100
        const frontDeskPct = (d.frontDeskHours / total) * 100
        const otherPct = (d.otherHours / total) * 100
        const sorterOutput = d.sorterHours > 0 ? d.volume / d.sorterHours : null

        return (
          <div
            key={d.date}
            className={['rounded-lg border p-3', d.isBest ? 'border-[#2f8f87]/25 bg-[#e1f5f1]/40' : d.isWorst ? 'border-red-200 bg-red-50/50' : 'border-slate-200 bg-white'].join(' ')}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={['text-sm font-semibold', d.isBest ? 'text-[#1f6f68]' : d.isWorst ? 'text-red-600' : 'text-slate-700'].join(' ')}>
                  {d.isWorst ? '▼ ' : d.isBest ? '▲ ' : ''}{d.date}
                </span>
                {d.isWorst && <span className="text-[11px] font-medium text-red-400">{t('compare.hours.lowestEfficiency')}</span>}
                {d.isBest && <span className="text-[11px] font-medium" style={{ color: C_ACCENT }}>{t('compare.hours.highestEfficiency')}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-slate-500">
                <span>{t('compare.chart.totalHours')} <b className="text-slate-700">{fmtHours(d.totalHours)}</b></span>
                <span>{d.sorterCount} {people}</span>
                {sorterOutput != null && (
                  <span className={['font-medium', d.isWorst ? 'text-red-500' : 'text-slate-600'].join(' ')}>
                    {t('compare.hours.outputDensity')} {formatNumber(sorterOutput, 1)} {parcelsPerHour}
                  </span>
                )}
              </div>
            </div>

            <div className="flex h-5 w-full overflow-hidden rounded-md">
              {sorterPct > 0 && (
                <div
                  className="flex items-center justify-center text-[10px] font-medium text-white"
                  style={{ width: `${sorterPct}%`, backgroundColor: d.isWorst ? '#d97706' : C_ACCENT }}
                  title={t('compare.hours.sorterTooltip', { hours: fmtHours(d.sorterHours) })}
                >
                  {sorterPct > 10 ? `${formatNumber(sorterPct, 0)}%` : ''}
                </div>
              )}
              {frontDeskPct > 0 && (
                <div
                  className="flex items-center justify-center text-[10px] font-medium text-white"
                  style={{ width: `${frontDeskPct}%`, backgroundColor: d.isWorst ? C_RED : C_BLUE }}
                  title={t('compare.hours.frontDeskTooltip', { hours: fmtHours(d.frontDeskHours) })}
                >
                  {frontDeskPct > 8 ? `${formatNumber(frontDeskPct, 0)}%` : ''}
                </div>
              )}
              {otherPct > 0 && (
                <div
                  className="flex items-center justify-center text-[10px] font-medium text-slate-600"
                  style={{ width: `${otherPct}%`, backgroundColor: '#e2e8f0' }}
                  title={t('compare.hours.otherTooltip', { hours: fmtHours(d.otherHours) })}
                >
                  {otherPct > 8 ? `${formatNumber(otherPct, 0)}%` : ''}
                </div>
              )}
            </div>

            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] tabular-nums text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: d.isWorst ? '#d97706' : C_ACCENT }} />
                {t('compare.hours.sorterLegend', { hours: fmtHours(d.sorterHours), pct: formatNumber(sorterPct, 0) })}
              </span>
              {d.frontDeskHours > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: d.isWorst ? C_RED : C_BLUE }} />
                  {t('compare.hours.frontDeskLegend', { hours: fmtHours(d.frontDeskHours), pct: formatNumber(frontDeskPct, 0) })}
                  {d.isWorst && <span className="text-red-400">{t('compare.hours.frontDeskNonProductive')}</span>}
                </span>
              )}
              {d.otherHours > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-2 w-3 rounded-sm bg-slate-200" />
                  {t('compare.hours.otherLegend', { hours: fmtHours(d.otherHours), pct: formatNumber(otherPct, 0) })}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── 区块 D：分拣员扫描效率对比（含跨日 delta）──────────────────────────────
function ScannerCompareSection({ result }: { result: CompareAnalysisResult }) {
  const { t } = useTranslation('efficiencyRecords')
  const dash = t('format.dash')
  const parcels = t('format.parcels')
  const hasScannerData = result.dayMetrics.some((d) => d.scanners.length > 0)

  const dates = result.dayMetrics.map((d) => d.date)
  const worstDate = result.worstDate
  const bestDate = result.bestDate

  const allScanners = useMemo(() => {
    const set = new Set<string>()
    for (const d of result.dayMetrics) {
      for (const s of d.scanners) set.add(s.scanner)
    }
    return [...set]
  }, [result])

  const scannerByDate = useMemo(() => {
    const map = new Map<string, Map<string, { scanCount: number; eff: number; cainiaoShare: number }>>()
    for (const d of result.dayMetrics) {
      for (const s of d.scanners) {
        if (!map.has(s.scanner)) map.set(s.scanner, new Map())
        map.get(s.scanner)!.set(d.date, {
          scanCount: s.scanCount,
          eff: s.cainiaoAdjustedEfficiency,
          cainiaoShare: s.cainiaoShare,
        })
      }
    }
    return map
  }, [result])

  // 计算每人跨日 delta (最优日 - 最差日)
  const scannerDelta = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const name of allScanners) {
      const byDate = scannerByDate.get(name)
      const bestEff = byDate?.get(bestDate)?.eff ?? null
      const worstEff = byDate?.get(worstDate)?.eff ?? null
      map.set(name, bestEff != null && worstEff != null ? bestEff - worstEff : null)
    }
    return map
  }, [allScanners, scannerByDate, bestDate, worstDate])

  // 按最差日 delta 降序排（在最差日效率最低的排前面）
  const scannersSorted = useMemo(() => {
    return [...allScanners].sort((a, b) => {
      const da = scannerDelta.get(a)
      const db = scannerDelta.get(b)
      // 无 delta（只出现在一天的）放最后
      if (da == null && db == null) return 0
      if (da == null) return 1
      if (db == null) return -1
      return db - da  // delta 越大（效率在最优日比最差日高越多）排越前
    })
  }, [allScanners, scannerDelta])

  type ScannerRow = { scanner: string; key: string }

  const hasBestWorstComparison = dates.includes(bestDate) && dates.includes(worstDate)

  const scannerColumns: ColumnsType<ScannerRow> = useMemo(
    () => [
      {
        title: t('compare.scanner.colScanner'),
        dataIndex: 'scanner',
        key: 'scanner',
        width: 90,
        fixed: 'left',
        render: (name: string) => <span className="font-medium text-slate-800">{name}</span>,
      },
      ...dates.map((date) => {
        const dm = result.dayMetrics.find((d) => d.date === date)!
        const isWorst = date === worstDate
        const isBest = date === bestDate
        const dayAvgEff = dm.scannerEfficiency ?? (dm.dayEfficiency ?? 0)

        return {
          title: (
            <div className="text-center leading-tight">
              <div className={[isWorst ? 'font-semibold text-red-600' : isBest ? 'font-semibold' : ''].join(' ')}>
                {date}
              </div>
              {isBest && <div className="text-[10px]" style={{ color: C_ACCENT }}>{t('compare.scanner.bestDayHeader')}</div>}
              {isWorst && <div className="text-[10px] text-red-500">{t('compare.scanner.worstDayHeader')}</div>}
              <div className="text-[10px] tabular-nums text-slate-400">{t('compare.scanner.colAvgEff', { avg: formatNumber(dayAvgEff, 0) })}</div>
            </div>
          ),
          key: date,
          width: 100,
          align: 'center' as const,
          render: (_: unknown, row: ScannerRow) => {
            const data = scannerByDate.get(row.scanner)?.get(date)
            if (!data) {
              return (
                <div className="text-center">
                  <span className={['text-[11px]', isWorst ? 'font-medium text-red-300' : 'text-slate-300'].join(' ')}>
                    {isWorst ? t('compare.scanner.absent') : dash}
                  </span>
                </div>
              )
            }

            const isAboveAvg = data.eff >= dayAvgEff * 1.05
            const isBelowAvg = data.eff < dayAvgEff * 0.9

            return (
              <div className="flex flex-col items-center gap-0.5">
                <span
                  className={[
                    'text-sm font-bold tabular-nums',
                    isWorst
                      ? isBelowAvg ? 'text-red-600' : 'text-slate-600'
                      : isAboveAvg ? 'text-green-600' : isBelowAvg ? 'text-red-500' : 'text-slate-700',
                  ].join(' ')}
                >
                  {formatNumber(data.eff, 0)}
                </span>
                <span className="text-[10px] tabular-nums text-slate-400">{fmtNum(data.scanCount)}{parcels}</span>
              </div>
            )
          },
        }
      }),
      ...(hasBestWorstComparison
        ? [
            {
              title: (
                <div className="text-center leading-tight">
                  <div className="font-semibold text-slate-600">{t('compare.scanner.colDelta')}</div>
                  <div className="text-[10px] text-slate-400">{t('compare.scanner.colDeltaSub')}</div>
                </div>
              ),
              key: 'delta',
              width: 80,
              align: 'center' as const,
              render: (_: unknown, row: ScannerRow) => {
                const delta = scannerDelta.get(row.scanner)
                if (delta == null) return <span className="text-[11px] text-slate-300">{dash}</span>
                const isLarge = Math.abs(delta) >= 50
                return (
                  <div className="flex flex-col items-center gap-0.5">
                    <span
                      className={[
                        'text-sm font-bold tabular-nums',
                        delta > 20 ? 'text-red-600' : delta > 0 ? 'text-orange-500' : 'text-green-600',
                      ].join(' ')}
                    >
                      {delta > 0 ? '+' : ''}{formatNumber(delta, 0)}
                    </span>
                    {isLarge && (
                      <span className={['text-[10px]', delta > 0 ? 'text-red-400' : 'text-green-500'].join(' ')}>
                        {delta > 0 ? t('compare.scanner.deltaWorstLower') : t('compare.scanner.deltaWorstHigher')}
                      </span>
                    )}
                  </div>
                )
              },
            },
          ]
        : []),
    ],
    [dash, dates, hasBestWorstComparison, parcels, result.dayMetrics, scannerByDate, scannerDelta, t, worstDate, bestDate],
  )

  if (!hasScannerData) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
        {t('compare.scanner.empty')}
      </div>
    )
  }

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        {t('compare.scanner.footnote')}
        {hasBestWorstComparison && <span>{t('compare.scanner.footnoteDelta')}</span>}
        {' '}<span className="text-red-500 font-medium">{t('compare.scanner.footnoteAbsent')}</span>{t('compare.scanner.footnoteAbsentDesc')}
      </p>
      <Table<ScannerRow>
        rowKey="key"
        columns={scannerColumns}
        dataSource={scannersSorted.map((s) => ({ scanner: s, key: s }))}
        pagination={false}
        scroll={{ x: 90 + dates.length * 100 + (hasBestWorstComparison ? 80 : 0) }}
        size="small"
        rowClassName={(row) => {
          const delta = scannerDelta.get(row.scanner)
          return delta != null && delta > 30 ? 'bg-red-50/30' : ''
        }}
      />
    </div>
  )
}

// ─── 区块 C：逐日人员效率对比表 ──────────────────────────────────────────────
function PersonnelCompareSection({ result }: { result: CompareAnalysisResult }) {
  const { t } = useTranslation('efficiencyRecords')
  const dash = t('format.dash')
  const parcelsPerHour = t('format.parcelsPerHour')
  const allPersonnel = useMemo(() => {
    const nameSet = new Set<string>()
    for (const d of result.dayMetrics) {
      for (const p of d.personnel) nameSet.add(p.sorterName)
    }
    return [...nameSet].sort()
  }, [result])

  const personnelByDate = useMemo(() => {
    const map = new Map<string, Map<string, { hours: number; isFrontDesk: boolean; isSorterWorker: boolean }>>()
    for (const d of result.dayMetrics) {
      for (const p of d.personnel) {
        if (!map.has(p.sorterName)) map.set(p.sorterName, new Map())
        map.get(p.sorterName)!.set(d.date, {
          hours: p.hours,
          isFrontDesk: p.isFrontDesk,
          isSorterWorker: p.isSorterWorker,
        })
      }
    }
    return map
  }, [result])

  const scannerEffByDate = useMemo(() => {
    const map = new Map<string, Map<string, number | null>>()
    for (const d of result.dayMetrics) {
      for (const s of d.scanners) {
        if (!map.has(s.scanner)) map.set(s.scanner, new Map())
        map.get(s.scanner)!.set(d.date, s.cainiaoAdjustedEfficiency)
      }
    }
    return map
  }, [result])

  const dates = result.dayMetrics.map((d) => d.date)

  const cainiaoShareRange = useMemo(() => {
    const shares = result.dayMetrics.map((d) => d.cainiaoShare)
    return { min: Math.min(...shares), max: Math.max(...shares) }
  }, [result])

  type PersonRow = { name: string; key: string }

  const personColumns: ColumnsType<PersonRow> = useMemo(
    () => [
      {
        title: t('compare.personnel.colName'),
        dataIndex: 'name',
        key: 'name',
        width: 90,
        fixed: 'left',
        render: (name: string) => <span className="font-medium text-slate-800">{name}</span>,
      },
      ...dates.map((date) => {
        const dm = result.dayMetrics.find((d) => d.date === date)!
        const { min: minCainiao, max: maxCainiao } = cainiaoShareRange
        const cainiaoSpread = maxCainiao - minCainiao
        const cainiaoPct = formatNumber(dm.cainiaoShare * 100, 0)
        const cainiaoColor =
          cainiaoSpread > 0.03 && dm.cainiaoShare === maxCainiao
            ? C_ACCENT
            : cainiaoSpread > 0.03 && dm.cainiaoShare === minCainiao
              ? '#d97706'
              : '#64748b'
        const isWorst = dm.isWorst
        const isBest = dm.isBest

        return {
          title: (
            <div className="flex flex-col items-center gap-0.5 text-center leading-tight">
              <span className={[isWorst ? 'font-semibold text-red-600' : isBest ? 'font-semibold' : ''].join(' ')}>
                {date}
              </span>
              {isBest && <span className="text-[10px]" style={{ color: C_ACCENT }}>{t('compare.personnel.bestHeader')}</span>}
              {isWorst && <span className="text-[10px] text-red-500">{t('compare.personnel.worstHeader')}</span>}
              <span className="whitespace-nowrap text-[10px] tabular-nums text-slate-500">
                {t('compare.personnel.headerVolume', { volume: fmtNum(dm.volume) })}
                {' '}
                <span style={{ color: cainiaoColor }}>{t('compare.personnel.headerCainiao', { pct: cainiaoPct })}</span>
              </span>
            </div>
          ),
          key: date,
          width: 160,
          align: 'center' as const,
          render: (_: unknown, row: PersonRow) => {
            const dayData = personnelByDate.get(row.name)?.get(date)
            if (!dayData) {
              return (
                <span className={['text-xs', isWorst ? 'font-medium text-red-300' : 'text-slate-300'].join(' ')}>
                  {isWorst ? t('compare.personnel.absentWorst') : dash}
                </span>
              )
            }
            const roleColor = dayData.isFrontDesk ? C_BLUE : C_ACCENT
            const roleLabel = dayData.isFrontDesk
              ? t('compare.personnel.roleFrontDesk')
              : dayData.isSorterWorker
                ? t('compare.personnel.roleSorter')
                : t('compare.personnel.roleOther')

            let scanEff: number | null = null
            for (const [scannerKey, dateMap] of scannerEffByDate) {
              if (scannerKey.includes(row.name) || row.name.includes(scannerKey)) {
                scanEff = dateMap.get(date) ?? null
                break
              }
            }

            return (
              <span className="inline-block whitespace-nowrap text-xs leading-snug">
                <span className="tabular-nums text-slate-600">{fmtHours(dayData.hours)}</span>
                {scanEff != null && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className={['tabular-nums font-medium', isWorst ? 'text-red-500' : ''].join(' ')} style={!isWorst ? { color: C_ACCENT } : undefined}>
                      {formatNumber(scanEff, 0)}{parcelsPerHour}
                    </span>
                  </>
                )}
                <span className="text-slate-300">·</span>
                <span style={{ color: roleColor }}>{roleLabel}</span>
              </span>
            )
          },
        }
      }),
    ],
    [cainiaoShareRange, dash, dates, parcelsPerHour, personnelByDate, result.dayMetrics, scannerEffByDate, t],
  )

  if (allPersonnel.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
        {t('compare.personnel.empty')}
      </div>
    )
  }

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        {t('compare.personnel.footnote')}
        <span className="text-red-400">{t('compare.personnel.footnoteWorstAbsent')}</span>{t('compare.personnel.footnoteWorstAbsentDesc')}
      </p>
      <Table<PersonRow>
        rowKey="key"
        columns={personColumns}
        dataSource={allPersonnel.map((name) => ({ name, key: name }))}
        pagination={false}
        scroll={{ x: 90 + dates.length * 160 }}
      />
    </div>
  )
}

// ─── 区块 F：AI 深度分析 ───────────────────────────────────────────────────────
function AiAnalysisSection({
  result,
}: {
  result: CompareAnalysisResult
}) {
  const { t } = useTranslation('efficiencyRecords')
  const [aiProvider, setAiProvider] = useState<EfficiencyInsightAiProvider>('deepseek')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [analysis, setAnalysis] = useState<EfficiencyAiAnalysis | null>(null)

  const daySnapshots = useMemo(() => buildDaySnapshots(result.dayMetrics), [result])

  const handleGenerate = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await generateCompareInsight(
        daySnapshots,
        result.bestDate,
        result.worstDate,
        result.efficiencyGapPct,
        aiProvider,
      )
      setAnalysis(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('compare.ai.failed'))
    } finally {
      setLoading(false)
    }
  }, [daySnapshots, result, aiProvider, t])

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-[#f7fbff] to-white px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md" style={{ backgroundColor: C_ACCENT }}>
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">{t('compare.ai.title')}</div>
            <div className="text-[11px] text-slate-500">{t('compare.ai.subtitle')}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={aiProvider} onChange={setAiProvider} options={AI_PROVIDER_OPTIONS} style={{ width: 110 }} />
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading}
            className={[
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              loading ? 'cursor-not-allowed bg-slate-100 text-slate-400' : 'text-white hover:opacity-90',
            ].join(' ')}
            style={loading ? undefined : { backgroundColor: C_ACCENT }}
          >
            {loading ? (
              <><RefreshCw className="h-3.5 w-3.5 animate-spin" />{t('compare.ai.analyzing')}</>
            ) : analysis ? (
              <><RefreshCw className="h-3.5 w-3.5" />{t('compare.ai.reanalyze')}</>
            ) : (
              <><Cpu className="h-3.5 w-3.5" />{t('compare.ai.start')}</>
            )}
          </button>
        </div>
      </div>

      <div className="px-4 py-3">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        {loading && !analysis && (
          <div className="flex items-center gap-3 py-4 text-sm text-slate-500">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: C_ACCENT, animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
            {t('compare.ai.loading')}
          </div>
        )}
        {analysis && !loading && (
          <div className="space-y-4">
            {analysis.findings.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <TrendingDown className="h-3.5 w-3.5" />{t('compare.ai.findings')}
                </div>
                <ul className="space-y-1.5">
                  {analysis.findings.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.suggestions.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <TrendingUp className="h-3.5 w-3.5" />{t('compare.ai.suggestions')}
                </div>
                <ul className="space-y-1.5">
                  {analysis.suggestions.map((item, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2f8f87]" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {!analysis && !loading && !error && (
          <div className="py-4 text-center text-sm text-slate-400">
            {t('compare.ai.placeholder')}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 主 Section 标题 ──────────────────────────────────────────────────────────
function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <div className="h-4 w-0.5 rounded-full" style={{ backgroundColor: C_ACCENT }} />
      <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-slate-600">
        {icon}
        {children}
      </h3>
    </div>
  )
}

// ─── 主内容 ───────────────────────────────────────────────────────────────────
function CompareAnalysisContent({ records }: { records: EfficiencyAttendanceDayRecord[] }) {
  const { t } = useTranslation('efficiencyRecords')
  const comparableCount = useMemo(() => selectComparableRecords(records).length, [records])
  const result = useMemo(() => {
    if (records.length < 2) return null
    try {
      return computeCompareAnalysis(records)
    } catch (e) {
      console.error('[CompareAnalysis] computeCompareAnalysis threw:', e)
      return null
    }
  }, [records])

  if (!result) {
    return (
      <div className="flex min-h-[200px] items-center justify-center px-6 text-center text-sm text-slate-500">
        {comparableCount < 2
          ? t('compare.empty.needFullRecords')
          : t('compare.empty.needTwoDates')}
      </div>
    )
  }

  return (
    <div className="space-y-10 pb-10">
      {/* A 效率总览（含差距摘要） */}
      <section>
        <SectionLabel icon={<BarChart2 className="h-3.5 w-3.5" />}>{t('compare.section.overview')}</SectionLabel>
        <EfficiencyChart result={result} />
      </section>

      {/* E 根因诊断（提前到第二位，最重要的诊断）*/}
      <section>
        <SectionLabel icon={<Lightbulb className="h-3.5 w-3.5" />}>{t('compare.section.rootCause')}</SectionLabel>
        <RootCauseSection result={result} />
        {result.hasMissingPersonnel && (
          <p className="mt-2 text-xs text-slate-400">{t('compare.missing.personnel')}</p>
        )}
        {result.hasMissingScanner && (
          <p className="mt-1 text-xs text-slate-400">{t('compare.missing.scanner')}</p>
        )}
      </section>

      {/* 改善建议（紧跟根因） */}
      {result.suggestions.length > 0 && (
        <section>
          <SectionLabel icon={<AlertTriangle className="h-3.5 w-3.5" />}>{t('compare.section.suggestions')}</SectionLabel>
          <SuggestionsSection result={result} />
        </section>
      )}

      {/* B 工时结构 */}
      <section>
        <SectionLabel icon={<Clock className="h-3.5 w-3.5" />}>{t('compare.section.hoursStructure')}</SectionLabel>
        <HoursStructureSection result={result} />
      </section>

      {/* D 分拣员效率对比 */}
      <section>
        <SectionLabel icon={<TrendingUp className="h-3.5 w-3.5" />}>{t('compare.section.scannerCompare')}</SectionLabel>
        <ScannerCompareSection result={result} />
      </section>

      {/* C 人员出勤明细 */}
      <section>
        <SectionLabel icon={<Users className="h-3.5 w-3.5" />}>{t('compare.section.personnelCompare')}</SectionLabel>
        <PersonnelCompareSection result={result} />
      </section>

      {/* F AI 深度分析 */}
      <section>
        <SectionLabel icon={<Sparkles className="h-3.5 w-3.5" />}>{t('compare.section.aiAnalysis')}</SectionLabel>
        <AiAnalysisSection result={result} />
      </section>
    </div>
  )
}

// ─── 入口组件 ─────────────────────────────────────────────────────────────────
export function CompareAnalysisDrawer({ open, onClose, records }: Props) {
  const { t } = useTranslation('efficiencyRecords')
  const sortedDates = useMemo(
    () => [...records].sort((a, b) => a.date.localeCompare(b.date)).map((r) => r.date),
    [records],
  )

  const subtitle =
    sortedDates.length === 0
      ? undefined
      : sortedDates.length === 1
        ? sortedDates[0]
        : t('compare.drawer.subtitleRange', {
            start: sortedDates[0],
            end: sortedDates[sortedDates.length - 1],
            count: sortedDates.length,
          })

  return (
    <AdminDrawer
      open={open}
      onClose={onClose}
      eyebrow={t('compare.drawer.eyebrow')}
      title={t('compare.drawer.title', { count: records.length })}
      subtitle={subtitle}
      width={Math.min(980, typeof window !== 'undefined' ? window.innerWidth - 48 : 980)}
      destroyOnClose
    >
      <div className="px-6 pt-5">
        <CompareAnalysisContent records={records} />
      </div>
    </AdminDrawer>
  )
}
