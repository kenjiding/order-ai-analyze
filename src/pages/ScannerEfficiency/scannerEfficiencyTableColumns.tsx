import { useEffect, useRef, useState } from 'react'
import { sortingEfficiencyForPerson } from './sortingLookup'
import type { DataTableColumn, DataTableRow } from './components/ui'
import { formatCainiaoSharePercent } from './cainiaoWaybill'
import { formatInteger, formatNumber } from './formatAndParse'
import { isScannerAdjustedEfficiencyLow } from './scannerEfficiencyThresholds'

function DailyTotalHoursCell({
  dateKey,
  hours,
  enabled,
  onCommit,
}: {
  dateKey: string
  hours: number
  enabled: boolean
  onCommit: (date: string, value: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    const node = inputRef.current
    node?.focus()
    node?.select()
  }, [editing])

  const commitFromText = (raw: string) => {
    const trimmed = raw.trim().replace(/,/g, '')
    if (trimmed === '') {
      onCommit(dateKey, null)
      return
    }
    const n = parseFloat(trimmed)
    if (Number.isFinite(n) && n >= 0) {
      onCommit(dateKey, n)
    }
  }

  const finishEditing = () => {
    commitFromText(text)
    setEditing(false)
  }

  if (!enabled) {
    return <span className="tabular-nums text-slate-600">-</span>
  }

  const display =
    Number.isFinite(hours) && hours >= 0 ? hours.toFixed(2) : '-'

  if (!editing) {
    return (
      <button
        type="button"
        className="block w-full min-w-[5rem] cursor-pointer rounded border border-transparent bg-transparent px-1 py-0.5 text-left text-sm tabular-nums text-slate-900 hover:border-slate-200 hover:bg-slate-50 focus-visible:border-[#2f8f87] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f8f87]/30"
        aria-label={`${dateKey} 总工时(含修正工时)，点击修改`}
        onClick={() => {
          setText(Number.isFinite(hours) ? hours.toFixed(2) : '')
          setEditing(true)
        }}
      >
        {display}
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      aria-label={`${dateKey} 总工时(含修正工时)`}
      className="w-full min-w-[5.5rem] rounded border border-slate-200 bg-white px-2 py-1 text-left text-sm tabular-nums text-slate-900 shadow-sm outline-none focus:border-[#2f8f87] focus:ring-2 focus:ring-[#2f8f87]/25"
      value={text}
      onChange={(e) => {
        const v = e.target.value
        setText(v)
        const trimmed = v.trim().replace(/,/g, '')
        if (trimmed === '') return
        const n = parseFloat(trimmed)
        if (Number.isFinite(n) && n >= 0) {
          onCommit(dateKey, n)
        }
      }}
      onBlur={finishEditing}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finishEditing()
        }
      }}
    />
  )
}

type MatchFooterStats = {
  totalVolume: number
  avgVolume: number
  totalCainiaoVolume: number
  avgCainiaoVolume: number
  cainiaoShareFromTotals: number | null
  avgCainiaoShare: number | null
  totalHoursSum: number
  avgTotalHours: number
  efficiencyFromTotals: number | null
  avgDayEfficiency: number | null
  /** 窗口内：总成本合计 ÷ 总货量合计 */
  avgCostPerTicket?: number | null
  costPerTicketFromTotals?: number | null
  totalLaborCostSum: number | null
  avgTotalLaborCost: number | null
}

/** 「当天效率(h)」≤ 该阈值时用红色突出（与页内口径一致：票/小时） */
const DAY_EFFICIENCY_ALERT_MAX = 135

function isDayEfficiencyAtOrBelowAlert(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value <= DAY_EFFICIENCY_ALERT_MAX
}

/** 「每票成本」≥ 该阈值（美元/票）时用琥珀色突出 */
const COST_PER_TICKET_AMBER_MIN = 0.25

function isCostPerTicketAmberHighlight(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= COST_PER_TICKET_AMBER_MIN
}

function costPerTicketHighlightClass(cost: number): string {
  const base = 'inline-block rounded px-1.5 py-0.5 font-semibold tabular-nums'
  return isCostPerTicketAmberHighlight(cost)
    ? `${base} bg-amber-100 text-amber-700`
    : `${base} bg-red-50 text-red-600`
}

function attendanceMatchFooterCell(
  top: string,
  bottom: string,
  accent?: { topClass?: string; bottomClass?: string },
) {
  const topClass = accent?.topClass ?? 'font-medium text-slate-900'
  const bottomClass = accent?.bottomClass ?? 'text-slate-600'
  return (
    <div className="flex flex-col gap-0.5 text-xs leading-snug">
      <span className={topClass}>总计 {top}</span>
      <span className={bottomClass}>平均 {bottom}</span>
    </div>
  )
}

