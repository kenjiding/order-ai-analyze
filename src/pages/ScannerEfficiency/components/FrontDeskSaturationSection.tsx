import { useState } from 'react'
import Collapse from '@mui/material/Collapse'
import { Button, Popover } from 'antd'
import { ChevronDown, CloudDownload } from 'lucide-react'
import {
  DensityHeatmapCellDetail,
  type DensityHeatmapClockOutDetail,
} from './DensityHeatmapCellDetail'
import type { FrontDeskDensityAllocation } from '../frontDeskSaturation'
import { formatInteger, formatNumber } from '../formatAndParse'
import type { SourceInfo } from '../sourceInfo'
import { SectionTitle, type DataTableRow } from './ui'

const HEATMAP_POPOVER_STYLES = {
  content: {
    padding: 0,
    borderRadius: 8,
    overflow: 'hidden',
    boxShadow: '0 16px 40px rgba(34, 50, 71, 0.14)',
    border: '1px solid #d8e6ee',
  },
} as const

type Props = {
  densityRows: DataTableRow[]
  clockOutRows: DataTableRow[]
  allocationSourceInfo: SourceInfo
  loadingAllocationApi: boolean
  onAllocationFileChange: (files: FileList | null) => Promise<void>
  onClearAllocation: () => void
  onApiFetch?: () => void
  readOnly?: boolean
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

function DensityHeatmapCell({
  count,
  detail,
  frontDeskOffDuty,
}: {
  count: number
  detail: {
    date: string
    slot: string
    count: number
    allocations: FrontDeskDensityAllocation[]
    clockOut?: DensityHeatmapClockOutDetail
  }
  frontDeskOffDuty?: DensityHeatmapClockOutDetail
}) {
  const hasDetail = detail.count > 0 || detail.allocations.length > 0 || detail.clockOut

  const cellBody = (
    <span
      className={[
        'block rounded-md px-2 py-2 transition',
        hasDetail ? 'cursor-default hover:ring-2 hover:ring-[#2f8f87]/25 hover:ring-offset-1' : '',
      ].join(' ')}
    >
      <span className="block">{count > 0 ? formatInteger(count) : '·'}</span>
      {frontDeskOffDuty && (
        <span
          className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ring-1 ${offDutyIdleClass(frontDeskOffDuty.idleMinutes)}`}
        >
          前台下班 {idleMinutesLabel(frontDeskOffDuty.idleMinutes)}
        </span>
      )}
    </span>
  )

  if (!hasDetail) {
    return cellBody
  }

  return (
    <Popover
      content={<DensityHeatmapCellDetail {...detail} />}
      trigger="hover"
      placement="top"
      mouseEnterDelay={0.16}
      styles={HEATMAP_POPOVER_STYLES}
      arrow={{ pointAtCenter: true }}
    >
      {cellBody}
    </Popover>
  )
}

function AllocationDensityHeatmap({
  rows,
  clockOutRows,
  offDutyIdleOffsetMinutes,
}: {
  rows: DataTableRow[]
  clockOutRows: DataTableRow[]
  offDutyIdleOffsetMinutes: number
}) {
  if (!rows.length && !clockOutRows.length) {
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

  clockOutRows.forEach((row) => {
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
        <span>悬停格子可查看司机所属公司、Route Code 与分配时间</span>
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
                  const clockOut: DensityHeatmapClockOutDetail | undefined = frontDeskOffDuty
                    ? {
                        label: frontDeskOffDuty.label,
                        person: frontDeskOffDuty.person,
                        idleMinutes: frontDeskOffDuty.idleMinutes,
                      }
                    : undefined
                  return (
                    <td
                      key={`${date}-${slot}`}
                      className={`rounded px-1 py-1 text-center font-semibold tabular-nums ${heatCellClass(count, maxCount)}`}
                    >
                      <DensityHeatmapCell
                        count={count}
                        frontDeskOffDuty={clockOut}
                        detail={{
                          date,
                          slot,
                          count,
                          allocations,
                          clockOut,
                        }}
                      />
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
  densityRows,
  clockOutRows,
  allocationSourceInfo,
  loadingAllocationApi,
  onAllocationFileChange,
  onClearAllocation,
  onApiFetch,
  readOnly = false,
}: Props) {
  const [offDutyIdleOffsetMinutes, setOffDutyIdleOffsetMinutes] = useState(30)
  const [allocationPanelExpanded, setAllocationPanelExpanded] = useState(false)

  const allocationPanelSummary = readOnly
    ? '记录查看模式下不可修改分配表，请退出查看后重新载入'
    : loadingAllocationApi
    ? '正在从 iMile API 异步拉取前台分配数据…'
    : allocationSourceInfo.rowCount > 0
      ? `已载入 ${formatInteger(allocationSourceInfo.rowCount)} 行${allocationSourceInfo.fileNames.length ? `（${allocationSourceInfo.fileNames.join('、')}）` : ''}`
      : '点击展开上传文件或查看载入状态'

  return (
    <section className="space-y-4">
      <SectionTitle
        eyebrow="Allocation Density"
        title="包裹分配密度热力图"
        description=""
        right={
          <div className="flex items-center gap-3">
            {onApiFetch && !readOnly && (
              <Button
                type='primary'
                icon={<CloudDownload className="h-4 w-4" aria-hidden />}
                loading={loadingAllocationApi}
                disabled={loadingAllocationApi}
                onClick={onApiFetch}
              >
                API 获取
              </Button>
            )}
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
          </div>
        }
      />

      <section className="admin-panel overflow-hidden border border-cyan-200 bg-cyan-50/40">
        <button
          type="button"
          className={[
            'flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-cyan-50/60',
            allocationPanelExpanded ? 'border-b border-cyan-200' : '',
          ].join(' ')}
          aria-expanded={allocationPanelExpanded}
          aria-label={allocationPanelExpanded ? '收起前台分配包裹表' : '展开前台分配包裹表'}
          onClick={() => setAllocationPanelExpanded((prev) => !prev)}
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold text-cyan-900">前台分配包裹表</div>
            {!allocationPanelExpanded && (
              <div className="mt-0.5 truncate text-xs text-cyan-800/80">{allocationPanelSummary}</div>
            )}
          </div>
          <ChevronDown
            className={[
              'h-5 w-5 shrink-0 text-cyan-700 transition-transform duration-200',
              allocationPanelExpanded ? 'rotate-180' : '',
            ].join(' ')}
            aria-hidden
          />
        </button>
        <Collapse in={allocationPanelExpanded} timeout="auto" unmountOnExit>
          <div className="space-y-3 px-5 py-4">
            {readOnly ? (
              <div className="rounded-lg border border-cyan-200 bg-white px-3 py-2 text-xs leading-relaxed text-cyan-900">
                当前为效率考勤记录查看模式，分配表数据来自已保存快照。
              </div>
            ) : (
              <>
            <label className="group flex cursor-pointer flex-col rounded-lg border border-dashed border-cyan-300 bg-white px-4 py-4 text-left transition hover:border-cyan-500 hover:bg-cyan-50/30">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">可选</div>
              <div className="mt-1 text-base font-semibold text-slate-900">上传前台分配包裹表</div>
              <div className="mt-1 text-xs text-slate-500">
                按“分配时间”统计箱号/派送员交接批次；载入扫描记录 API 拉取到件时会异步拉取前台分配数据
              </div>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                multiple
                className="hidden"
                onChange={(event) => void onAllocationFileChange(event.target.files)}
              />
            </label>

            {loadingAllocationApi && (
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs leading-relaxed text-cyan-900">
                正在从 iMile API 异步拉取前台分配数据…
              </div>
            )}

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
              </>
            )}
          </div>
        </Collapse>
      </section>

      <AllocationDensityHeatmap
        rows={densityRows}
        clockOutRows={clockOutRows}
        offDutyIdleOffsetMinutes={offDutyIdleOffsetMinutes}
      />
    </section>
  )
}
