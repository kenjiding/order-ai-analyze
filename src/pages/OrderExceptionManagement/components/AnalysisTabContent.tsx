import { Select, Tag, Tooltip } from 'antd'
import { saveAs } from 'file-saver'
import { CheckSquare, ChevronDown, Loader2, Play, Settings2, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx-js-style'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import { applySheetCenterAlignment } from '../../../utils/xlsxCenteredSheet'
import { DataTable, ExportButton, type DataTableColumn } from '../../ScannerEfficiency/components/ui'
import {
  type OrderAnalyzeAiProvider,
  type OrderAnalyzeApiTiming,
  type OrderAnalyzeTokenUsage,
} from '../orderExceptionApi'
import type { AnalysisRow, AnalyzeProgress, ImportedAnalyzeOrders, SubmittedJobBanner } from '../useOrderExceptionManagementPage'
import type { PostFilterConfig } from '../postFilter/types'
import { AnalyzeProgressStrip } from './AnalyzeProgressStrip'
import { OrderAnalysisDetailDrawer } from './OrderAnalysisDetailDrawer'
import { OrderExceptionPushSection } from './OrderExceptionPushSection'
import { PostFilterConfigSection } from './PostFilterConfigSection'

type Row = AnalysisRow

type ColumnFilters = {
  lossScope: string[]
  categoryName: string[]
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

function buildColumns(
  onOpenOrderDetail: (row: Row) => void,
  visitedOrders: Set<string>,
  columnFilters: ColumnFilters,
  onColumnFilterChange: (key: keyof ColumnFilters, next: string[]) => void,
  lossScopeOptions: string[],
  categoryNameOptions: string[],
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
      render: (row) => {
        const r = row as unknown as Row
        if (r.status === 'pending' || r.status === 'analyzing') {
          return <span className="text-slate-400">—</span>
        }
        return <span>{r.latestResponsibility ? r.latestResponsibility.noOperationDays : '—'}</span>
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
      key: 'consigneeRouteCode',
      title: '路由码',
      render: (row) => {
        const r = row as unknown as Row
        if (r.status === 'pending' || r.status === 'analyzing') {
          return <span className="text-slate-400">—</span>
        }
        return <span>{r.orderInfo?.consigneeRouteCode || '—'}</span>
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

const ANALYZE_MODEL_OPTIONS: { value: OrderAnalyzeAiProvider; label: string }[] = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openai', label: 'OpenAI' },
]

function formatTokenCount(n: number): string {
  return n.toLocaleString('zh-CN')
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} 毫秒`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`
  const totalSec = Math.round(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return sec > 0 ? `${min} 分 ${sec} 秒` : `${min} 分`
}

type Props = {
  analyzeOrderText: string
  onAnalyzeOrderTextChange: (value: string) => void
  analyzeAiProvider: OrderAnalyzeAiProvider
  onAnalyzeAiProviderChange: (value: OrderAnalyzeAiProvider) => void
  batchAnalyze: boolean
  onBatchAnalyzeChange: (value: boolean) => void
  onAnalyze: () => void
  onAnalyzeOrderFileUpload: (file: File) => Promise<void>
  onClearImportedAnalyzeOrders: () => void
  importedAnalyzeOrders: ImportedAnalyzeOrders | null
  isAnalyzing: boolean
  isPaused: boolean
  onPauseAnalyze: () => void
  onResumeAnalyze: () => void
  rows: Row[]
  filteredRows: Row[]
  totalDoneRowCount: number
  analyzeProgress: AnalyzeProgress | null
  submittedJobBanner: SubmittedJobBanner | null
  onDismissSubmittedJobBanner: () => void
  onGoToJobsTab: () => void
  tokenUsage: OrderAnalyzeTokenUsage | null
  analyzedOrderCount: number
  durationMs: number | null
  apiTiming: OrderAnalyzeApiTiming | null
  onOpenWarehouseConfig: () => void
  postFilterDraft: PostFilterConfig
  onPostFilterDraftChange: (next: PostFilterConfig) => void
  appliedPostFilter: PostFilterConfig
  onRunPostFilter: () => void
}

const CROSS_CHECKED_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
}

/**
 * 与 onExportResults 列顺序一致：订单号、异常类型、子类型、当前责任站点、路由码、置信度、额外数据、
 * 判定依据、是否需复核、交叉验证模型、最新责任人、最新责任时间、最新责任操作、无操作天数
 */
const ANALYZE_EXPORT_COLUMN_WIDTHS = [24, 14, 16, 28, 16, 10, 44, 80, 12, 16, 20, 20, 24, 14] as const

export function AnalysisTabContent({
  analyzeOrderText,
  onAnalyzeOrderTextChange,
  analyzeAiProvider,
  onAnalyzeAiProviderChange,
  batchAnalyze,
  onBatchAnalyzeChange,
  onAnalyze,
  onAnalyzeOrderFileUpload,
  onClearImportedAnalyzeOrders,
  importedAnalyzeOrders,
  isAnalyzing,
  isPaused,
  onPauseAnalyze,
  onResumeAnalyze,
  rows,
  filteredRows,
  totalDoneRowCount,
  analyzeProgress,
  submittedJobBanner,
  onDismissSubmittedJobBanner,
  onGoToJobsTab,
  tokenUsage,
  analyzedOrderCount,
  durationMs,
  apiTiming,
  onOpenWarehouseConfig,
  postFilterDraft,
  onPostFilterDraftChange,
  appliedPostFilter,
  onRunPostFilter,
}: Props) {
  const canAnalyze = usePermission(PERMISSION_KEYS.btnOrderExceptionAnalyze)
  const [detailRow, setDetailRow] = useState<Row | null>(null)
  const [visitedOrders, setVisitedOrders] = useState<Set<string>>(() => new Set())
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({
    lossScope: [],
    categoryName: [],
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
    const { lossScope, categoryName, currentResponsibilityParty, latestResponsibilityPerson, latestResponsibilityAction } =
      columnFilters
    const hasFilter =
      lossScope.length > 0 ||
      categoryName.length > 0 ||
      currentResponsibilityParty.length > 0 ||
      latestResponsibilityPerson.length > 0 ||
      latestResponsibilityAction.length > 0
    if (!hasFilter) return filteredRows
    return filteredRows.filter((r) => {
      if (r.status !== 'done') return true
      if (lossScope.length > 0 && !lossScope.includes(r.lossScope ?? '')) return false
      if (categoryName.length > 0 && !categoryName.includes(r.categoryName ?? '')) return false
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

  const onOrderFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      void onAnalyzeOrderFileUpload(file)
    },
    [onAnalyzeOrderFileUpload]
  )

  const handleOpenOrderDetail = useCallback((row: Row) => {
    setVisitedOrders((prev) => {
      if (prev.has(row.orderNo)) return prev
      const next = new Set(prev)
      next.add(row.orderNo)
      return next
    })
    setDetailRow(row)
  }, [])

  const avgTokensPerOrder =
    tokenUsage && analyzedOrderCount > 0 ? Math.round(tokenUsage.totalTokens / analyzedOrderCount) : null
  const avgDurationMsPerOrder =
    durationMs != null && analyzedOrderCount > 0 ? Math.round(durationMs / analyzedOrderCount) : null
  const avgImileMsPerOrder =
    apiTiming && analyzedOrderCount > 0 ? Math.round(apiTiming.imileMs / analyzedOrderCount) : null
  const avgAiMsPerOrder =
    apiTiming && analyzedOrderCount > 0 ? Math.round(apiTiming.aiMs / analyzedOrderCount) : null
  const showAnalyzeStats = Boolean(tokenUsage || durationMs != null || apiTiming != null)
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
    const data = exportableRows.map((r) => ({
      订单号: r.orderNo,
      异常类型: r.lossScope,
      子类型: r.categoryName,
      当前责任站点: r.currentResponsibilityParty,
      路由码: r.orderInfo?.consigneeRouteCode || '—',
      置信度: r.confidence,
      额外数据: r.extraData?.summary ?? '—',
      判定依据: r.reason,
      是否需复核: r.needsReview ? '是' : '否',
      交叉验证模型: r.crossCheckedBy ? (CROSS_CHECKED_LABEL[r.crossCheckedBy] ?? r.crossCheckedBy) : '—',
      最新责任人: r.latestResponsibility?.person ?? '—',
      最新责任时间: r.latestResponsibility?.displayTime ?? '—',
      最新责任操作: r.latestResponsibility?.action ?? '—',
      无操作天数: r.latestResponsibility ? r.latestResponsibility.noOperationDays : '—',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    applySheetCenterAlignment(ws)
    ws['!cols'] = ANALYZE_EXPORT_COLUMN_WIDTHS.map((wch) => ({ wch }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '分析结果')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const stamp = new Date().toISOString().slice(0, 19).replace(/-/g, '').replace(/:/g, '').replace(/T/g, '')
    saveAs(blob, `异常订单分析结果-${stamp}.xlsx`)
  }, [exportableRows])

  return (
    <div className="space-y-5">
      <section className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-950">
            待分析订单
            {/* <span className="ml-3 mt-1 text-xs text-red-500">
                (一次最多 {ORDER_EXCEPTION_ANALYZE_MAX_BATCH} 个订单，超出请删减或分批操作)
            </span> */}
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
              <span className="shrink-0">分析模型</span>
              <Select<OrderAnalyzeAiProvider>
                className="min-w-[140px]"
                value={analyzeAiProvider}
                options={ANALYZE_MODEL_OPTIONS}
                disabled={isAnalyzing}
                onChange={(v) => onAnalyzeAiProviderChange(v)}
                aria-label="选择分析模型"
              />
            </label>
            <label
              title="支持 xlsx / xls / csv / txt；表格需含「订单号」列，或首列为订单号。"
              className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-[#2f8f87]/40 hover:bg-[#2f8f87]/5 hover:text-[#1f6f68] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
            >
              <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden />
              导入文件
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain"
                disabled={isAnalyzing}
                onChange={onOrderFileChange}
                className="hidden"
              />
            </label>
            <label
              htmlFor="order-exception-batch-analyze"
              className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2 text-left"
            >
              <input
                type="checkbox"
                id="order-exception-batch-analyze"
                checked={batchAnalyze}
                disabled={isAnalyzing}
                onChange={(e) => onBatchAnalyzeChange(e.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-slate-300 text-[#2f8f87] accent-[#2f8f87] focus:ring-2 focus:ring-[#2f8f87]/25 focus:ring-offset-0 disabled:cursor-not-allowed"
              />
              <span className="text-xs font-medium leading-none text-slate-800">批量分析</span>
            </label>
            <button
              type="button"
              disabled={isAnalyzing}
              onClick={onOpenWarehouseConfig}
              className="admin-btn border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Settings2 className="h-4 w-4" />
              分析配置
            </button>
            <Tooltip title={!canAnalyze ? '无操作权限' : undefined}>
              <button
                type="button"
                disabled={!canAnalyze || (isAnalyzing && batchAnalyze)}
                onClick={() => {
                  if (!isAnalyzing) {
                    void onAnalyze()
                  } else if (isPaused) {
                    onResumeAnalyze()
                  } else {
                    onPauseAnalyze()
                  }
                }}
                className={[
                  'admin-btn inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50',
                  isAnalyzing && !batchAnalyze && !isPaused
                    ? 'border-amber-500 bg-amber-500 text-white hover:border-amber-600 hover:bg-amber-600'
                    : 'admin-btn-primary',
                ].join(' ')}
              >
                {isAnalyzing && isPaused ? <Play className="h-4 w-4" aria-hidden /> : null}
                {isAnalyzing && !isPaused ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {!isAnalyzing ? '开始分析' : batchAnalyze ? '开始分析' : isPaused ? '继续分析' : '暂停分析'}
              </button>
            </Tooltip>
          </div>
        </div>
        {importedAnalyzeOrders ? (
          <div className="mt-3 flex items-center justify-end gap-2 text-xs text-slate-600" aria-live="polite">
            <span>
              已导入{' '}
              <span className="font-semibold text-slate-900">
                {importedAnalyzeOrders.orderNos.length.toLocaleString('zh-CN')}
              </span>{' '}
              个订单
            </span>
            <button
              type="button"
              disabled={isAnalyzing}
              onClick={onClearImportedAnalyzeOrders}
              className="text-[#1f6f68] underline decoration-dashed underline-offset-2 hover:text-[#2f8f87] disabled:cursor-not-allowed disabled:opacity-50"
            >
              清除
            </button>
          </div>
        ) : null}
        <label className={`block text-xs font-medium text-slate-600 ${importedAnalyzeOrders ? 'mt-3' : 'mt-4'}`}>
          <textarea
            value={analyzeOrderText}
            onChange={(e) => onAnalyzeOrderTextChange(e.target.value)}
            rows={8}
            placeholder="每行一个或使用逗号分隔"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-[#2f8f87] focus:outline-none focus:ring-2 focus:ring-[#2f8f87]/25"
          />
        </label>
        {showAnalyzeStats ? (
          <div className="mt-4">
            <p className="text-xs text-slate-600" aria-live="polite">
              {durationMs != null ? (
                <>
                  总耗时：
                  <span className="font-semibold text-slate-900">{formatDuration(durationMs)}</span>
                  {avgDurationMsPerOrder != null ? (
                    <>
                      {' '}
                      （平均每单 {formatDuration(avgDurationMsPerOrder)}）
                    </>
                  ) : null}
                </>
              ) : null}
              {apiTiming ? (
                <>
                  {durationMs != null ? ' · ' : null}
                  iMile 接口：
                  <span className="font-semibold text-slate-900">{formatDuration(apiTiming.imileMs)}</span>
                  {avgImileMsPerOrder != null ? (
                    <>
                      {' '}
                      （平均每单 {formatDuration(avgImileMsPerOrder)}）
                    </>
                  ) : null}
                  {' · '}
                  AI 接口：
                  <span className="font-semibold text-slate-900">{formatDuration(apiTiming.aiMs)}</span>
                  {avgAiMsPerOrder != null ? (
                    <>
                      {' '}
                      （平均每单 {formatDuration(avgAiMsPerOrder)}）
                    </>
                  ) : null}
                </>
              ) : null}
              {tokenUsage ? (
                <>
                  {durationMs != null || apiTiming != null ? ' · ' : null}
                  Token 消耗：
                  <span className="font-semibold text-slate-900">{formatTokenCount(tokenUsage.totalTokens)}</span>{' '}
                  （输入 {formatTokenCount(tokenUsage.promptTokens)} / 输出{' '}
                  {formatTokenCount(tokenUsage.completionTokens)}）
                  {tokenUsage.apiCalls > 0 ? (
                    <>
                      {' '}
                      · API {formatTokenCount(tokenUsage.apiCalls)} 次
                    </>
                  ) : null}
                  {avgTokensPerOrder != null ? (
                    <>
                      {' '}
                      · 平均每单 {formatTokenCount(avgTokensPerOrder)} Token
                    </>
                  ) : null}
                </>
              ) : null}
            </p>
          </div>
        ) : null}
      </section>

      {showResultsSection ? (
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
              permission={PERMISSION_KEYS.btnOrderExceptionAnalyze}
              disabled={exportableRows.length === 0 || isAnalyzing || !canAnalyze}
              onClick={onExportResults}
              className="shrink-0"
            />
          </div>
          {submittedJobBanner ? (
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
                incrementalResults={!batchAnalyze}
                isPaused={isPaused}
              />
            </div>
          ) : null}
          <div className="mt-4 flex items-stretch gap-0">
            <div className="min-w-0 flex-1 pr-[10px]">
              <DataTable
                columns={columns}
                rows={tableRows}
                emptyText="暂无结果，填写订单号并点击开始分析。"
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
      ) : null}

      {exportableRows.length > 0 && (
        <OrderExceptionPushSection
          doneRows={exportableRows.map((r) => ({
            lossScope: r.lossScope ?? '',
            categoryName: r.categoryName ?? '',
            currentResponsibilityParty: r.currentResponsibilityParty ?? '',
            confidence: r.confidence ?? '',
          }))}
          analysisDate={new Date().toISOString().slice(0, 10)}
        />
      )}

      <OrderAnalysisDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} />
    </div>
  )
}
