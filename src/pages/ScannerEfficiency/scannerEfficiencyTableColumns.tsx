import { useEffect, useRef, useState } from 'react'
import { i18n } from '../../i18n/index'
import { sortingEfficiencyForPerson } from './sortingLookup'
import type { ScannerEfficiencyResult } from './aggregates'
import type { DataTableColumn, DataTableRow } from './components/ui'
import { formatCainiaoSharePercent } from './cainiaoWaybill'
import { formatInteger, formatNumber } from './formatAndParse'
import {
  isScannerAdjustedEfficiencyLow,
  isScannerTotalEfficiencyLow,
  SCANNER_EFFICIENCY_TABLE_LOW_CLASS,
  SCANNER_EFFICIENCY_TABLE_NORMAL_CLASS,
} from './scannerEfficiencyThresholds'

const t = (key: string, options?: Record<string, unknown>) =>
  String(i18n.t(key, { ns: 'scannerEfficiency', ...options }))

/** 数值列排序：无效值视为 -∞，配合 descend→ascend 时高值优先、空值靠后 */
function compareNumericField(
  a: DataTableRow,
  b: DataTableRow,
  getValue: (row: DataTableRow) => unknown,
): number {
  const toNum = (v: unknown) => {
    if (v == null || v === '') return Number.NEGATIVE_INFINITY
    const n = Number(v)
    return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY
  }
  return toNum(getValue(a)) - toNum(getValue(b))
}

const METRIC_SORT_DIRECTIONS: Array<'ascend' | 'descend'> = ['descend', 'ascend']

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
        aria-label={t('columns.totalHoursEditAria', { date: dateKey })}
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
      aria-label={t('columns.totalHoursInputAria', { date: dateKey })}
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
  totalSheinVolume: number
  avgSheinVolume: number
  sheinShareFromTotals: number | null
  avgSheinShare: number | null
  totalTemuVolume: number
  avgTemuVolume: number
  temuShareFromTotals: number | null
  avgTemuShare: number | null
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

/** 「每票成本」色阶（美元/票，按展示两位小数判定）：≤0.25 绿，(0.25, 0.28] 黄，>0.28 红 */
const COST_PER_TICKET_GREEN_MAX = 0.25
const COST_PER_TICKET_YELLOW_MAX = 0.28

function costPerTicketForHighlight(cost: number): number {
  return Math.round(cost * 100) / 100
}

const DAY_EFFICIENCY_CELL_CLASS = 'text-base tabular-nums'
const COST_PER_TICKET_CELL_CLASS = 'text-base tabular-nums'

function costPerTicketHighlightClass(cost: number): string {
  const normalized = costPerTicketForHighlight(cost)
  const base = `inline-block rounded px-1.5 py-0.5 font-semibold ${COST_PER_TICKET_CELL_CLASS}`
  if (normalized <= COST_PER_TICKET_GREEN_MAX) {
    return `${base} bg-green-100 text-green-700`
  }
  if (normalized <= COST_PER_TICKET_YELLOW_MAX) {
    return `${base} bg-amber-100 text-amber-700`
  }
  return `${base} bg-red-100 text-red-700`
}

function attendanceMatchFooterCell(
  total: string,
  accent?: { topClass?: string; emphasized?: boolean },
) {
  const topClass = accent?.topClass ?? 'font-medium text-slate-900'
  const sizeClass = accent?.emphasized ? 'text-base' : 'text-xs'
  return (
    <span className={`${sizeClass} leading-snug ${topClass}`}>{t('tableFooter.totalWithValue', { value: total })}</span>
  )
}

export function buildDailyVolumeColumns(): DataTableColumn[] {
  return [
    { key: 'date', title: t('columns.date') },
    { key: 'volume', title: t('columns.totalVolume'), render: (row: DataTableRow) => formatInteger(Number(row.volume)) },
    {
      key: 'cainiaoShare',
      title: t('columns.cainiaoShare'),
      render: (row: DataTableRow) =>
        formatCainiaoSharePercent(Number(row.volume) > 0 ? Number(row.cainiaoShare) : null),
    },
    {
      key: 'sheinShare',
      title: t('columns.sheinShare'),
      render: (row: DataTableRow) =>
        formatCainiaoSharePercent(Number(row.volume) > 0 ? Number(row.sheinShare) : null),
    },
    {
      key: 'temuShare',
      title: t('columns.temuShare'),
      render: (row: DataTableRow) =>
        formatCainiaoSharePercent(Number(row.volume) > 0 ? Number(row.temuShare) : null),
    },
    {
      key: 'scannerCount',
      title: t('columns.scannerCount'),
      render: (row: DataTableRow) => formatInteger(Number(row.scannerCount)),
    },
  ]
}

