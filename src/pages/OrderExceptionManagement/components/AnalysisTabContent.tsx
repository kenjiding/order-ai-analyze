import { Button, Drawer, Form, Input, Select, Tag, Timeline } from 'antd'
import { saveAs } from 'file-saver'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as XLSX from 'xlsx-js-style'
import { useAppSettings } from '../../../context/AppSettingsContext'
import { showToast } from '../../../utils/toast'
import { applySheetCenterAlignment } from '../../../utils/xlsxCenteredSheet'
import { DataTable, ExportButton, type DataTableColumn } from '../../ScannerEfficiency/components/ui'
import {
  getClosureVendors,
  postClosureDriverVendor,
  type ClosureExceptionTypeOption,
  type ClosureVendorOption,
  type OrderAnalyzeAiProvider,
  type OrderAnalyzeApiTiming,
  type OrderAnalyzeInterceptLog,
  type OrderAnalyzeTokenUsage,
} from '../orderExceptionApi'
import type { TrackEvent } from '../types'
import type { AnalysisRow, AnalyzeProgress } from '../useOrderExceptionManagementPage'
import { AnalyzeProgressStrip } from './AnalyzeProgressStrip'

type Row = AnalysisRow

type ClosureExceptionTypeKey = ClosureExceptionTypeOption['key']

const CLOSURE_EXCEPTION_TYPE_OPTIONS: ClosureExceptionTypeOption[] = [
  { key: 'aus_Packet_loss_in_the_station', value: '库内丢包', label: null },
  { key: 'aus_packet_loss_out_the_station', value: '库外丢包', label: null },
  { key: 'aus_Theft_and_robbery', value: '盗抢', label: null },
  { key: 'aus_Damaged_before_entering_the_station', value: '入站前破损', label: null },
  { key: 'aus_Empty_package_before_entering_the_station', value: '入站前空包', label: null },
  { key: 'aus_3PL_lost_items', value: '3PL丢件', label: null },
]

const CLOSURE_TYPE_VALUE_BY_KEY = new Map(CLOSURE_EXCEPTION_TYPE_OPTIONS.map((x) => [x.key, x.value]))

const STAGE_DOT_COLOR: Record<string, string> = {
  订单提交: 'blue',
  已揽件: 'cyan',
  转运: 'purple',
  派送: 'green',
}

const TRACK_TYPE_TAG: Record<string, { color: string; label: string }> = {
  Schedule: { color: 'processing', label: '预约派送' },
  Problem: { color: 'error', label: '问题件' },
  Delivery: { color: 'success', label: '派送中' },
}

type ClosureVendorMemoryCache = {
  vendors: ClosureVendorOption[]
  defaultStationCode: string
}

let closureVendorMemoryCache: ClosureVendorMemoryCache | null = null

const TRACK_DRIVER_ID_RE = /\bID\s*[:：]\s*(D[0-9A-Za-z-]+)/gi

function sortTrackEventsDesc(events: TrackEvent[]): TrackEvent[] {
  return [...events].sort((a, b) => b.time.localeCompare(a.time))
}

function sortInterceptLogsDesc(logs: OrderAnalyzeInterceptLog[]): OrderAnalyzeInterceptLog[] {
  return [...logs].sort((a, b) => (b.gmtScan || b.gmtIntercept).localeCompare(a.gmtScan || a.gmtIntercept))
}

function isOutResponsibility(row: Row): boolean {
  if (row.activeResponsibilityOwner === 'external_carrier') return true
  if (row.lossScope === '库外丢失') return true
  return row.latestResponsibilityTrackMarker?.owner === 'out_warehouse'
}

function readLatestProblemTrack(events: TrackEvent[]): TrackEvent | null {
  const sorted = sortTrackEventsDesc(events)
  for (const event of sorted) {
    const trackType = String(event.trackType ?? '').trim().toLowerCase()
    if (trackType === 'problem' || event.content.includes('登记问题件')) return event
  }
  return null
}

