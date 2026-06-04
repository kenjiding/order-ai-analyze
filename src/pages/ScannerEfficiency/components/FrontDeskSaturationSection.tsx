import { useState } from 'react'
import Tooltip from '@mui/material/Tooltip'
import {
  formatDensityAllocationLabel,
  type FrontDeskDensityAllocation,
  type FrontDeskSaturationResult,
  type FrontDeskSaturationStatus,
} from '../frontDeskSaturation'
import { formatInteger, formatNumber } from '../formatAndParse'
import type { SourceInfo } from '../exportWorkbook'
import { DataTable, Metric, SectionTitle, type DataTableColumn, type DataTableRow } from './ui'

type Props = {
  result: FrontDeskSaturationResult | null
  dailyRows: DataTableRow[]
  densityRows: DataTableRow[]
  afternoonStartHour: number
  allocationSourceInfo: SourceInfo
  onAllocationFileChange: (files: FileList | null) => Promise<void>
  onClearAllocation: () => void
}

const statusClassMap: Record<FrontDeskSaturationStatus, string> = {
  missing: 'bg-slate-100 text-slate-600',
  idle: 'bg-amber-100 text-amber-700',
  loose: 'bg-blue-100 text-blue-700',
  reasonable: 'bg-emerald-100 text-emerald-700',
  tight: 'bg-violet-100 text-violet-700',
  delayed: 'bg-rose-100 text-rose-700',
}

function formatMinutes(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const label = `${formatNumber(abs, 0)} 分钟`
  if (value < 0) return `提前 ${label}`
  if (value > 0) return `滞后 ${label}`
  return '同步'
}

function percent(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${formatNumber(value * 100, 1)}%`
}

function saturationPercent(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${formatNumber(value, 0)}%`
}

function heatCellClass(count: number, maxCount: number): string {
  if (count <= 0 || maxCount <= 0) return 'bg-slate-50 text-slate-300'
  const ratio = count / maxCount
  if (ratio >= 0.8) return 'bg-[#166f68] text-white'
  if (ratio >= 0.6) return 'bg-[#2f8f87] text-white'
  if (ratio >= 0.35) return 'bg-[#8bd8cf] text-slate-900'
  return 'bg-[#d9f2ef] text-slate-700'
}

function offDutyIdleClass(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return 'bg-slate-100 text-slate-600 ring-slate-200'
  if (minutes >= 120) return 'bg-red-700 text-white ring-red-800'
  if (minutes >= 60) return 'bg-red-500 text-white ring-red-600'
  if (minutes >= 30) return 'bg-orange-300 text-orange-950 ring-orange-400'
  return 'bg-rose-100 text-rose-700 ring-rose-200'
}