export function buildDailyVolumeColumns(): DataTableColumn[] {
  return [
    { key: 'date', title: '日期' },
    { key: 'volume', title: '总货量', render: (row: DataTableRow) => formatInteger(Number(row.volume)) },
    {
      key: 'cainiaoVolume',
      title: '菜鸟票',
      render: (row: DataTableRow) => formatInteger(Number(row.cainiaoVolume)),
    },
    {
      key: 'cainiaoShare',
      title: '菜鸟占比',
      render: (row: DataTableRow) =>
        formatCainiaoSharePercent(Number(row.volume) > 0 ? Number(row.cainiaoShare) : null),
    },
    {
      key: 'scannerCount',
      title: '扫描员人数',
      render: (row: DataTableRow) => formatInteger(Number(row.scannerCount)),
    },
  ]
}

export function buildAttendanceMatchColumns(options?: {
  onDailyTotalHoursCommit?: (date: string, value: number | null) => void
}): DataTableColumn[] {
  const onCommit = options?.onDailyTotalHoursCommit
  return [
    { key: 'date', title: '日期' },
    {
      key: 'volume',
      title: '总货量',
      render: (row: DataTableRow) => {
        if (row.isAttendanceMatchFooter && row.matchFooterStats) {
          const s = row.matchFooterStats as MatchFooterStats
          return attendanceMatchFooterCell(
            formatInteger(s.totalVolume),
            formatNumber(s.avgVolume, 2),
          )
        }
        return formatInteger(Number(row.volume))
      },
    },
    {
      key: 'attendanceTotalLaborCost',
      title: '总成本',
      render: (row: DataTableRow) => {
        if (row.isAttendanceMatchFooter && row.matchFooterStats) {
          const s = row.matchFooterStats as MatchFooterStats
          const total =
            s.totalLaborCostSum == null || !Number.isFinite(s.totalLaborCostSum)
              ? '—'
              : `$${formatNumber(s.totalLaborCostSum, 2)}`
          const avg =
            s.avgTotalLaborCost == null || !Number.isFinite(s.avgTotalLaborCost)
              ? '—'
              : `$${formatNumber(s.avgTotalLaborCost, 2)}`
          return attendanceMatchFooterCell(total, avg)
        }
        const cost = row.attendanceTotalLaborCost
        if (cost == null || !Number.isFinite(Number(cost))) {
          return <span className="tabular-nums text-slate-400">-</span>
        }
        return (
          <span className="tabular-nums text-slate-900">${formatNumber(Number(cost), 2)}</span>
        )
      },
    },
    {
      key: 'cainiaoShare',
      title: '菜鸟占比',
      render: (row: DataTableRow) => {
        if (row.isAttendanceMatchFooter && row.matchFooterStats) {
          const s = row.matchFooterStats as MatchFooterStats
          return attendanceMatchFooterCell(
            formatCainiaoSharePercent(s.cainiaoShareFromTotals),
            formatCainiaoSharePercent(s.avgCainiaoShare),
          )
        }
        if (row.isAttendanceOnly || !(Number(row.volume) > 0)) {
          return <span className="tabular-nums text-slate-400">-</span>
        }
        return (
          <span className="tabular-nums text-slate-700">
            {formatCainiaoSharePercent(Number(row.cainiaoShare))}
          </span>
        )
      },
    },
    {
      key: 'sorterCount',
      title: '分拣人数',
      render: (row: DataTableRow) =>
        row.isAttendanceMatchFooter ? '—' : row.hasAttendance ? formatInteger(Number(row.sorterCount)) : '-',
    },
    {
      key: 'totalHours',
      title: '总工时(含修正工时)',
      render: (row: DataTableRow) => {
        if (row.isAttendanceMatchFooter && row.matchFooterStats) {
          const s = row.matchFooterStats as MatchFooterStats
          return attendanceMatchFooterCell(
            formatNumber(s.totalHoursSum, 2),
            formatNumber(s.avgTotalHours, 2),
          )
        }
        const dateStr = String(row.date ?? '')
        return (
          <DailyTotalHoursCell
            dateKey={dateStr}
            hours={Number(row.totalHours)}
            enabled={Boolean(row.hasAttendance)}
            onCommit={(date, value) => onCommit?.(date, value)}
          />
        )
      },
    },
    {
      key: 'dayEfficiency',
      title: '当天效率(h)',
      render: (row: DataTableRow) => {
        if (row.isAttendanceMatchFooter && row.matchFooterStats) {
          const s = row.matchFooterStats as MatchFooterStats
          const totalEff =
            s.efficiencyFromTotals == null ? '—' : formatNumber(s.efficiencyFromTotals, 2)
          const avgEff =
            s.avgDayEfficiency == null ? '—' : formatNumber(s.avgDayEfficiency, 2)
          return attendanceMatchFooterCell(totalEff, avgEff, {
            topClass: isDayEfficiencyAtOrBelowAlert(s.efficiencyFromTotals)
              ? 'font-semibold tabular-nums text-red-600'
              : 'font-medium tabular-nums text-slate-900',
            bottomClass: isDayEfficiencyAtOrBelowAlert(s.avgDayEfficiency)
              ? 'font-semibold tabular-nums text-red-500'
              : 'text-slate-600',
          })
        }
        if (row.dayEfficiency == null) {
          return <span className="tabular-nums text-slate-400">-</span>
        }
        const eff = Number(row.dayEfficiency)
        const low = isDayEfficiencyAtOrBelowAlert(eff)
        return (
          <span
            className={
              low
                ? 'font-semibold tabular-nums text-red-600'
                : 'tabular-nums text-slate-900'
            }
          >
            {formatNumber(eff, 2)}
          </span>
        )
      },
    },
    {
      key: 'attendanceCostPerTicket',
      title: '每票成本',
      render: (row: DataTableRow) => {
        if (row.isAttendanceMatchFooter && row.matchFooterStats) {
          const s = row.matchFooterStats as MatchFooterStats
          const footerCost = s.costPerTicketFromTotals ?? s.avgCostPerTicket
          const unit =
            footerCost == null || !Number.isFinite(footerCost)
              ? '—'
              : `$${formatNumber(footerCost, 2)}`
          if (footerCost == null || !Number.isFinite(footerCost)) {
            return attendanceMatchFooterCell(unit, '—')
          }
          return (
            <div className="flex flex-col gap-0.5 text-xs leading-snug">
              <span className="font-medium text-slate-900">
                总计 <span className={costPerTicketHighlightClass(footerCost)}>{unit}</span>
              </span>
              <span className="text-slate-500">平均 —</span>
            </div>
          )
        }
        const c = row.attendanceCostPerTicket
        if (c == null || !Number.isFinite(Number(c))) {
          return <span className="tabular-nums text-slate-400">-</span>
        }
        const cost = Number(c)
        return (
          <span className={costPerTicketHighlightClass(cost)}>
            ${formatNumber(cost, 2)}
          </span>
        )
      },
    },
  ]
}

