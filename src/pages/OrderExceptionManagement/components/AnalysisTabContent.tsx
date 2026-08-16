import { Select, Tooltip } from 'antd'
import { Loader2, Play, Settings2, Upload } from 'lucide-react'
import { useCallback, type ChangeEvent } from 'react'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import {
  type OrderAnalyzeAiProvider,
  type OrderAnalyzeApiTiming,
  type OrderAnalyzeTokenUsage,
} from '../orderExceptionApi'
import type { AnalysisRow, AnalyzeProgress, ImportedAnalyzeOrders, SubmittedJobBanner } from '../analysisTypes'
import type { PostFilterConfig } from '../postFilter/types'
import { OrderExceptionAnalysisResults } from './OrderExceptionAnalysisResults'

type Row = AnalysisRow

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

  const onOrderFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      void onAnalyzeOrderFileUpload(file)
    },
    [onAnalyzeOrderFileUpload],
  )

  const avgTokensPerOrder =
    tokenUsage && analyzedOrderCount > 0 ? Math.round(tokenUsage.totalTokens / analyzedOrderCount) : null
  const avgDurationMsPerOrder =
    durationMs != null && analyzedOrderCount > 0 ? Math.round(durationMs / analyzedOrderCount) : null
  const avgImileMsPerOrder =
    apiTiming && analyzedOrderCount > 0 ? Math.round(apiTiming.imileMs / analyzedOrderCount) : null
  const avgAiMsPerOrder =
    apiTiming && analyzedOrderCount > 0 ? Math.round(apiTiming.aiMs / analyzedOrderCount) : null
  const showAnalyzeStats = Boolean(tokenUsage || durationMs != null || apiTiming != null)

  return (
    <div className="space-y-5">
      <section className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-950">待分析订单</h3>
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
                    <> （平均每单 {formatDuration(avgDurationMsPerOrder)}）</>
                  ) : null}
                </>
              ) : null}
              {apiTiming ? (
                <>
                  {durationMs != null ? ' · ' : null}
                  iMile 接口：
                  <span className="font-semibold text-slate-900">{formatDuration(apiTiming.imileMs)}</span>
                  {avgImileMsPerOrder != null ? (
                    <> （平均每单 {formatDuration(avgImileMsPerOrder)}）</>
                  ) : null}
                  {' · '}
                  AI 接口：
                  <span className="font-semibold text-slate-900">{formatDuration(apiTiming.aiMs)}</span>
                  {avgAiMsPerOrder != null ? <> （平均每单 {formatDuration(avgAiMsPerOrder)}）</> : null}
                </>
              ) : null}
              {tokenUsage ? (
                <>
                  {durationMs != null || apiTiming != null ? ' · ' : null}
                  Token 消耗：
                  <span className="font-semibold text-slate-900">{formatTokenCount(tokenUsage.totalTokens)}</span>{' '}
                  （输入 {formatTokenCount(tokenUsage.promptTokens)} / 输出{' '}
                  {formatTokenCount(tokenUsage.completionTokens)}）
                  {tokenUsage.apiCalls > 0 ? <> · API {formatTokenCount(tokenUsage.apiCalls)} 次</> : null}
                  {avgTokensPerOrder != null ? (
                    <> · 平均每单 {formatTokenCount(avgTokensPerOrder)} Token</>
                  ) : null}
                </>
              ) : null}
            </p>
          </div>
        ) : null}
      </section>

      <OrderExceptionAnalysisResults
        rows={rows}
        filteredRows={filteredRows}
        totalDoneRowCount={totalDoneRowCount}
        isAnalyzing={isAnalyzing}
        isPaused={isPaused}
        analyzeProgress={analyzeProgress}
        postFilterDraft={postFilterDraft}
        onPostFilterDraftChange={onPostFilterDraftChange}
        appliedPostFilter={appliedPostFilter}
        onRunPostFilter={onRunPostFilter}
        exportPermission={PERMISSION_KEYS.btnOrderExceptionAnalyze}
        emptyText="暂无结果，填写订单号并点击开始分析。"
        submittedJobBanner={submittedJobBanner}
        onDismissSubmittedJobBanner={onDismissSubmittedJobBanner}
        onGoToJobsTab={onGoToJobsTab}
        showPushSection
      />
    </div>
  )
}