function hitTheftSignal(events: TrackEvent[]): boolean {
  const latestProblemTrack = readLatestProblemTrack(events)
  if (!latestProblemTrack) return false
  return latestProblemTrack.content.includes('盗抢')
}

function inferClosureExceptionTypeKey(row: Row): ClosureExceptionTypeKey | null {
  if (row.lossScope === '3PL丢件') {
    return 'aus_3PL_lost_items'
  }
  if (isOutResponsibility(row) && hitTheftSignal(row.trackEvents)) {
    return 'aus_Theft_and_robbery'
  }
  if (row.lossScope === '库内丢失') return 'aus_Packet_loss_in_the_station'
  if (row.lossScope === '库外丢失') return 'aus_packet_loss_out_the_station'
  return null
}

function renderTrackContentWithDriverIdClickable(
  content: string,
  onPickDriverId: (driverId: string) => void
): ReactNode {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let matched = false

  for (const match of content.matchAll(TRACK_DRIVER_ID_RE)) {
    const index = match.index ?? 0
    const fullText = match[0]
    const driverId = match[1]?.trim() ?? ''
    if (!driverId) continue
    matched = true

    if (index > lastIndex) {
      nodes.push(content.slice(lastIndex, index))
    }

    nodes.push(
      <button
        key={`${index}-${driverId}`}
        type="button"
        onClick={() => onPickDriverId(driverId)}
        className="mx-0.5 inline-flex items-center rounded px-1 py-0.5 font-mono text-[12px] font-semibold text-[#1f6f68] underline decoration-dotted underline-offset-2 hover:bg-emerald-50 hover:text-[#2f8f87] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f8f87]/30"
        title={`点击回填派送员 ID：${driverId}`}
      >
        {fullText}
      </button>
    )

    lastIndex = index + fullText.length
  }

  if (!matched) return content
  if (lastIndex < content.length) nodes.push(content.slice(lastIndex))
  return nodes
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
        分析中…
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
  return <span className="text-slate-700">{reason}</span>
}

function buildColumns(onOpenOrderDetail: (row: Row) => void, visitedOrders: Set<string>): DataTableColumn[] {
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
      render: (row) => {
        const r = row as unknown as Row
        if (r.status === 'pending' || r.status === 'analyzing') {
          return <span className="text-slate-400">—</span>
        }
        return <span>{String(r.categoryName ?? '')}</span>
      },
    },
    {
      key: 'currentResponsibilityParty',
      title: '当前责任方',
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
      key: 'reason',
      title: '判定依据',
      render: (row) => renderReasonCell(row as unknown as Row),
    },
  ]
}

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
  isAnalyzing: boolean
  rows: Row[]
  analyzeProgress: AnalyzeProgress | null
  tokenUsage: OrderAnalyzeTokenUsage | null
  analyzedOrderCount: number
  durationMs: number | null
  apiTiming: OrderAnalyzeApiTiming | null
}

const CROSS_CHECKED_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
}

/** 与 onExportResults 列顺序一致：订单号、异常类型、子类型、当前责任方、置信度、判定依据、是否需复核、交叉验证模型 */
const ANALYZE_EXPORT_COLUMN_WIDTHS = [24, 14, 16, 28, 10, 80, 12, 16] as const