export function buildAttendancePersonColumns(personSortingLookup: Map<string, number>): DataTableColumn[] {
  return [
    { key: 'sorterName', title: '人员' },
    { key: 'totalHours', title: '总工时(小时)', render: (row: DataTableRow) => formatNumber(Number(row.totalHours), 2) },
    {
      key: 'sortingScanCount',
      title: '扫描量',
      render: (row: DataTableRow) =>
        row.personMatchedSortingScan == null ? '—' : formatInteger(Number(row.personMatchedSortingScan)),
    },
    {
      key: 'onDutyEfficiency',
      title: '在岗效率(票/小时)',
      render: (row: DataTableRow) =>
        row.personOnDutyEfficiencyPerHour == null
          ? '—'
          : formatNumber(Number(row.personOnDutyEfficiencyPerHour), 2),
    },
    { key: 'activeDays', title: '活跃天数', render: (row: DataTableRow) => formatInteger(Number(row.activeDays)) },
    {
      key: 'sortingEfficiency',
      title: '一级分拣效率(票/小时)',
      render: (row: DataTableRow) => {
        const v = sortingEfficiencyForPerson(
          {
            sorterName: String(row.sorterName ?? ''),
            sorterKey: String(row.sorterKey ?? ''),
            efficiencyMatchNames: row.efficiencyMatchNames as string[] | undefined,
          },
          personSortingLookup,
        )
        return v === '' ? '—' : formatNumber(v, 2)
      },
    },
  ]
}

export function buildScannerDailyColumns(): DataTableColumn[] {
  return [
    { key: 'date', title: '日期' },
    { key: 'scanCount', title: '扫描量', render: (row: DataTableRow) => formatInteger(Number(row.scanCount)) },
    { key: 'scannerCount', title: '扫描员人数', render: (row: DataTableRow) => formatInteger(Number(row.scannerCount)) },
    {
      key: 'effectiveHours',
      title: '有效工时(h)',
      render: (row: DataTableRow) => formatNumber(Number(row.effectiveHours), 2),
    },
    {
      key: 'efficiency',
      title: '效率(票/小时)',
      render: (row: DataTableRow) => formatNumber(Number(row.efficiency), 2),
    },
  ]
}

export function buildScannerPersonColumns(): DataTableColumn[] {
  return [
    { key: 'scanner', title: '扫描员' },
    {
      key: 'scanCount',
      title: '总扫描量',
      render: (row: DataTableRow) => formatInteger(Number(row.scanCount)),
    },
    {
      key: 'activeDays',
      title: '活跃天数',
      render: (row: DataTableRow) => formatInteger(Number(row.activeDays)),
    },
    {
      key: 'effectiveHours',
      title: '一级分拣有效工时',
      render: (row: DataTableRow) => formatNumber(Number(row.effectiveHours), 2),
    },
    // {
    //   key: 'efficiency',
    //   title: '总效率(票/小时)',
    //   render: (row: DataTableRow) => formatNumber(Number(row.efficiency), 2),
    // },
    {
      key: 'adjustedEfficiency',
      title: '修正效率(票/小时)',
      render: (row: DataTableRow) => {
        const v = Number(row.adjustedEfficiency)
        const low = isScannerAdjustedEfficiencyLow(v)
        return (
          <span
            className={
              low ? 'font-semibold tabular-nums text-red-600' : 'tabular-nums text-slate-900'
            }
          >
            {formatNumber(v, 2)}
          </span>
        )
      },
    },
  ]
}
