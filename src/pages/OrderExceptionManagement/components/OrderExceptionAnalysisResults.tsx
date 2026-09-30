import { Tag, Tooltip } from 'antd'
import { saveAs } from 'file-saver'
import { CheckSquare, ChevronDown, Loader2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import * as XLSX from 'xlsx-js-style'
import { applySheetCenterAlignment } from '../../../utils/xlsxCenteredSheet'
import { DataTable, ExportButton, type DataTableColumn } from '../../ScannerEfficiency/components/ui'
import { networkDurationLabel, type AnalysisRow, type AnalyzeProgress, type SubmittedJobBanner } from '../analysisTypes'
import { trackOrderExceptionUsage } from '../orderExceptionApi'
import type { PostFilterConfig } from '../postFilter/types'
import { AnalyzeProgressStrip } from './AnalyzeProgressStrip'
import { OrderAnalysisDetailDrawer } from './OrderAnalysisDetailDrawer'
import { OrderExceptionPushSection } from './OrderExceptionPushSection'
import { PostFilterConfigSection } from './PostFilterConfigSection'
import {
  ANALYSIS_EXPORT_COLUMN_WIDTHS,
  getAnalysisExportLabels,
  getAnalysisExportSheetName,
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
  selectAllLabel,
  clearLabel,
  emptyLabel,
  emptyValueLabel,
}: {
  title: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  selectAllLabel: string
  clearLabel: string
  emptyLabel: string
  emptyValueLabel: string
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
                {selectAllLabel}
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className={[
                  'text-[11px] transition-colors',
                  isActive ? 'text-[#1f6f68] hover:text-[#2f8f87]' : 'text-slate-400',
                ].join(' ')}
              >
                {clearLabel}
              </button>
            </div>
            <div className="max-h-52 overflow-y-auto py-1">
              {options.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-slate-400">{emptyLabel}</p>
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
                    <span className="truncate">{opt || emptyValueLabel}</span>
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

function renderReasonCell(r: Row, t: TFunction): ReactNode {
  const reason = String(r.reason ?? '')
  if (r.status === 'pending') {
    return <span className="text-slate-400">{t('results.pendingAnalyze')}</span>
  }
  if (r.status === 'analyzing') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[#1f6f68]">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        {reason || t('results.analyzing')}
      </span>
    )
  }
  if (r.status === 'error') {
    return <span className="text-red-600">{reason}</span>
  }
  const factPrefix = '[事实校验纠正]'
  const cancelPrefix = '[取消扫描核验纠正]'
  if (reason.startsWith(factPrefix)) {
    return (
      <span>
        <span className="font-semibold text-amber-600">{t('results.factCheckPrefix')}</span>
        <span className="text-slate-700">{reason.slice(factPrefix.length)}</span>
      </span>
    )
  }
  if (reason.startsWith(cancelPrefix)) {
    return (
      <span>
        <span className="font-semibold text-amber-600">{t('results.cancelScanPrefix')}</span>
        <span className="text-slate-700">{reason.slice(cancelPrefix.length)}</span>
      </span>
    )
  }
  return <span className="text-slate-700">{reason}</span>
}

function SubmittedBanner({
  banner,
  onDismiss,
  onGoToJobs,
  t,
}: {
  banner: SubmittedJobBanner
  onDismiss: () => void
  onGoToJobs: () => void
  t: TFunction
}) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
      <CheckSquare className="h-4 w-4 shrink-0 text-blue-500" aria-hidden />
      <p className="min-w-0 flex-1 text-xs text-slate-700">
        {t('results.batchJobBanner', { count: banner.orderCount })}
      </p>
      <button
        type="button"
        onClick={onGoToJobs}
        className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
      >
        {t('results.viewJobQueue')}
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
  t: TFunction,
  filterLabels: {
    selectAll: string
    clear: string
    empty: string
    emptyValue: string
  },
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
      title: t('results.colOrderNo'),
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
            aria-label={t('results.viewOrderDetailAria', { orderNo: r.orderNo })}
          >
            {r.orderNo}
          </button>
        )
      },
    },
    {
      key: 'lossScope',
      title: t('results.colExceptionType'),
      renderTitle: () => (
        <FilterableHeader
          title={t('results.colExceptionType')}
          options={lossScopeOptions}
          selected={columnFilters.lossScope}
          onChange={(next) => onColumnFilterChange('lossScope', next)}
          selectAllLabel={filterLabels.selectAll}
          clearLabel={filterLabels.clear}
          emptyLabel={filterLabels.empty}
          emptyValueLabel={filterLabels.emptyValue}
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
      title: t('results.colSubType'),
      renderTitle: () => (
        <FilterableHeader
          title={t('results.colSubType')}
          options={categoryNameOptions}
          selected={columnFilters.categoryName}
          onChange={(next) => onColumnFilterChange('categoryName', next)}
          selectAllLabel={filterLabels.selectAll}
          clearLabel={filterLabels.clear}
          emptyLabel={filterLabels.empty}
          emptyValueLabel={filterLabels.emptyValue}
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
      key: 'networkDuration',
      title: t('results.colNetworkDuration'),
      render: (row) => {
        const r = row as unknown as Row
        if (r.status === 'pending' || r.status === 'analyzing') {
          return <span className="text-slate-400">—</span>
        }
        return <span>{networkDurationLabel(r)}</span>
      },
    },
    {
      key: 'noOperationDays',
      title: t('results.colNoOperationDays'),
      renderTitle: () => (
        <FilterableHeader
          title={t('results.colNoOperationDays')}
          options={noOperationDaysOptions}
          selected={columnFilters.noOperationDays}
          onChange={(next) => onColumnFilterChange('noOperationDays', next)}
          selectAllLabel={filterLabels.selectAll}
          clearLabel={filterLabels.clear}
          emptyLabel={filterLabels.empty}
          emptyValueLabel={filterLabels.emptyValue}
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
      title: t('results.colRouteCode'),
      renderTitle: () => (
        <FilterableHeader
          title={t('results.colRouteCode')}
          options={consigneeRouteCodeOptions}
          selected={columnFilters.consigneeRouteCode}
          onChange={(next) => onColumnFilterChange('consigneeRouteCode', next)}
          selectAllLabel={filterLabels.selectAll}
          clearLabel={filterLabels.clear}
          emptyLabel={filterLabels.empty}
          emptyValueLabel={filterLabels.emptyValue}
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
      title: t('results.colLatestPerson'),
      renderTitle: () => (
        <FilterableHeader
          title={t('results.colLatestPerson')}
          options={latestResponsibilityPersonOptions}
          selected={columnFilters.latestResponsibilityPerson}
          onChange={(next) => onColumnFilterChange('latestResponsibilityPerson', next)}
          selectAllLabel={filterLabels.selectAll}
          clearLabel={filterLabels.clear}
          emptyLabel={filterLabels.empty}
          emptyValueLabel={filterLabels.emptyValue}
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
      title: t('results.colLatestAction'),
      renderTitle: () => (
        <FilterableHeader
          title={t('results.colLatestAction')}
          options={latestResponsibilityActionOptions}
          selected={columnFilters.latestResponsibilityAction}
          onChange={(next) => onColumnFilterChange('latestResponsibilityAction', next)}
          selectAllLabel={filterLabels.selectAll}
          clearLabel={filterLabels.clear}
          emptyLabel={filterLabels.empty}
          emptyValueLabel={filterLabels.emptyValue}
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
      title: t('results.colLatestTime'),
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
      title: t('results.colCurrentHub'),
      renderTitle: () => (
        <FilterableHeader
          title={t('results.colCurrentHub')}
          options={responsibilityOptions}
          selected={columnFilters.currentResponsibilityParty}
          onChange={(next) => onColumnFilterChange('currentResponsibilityParty', next)}
          selectAllLabel={filterLabels.selectAll}
          clearLabel={filterLabels.clear}
          emptyLabel={filterLabels.empty}
          emptyValueLabel={filterLabels.emptyValue}
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
      title: t('results.colConfidence'),
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
                {t('results.needsReview')}
              </Tag>
            )}
            {r.crossCheckedBy && !r.needsReview && (
              <Tag color="processing" className="m-0 text-xs leading-tight">
                {t('results.crossChecked')}
              </Tag>
            )}
          </span>
        )
      },
    },
    {
      key: 'extraData',
      title: t('results.colExtraData'),
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
      title: t('results.colReason'),
      render: (row) => renderReasonCell(row as unknown as Row, t),
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
  emptyText,
  submittedJobBanner = null,
  onDismissSubmittedJobBanner,
  onGoToJobsTab,
  showPushSection = true,
}: OrderExceptionAnalysisResultsProps) {
  const { t } = useTranslation('orderException')
  const filterLabels = useMemo(
    () => ({
      selectAll: t('results.selectAll'),
      clear: t('results.clearFilter'),
      empty: t('results.emptyFilterOptions'),
      emptyValue: t('results.emptyValue'),
    }),
    [t],
  )
  const resolvedEmptyText = emptyText ?? t('results.emptyDefault')
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
    trackOrderExceptionUsage('orderClick')
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
        t,
        filterLabels,
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
      t,
      filterLabels,
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
    const labels = getAnalysisExportLabels(t)
    const data = exportableRows.map((row) => toAnalysisExportRow(row, labels, t))
    const ws = XLSX.utils.json_to_sheet(data)
    applySheetCenterAlignment(ws)
    ws['!cols'] = ANALYSIS_EXPORT_COLUMN_WIDTHS.map((wch) => ({ wch }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, getAnalysisExportSheetName(t))
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const stamp = new Date().toISOString().slice(0, 19).replace(/-/g, '').replace(/:/g, '').replace(/T/g, '')
    saveAs(blob, `${t('results.exportFileNamePrefix')}${stamp}.xlsx`)
    trackOrderExceptionUsage('exportExcel')
  }, [exportableRows, t])

  if (!showResultsSection) return null

  return (
    <div className="space-y-5">
      <section className="admin-panel p-5 pr-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-950">{t('results.title')}</h3>
            {isFiltered && (
              <span className="text-xs text-slate-500" aria-live="polite">
                {t('results.filteredCount', {
                  total: totalDoneRowCount,
                  filtered: filteredDoneRowCount,
                })}
              </span>
            )}
          </div>
          <ExportButton
            label={t('results.exportExcel')}
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
            t={t}
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
              emptyText={resolvedEmptyText}
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