export function AnalysisTabContent({
  analyzeOrderText,
  onAnalyzeOrderTextChange,
  analyzeAiProvider,
  onAnalyzeAiProviderChange,
  batchAnalyze,
  onBatchAnalyzeChange,
  onAnalyze,
  isAnalyzing,
  rows,
  analyzeProgress,
  tokenUsage,
  analyzedOrderCount,
  durationMs,
  apiTiming,
}: Props) {
  const { imileToken } = useAppSettings()
  const [detailRow, setDetailRow] = useState<Row | null>(null)
  const [visitedOrders, setVisitedOrders] = useState<Set<string>>(() => new Set())

  const [closureTypeKey, setClosureTypeKey] = useState<ClosureExceptionTypeKey | ''>('')
  const [closureRemark, setClosureRemark] = useState('')
  const [stationCode, setStationCode] = useState('')
  const [vendorOptions, setVendorOptions] = useState<ClosureVendorOption[]>([])
  const [selectedVendorKey, setSelectedVendorKey] = useState('')
  const [detectedDriverId, setDetectedDriverId] = useState('')
  const [pendingAutoResolveDriverId, setPendingAutoResolveDriverId] = useState('')
  const [vendorAutoFillTip, setVendorAutoFillTip] = useState('')
  const [submitPreview, setSubmitPreview] = useState('')
  const [isLoadingVendors, setIsLoadingVendors] = useState(false)
  const [isResolvingVendor, setIsResolvingVendor] = useState(false)

  const handleOpenOrderDetail = useCallback((row: Row) => {
    setVisitedOrders((prev) => {
      if (prev.has(row.orderNo)) return prev
      const next = new Set(prev)
      next.add(row.orderNo)
      return next
    })
    setDetailRow(row)
  }, [])

  useEffect(() => {
    if (!detailRow) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [detailRow])

  useEffect(() => {
    if (!detailRow) {
      setClosureTypeKey('')
      setClosureRemark('')
      setStationCode('')
      setVendorOptions([])
      setSelectedVendorKey('')
      setDetectedDriverId('')
      setPendingAutoResolveDriverId('')
      setVendorAutoFillTip('')
      setSubmitPreview('')
      return
    }

    const inferred = inferClosureExceptionTypeKey(detailRow)
    setClosureTypeKey(inferred ?? '')
    setClosureRemark(detailRow.reason || '')
    setSelectedVendorKey('')
    setSubmitPreview('')
    setVendorAutoFillTip('')
    setDetectedDriverId(detailRow.detectedDriverId ?? '')
    setPendingAutoResolveDriverId(detailRow.detectedDriverId ?? '')
  }, [detailRow])

  const loadClosureVendors = useCallback(async () => {
    const token = imileToken.trim()
    if (!detailRow || !token) return

    if (closureVendorMemoryCache) {
      setVendorOptions(closureVendorMemoryCache.vendors)
      if (!stationCode.trim()) setStationCode(closureVendorMemoryCache.defaultStationCode || '')
      return
    }

    setIsLoadingVendors(true)
    try {
      const { vendors, defaultStationCode } = await getClosureVendors({ imileToken: token })
      closureVendorMemoryCache = { vendors, defaultStationCode }
      setVendorOptions(vendors)
      if (!stationCode.trim()) setStationCode(defaultStationCode || '')
    } catch (e) {
      showToast((e as Error).message || '供应商列表加载失败', 'error')
    } finally {
      setIsLoadingVendors(false)
    }
  }, [detailRow, imileToken, stationCode])

  useEffect(() => {
    if (!detailRow) return
    void loadClosureVendors()
  }, [detailRow, loadClosureVendors])

  const resolveVendorByDriver = useCallback(
    async (driverId: string, nextStationCode: string) => {
      const token = imileToken.trim()
      if (!token || !driverId || !nextStationCode) return
      setIsResolvingVendor(true)
      try {
        const { result } = await postClosureDriverVendor({
          imileToken: token,
          driverId,
          stationCode: nextStationCode,
        })
        if (!result) {
          setVendorAutoFillTip('未查询到司机供应商，请手动选择。')
          return
        }

        setVendorAutoFillTip('')
        setVendorOptions((prev) => {
          const exists = prev.some((x) => x.key === result.vendorCode)
          if (exists) return prev
          const next = [...prev, { key: result.vendorCode, value: result.vendorName, label: null }]
          if (closureVendorMemoryCache) {
            closureVendorMemoryCache = {
              ...closureVendorMemoryCache,
              vendors: next,
            }
          }
          return next
        })
        setSelectedVendorKey(result.vendorCode)
        setVendorAutoFillTip(`已自动回填供应商：${result.vendorName}（${result.vendorCode}）`)
      } catch (e) {
        setVendorAutoFillTip('供应商自动识别失败，请手动选择。')
        showToast((e as Error).message || '司机供应商识别失败', 'error')
      } finally {
        setIsResolvingVendor(false)
      }
    },
    [imileToken]
  )

  const handleTrackDriverIdPick = useCallback(
    (driverId: string) => {
      setDetectedDriverId(driverId)
      setSelectedVendorKey('')
      setVendorAutoFillTip('')
      const nextStationCode = stationCode.trim()
      if (nextStationCode) {
        setPendingAutoResolveDriverId('')
        void resolveVendorByDriver(driverId, nextStationCode)
        return
      }
      setPendingAutoResolveDriverId(driverId)
    },
    [resolveVendorByDriver, stationCode]
  )

  useEffect(() => {
    if (!detailRow) return
    if (!isOutResponsibility(detailRow)) return
    const driverId = pendingAutoResolveDriverId.trim()
    if (!driverId || !stationCode.trim()) return
    void resolveVendorByDriver(driverId, stationCode.trim())
    setPendingAutoResolveDriverId('')
  }, [detailRow, pendingAutoResolveDriverId, stationCode, resolveVendorByDriver])

  const sortedTrackEvents = useMemo(
    () => (detailRow ? sortTrackEventsDesc(detailRow.trackEvents) : []),
    [detailRow]
  )
  const sortedInterceptLogs = useMemo(
    () => (detailRow ? sortInterceptLogsDesc(detailRow.interceptLogs) : []),
    [detailRow]
  )
  const latestResponsibilityMarker = detailRow?.latestResponsibilityTrackMarker ?? null
  const hasInterceptLogs = sortedInterceptLogs.length > 0

  const vendorSelectOptions = useMemo(
    () =>
      vendorOptions.map((x) => ({
        value: x.key,
        label: `${x.value} (${x.key})`,
      })),
    [vendorOptions]
  )

  const outResponsibility = detailRow ? isOutResponsibility(detailRow) : false

  const avgTokensPerOrder =
    tokenUsage && analyzedOrderCount > 0 ? Math.round(tokenUsage.totalTokens / analyzedOrderCount) : null
  const avgDurationMsPerOrder =
    durationMs != null && analyzedOrderCount > 0 ? Math.round(durationMs / analyzedOrderCount) : null
  const avgImileMsPerOrder =
    apiTiming && analyzedOrderCount > 0 ? Math.round(apiTiming.imileMs / analyzedOrderCount) : null
  const avgAiMsPerOrder =
    apiTiming && analyzedOrderCount > 0 ? Math.round(apiTiming.aiMs / analyzedOrderCount) : null
  const showAnalyzeStats = Boolean(tokenUsage || durationMs != null || apiTiming != null)
  const exportableRows = rows.filter((r) => r.status === 'done')
  const showResultsSection = rows.length > 0 || isAnalyzing
  const columns = useMemo(() => buildColumns(handleOpenOrderDetail, visitedOrders), [handleOpenOrderDetail, visitedOrders])
  const tableRows: Record<string, unknown>[] = rows.map((r) => ({
    ...r,
    id: r.orderNo,
  })) as unknown as Record<string, unknown>[]

  const onExportResults = useCallback(() => {
    if (exportableRows.length === 0) return
    const data = exportableRows.map((r) => ({
      订单号: r.orderNo,
      异常类型: r.lossScope,
      子类型: r.categoryName,
      当前责任方: r.currentResponsibilityParty,
      置信度: r.confidence,
      判定依据: r.reason,
      是否需复核: r.needsReview ? '是' : '否',
      交叉验证模型: r.crossCheckedBy ? (CROSS_CHECKED_LABEL[r.crossCheckedBy] ?? r.crossCheckedBy) : '—',
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

  const handlePreviewSubmit = useCallback(() => {
    if (!detailRow) return

    const selectedTypeKey = closureTypeKey.trim() as ClosureExceptionTypeKey | ''
    if (!selectedTypeKey) {
      showToast('请先选择异常类型', 'error')
      return
    }

    if (outResponsibility && !selectedVendorKey.trim()) {
      showToast('当前为库外责任，请选择派件员供应商', 'error')
      return
    }

    const vendor = vendorOptions.find((x) => x.key === selectedVendorKey)
    const payload = {
      orderNo: detailRow.orderNo,
      exceptionType: {
        key: selectedTypeKey,
        value: CLOSURE_TYPE_VALUE_BY_KEY.get(selectedTypeKey) ?? '',
      },
      remark: closureRemark.trim(),
      deliverySupplier: vendor
        ? {
            vendorCode: vendor.key,
            vendorName: vendor.value,
          }
        : null,
      stationCode: stationCode.trim() || null,
      driverId: detectedDriverId || null,
      aiResult: {
        lossScope: detailRow.lossScope,
        subType: detailRow.categoryName,
        responsibilityParty: detailRow.currentResponsibilityParty,
        reason: detailRow.reason,
        confidence: detailRow.confidence,
      },
    }

    setSubmitPreview(JSON.stringify(payload, null, 2))
    showToast('已生成提交预览（未实际调用闭环接口）', 'success')
  }, [
    closureRemark,
    closureTypeKey,
    detectedDriverId,
    detailRow,
    outResponsibility,
    selectedVendorKey,
    stationCode,
    vendorOptions,
  ])

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
              onClick={onAnalyze}
              className="admin-btn admin-btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              开始分析
            </button>
          </div>
        </div>
        <label className="mt-4 block text-xs font-medium text-slate-600">
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
        <section className="admin-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-950">分析结果</h3>
            <ExportButton
              label="导出 Excel"
              disabled={exportableRows.length === 0 || isAnalyzing}
              onClick={onExportResults}
              className="shrink-0"
            />
          </div>
          {analyzeProgress ? (
            <div className="mt-4">
              <AnalyzeProgressStrip
                progress={analyzeProgress}
                isAnalyzing={isAnalyzing}
                incrementalResults={!batchAnalyze}
              />
            </div>
          ) : null}
          <div className="mt-4">
            <DataTable
              columns={columns}
              rows={tableRows}
              emptyText="暂无结果，填写订单号并点击开始分析。"
              boundedScroll
            />
          </div>
        </section>
      ) : null}

      <Drawer
        open={detailRow !== null}
        onClose={() => setDetailRow(null)}
        title={detailRow ? `订单 ${detailRow.orderNo} — ${detailRow.lossScope}/${detailRow.categoryName}` : '订单详情'}
        width={hasInterceptLogs ? 'min(1180px, 96vw)' : 'min(860px, 96vw)'}
        destroyOnClose
      >
        {detailRow ? (
          <div className="space-y-5">
            <div className="flex gap-4">
              <section className="flex-1 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-slate-900">异常完结</h4>
                  <Tag color={outResponsibility ? 'warning' : 'default'} className="m-0">
                    {outResponsibility ? '库外责任（供应商必填）' : '非库外责任'}
                  </Tag>
                </div>

                <Form layout="vertical" size="middle" colon={false}>
                  <div className="grid grid-cols-2 gap-x-4">
                    <Form.Item label="异常类型" required className="mb-3">
                      <Select<ClosureExceptionTypeKey>
                        value={closureTypeKey || undefined}
                        placeholder="请选择异常类型"
                        options={CLOSURE_EXCEPTION_TYPE_OPTIONS.map((x) => ({
                          value: x.key,
                          label: x.value,
                        }))}
                        onChange={(v) => setClosureTypeKey(v)}
                      />
                    </Form.Item>

                    <Form.Item
                      label="派件员供应商"
                      required={outResponsibility}
                      className="mb-3"
                      extra={vendorAutoFillTip || undefined}
                    >
                      <Select<string>
                        value={selectedVendorKey || undefined}
                        placeholder={isLoadingVendors ? '加载中...' : '请选择供应商'}
                        showSearch
                        allowClear
                        loading={isLoadingVendors}
                        options={vendorSelectOptions}
                        optionFilterProp="label"
                        onChange={(v) => setSelectedVendorKey(v ?? '')}
                        onClear={() => setSelectedVendorKey('')}
                      />
                    </Form.Item>
                  </div>

                  <Form.Item label="备注" className="mb-3">
                    <Input.TextArea
                      rows={3}
                      value={closureRemark}
                      onChange={(e) => setClosureRemark(e.target.value)}
                      placeholder="默认回填 AI 判定依据"
                    />
                  </Form.Item>

                  <Form.Item className="mb-0">
                    <div className="flex items-center gap-3">
                      <Button type="primary" onClick={handlePreviewSubmit}>
                        提交
                      </Button>
                    </div>
                  </Form.Item>
                </Form>

                {submitPreview ? (
                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-900 p-3 text-xs text-slate-100">
                    <pre className="overflow-auto whitespace-pre-wrap break-all">{submitPreview}</pre>
                  </div>
                ) : null}
              </section>

              <section className="w-[340px] shrink-0 rounded-lg border border-dashed border-slate-300 bg-white p-4">
                <h4 className="mb-4 text-sm font-semibold text-slate-900">供应商识别</h4>
                <Form layout="vertical" size="middle" colon={false}>
                  <Form.Item label="站点编码" className="mb-3">
                    <Input
                      value={stationCode}
                      onChange={(e) => setStationCode(e.target.value.trim())}
                      placeholder="例如：S210372901"
                    />
                  </Form.Item>

                  <Form.Item label="派送员 ID" className="mb-3">
                    <Input
                      value={detectedDriverId}
                      onChange={(e) => {
                        setDetectedDriverId(e.target.value.trim())
                        setSelectedVendorKey('')
                        setVendorAutoFillTip('')
                        setPendingAutoResolveDriverId('')
                      }}
                      placeholder="可手动输入"
                      className="font-mono"
                    />
                  </Form.Item>

                  <Form.Item className="mb-0">
                    <Button
                      block
                      disabled={!detectedDriverId || !stationCode || isResolvingVendor}
                      loading={isResolvingVendor}
                      onClick={() =>
                        detectedDriverId ? void resolveVendorByDriver(detectedDriverId, stationCode) : undefined
                      }
                    >
                      识别供应商
                    </Button>
                  </Form.Item>
                </Form>
              </section>
            </div>

            <div className="flex h-full gap-5">
              <section className="flex min-w-0 flex-1 flex-col">
                <h4 className="mb-3 flex shrink-0 items-center gap-2 text-sm font-semibold text-slate-950">
                  <span className="inline-block h-4 w-1 rounded-full bg-[#1f6f68]" />
                  Query 完整轨迹
                  <Tag className="ml-1">{sortedTrackEvents.length} 条</Tag>
                </h4>

                {sortedTrackEvents.length === 0 ? (
                  <p className="text-sm text-slate-400">暂无轨迹数据</p>
                ) : (
                  <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-slate-50/60 px-5 pt-5 pb-1">
                    <Timeline
                      items={sortedTrackEvents.map((evt) => {
                        const isLatestResponsibilityTrack =
                          latestResponsibilityMarker?.source === 'track' &&
                          latestResponsibilityMarker.time === evt.time
                        const stageColor = STAGE_DOT_COLOR[evt.trackStageTx ?? ''] ?? 'gray'
                        const dotColor = isLatestResponsibilityTrack ? 'red' : stageColor
                        const typeTag = evt.trackType ? TRACK_TYPE_TAG[evt.trackType] : null
                        return {
                          color: dotColor,
                          children: (
                            <div className={`pb-0.5 ${isLatestResponsibilityTrack ? 'text-red-700' : ''}`}>
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`font-mono text-xs tabular-nums ${
                                    isLatestResponsibilityTrack ? 'text-red-600' : 'text-slate-500'
                                  }`}
                                >
                                  {evt.time}
                                </span>
                                {evt.trackStageTx && (
                                  <Tag
                                    color={isLatestResponsibilityTrack ? 'red' : stageColor}
                                    className="m-0 border-0 text-[11px] leading-tight"
                                  >
                                    {evt.trackStageTx}
                                  </Tag>
                                )}
                                {typeTag && (
                                  <Tag
                                    color={isLatestResponsibilityTrack ? 'red' : typeTag.color}
                                    className="m-0 border-0 text-[11px] leading-tight"
                                  >
                                    {typeTag.label}
                                  </Tag>
                                )}
                                {isLatestResponsibilityTrack && (
                                  <Tag color="red" className="m-0 border-0 text-[11px] leading-tight">
                                    最新责任方
                                  </Tag>
                                )}
                              </div>
                              <p
                                className={`mt-1 text-[13px] leading-relaxed ${
                                  isLatestResponsibilityTrack ? 'text-red-700' : 'text-slate-800'
                                }`}
                              >
                                {renderTrackContentWithDriverIdClickable(evt.content, handleTrackDriverIdPick)}
                              </p>
                            </div>
                          ),
                        }
                      })}
                    />
                  </div>
                )}
              </section>

              {hasInterceptLogs && (
                <section className="flex w-[340px] shrink-0 flex-col">
                  <h4 className="mb-2 flex shrink-0 items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className="inline-block h-3.5 w-0.5 rounded-full bg-slate-400" />
                    完整阻断日志
                    <Tag className="ml-1 border-slate-200 bg-slate-100 text-slate-600">{sortedInterceptLogs.length} 条</Tag>
                  </h4>

                  <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200 bg-white px-3 py-3">
                    <Timeline
                      items={sortedInterceptLogs.map((log) => {
                        const isLatestResponsibilityIntercept =
                          latestResponsibilityMarker?.source === 'intercept' &&
                          latestResponsibilityMarker.time === log.gmtIntercept
                        const scanUserCode = log.scanUserCode.trim()
                        return {
                          color: isLatestResponsibilityIntercept ? 'red' : 'gray',
                          children: (
                            <div
                              className={`rounded-sm px-2 py-0.5 ${
                                isLatestResponsibilityIntercept
                                  ? 'border-red-400 bg-red-50/40 text-red-700'
                                  : 'border-slate-200 text-slate-700'
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`font-mono text-[11px] tabular-nums ${
                                    isLatestResponsibilityIntercept ? 'text-red-600' : 'text-slate-500'
                                  }`}
                                >
                                  {log.gmtScan || log.gmtIntercept}
                                </span>
                                <span className="font-semibold text-[12px]">{log.scanTypeDesc || '—'}</span>
                              </div>
                              <div
                                className={`mt-1 space-y-0.5 text-[12px] leading-5 ${
                                  isLatestResponsibilityIntercept ? 'text-red-700' : 'text-slate-800'
                                }`}
                              >
                                <p>
                                  <span className="text-slate-500">扫描网点：</span>
                                  <span>{log.scanOcName || '—'}</span>
                                </p>
                                <p>
                                  <span className="text-slate-500">阻断原因：</span>
                                  <span>{log.interceptReasonDesc || '—'}</span>
                                </p>
                                <p>
                                  <span className="text-slate-500">操作人：</span>
                                  <span className="font-medium">{log.scanUserName || '-'}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (scanUserCode) handleTrackDriverIdPick(scanUserCode)
                                    }}
                                    disabled={!scanUserCode}
                                    className={`ml-1 inline-flex items-center rounded px-0.5 py-0.5 font-mono text-[11px] underline decoration-dotted underline-offset-2 disabled:cursor-not-allowed disabled:no-underline ${
                                      isLatestResponsibilityIntercept
                                        ? 'text-red-500 hover:bg-red-100/70 hover:text-red-600 disabled:text-red-300'
                                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800 disabled:text-slate-400'
                                    }`}
                                    title={scanUserCode ? `点击回填派送员 ID：${scanUserCode}` : '无派送员 ID'}
                                  >
                                    ({scanUserCode || '-'})
                                  </button>
                                </p>
                              </div>
                            </div>
                          ),
                        }
                      })}
                    />
                  </div>
                </section>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}
