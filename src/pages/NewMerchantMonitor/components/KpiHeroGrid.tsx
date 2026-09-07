import { Tooltip } from 'antd'
import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatCount, formatPercent, type KpiSummary } from '../metrics'

type Props = {
  metrics: KpiSummary
  hasData: boolean
}

const ACCENT = '#1f6f68'
const ACCENT_SOFT = 'rgba(31, 111, 104, 0.08)'

function HeroCard({
  title,
  primary,
  secondary,
  accent = false,
  tooltip,
}: {
  title: string
  primary: ReactNode
  secondary?: ReactNode
  accent?: boolean
  tooltip?: string
}) {
  return (
    <div
      className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
      style={accent ? { background: ACCENT_SOFT, borderColor: 'rgba(31, 111, 104, 0.18)' } : undefined}
    >
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-500">
        <span>{title}</span>
        {tooltip ? (
          <Tooltip title={tooltip}>
            <Info className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          </Tooltip>
        ) : null}
      </div>
      <div
        className="mt-3 text-5xl font-semibold leading-tight tracking-tight tabular-nums"
        style={{ color: accent ? ACCENT : '#0f172a' }}
      >
        {primary}
      </div>
      {secondary ? <div className="mt-2 text-xs text-slate-500">{secondary}</div> : null}
    </div>
  )
}

function SubCard({
  title,
  rate,
  matched,
  subsetTotal,
  emptyHint,
  noSiteDataLabel,
}: {
  title: string
  rate: number | null
  matched: number
  subsetTotal: number
  emptyHint: string
  noSiteDataLabel: string
}) {
  const { t } = useTranslation('newMerchant')
  const empty = subsetTotal === 0
  return (
    <div className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <span>{title}</span>
        {empty ? (
          <Tooltip title={emptyHint}>
            <Info className="h-3 w-3 text-slate-400" aria-hidden />
          </Tooltip>
        ) : null}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums" style={{ color: ACCENT }}>
        {formatPercent(rate)}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        {empty ? noSiteDataLabel : t('matchedOverTotal', { matched: formatCount(matched), total: formatCount(subsetTotal) })}
      </div>
    </div>
  )
}

export default function KpiHeroGrid({ metrics, hasData }: Props) {
  const { t } = useTranslation('newMerchant')

  if (!hasData) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-400">
        {t('emptyHint')}
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="lg:col-span-3">
        <HeroCard
          title={t('totalVolume')}
          primary={formatCount(metrics.totalCount)}
          secondary={t('signedCount', { count: formatCount(metrics.signedCount) })}
          accent
        />
      </div>
      <div className="lg:col-span-3">
        <HeroCard
          title={t('signRate')}
          primary={formatPercent(metrics.signRate)}
          secondary={t('signedOverTotal')}
          tooltip={t('signRateTooltip')}
        />
      </div>
      <div className="lg:col-span-3">
        <HeroCard
          title={t('within24hRate')}
          primary={formatPercent(metrics.within24hRate)}
          secondary={t('within24hDetail', {
            matched: formatCount(metrics.within24hCount),
            total: formatCount(metrics.dispatchedCount),
          })}
          tooltip={t('within24hTooltip')}
        />
      </div>
      <div className="lg:col-span-3">
        <HeroCard
          title={t('dsArriveVolume')}
          primary={
            <span>
              {formatCount(metrics.dsArriveCount)}
              <span className="ml-2 text-2xl font-medium text-slate-400">
                {formatPercent(metrics.dsArriveRate)}
              </span>
            </span>
          }
          secondary={t('dsArriveOverTotal')}
          tooltip={t('dsArriveTooltip')}
        />
      </div>

      <div className="lg:col-span-6">
        <SubCard
          title={t('melbourne2D')}
          rate={metrics.melbourne2D.rate}
          matched={metrics.melbourne2D.matched}
          subsetTotal={metrics.melbourne2D.subsetTotal}
          emptyHint={t('noMelbourneData')}
          noSiteDataLabel={t('noSiteData')}
        />
      </div>
      <div className="lg:col-span-6">
        <SubCard
          title={t('sydney3D')}
          rate={metrics.sydney3D.rate}
          matched={metrics.sydney3D.matched}
          subsetTotal={metrics.sydney3D.subsetTotal}
          emptyHint={t('noSydneyData')}
          noSiteDataLabel={t('noSiteData')}
        />
      </div>
    </div>
  )
}
