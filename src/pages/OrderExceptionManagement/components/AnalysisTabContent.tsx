import { Select, Tag, Tooltip } from 'antd'
import { saveAs } from 'file-saver'
import { Loader2, Settings2, Upload } from 'lucide-react'
import { useCallback, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import * as XLSX from 'xlsx-js-style'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import { applySheetCenterAlignment } from '../../../utils/xlsxCenteredSheet'
import { DataTable, ExportButton, type DataTableColumn } from '../../ScannerEfficiency/components/ui'
import {
  type OrderAnalyzeAiProvider,
  type OrderAnalyzeApiTiming,
  type OrderAnalyzeTokenUsage,
} from '../orderExceptionApi'
import type { AnalysisRow, AnalyzeProgress, ImportedAnalyzeOrders } from '../useOrderExceptionManagementPage'
import { AnalyzeProgressStrip } from './AnalyzeProgressStrip'
import { OrderAnalysisDetailDrawer } from './OrderAnalysisDetailDrawer'

type Row = AnalysisRow

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
  onAnalyzeOrderFileUpload: (file: File) => Promise<void>
  onClearImportedAnalyzeOrders: () => void
  importedAnalyzeOrders: ImportedAnalyzeOrders | null
  isAnalyzing: boolean
  rows: Row[]
  analyzeProgress: AnalyzeProgress | null
  tokenUsage: OrderAnalyzeTokenUsage | null
  analyzedOrderCount: number
  durationMs: number | null
  apiTiming: OrderAnalyzeApiTiming | null
  onOpenWarehouseConfig: () => void
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
  onAnalyzeOrderFileUpload,
  onClearImportedAnalyzeOrders,
  importedAnalyzeOrders,
  isAnalyzing,
  rows,
  analyzeProgress,
  tokenUsage,
  analyzedOrderCount,
  durationMs,
  apiTiming,
  onOpenWarehouseConfig,
}: Props) {
  const canAnalyze = usePermission(PERMISSION_KEYS.btnOrderExceptionAnalyze)
  const [detailRow, setDetailRow] = useState<Row | null>(null)
  const [visitedOrders, setVisitedOrders] = useState<Set<string>>(() => new Set())

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
                disabled={isAnalyzing || !canAnalyze}
                onClick={onAnalyze}
                className="admin-btn admin-btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                开始分析
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
        <section className="admin-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-950">分析结果</h3>
            <ExportButton
              label="导出 Excel"
              permission={PERMISSION_KEYS.btnOrderExceptionAnalyze}
              disabled={exportableRows.length === 0 || isAnalyzing || !canAnalyze}
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

      <OrderAnalysisDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} />
    </div>
  )
}
