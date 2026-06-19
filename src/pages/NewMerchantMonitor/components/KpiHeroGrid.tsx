import { Tooltip } from 'antd'
import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
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
}: {
  title: string
  rate: number | null
  matched: number
  subsetTotal: number
  emptyHint: string
}) {
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
        {empty ? '无该站点数据' : `${formatCount(matched)} / ${formatCount(subsetTotal)}`}
      </div>
    </div>
  )
}

export default function KpiHeroGrid({ metrics, hasData }: Props) {
  if (!hasData) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-400">
        请输入新商家代码与时间范围后点击「查询」
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="lg:col-span-3">
        <HeroCard
          title="总货量"
          primary={formatCount(metrics.totalCount)}
          secondary={`已签收 ${formatCount(metrics.signedCount)} 单`}
          accent
        />
      </div>
      <div className="lg:col-span-3">
        <HeroCard
          title="签收率"
          primary={formatPercent(metrics.signRate)}
          secondary={`已签收 / 总货量`}
          tooltip="已签收单数（含 signDate）/ 总货量"
        />
      </div>
      <div className="lg:col-span-3">
        <HeroCard
          title="24h派签率"
          primary={formatPercent(metrics.within24hRate)}
          secondary={`24h 内 ${formatCount(metrics.within24hCount)} / 已派送 ${formatCount(
            metrics.dispatchedCount,
          )}`}
          tooltip="signDate − deliveryTime ≤ 24h 的单数 / 有 deliveryTime 的记录数（signDate 为空视为未达标）"
        />
      </div>
      <div className="lg:col-span-3">
        <HeroCard
          title="到达DS货量"
          primary={
            <span>
              {formatCount(metrics.dsArriveCount)}
              <span className="ml-2 text-2xl font-medium text-slate-400">
                {formatPercent(metrics.dsArriveRate)}
              </span>
            </span>
          }
          secondary="已到达DS / 总货量"
          tooltip="firstDsArriveDate 有值的单数 / 总货量"
        />
      </div>

      <div className="lg:col-span-6">
        <SubCard
          title="Melbourne Center · 2D 签收率"
          rate={metrics.melbourne2D.rate}
          matched={metrics.melbourne2D.matched}
          subsetTotal={metrics.melbourne2D.subsetTotal}
          emptyHint="该窗口无 Melbourne Center 数据"
        />
      </div>
      <div className="lg:col-span-6">
        <SubCard
          title="Sydney Center · 3D 签收率"
          rate={metrics.sydney3D.rate}
          matched={metrics.sydney3D.matched}
          subsetTotal={metrics.sydney3D.subsetTotal}
          emptyHint="该窗口无 Sydney Center 数据"
        />
      </div>
    </div>
  )
}
