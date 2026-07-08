import { Clock3, Package, UserRound } from 'lucide-react'
import type { FrontDeskDensityAllocation } from '../frontDeskSaturation'
import { formatInteger, formatNumber } from '../formatAndParse'

export type DensityHeatmapClockOutDetail = {
  label: string
  person: string
  idleMinutes: number | null
}

type Props = {
  date: string
  slot: string
  count: number
  allocations: FrontDeskDensityAllocation[]
  clockOut?: DensityHeatmapClockOutDetail
}

function idleGapTone(minutes: number | null): {
  panel: string
  value: string
  hint: string
} {
  if (minutes == null || !Number.isFinite(minutes)) {
    return {
      panel: 'bg-slate-50 text-slate-600 ring-slate-200/80',
      value: '—',
      hint: '暂无空档数据',
    }
  }
  const value = `${formatNumber(minutes, 0)} 分钟`
  if (minutes >= 120) {
    return { panel: 'bg-red-50 text-red-900 ring-red-200/80', value, hint: '空档偏长' }
  }
  if (minutes >= 60) {
    return { panel: 'bg-orange-50 text-orange-950 ring-orange-200/80', value, hint: '需关注' }
  }
  if (minutes >= 30) {
    return { panel: 'bg-amber-50 text-amber-950 ring-amber-200/80', value, hint: '略有余量' }
  }
  return { panel: 'bg-[#e1f5f1] text-[#1f6f68] ring-[#2f8f87]/20', value, hint: '衔接紧凑' }
}

function AllocationRow({ item }: { item: FrontDeskDensityAllocation }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-[var(--admin-line)] px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-900">{item.driverCompany}</div>
        <div className="mt-0.5 font-mono text-[11px] font-semibold tracking-wide text-[#1f6f68]">
          {item.driverCode}
        </div>
      </div>
      <div className="flex items-start gap-1 pt-0.5 text-[11px] tabular-nums text-slate-500">
        <Clock3 className="mt-0.5 h-3 w-3 shrink-0 opacity-70" aria-hidden />
        <span>{item.allocationTimeLabel}</span>
      </div>
    </li>
  )
}

export function DensityHeatmapCellDetail({ date, slot, count, allocations, clockOut }: Props) {
  const idleTone = clockOut ? idleGapTone(clockOut.idleMinutes) : null

  return (
    <div className="w-[min(20rem,calc(100vw-2rem))] overflow-hidden bg-white text-[var(--admin-text)]">
      <div className="border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#65758b]">
              {date}
            </div>
            <div className="mt-0.5 text-sm font-semibold text-slate-900">{slot}</div>
          </div>
          <div className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#e1f5f1] px-2.5 py-1 text-xs font-semibold text-[#1f6f68]">
            <Package className="h-3.5 w-3.5" aria-hidden />
            {formatInteger(count)} 箱
          </div>
        </div>
      </div>

      {allocations.length > 0 ? (
        <ul className="max-h-52 list-none overflow-y-auto p-0">
          {allocations.map((item, index) => (
            <AllocationRow
              key={`${item.driverCompany}-${item.driverCode}-${item.allocationTimeLabel}-${index}`}
              item={item}
            />
          ))}
        </ul>
      ) : (
        <div className="px-3 py-3 text-xs text-slate-500">该时段无分配明细。</div>
      )}

      {clockOut && (
        <div className="border-t border-[var(--admin-line)] bg-white px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#65758b]">
            <UserRound className="h-3.5 w-3.5" aria-hidden />
            前台下班
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-700">
            {clockOut.person ? (
              <span className="font-medium text-slate-900">{clockOut.person}</span>
            ) : null}
            <span className="tabular-nums text-slate-600">{clockOut.label}</span>
          </div>
          {idleTone && (
            <div
              className={`mt-2 flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 ring-1 ${idleTone.panel}`}
            >
              <div>
                <div className="text-[11px] font-medium opacity-80">分配后空档</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums">{idleTone.value}</div>
              </div>
              <div className="text-[11px] font-medium opacity-75">{idleTone.hint}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
