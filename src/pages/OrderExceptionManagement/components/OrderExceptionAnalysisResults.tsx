import { Tag, Tooltip } from 'antd'
import { saveAs } from 'file-saver'
import { CheckSquare, ChevronDown, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx-js-style'
import { applySheetCenterAlignment } from '../../../utils/xlsxCenteredSheet'
import { DataTable, ExportButton, type DataTableColumn } from '../../ScannerEfficiency/components/ui'
import type { AnalysisRow, AnalyzeProgress, SubmittedJobBanner } from '../analysisTypes'
import type { PostFilterConfig } from '../postFilter/types'
import { AnalyzeProgressStrip } from './AnalyzeProgressStrip'
import { OrderAnalysisDetailDrawer } from './OrderAnalysisDetailDrawer'
import { OrderExceptionPushSection } from './OrderExceptionPushSection'
import { PostFilterConfigSection } from './PostFilterConfigSection'
import {
  ANALYSIS_EXPORT_COLUMN_WIDTHS,
  ANALYSIS_EXPORT_SHEET_NAME,
  toAnalysisExportRow,
} from '../analysisExport'

type Row = AnalysisRow

type ColumnFilters = {
  lossScope: string[]
  categoryName: string[]
  noOperationDays: string[]
  consigneeRouteCode: string[]
  currentResponsibilityParty: string[]
  latestResponsibilityPerson: string[]
  latestResponsibilityAction: string[]
}

function FilterableHeader({
  title,
  options,
  selected,
  onChange,
}: {
  title: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updateMenuPos = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuPos({ left: rect.left, top: rect.bottom + 6 })
  }, [])

  useEffect(() => {
    if (!open) return
    updateMenuPos()
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', updateMenuPos, true)
    window.addEventListener('resize', updateMenuPos)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', updateMenuPos, true)
      window.removeEventListener('resize', updateMenuPos)
    }
  }, [open, updateMenuPos])

  const isActive = selected.length > 0

  const toggleOption = (val: string) => {
    onChange(selected.includes(val) ? selected.filter((s) => s !== val) : [...selected, val])
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          'inline-flex items-center gap-1 rounded px-1 -mx-1 py-0.5 transition-colors',
          isActive ? 'text-[#1f6f68]' : 'hover:text-[#1f6f68]',
        ].join(' ')}
      >
        <span className={isActive ? 'font-bold' : ''}>{title}</span>
        {isActive ? (
          <span className="inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[#1f6f68] px-0.5 text-[9px] font-bold leading-none text-white">
            {selected.length}
          </span>
        ) : (
          <ChevronDown
            className={['h-3 w-3 shrink-0 transition-transform', open ? 'rotate-180' : ''].join(' ')}
            aria-hidden
          />
        )}
      </button>

      {open && menuPos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', left: menuPos.left, top: menuPos.top }}
            className="z-50 min-w-[148px] rounded-md border border-slate-200 bg-white shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-2.5 py-1.5">
              <button
                type="button"
                onClick={() => onChange(options)}
                className="text-[11px] text-slate-500 hover:text-slate-800"
              >
                全选
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className={[
                  'text-[11px] transition-colors',
                  isActive ? 'text-[#1f6f68] hover:text-[#2f8f87]' : 'text-slate-400',
                ].join(' ')}
              >
                清除
              </button>
            </div>
            <div className="max-h-52 overflow-y-auto py-1">
              {options.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-slate-400">暂无数据</p>
              ) : (
                options.map((opt) => (
                  <label
                    key={opt}
                    className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[11px] font-normal normal-case tracking-normal text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(opt)}
                      onChange={() => toggleOption(opt)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 accent-[#1f6f68]"
                    />
                    <span className="truncate">{opt || '(空)'}</span>
                  </label>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

function renderReasonCell(r: Row): ReactNode {
  const reason = String(r.reason ?? '')
  if (r.status === 'pending') {
    return <span className="text-slate-400">待分析</span>
  }
  if (r.status === 'analyzing') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[#1f6f68]">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        {reason || '分析中…'}
      </span>
    )
  }
  if (r.status === 'error') {
    return <span className="text-red-600">{reason}</span>
  }
  if (reason.startsWith('[事实校验纠正]')) {
    return (
      <span>
        <span className="font-semibold text-amber-600">[事实校验纠正]</span>
        <span className="text-slate-700">{reason.slice('[事实校验纠正]'.length)}</span>
      </span>
    )
  }
  if (reason.startsWith('[取消扫描核验纠正]')) {
    return (
      <span>
        <span className="font-semibold text-amber-600">[取消扫描核验纠正]</span>
        <span className="text-slate-700">{reason.slice('[取消扫描核验纠正]'.length)}</span>
      </span>
    )
  }
  return <span className="text-slate-700">{reason}</span>
}

function SubmittedBanner({
  banner,
  onDismiss,
  onGoToJobs,
}: {
  banner: SubmittedJobBanner
  onDismiss: () => void
  onGoToJobs: () => void
}) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
      <CheckSquare className="h-4 w-4 shrink-0 text-blue-500" aria-hidden />
      <p className="min-w-0 flex-1 text-xs text-slate-700">
        批量任务已提交（<span className="font-semibold">{banner.orderCount} 单</span>），后台 Worker 正在处理，分析页面不会被阻塞
      </p>
      <button
        type="button"
        onClick={onGoToJobs}
        className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
      >
        查看任务队列 →
      </button>
      <button type="button" onClick={onDismiss} className="shrink-0 text-slate-400 hover:text-slate-600">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/** 「额外数据」列固定宽度：单行展示、超出省略，完整内容由 hover Tooltip 给出 */
const EXTRA_DATA_COLUMN_WIDTH_CLASS = 'w-[420px]'

function noOperationDaysLabel(r: Row): string {
  return r.latestResponsibility ? String(r.latestResponsibility.noOperationDays) : '—'
}

function routeCodeLabel(r: Row): string {
  return r.orderInfo?.consigneeRouteCode || '—'
}

function buildColumns(
  onOpenOrderDetail: (row: Row) => void,
  visitedOrders: Set<string>,
  columnFilters: ColumnFilters,
  onColumnFilterChange: (key: keyof ColumnFilters, next: string[]) => void,
  lossScopeOptions: string[],
  categoryNameOptions: string[],
  noOperationDaysOptions: string[],
  consigneeRouteCodeOptions: string[],
  responsibilityOptions: string[],
  latestResponsibilityPersonOptions: string[],
  latestResponsibilityActionOptions: string[],
): DataTableColumn[] {
  return [
    {
      key: 'orderNo',
      title: '订单号',
      render: (row) => {
        const r = row as unknown as Row
        const disabled = r.status === 'pending' || r.status === 'analyzing'
        const visited = visitedOrders.has(r.orderNo)
        return (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onOpenOrderDetail(r)}
            className={`font-mono underline decoration-dashed underline-offset-2 disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline ${
              visited ? 'text-slate-400 hover:text-slate-500' : 'text-[#1f6f68] hover:text-[#2f8f87]'
            }`}
            aria-label={`查看订单 ${r.orderNo} 的轨迹与阻断日志`}
          >
            {r.orderNo}
          </button>
        )
      },
    },
    {
      key: 'lossScope',
      title: '异常类型',
      renderTitle: () => (
        <FilterableHeader
          title="异常类型"
          options={lossScopeOptions}
          selected={columnFilters.lossScope}
          onChange={(next) => onColumnFilterChange('lossScope', next)}
        />
      ),
      render: (row) => {
        const r = row as unknown as Row
        if (r.status === 'pending' || r.status === 'analyzing') {
          return <span className="text-slate-400">—</span>
        }
        return <span>{String(r.lossScope ?? '')}</span>
      },
    },
    {
      key: 'categoryName',
      title: '子类型',
      renderTitle: () => (
        <FilterableHeader
          title="子类型"
          options={categoryNameOptions}
          selected={columnFilters.categoryName}
          onChange={(next) => onColumnFilterChange('categoryName', next)}
        />
      ),
      render: (row) => {
        const r = row as unknown as Row
        if (r.status === 'pending' || r.status === 'analyzing') {
          return <span className="text-slate-400">—</span>
        }
        return <span>{String(r.categoryName ?? '')}</span>
      },
    },
    {
      key: 'noOperationDays',
      title: '无操作天数',
      renderTitle: () => (
        <FilterableHeader
          title="无操作天数"
          options={noOperationDaysOptions}
          selected={columnFilters.noOperationDays}
          onChange={(next) => onColumnFilterChange('noOperationDays', next)}
        />
      ),
      render: (row) => {
        const r = row as unknown as Row
        if (r.status === 'pending' || r.status === 'analyzing') {
          return <span className="text-slate-400">—</span>
        }
        return <span>{noOperationDaysLabel(r)}</span>
      },
    },
    {
      key: 'consigneeRouteCode',
      title: '路由码',
      renderTitle: () => (
        <FilterableHeader
          title="路由码"
          options={consigneeRouteCodeOptions}
          selected={columnFilters.consigneeRouteCode}
          onChange={(next) => onColumnFilterChange('consigneeRouteCode', next)}
        />
      ),
      render: (row) => {
        const r = row as unknown as Row
        if (r.status === 'pending' || r.status === 'analyzing') {
          return <span className="text-slate-400">—</span>
        }
        return <span>{routeCodeLabel(r)}</span>
      },
    },
    {
      key: 'latestResponsibilityPerson',
      title: '最新责任人',
      renderTitle: () => (
        <FilterableHeader
          title="最新责任人"
          options={latestResponsibilityPersonOptions}
          selected={columnFilters.latestResponsibilityPerson}
          onChange={(next) => onColumnFilterChange('latestResponsibilityPerson', next)}
        />
      ),
      render: (row) => {
        const r = row as unknown as Row
        if (r.status === 'pending' || r.status === 'analyzing') {
          return <span className="text-slate-400">—</span>
        }
        return <span>{r.latestResponsibility?.person ?? '—'}</span>
      },
    },
    {
      key: 'latestResponsibilityAction',
      title: '最新责任操作',
      renderTitle: () => (
        <FilterableHeader
          title="最新责任操作"
          options={latestResponsibilityActionOptions}
          selected={columnFilters.latestResponsibilityAction}
          onChange={(next) => onColumnFilterChange('latestResponsibilityAction', next)}
        />
      ),
      render: (row) => {
        const r = row as unknown as Row
        if (r.status === 'pending' || r.status === 'analyzing') {
          return <span className="text-slate-400">—</span>
        }
        return <span>{r.latestResponsibility?.action ?? '—'}</span>
      },
    },
    {
      key: 'latestResponsibilityTime',
      title: '最新责任时间',
      render: (row) => {
        const r = row as unknown as Row
        if (r.status === 'pending' || r.status === 'analyzing') {
          return <span className="text-slate-400">—</span>
        }
        return <span>{r.latestResponsibility?.displayTime ?? '—'}</span>
      },
    },
    {
      key: 'currentResponsibilityParty',
      title: '当前责任站点',
      renderTitle: () => (
        <FilterableHeader
          title="当前责任站点"
          options={responsibilityOptions}
          selected={columnFilters.currentResponsibilityParty}
          onChange={(next) => onColumnFilterChange('currentResponsibilityParty', next)}
        />
      ),
      render: (row) => {
        const r = row as unknown as Row
        if (r.status === 'pending' || r.status === 'analyzing') {
          return <span className="text-slate-400">—</span>
        }
        return <span>{String(r.currentResponsibilityParty ?? '—')}</span>
      },
    },
    {
      key: 'confidence',
      title: '置信度',
      render: (row) => {
        const r = row as unknown as Row
        if (r.status === 'pending' || r.status === 'analyzing') {
          return <span className="text-slate-400">—</span>
        }
        if (r.status === 'error') {
          return <span className="text-slate-400">—</span>
        }
        return (
          <span className="inline-flex items-center gap-1">
            <span>{String(r.confidence ?? '')}</span>
            {r.needsReview && (
              <Tag color="warning" className="m-0 text-xs leading-tight">
                需复核
              </Tag>
            )}
            {r.crossCheckedBy && !r.needsReview && (
              <Tag color="processing" className="m-0 text-xs leading-tight">
                已交叉验证
              </Tag>
            )}
          </span>
        )
      },
    },
    {
      key: 'extraData',
      title: '额外数据',
      render: (row) => {
        const r = row as unknown as Row
        if (!r.extraData) return <span className="text-slate-400">—</span>
        return (
          <Tooltip title={r.extraData.summary} placement="topLeft">
            <div className={`${EXTRA_DATA_COLUMN_WIDTH_CLASS} truncate`}>{r.extraData.summary}</div>
          </Tooltip>
        )
      },
    },
    {
      key: 'reason',
      title: '判定依据',
      render: (row) => renderReasonCell(row as unknown as Row),
    },
  ]
}

const ANALYSIS_RESULTS_MAX_HEIGHT_PX = 600

export type OrderExceptionAnalysisResultsProps = {
  rows: Row[]
  filteredRows: Row[]
  totalDoneRowCount: number
  isAnalyzing: boolean
  isPaused?: boolean
  analyzeProgress: AnalyzeProgress | null
  postFilterDraft: PostFilterConfig
  onPostFilterDraftChange: (next: PostFilterConfig) => void
  appliedPostFilter: PostFilterConfig
  onRunPostFilter: () => void
  exportPermission: string
  emptyText?: string
  submittedJobBanner?: SubmittedJobBanner | null
  onDismissSubmittedJobBanner?: () => void
  onGoToJobsTab?: () => void
  showPushSection?: boolean
}

export function OrderExceptionAnalysisResults({
  rows,
  filteredRows,
  totalDoneRowCount,
  isAnalyzing,
  isPaused = false,
  analyzeProgress,
  postFilterDraft,
  onPostFilterDraftChange,
  appliedPostFilter,
  onRunPostFilter,
  exportPermission,
  emptyText = '暂无结果。',
  submittedJobBanner = null,
  onDismissSubmittedJobBanner,
  onGoToJobsTab,
  showPushSection = true,
}: OrderExceptionAnalysisResultsProps) {
  const [detailRow, setDetailRow] = useState<Row | null>(null)
  const [visitedOrders, setVisitedOrders] = useState<Set<string>>(() => new Set())
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({
    lossScope: [],
    categoryName: [],
    noOperationDays: [],
    consigneeRouteCode: [],
    currentResponsibilityParty: [],
    latestResponsibilityPerson: [],
    latestResponsibilityAction: [],
  })

  const onColumnFilterChange = useCallback((key: keyof ColumnFilters, next: string[]) => {
    setColumnFilters((prev) => ({ ...prev, [key]: next }))
  }, [])

  const doneRows = useMemo(() => filteredRows.filter((r) => r.status === 'done'), [filteredRows])

  const lossScopeOptions = useMemo(
    () => [...new Set(doneRows.map((r) => r.lossScope ?? '').filter(Boolean))].sort(),
    [doneRows],
  )
  const categoryNameOptions = useMemo(
    () => [...new Set(doneRows.map((r) => r.categoryName ?? '').filter(Boolean))].sort(),
    [doneRows],
  )
  const noOperationDaysOptions = useMemo(
    () =>
      [
        ...new Set(
          doneRows
            .map((r) => (r.latestResponsibility ? String(r.latestResponsibility.noOperationDays) : ''))
            .filter(Boolean),
        ),
      ].sort((a, b) => Number(a) - Number(b)),
    [doneRows],
  )
  const consigneeRouteCodeOptions = useMemo(
    () =>
      [...new Set(doneRows.map((r) => r.orderInfo?.consigneeRouteCode ?? '').filter((v) => v && v !== '—'))].sort(),
    [doneRows],
  )
  const responsibilityOptions = useMemo(
    () =>
      [...new Set(doneRows.map((r) => r.currentResponsibilityParty ?? '').filter((v) => v && v !== '—'))].sort(),
    [doneRows],
  )
  const latestResponsibilityPersonOptions = useMemo(
    () =>
      [...new Set(doneRows.map((r) => r.latestResponsibility?.person ?? '').filter((v) => v && v !== '—'))].sort(),
    [doneRows],
  )
  const latestResponsibilityActionOptions = useMemo(
    () =>
      [...new Set(doneRows.map((r) => r.latestResponsibility?.action ?? '').filter((v) => v && v !== '—'))].sort(),
    [doneRows],
  )

  const columnFilteredRows = useMemo(() => {
    const {
      lossScope,
      categoryName,
      noOperationDays,
      consigneeRouteCode,
      currentResponsibilityParty,
      latestResponsibilityPerson,
      latestResponsibilityAction,
    } = columnFilters
    const hasFilter =
      lossScope.length > 0 ||
      categoryName.length > 0 ||
      noOperationDays.length > 0 ||
      consigneeRouteCode.length > 0 ||
      currentResponsibilityParty.length > 0 ||
      latestResponsibilityPerson.length > 0 ||
      latestResponsibilityAction.length > 0
    if (!hasFilter) return filteredRows
    return filteredRows.filter((r) => {
      if (r.status !== 'done') return true
      if (lossScope.length > 0 && !lossScope.includes(r.lossScope ?? '')) return false
      if (categoryName.length > 0 && !categoryName.includes(r.categoryName ?? '')) return false
      if (noOperationDays.length > 0 && !noOperationDays.includes(noOperationDaysLabel(r))) return false
      if (consigneeRouteCode.length > 0 && !consigneeRouteCode.includes(routeCodeLabel(r))) return false
      if (currentResponsibilityParty.length > 0 && !currentResponsibilityParty.includes(r.currentResponsibilityParty ?? '')) return false
      if (latestResponsibilityPerson.length > 0 || latestResponsibilityAction.length > 0) {
        const person = r.latestResponsibility?.person ?? '—'
        const action = r.latestResponsibility?.action ?? '—'
        if (latestResponsibilityPerson.length > 0 && !latestResponsibilityPerson.includes(person)) return false
        if (latestResponsibilityAction.length > 0 && !latestResponsibilityAction.includes(action)) return false
      }
      return true
    })
  }, [filteredRows, columnFilters])

  const handleOpenOrderDetail = useCallback((row: Row) => {
    setVisitedOrders((prev) => {
      if (prev.has(row.orderNo)) return prev
      const next = new Set(prev)
      next.add(row.orderNo)
      return next
    })
    setDetailRow(row)
  }, [])

  const exportableRows = filteredRows.filter((r) => r.status === 'done')
  const columnFilteredDoneCount = columnFilteredRows.filter((r) => r.status === 'done').length
  const filteredDoneRowCount = columnFilteredDoneCount
  const isFiltered = totalDoneRowCount > 0 && filteredDoneRowCount !== totalDoneRowCount
  const showResultsSection = rows.length > 0 || isAnalyzing
  const columns = useMemo(
    () =>
      buildColumns(
        handleOpenOrderDetail,
        visitedOrders,
        columnFilters,
        onColumnFilterChange,
        lossScopeOptions,
        categoryNameOptions,
        noOperationDaysOptions,
        consigneeRouteCodeOptions,
        responsibilityOptions,
        latestResponsibilityPersonOptions,
        latestResponsibilityActionOptions,
      ),
    [
      handleOpenOrderDetail,
      visitedOrders,
      columnFilters,
      onColumnFilterChange,
      lossScopeOptions,
      categoryNameOptions,
      noOperationDaysOptions,
      consigneeRouteCodeOptions,
      responsibilityOptions,
      latestResponsibilityPersonOptions,
      latestResponsibilityActionOptions,
    ],
  )
  const tableRows: Record<string, unknown>[] = columnFilteredRows.map((r) => ({
    ...r,
    id: r.orderNo,
  })) as unknown as Record<string, unknown>[]

  const onExportResults = useCallback(() => {
    if (exportableRows.length === 0) return
    const data = exportableRows.map(toAnalysisExportRow)
    const ws = XLSX.utils.json_to_sheet(data)
    applySheetCenterAlignment(ws)
    ws['!cols'] = ANALYSIS_EXPORT_COLUMN_WIDTHS.map((wch) => ({ wch }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, ANALYSIS_EXPORT_SHEET_NAME)
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const stamp = new Date().toISOString().slice(0, 19).replace(/-/g, '').replace(/:/g, '').replace(/T/g, '')
    saveAs(blob, `异常订单分析结果-${stamp}.xlsx`)
  }, [exportableRows])

  if (!showResultsSection) return null

  return (
    <div className="space-y-5">
      <section className="admin-panel p-5 pr-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-950">分析结果</h3>
            {isFiltered && (
              <span className="text-xs text-slate-500" aria-live="polite">
                共 {totalDoneRowCount} 条，已过滤至 {filteredDoneRowCount} 条
              </span>
            )}
          </div>
          <ExportButton
            label="导出 Excel"
            permission={exportPermission}
            disabled={exportableRows.length === 0 || isAnalyzing}
            onClick={onExportResults}
            className="shrink-0"
          />
        </div>
        {submittedJobBanner && onDismissSubmittedJobBanner && onGoToJobsTab ? (
          <SubmittedBanner
            banner={submittedJobBanner}
            onDismiss={onDismissSubmittedJobBanner}
            onGoToJobs={onGoToJobsTab}
          />
        ) : null}
        {analyzeProgress ? (
          <div className="mt-4">
            <AnalyzeProgressStrip
              progress={analyzeProgress}
              isAnalyzing={isAnalyzing}
              incrementalResults
              isPaused={isPaused}
            />
          </div>
        ) : null}
        <div className="mt-4 flex items-stretch gap-0">
          <div className="min-w-0 flex-1 pr-[10px]">
            <DataTable
              columns={columns}
              rows={tableRows}
              emptyText={emptyText}
              boundedScroll
              boundedScrollMaxHeight={ANALYSIS_RESULTS_MAX_HEIGHT_PX}
            />
          </div>
          <PostFilterConfigSection
            draft={postFilterDraft}
            applied={appliedPostFilter}
            onChange={onPostFilterDraftChange}
            onApply={onRunPostFilter}
            maxHeight={ANALYSIS_RESULTS_MAX_HEIGHT_PX}
          />
        </div>
      </section>

      {showPushSection && exportableRows.length > 0 ? (
        <OrderExceptionPushSection
          doneRows={exportableRows.map((r) => ({
            lossScope: r.lossScope ?? '',
            categoryName: r.categoryName ?? '',
            currentResponsibilityParty: r.currentResponsibilityParty ?? '',
            confidence: r.confidence ?? '',
          }))}
          analysisDate={new Date().toISOString().slice(0, 10)}
        />
      ) : null}

      <OrderAnalysisDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} />
    </div>
  )
}
