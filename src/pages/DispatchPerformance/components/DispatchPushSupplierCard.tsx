import { Tag } from 'antd'
import { Award, Medal, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DispatchRankingResult } from '../../../../shared/dispatchPerformance/rankingScore'
import type { DispatchMetrics, DispatchSupplierNode } from '../dispatchPerformanceTypes'
import {
  BEFORE11_ALERT_PCT,
  BEFORE11_TARGET_PCT,
  SIGN_ALERT_PCT,
  SIGN_TARGET_PCT,
  formatAvgTotal,
} from '../dispatchMetricThresholds'
import { pushSectionId } from '../dispatchPushCapture'
import { RateCell } from './PerformanceBreakdownTable'
import { dispatchPushMetricLabelKey, type DispatchPushMetricKey } from '../dispatchPushMetrics'

export type DispatchPushCardStatus = 'idle' | 'capturing' | 'pushing' | 'ok' | 'error' | 'skipped'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** 分数越高颜色越"稳"，红/黄/绿是有含义的功能色，不是装饰；深色渐变 hero 上要提亮才不糊 */
function scoreToneOnDark(score: number): string {
  if (score >= 90) return 'text-emerald-200'
  if (score >= 70) return 'text-amber-200'
  return 'text-rose-200'
}

/** 前三名金/银/铜奖章图标，第 4 名起不给图标——奖章色只用在图标上，不做整块底色，避免和 hero 的品牌渐变打架 */
const RANK_TIER: Record<number, { icon: typeof Trophy; iconColor: string }> = {
  1: { icon: Trophy, iconColor: 'text-amber-300' },
  2: { icon: Medal, iconColor: 'text-slate-200' },
  3: { icon: Award, iconColor: 'text-orange-300' },
}

/**
 * 排名 + 综合分，並排放在 hero 渐变条里：排名是一个半透明玻璃质感的白色胶囊（前三名带对应
 * 奖章图标），分数是渐变底上的超大号数字——奖章色/分数色都只用在图标和数字本身，
 * 不做整块纯色底，避免和品牌渐变互相抢戏。
 */
function RankingStat({ ranking, t }: { ranking: DispatchRankingResult; t: Translate }) {
  const tier = RANK_TIER[ranking.rank]
  const Icon = tier?.icon
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 ring-1 ring-inset ring-white/25 backdrop-blur-sm">
        {Icon ? <Icon className={`h-6 w-6 ${tier!.iconColor}`} aria-hidden /> : null}
        <span className="text-2xl font-black text-white">{t('push.rankValue', { rank: ranking.rank })}</span>
      </div>
      <span className={`font-mono text-5xl font-black leading-none tabular-nums ${scoreToneOnDark(ranking.score)}`}>
        {ranking.score.toFixed(1)}
        <span className="ml-1 font-sans text-base font-semibold text-white/70">{t('push.scoreUnit')}</span>
      </span>
    </div>
  )
}

function MetricValue({
  metricKey,
  row,
  dayCount,
  settlingLabel,
}: {
  metricKey: DispatchPushMetricKey
  row: DispatchMetrics
  dayCount: number
  settlingLabel: string
}) {
  switch (metricKey) {
    case 'total':
      return <span className="tabular-nums">{formatAvgTotal(row.total, dayCount)}</span>
    case 'before11Rate':
      return <RateCell rate={row.before11Rate} alertPct={BEFORE11_ALERT_PCT} targetPct={BEFORE11_TARGET_PCT} />
    case 'sameDayExitRate':
      return <RateCell rate={row.sameDayExitRate} />
    case 'signRate':
      return (
        <RateCell
          rate={row.signRate}
          alertPct={SIGN_ALERT_PCT}
          targetPct={SIGN_TARGET_PCT}
          pendingLabel={row.total > 0 && !row.dispatchSettled ? settlingLabel : undefined}
        />
      )
    case 'nextDaySignRate':
      return (
        <RateCell
          rate={row.nextDaySignRate}
          alertPct={SIGN_ALERT_PCT}
          targetPct={SIGN_TARGET_PCT}
          pendingLabel={row.total > 0 && !row.dispatchSettled ? settlingLabel : undefined}
        />
      )
    case 'priorityNextDaySignRate':
      return (
        <RateCell
          rate={row.priorityNextDaySignRate}
          alertPct={SIGN_ALERT_PCT}
          targetPct={SIGN_TARGET_PCT}
          pendingLabel={row.priorityTotal > 0 && !row.dispatchSettled ? settlingLabel : undefined}
        />
      )
    case 'problemCount':
      return !row.dispatchSettled ? (
        <span className="text-slate-300">—</span>
      ) : row.problemCount > 0 ? (
        <span className="tabular-nums text-amber-600">{row.problemCount}</span>
      ) : (
        <span className="text-slate-300">—</span>
      )
  }
}