function idleMinutesLabel(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${formatNumber(value, 0)} 分钟`
}

function adjustOffDutyIdleMinutes(raw: number | null, offsetMinutes: number): number | null {
  if (raw == null || !Number.isFinite(raw)) return null
  const offset = Number.isFinite(offsetMinutes) ? Math.max(0, offsetMinutes) : 0
  return Math.max(0, raw - offset)
}

function parseDensityAllocations(value: unknown): FrontDeskDensityAllocation[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const raw = item as FrontDeskDensityAllocation & { driver?: string }
      const driverCompany = String(raw.driverCompany ?? '').trim()
      const driverCode = String(raw.driverCode ?? (raw as { driverNo?: string }).driverNo ?? '').trim()
      const allocationTimeLabel = String(raw.allocationTimeLabel ?? '').trim()
      if (!driverCompany && !driverCode && !allocationTimeLabel && !raw.driver) return null
      return {
        driverCompany: driverCompany || '—',
        driverCode: driverCode || '—',
        allocationTimeLabel: allocationTimeLabel || '—',
      }
    })
    .filter((item): item is FrontDeskDensityAllocation => item != null)
}

function densityCellTooltipContent({
  date,
  slot,
  count,
  allocations,
  frontDeskOffDuty,
}: {
  date: string
  slot: string
  count: number
  allocations: FrontDeskDensityAllocation[]
  frontDeskOffDuty?: { label: string; person: string; idleMinutes: number | null }
}) {
  return (
    <div className="max-w-xs space-y-1 py-0.5 text-xs leading-relaxed">
      <div className="font-semibold">
        {date} {slot}：{formatInteger(count)} 个箱号
      </div>
      {allocations.length > 0 && (
        <ul className="max-h-48 list-none space-y-0.5 overflow-y-auto pl-0">
          {allocations.map((item, index) => (
            <li key={`${item.driverCompany}-${item.driverCode}-${item.allocationTimeLabel}-${index}`}>
              {formatDensityAllocationLabel(item)}
            </li>
          ))}
        </ul>
      )}
      {frontDeskOffDuty && (
        <div className="border-t border-white/20 pt-1 text-[11px] opacity-90">
          前台下班 {frontDeskOffDuty.person ? `${frontDeskOffDuty.person} ` : ''}
          {frontDeskOffDuty.label}；分配后空档 {idleMinutesLabel(frontDeskOffDuty.idleMinutes)}
        </div>
      )}
    </div>
  )
}

function FrontDeskDensityHeatmap({
  rows,
  dailyRows,
  offDutyIdleOffsetMinutes,
}: {
  rows: DataTableRow[]
  dailyRows: DataTableRow[]
  offDutyIdleOffsetMinutes: number
}) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
        暂无箱号分配密度数据。
      </div>
    )
  }

  const countMap = new Map<string, number>()
  const allocationsMap = new Map<string, FrontDeskDensityAllocation[]>()
  const frontDeskOffDutyMap = new Map<string, { label: string; person: string; idleMinutes: number | null }>()
  const dateSet = new Set<string>()
  const slotSet = new Set<string>()
  let maxCount = 0

  rows.forEach((row) => {
    const date = String(row.date ?? '')
    const timeSlot = String(row.timeSlot ?? '')
    if (!date || !timeSlot) return
    const count = Number(row.allocationCount ?? 0)
    const cellKey = `${date}\0${timeSlot}`
    dateSet.add(date)
    slotSet.add(timeSlot)
    countMap.set(cellKey, count)
    allocationsMap.set(cellKey, parseDensityAllocations(row.allocations))
    maxCount = Math.max(maxCount, count)
  })

  dailyRows.forEach((row) => {
    const date = String(row.date ?? '')
    const slot = String(row.frontDeskLastClockOutSlot ?? '')
    const label = String(row.frontDeskLastClockOutLabel ?? '')
    const person = String(row.frontDeskLastClockOutPerson ?? '')
    const idleMinutes = adjustOffDutyIdleMinutes(
      typeof row.offDutyIdleMinutes === 'number' && Number.isFinite(row.offDutyIdleMinutes)
        ? row.offDutyIdleMinutes
        : null,
      offDutyIdleOffsetMinutes,
    )
    if (!date || !slot) return
    dateSet.add(date)
    slotSet.add(slot)
    frontDeskOffDutyMap.set(`${date}\0${slot}`, { label, person, idleMinutes })
  })

  const dates = Array.from(dateSet).sort((a, b) => a.localeCompare(b))
  const slots = Array.from(slotSet).sort((a, b) => a.localeCompare(b))

  return (
    <div className="admin-panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 text-xs text-slate-500">
        <span>颜色越深，箱号分配越集中</span>
        <span>悬停格子可查看司机所属公司、司机编码与分配时间</span>
        <span>红色“前台下班”越深，表示最后分配到下班的空档越长</span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-5 rounded bg-[#d9f2ef]" />低
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-5 rounded bg-[#8bd8cf]" />中
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-5 rounded bg-[#166f68]" />高
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-1 p-3 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left font-semibold text-slate-600">
                日期
              </th>
              {slots.map((slot) => (
                <th key={slot} className="min-w-[5.5rem] px-2 py-2 text-center font-semibold text-slate-500">
                  {slot}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => (
              <tr key={date}>
                <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left font-semibold text-slate-700">
                  {date}
                </th>
                {slots.map((slot) => {
                  const cellKey = `${date}\0${slot}`
                  const count = countMap.get(cellKey) ?? 0
                  const allocations = allocationsMap.get(cellKey) ?? []
                  const frontDeskOffDuty = frontDeskOffDutyMap.get(cellKey)
                  const tooltip = densityCellTooltipContent({
                    date,
                    slot,
                    count,
                    allocations,
                    frontDeskOffDuty,
                  })
                  return (
                    <td
                      key={`${date}-${slot}`}
                      className={`rounded px-2 py-2 text-center font-semibold tabular-nums ${heatCellClass(count, maxCount)}`}
                    >
                      <Tooltip title={tooltip} arrow placement="top" enterDelay={200}>
                        <span className="block cursor-default">
                          <span className="block">{count > 0 ? formatInteger(count) : '·'}</span>
                          {frontDeskOffDuty && (
                            <span
                              className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ring-1 ${offDutyIdleClass(frontDeskOffDuty.idleMinutes)}`}
                            >
                              前台下班 {idleMinutesLabel(frontDeskOffDuty.idleMinutes)}
                            </span>
                          )}
                        </span>
                      </Tooltip>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function FrontDeskSaturationSection({
  result,
  dailyRows,
  densityRows,
  afternoonStartHour,
  allocationSourceInfo,
  onAllocationFileChange,
  onClearAllocation,
}: Props) {
  const [offDutyIdleOffsetMinutes, setOffDutyIdleOffsetMinutes] = useState(30)

  const dailyColumns: DataTableColumn[] = [
    { key: 'date', title: '日期' },
    { key: 'allocationCount', title: '箱号分配', render: (row) => formatInteger(Number(row.allocationCount)) },
    { key: 'frontDeskCount', title: '前台人数', render: (row) => formatInteger(Number(row.frontDeskCount)) },
    { key: 'frontDeskHours', title: '前台工时', render: (row) => formatNumber(Number(row.frontDeskHours), 2) },
    {
      key: 'frontDeskClockInLabel',
      title: '真实前台上班',
      render: (row) => String(row.frontDeskClockInLabel ?? '—'),
    },
    {
      key: 'frontDeskLastClockOutLabel',
      title: '真实前台下班',
      render: (row) => {
        const person = String(row.frontDeskLastClockOutPerson ?? '')
        const label = String(row.frontDeskLastClockOutLabel ?? '—')
        return person ? `${person} ${label}` : label
      },
    },
    {
      key: 'lastAllocationLabel',
      title: '最后分配',
      render: (row) => String(row.lastAllocationLabel ?? '—'),
    },
    {
      key: 'offDutyIdleMinutes',
      title: '分配后空档',
      render: (row) => idleMinutesLabel(row.offDutyIdleMinutes),
    },
    {
      key: 'sortingReadyLabel',
      title: '细分完成基准',
      render: (row) => String(row.sortingReadyLabel ?? '—'),
    },
    {
      key: 'firstAfternoonAllocationLabel',
      title: `${afternoonStartHour}:00 后集中起始(>2笔/段)`,
      render: (row) => String(row.firstAfternoonAllocationLabel ?? '—'),
    },
    {
      key: 'firstAfternoonGapMinutes',
      title: '提前/滞后',
      render: (row) => formatMinutes(row.firstAfternoonGapMinutes),
    },
    {
      key: 'boxesPerFrontDeskHour',
      title: '箱号/前台小时',
      render: (row) =>
        row.boxesPerFrontDeskHour == null ? '—' : formatNumber(Number(row.boxesPerFrontDeskHour), 2),
    },
    {
      key: 'surplusFrontDeskHours',
      title: '参考冗余工时',
      render: (row) =>
        row.surplusFrontDeskHours == null ? '—' : formatNumber(Number(row.surplusFrontDeskHours), 2),
    },
    {
      key: 'frontDeskSortingParticipationRate',
      title: '前台分拣参与',
      render: (row) => percent(row.frontDeskSortingParticipationRate),
    },
    {
      key: 'status',
      title: '状态',
      render: (row) => {
        const status = String(row.status || 'reasonable') as FrontDeskSaturationStatus
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClassMap[status]}`}>
            {String(row.statusLabel ?? '待观察')}
          </span>
        )
      },
    },
  ]

  return (
    <section className="space-y-4">
      <SectionTitle
        eyebrow="Front Desk Saturation"
        title="前台饱和度分析"
        description={`按箱号/派送员交接批次统计前台工作密度；${afternoonStartHour}:00 后取首个「半小时段分配数 > 2」的集中起始时间（该段第 3 笔分配），与“分拣下班基准 - 50 分钟割纸箱时间”对比，用于识别前台细分完成后到开始分配取货的合理程度。`}
      />

      <section className="admin-panel overflow-hidden border border-cyan-200 bg-cyan-50/40">
        <div className="border-b border-cyan-200 px-5 py-3 text-sm font-semibold text-cyan-900">前台分配包裹表</div>
        <div className="space-y-3 px-5 py-4">
          <label className="group flex cursor-pointer flex-col rounded-lg border border-dashed border-cyan-300 bg-white px-4 py-4 text-left transition hover:border-cyan-500 hover:bg-cyan-50/30">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">可选</div>
            <div className="mt-1 text-base font-semibold text-slate-900">上传前台分配包裹表</div>
            <div className="mt-1 text-xs text-slate-500">按“分配时间”统计箱号/派送员交接批次</div>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              multiple
              className="hidden"
              onChange={(event) => void onAllocationFileChange(event.target.files)}
            />
          </label>

          {allocationSourceInfo.fileNames.length > 0 && (
            <div className="rounded-lg border border-cyan-200 bg-white px-3 py-2 text-xs leading-relaxed text-cyan-900">
              前台分配表已载入 {allocationSourceInfo.fileNames.join('、')}：识别箱号分配{' '}
              {formatInteger(allocationSourceInfo.rowCount)} 行
              {allocationSourceInfo.droppedRows > 0 && (
                <>，未识别分配时间 {formatInteger(allocationSourceInfo.droppedRows)} 行</>
              )}
              。
            </div>
          )}

          <button
            type="button"
            onClick={onClearAllocation}
            className="inline-flex items-center rounded-lg border border-cyan-300 bg-white px-4 py-2 text-sm font-medium text-cyan-700 transition hover:border-cyan-400 hover:bg-cyan-50"
          >
            清空分配表
          </button>
        </div>
      </section>

      {!result ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-sm leading-7 text-slate-500">
          上传考勤后可识别前台和分拣工下班基准；再上传前台分配包裹表即可计算箱号分配密度。
        </div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-4">
            <Metric
              label="平均饱和指数"
              value={saturationPercent(result.summary.avgSaturationIndex)}
              hint={`参考基准 ${result.summary.benchmarkBoxesPerFrontDeskHour == null ? '—' : `${formatNumber(result.summary.benchmarkBoxesPerFrontDeskHour, 2)} 箱号/前台小时`}`}
              tone="dark"
            />
            <Metric
              label="前台总工时"
              value={`${formatNumber(result.summary.totalFrontDeskHours, 2)} h`}
              hint={`箱号分配 ${formatInteger(result.summary.totalAllocationCount)} 次`}
            />
            <Metric
              label="参考冗余工时"
              value={`${formatNumber(result.summary.totalSurplusFrontDeskHours, 2)} h`}
              hint={`低饱和/延迟风险 ${formatInteger(result.summary.riskDayCount)} 天`}
            />
            <Metric
              label="前台分拣参与"
              value={percent(result.summary.frontDeskSortingParticipationRate)}
              hint={`平均集中起始 ${formatMinutes(result.summary.avgFirstAfternoonGapMinutes)}`}
            />
          </div>

          <div className="min-w-0 px-4">
            <DataTable
              boundedScroll
              columns={dailyColumns}
              rows={dailyRows}
              emptyText="暂无前台饱和度数据。"
            />
          </div>

          <div className="min-w-0 px-4">
            <SectionTitle
              eyebrow="Allocation Density"
              title="包裹分配密度热力图"
              description=""
              right={
                <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={offDutyIdleOffsetMinutes}
                    onChange={(event) => {
                      const next = Number(event.target.value)
                      if (Number.isFinite(next) && next >= 0) setOffDutyIdleOffsetMinutes(next)
                    }}
                    className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-center text-sm font-semibold tabular-nums text-slate-900 outline-none focus:ring-2 focus:ring-[#2f8f87] focus:ring-offset-0"
                    aria-label="前台下班空档扣减分钟"
                  />
                  <span className="text-xs text-slate-500">分钟</span>
                </label>
              }
            />
            <FrontDeskDensityHeatmap
              rows={densityRows}
              dailyRows={dailyRows}
              offDutyIdleOffsetMinutes={offDutyIdleOffsetMinutes}
            />
          </div>
        </>
      )}
    </section>
  )
}