function isGroupedMetaRow(row: DataTableRow): boolean {
  return Boolean(row.isWeekGroupHeader || row.isWeekGroupFooter || row.isAttendanceMatchFooter)
}

export function buildAttendanceMatchColumns(options?: {
  onDailyTotalHoursCommit?: (date: string, value: number | null) => void
}): DataTableColumn[] {
  const onCommit = options?.onDailyTotalHoursCommit
  return [
    {
      key: 'date',
      title: t('columns.date'),
      render: (row: DataTableRow) => {
        if (row.isWeekGroupHeader) {
          const color = String(row.weekColor ?? '#2563eb')
          return (
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
              <span>{String(row.date ?? '')}</span>
            </div>
          )
        }
        if (row.isWeekGroupFooter) {
          const label = String(row.date ?? t('tableFooter.weekSubtotal'))
          const color = row.weekColor ? String(row.weekColor) : null
          if (color) {
            return (
              <div className="flex items-center gap-2 font-semibold text-slate-800">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <span>{label}</span>
              </div>
            )
          }
          return <span className="font-semibold text-slate-800">{label}</span>
        }
        return String(row.date ?? '')
      },
    },
    {
      key: 'volume',
      title: t('columns.totalVolume'),
      render: (row: DataTableRow) => {
        if (row.matchFooterStats && (row.isWeekGroupFooter || row.isAttendanceMatchFooter)) {
          const s = row.matchFooterStats as MatchFooterStats
          return attendanceMatchFooterCell(formatInteger(s.totalVolume))
        }
        if (row.isWeekGroupHeader) return '—'
        return formatInteger(Number(row.volume))
      },
    },
    {
      key: 'attendanceTotalLaborCost',
      title: t('columns.totalCost'),
      render: (row: DataTableRow) => {
        if (row.matchFooterStats && (row.isWeekGroupFooter || row.isAttendanceMatchFooter)) {
          const s = row.matchFooterStats as MatchFooterStats
          const total =
            s.totalLaborCostSum == null || !Number.isFinite(s.totalLaborCostSum)
              ? '—'
              : `$${formatNumber(s.totalLaborCostSum, 2)}`
          return attendanceMatchFooterCell(total)
        }
        if (row.isWeekGroupHeader) return '—'
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
      title: t('columns.cainiaoShare'),
      render: (row: DataTableRow) => {
        if (row.matchFooterStats && (row.isWeekGroupFooter || row.isAttendanceMatchFooter)) {
          const s = row.matchFooterStats as MatchFooterStats
          return attendanceMatchFooterCell(formatCainiaoSharePercent(s.cainiaoShareFromTotals))
        }
        if (row.isWeekGroupHeader) return '—'
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
      key: 'sheinShare',
      title: t('columns.sheinShare'),
      render: (row: DataTableRow) => {
        if (row.matchFooterStats && (row.isWeekGroupFooter || row.isAttendanceMatchFooter)) {
          const s = row.matchFooterStats as MatchFooterStats
          return attendanceMatchFooterCell(formatCainiaoSharePercent(s.sheinShareFromTotals))
        }
        if (row.isWeekGroupHeader) return '—'
        if (row.isAttendanceOnly || !(Number(row.volume) > 0)) {
          return <span className="tabular-nums text-slate-400">-</span>
        }
        return (
          <span className="tabular-nums text-slate-700">
            {formatCainiaoSharePercent(Number(row.sheinShare))}
          </span>
        )
      },
    },
    {
      key: 'temuShare',
      title: t('columns.temuShare'),
      render: (row: DataTableRow) => {
        if (row.matchFooterStats && (row.isWeekGroupFooter || row.isAttendanceMatchFooter)) {
          const s = row.matchFooterStats as MatchFooterStats
          return attendanceMatchFooterCell(formatCainiaoSharePercent(s.temuShareFromTotals))
        }
        if (row.isWeekGroupHeader) return '—'
        if (row.isAttendanceOnly || !(Number(row.volume) > 0)) {
          return <span className="tabular-nums text-slate-400">-</span>
        }
        return (
          <span className="tabular-nums text-slate-700">
            {formatCainiaoSharePercent(Number(row.temuShare))}
          </span>
        )
      },
    },
    {
      key: 'sorterCount',
      title: t('columns.sorterCount'),
      render: (row: DataTableRow) => {
        if (isGroupedMetaRow(row)) return row.isWeekGroupHeader ? '—' : '—'
        return row.hasAttendance ? formatInteger(Number(row.sorterCount)) : '-'
      },
    },
    {
      key: 'totalHours',
      title: t('columns.totalHoursAdjusted'),
      render: (row: DataTableRow) => {
        if (row.matchFooterStats && (row.isWeekGroupFooter || row.isAttendanceMatchFooter)) {
          const s = row.matchFooterStats as MatchFooterStats
          return attendanceMatchFooterCell(formatNumber(s.totalHoursSum, 2))
        }
        if (row.isWeekGroupHeader || row.isWeekGroupFooter) return '—'
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
      title: t('columns.dayEfficiency'),
      render: (row: DataTableRow) => {
        if (row.matchFooterStats && (row.isWeekGroupFooter || row.isAttendanceMatchFooter)) {
          const s = row.matchFooterStats as MatchFooterStats
          const totalEff =
            s.efficiencyFromTotals == null ? '—' : formatNumber(s.efficiencyFromTotals, 2)
          return attendanceMatchFooterCell(totalEff, {
            emphasized: true,
            topClass: isDayEfficiencyAtOrBelowAlert(s.efficiencyFromTotals)
              ? `font-semibold ${DAY_EFFICIENCY_CELL_CLASS} text-red-600`
              : `font-medium ${DAY_EFFICIENCY_CELL_CLASS} text-slate-900`,
          })
        }
        if (row.isWeekGroupHeader) return '—'
        if (row.dayEfficiency == null) {
          return <span className={`${DAY_EFFICIENCY_CELL_CLASS} text-slate-400`}>-</span>
        }
        const eff = Number(row.dayEfficiency)
        const low = isDayEfficiencyAtOrBelowAlert(eff)
        return (
          <span
            className={
              low
                ? `font-semibold ${DAY_EFFICIENCY_CELL_CLASS} text-red-600`
                : `${DAY_EFFICIENCY_CELL_CLASS} text-slate-900`
            }
          >
            {formatNumber(eff, 2)}
          </span>
        )
      },
    },
    {
      key: 'attendanceCostPerTicket',
      title: t('columns.costPerTicket'),
      render: (row: DataTableRow) => {
        if (row.matchFooterStats && (row.isWeekGroupFooter || row.isAttendanceMatchFooter)) {
          const s = row.matchFooterStats as MatchFooterStats
          const footerCost = s.costPerTicketFromTotals ?? s.avgCostPerTicket
          const unit =
            footerCost == null || !Number.isFinite(footerCost)
              ? '—'
              : `$${formatNumber(footerCost, 2)}`
          if (footerCost == null || !Number.isFinite(footerCost)) {
            return attendanceMatchFooterCell(unit, { emphasized: true })
          }
          return (
            <span className="text-base leading-snug">
              <span className="font-medium text-slate-900">
                {t('tableFooter.total')}{' '}
                <span className={costPerTicketHighlightClass(footerCost)}>{unit}</span>
              </span>
            </span>
          )
        }
        if (row.isWeekGroupHeader) return '—'
        const c = row.attendanceCostPerTicket
        if (c == null || !Number.isFinite(Number(c))) {
          return <span className={`${COST_PER_TICKET_CELL_CLASS} text-slate-400`}>-</span>
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

export function buildAttendancePersonColumns(
  scannerResult: ScannerEfficiencyResult | null,
): DataTableColumn[] {
  return [
    { key: 'sorterName', title: t('columns.person') },
    { key: 'totalHours', title: t('columns.totalHours'), render: (row: DataTableRow) => formatNumber(Number(row.totalHours), 2) },
    {
      key: 'sortingScanCount',
      title: t('columns.scanCount'),
      render: (row: DataTableRow) =>
        row.personMatchedSortingScan == null ? '—' : formatInteger(Number(row.personMatchedSortingScan)),
    },
    {
      key: 'onDutyEfficiency',
      title: t('columns.onDutyEfficiency'),
      render: (row: DataTableRow) =>
        row.personOnDutyEfficiencyPerHour == null
          ? '—'
          : formatNumber(Number(row.personOnDutyEfficiencyPerHour), 2),
    },
    { key: 'activeDays', title: t('columns.activeDays'), render: (row: DataTableRow) => formatInteger(Number(row.activeDays)) },
    {
      key: 'sortingEfficiency',
      title: t('columns.sortingEfficiency'),
      render: (row: DataTableRow) => {
        const v = sortingEfficiencyForPerson(
          {
            sorterName: String(row.sorterName ?? ''),
            sorterKey: String(row.sorterKey ?? ''),
            efficiencyMatchNames: row.efficiencyMatchNames as string[] | undefined,
          },
          scannerResult,
        )
        return v === '' ? '—' : formatNumber(v, 2)
      },
    },
  ]
}

export function buildScannerDailyColumns(): DataTableColumn[] {
  return [
    { key: 'date', title: t('columns.date') },
    { key: 'scanCount', title: t('columns.scanCount'), render: (row: DataTableRow) => formatInteger(Number(row.scanCount)) },
    { key: 'scannerCount', title: t('columns.scannerCount'), render: (row: DataTableRow) => formatInteger(Number(row.scannerCount)) },
    {
      key: 'effectiveHours',
      title: t('columns.effectiveHours'),
      render: (row: DataTableRow) => formatNumber(Number(row.effectiveHours), 2),
    },
    {
      key: 'efficiency',
      title: t('columns.efficiency'),
      render: (row: DataTableRow) => formatNumber(Number(row.efficiency), 2),
    },
  ]
}

export function buildScannerTotalEfficiencyColumns(): DataTableColumn[] {
  return [
    { key: 'scanner', title: t('columns.scanner') },
    {
      key: 'scanCount',
      title: t('columns.scanCount'),
      sortDirections: METRIC_SORT_DIRECTIONS,
      defaultSortOrder: 'descend',
      sorter: (a, b) => compareNumericField(a, b, (row) => row.scanCount),
      render: (row: DataTableRow) =>
        row.isTableAverageRow
          ? formatNumber(Number(row.scanCount), 2)
          : formatInteger(Number(row.scanCount)),
    },
    {
      key: 'cainiaoShare',
      title: t('columns.cainiaoShare'),
      render: (row: DataTableRow) => {
        if (row.cainiaoShare == null) return '—'
        return formatCainiaoSharePercent(Number(row.cainiaoShare))
      },
    },
    {
      key: 'totalHours',
      title: t('columns.totalHours'),
      render: (row: DataTableRow) => {
        if (row.totalHours == null) return '—'
        return formatNumber(Number(row.totalHours), 2)
      },
    },
    {
      key: 'cainiaoAdjustedTotalEfficiency',
      title: t('columns.totalEfficiency'),
      sortDirections: METRIC_SORT_DIRECTIONS,
      sorter: (a, b) =>
        compareNumericField(a, b, (row) => row.cainiaoAdjustedTotalEfficiency ?? row.totalEfficiency),
      render: (row: DataTableRow) => {
        const v = row.cainiaoAdjustedTotalEfficiency ?? row.totalEfficiency
        if (v == null) return '—'
        const num = Number(v)
        const low = !row.isTableAverageRow && isScannerTotalEfficiencyLow(num)
        return (
          <span className={low ? SCANNER_EFFICIENCY_TABLE_LOW_CLASS : SCANNER_EFFICIENCY_TABLE_NORMAL_CLASS}>
            {formatNumber(num, 2)}
          </span>
        )
      },
    },
  ]
}

export function buildScannerPersonColumns(): DataTableColumn[] {
  return [
    { key: 'scanner', title: t('columns.scanner'), width: 160 },
    {
      key: 'scanCount',
      title: t('columns.totalScanCount'),
      sortDirections: METRIC_SORT_DIRECTIONS,
      defaultSortOrder: 'descend',
      sorter: (a, b) => compareNumericField(a, b, (row) => row.scanCount),
      render: (row: DataTableRow) =>
        row.isTableAverageRow
          ? formatNumber(Number(row.scanCount), 2)
          : formatInteger(Number(row.scanCount)),
    },
    {
      key: 'cainiaoShare',
      title: t('columns.cainiaoShare'),
      render: (row: DataTableRow) => {
        if (row.cainiaoShare == null) return '—'
        return formatCainiaoSharePercent(Number(row.cainiaoShare))
      },
    },
    {
      key: 'activeDays',
      title: t('columns.activeDays'),
      render: (row: DataTableRow) =>
        row.isTableAverageRow
          ? formatNumber(Number(row.activeDays), 2)
          : formatInteger(Number(row.activeDays)),
    },
    {
      key: 'effectiveHours',
      title: t('columns.sortingEffectiveHours'),
      render: (row: DataTableRow) => formatNumber(Number(row.effectiveHours), 2),
    },
    {
      key: 'cainiaoAdjustedEfficiency',
      title: t('columns.adjustedEfficiency'),
      sortDirections: METRIC_SORT_DIRECTIONS,
      sorter: (a, b) =>
        compareNumericField(a, b, (row) => row.cainiaoAdjustedEfficiency ?? row.adjustedEfficiency),
      render: (row: DataTableRow) => {
        const v = row.cainiaoAdjustedEfficiency ?? row.adjustedEfficiency
        if (v == null && row.isTableAverageRow) return '—'
        const num = Number(v)
        const low = !row.isTableAverageRow && isScannerAdjustedEfficiencyLow(num)
        return (
          <span className={low ? SCANNER_EFFICIENCY_TABLE_LOW_CLASS : SCANNER_EFFICIENCY_TABLE_NORMAL_CLASS}>
            {formatNumber(num, 2)}
          </span>
        )
      },
    },
  ]
}