const STATUS_TAG_COLOR: Record<Exclude<DispatchPushCardStatus, 'idle'>, string> = {
  capturing: 'processing',
  pushing: 'processing',
  ok: 'success',
  error: 'error',
  skipped: 'default',
}

function StatusTag({ status, error, t }: { status?: DispatchPushCardStatus; error?: string; t: Translate }) {
  if (!status || status === 'idle') return null
  const text = status === 'error' ? error || t('push.status.error') : t(`push.status.${status}`)
  return (
    <Tag color={STATUS_TAG_COLOR[status]} className="m-0">
      {text}
    </Tag>
  )
}

export function DispatchPushSupplierCard({
  supplier,
  metricKeys,
  dayCount,
  hasTarget,
  ranking,
  status,
  error,
}: {
  supplier: DispatchSupplierNode
  metricKeys: DispatchPushMetricKey[]
  dayCount: number
  /** 该供应商在 pushConfigIds 里是否命中至少一条推送目标；false 时只展示预览，推送时会被跳过 */
  hasTarget: boolean
  /** 供应商综合排名（调整权重后），供应商池不足 2 家时为 undefined，卡片上不展示 */
  ranking?: DispatchRankingResult
  status?: DispatchPushCardStatus
  error?: string
}) {
  const { t } = useTranslation('dispatchPerformance')
  const settlingLabel = t('breakdown.settling')

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-md shadow-slate-900/10">
      {/* 管理侧用来在列表里辨认这是哪家、推送进度如何；不算在截图范围内 */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-slate-700">{supplier.supplierName}</span>
          <span className="font-mono text-[11px] text-slate-400">{supplier.vendorCode}</span>
        </div>
        {!hasTarget ? <StatusTag status="skipped" t={t} /> : <StatusTag status={status} error={error} t={t} />}
      </div>

      {/* 下面这块才是真正会被截图、推送到供应商群的内容——按 to C 的成绩卡风格设计，不用管理后台的浅灰配色 */}
      <div id={pushSectionId(supplier.supplierKey)} data-push-capture-root className="bg-white">
        {ranking ? (
          <div className="flex items-center justify-between gap-3 bg-gradient-to-br from-teal-500 via-emerald-500 to-teal-600 px-5 py-5">
            <div className="min-w-0">
              <div className="truncate text-lg font-bold text-white">{supplier.supplierName}</div>
              <div className="font-mono text-sm text-white/70">{supplier.vendorCode}</div>
            </div>
            <RankingStat ranking={ranking} t={t} />
          </div>
        ) : null}

        <div className="p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {metricKeys.map((key) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase leading-tight tracking-wide text-slate-400">
                  {t(dispatchPushMetricLabelKey(key))}
                </div>
                <div className="mt-1.5 font-mono text-2xl font-bold leading-none tabular-nums text-slate-900">
                  <MetricValue metricKey={key} row={supplier} dayCount={dayCount} settlingLabel={settlingLabel} />
                </div>
              </div>
            ))}
          </div>

          {supplier.routes.length > 0 ? (
            <div className="mt-5">
              <div className="mb-2 text-sm font-semibold text-slate-500">{t('breakdown.routeCode')}</div>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-base">
                  <thead>
                    <tr className="border-b border-slate-200 bg-teal-50">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-teal-800">
                        {t('breakdown.routeCode')}
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
                    {supplier.routes.map((route, idx) => (
                      <tr key={route.routeCode || idx} className={idx % 2 === 1 ? 'bg-slate-50' : ''}>
                        <td className="px-4 py-2 text-slate-700">{route.routeCode || t('breakdown.noRouteCode')}</td>
                        {metricKeys.map((key) => (
                          <td key={key} className="px-4 py-2 text-right tabular-nums">
                            <MetricValue
                              metricKey={key}
                              row={route}
                              dayCount={dayCount}
                              settlingLabel={settlingLabel}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
