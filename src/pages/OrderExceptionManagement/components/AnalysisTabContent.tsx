import { Select, Tooltip } from 'antd'
import { Loader2, Play, Settings2, Upload } from 'lucide-react'
import { useCallback, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t, i18n } = useTranslation('orderException')
  const canAnalyze = usePermission(PERMISSION_KEYS.btnOrderExceptionAnalyze)

  const formatTokenCount = useCallback(
    (n: number) => n.toLocaleString(i18n.language),
    [i18n.language],
  )

  const formatDuration = useCallback(
    (ms: number) => {
      if (ms < 1000) return t('analyze.durationMs', { ms })
      if (ms < 60_000) return t('analyze.durationSec', { sec: (ms / 1000).toFixed(1) })
      const totalSec = Math.round(ms / 1000)
      const min = Math.floor(totalSec / 60)
      const sec = totalSec % 60
      return sec > 0
        ? t('analyze.durationMinSec', { min, sec })
        : t('analyze.durationMin', { min })
    },
    [t],
  )

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

  const analyzeButtonLabel = !isAnalyzing
    ? t('analyze.startAnalyze')
    : batchAnalyze
      ? t('analyze.startAnalyze')
      : isPaused
        ? t('analyze.continueAnalyze')
        : t('analyze.pauseAnalyze')

  return (
    <div className="space-y-5">
      <section className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-950">{t('analyze.pendingOrdersTitle')}</h3>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
              <span className="shrink-0">{t('analyze.analyzeModel')}</span>
              <Select<OrderAnalyzeAiProvider>
                className="min-w-[140px]"
                value={analyzeAiProvider}
                options={ANALYZE_MODEL_OPTIONS}
                disabled={isAnalyzing}
                onChange={(v) => onAnalyzeAiProviderChange(v)}
                aria-label={t('analyze.selectAnalyzeModel')}
              />
            </label>
            <label
              title={t('analyze.importFileHint')}
              className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-[#2f8f87]/40 hover:bg-[#2f8f87]/5 hover:text-[#1f6f68] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
            >
              <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t('analyze.importFile')}
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
              <span className="text-xs font-medium leading-none text-slate-800">{t('analyze.batchAnalyze')}</span>
            </label>
            <button
              type="button"
              disabled={isAnalyzing}
              onClick={onOpenWarehouseConfig}
              className="admin-btn border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Settings2 className="h-4 w-4" />
              {t('analyze.analysisConfig')}
            </button>
            <Tooltip title={!canAnalyze ? t('noPermission') : undefined}>
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
                {analyzeButtonLabel}
              </button>
            </Tooltip>
          </div>
        </div>
        {importedAnalyzeOrders ? (
          <div className="mt-3 flex items-center justify-end gap-2 text-xs text-slate-600" aria-live="polite">
            <span>
              {t('analyze.importedCount', {
                count: importedAnalyzeOrders.orderNos.length.toLocaleString(i18n.language),
              })}
            </span>
            <button
              type="button"
              disabled={isAnalyzing}
              onClick={onClearImportedAnalyzeOrders}
              className="text-[#1f6f68] underline decoration-dashed underline-offset-2 hover:text-[#2f8f87] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('results.clearFilter')}
            </button>
          </div>
        ) : null}
        <label className={`block text-xs font-medium text-slate-600 ${importedAnalyzeOrders ? 'mt-3' : 'mt-4'}`}>
          <textarea
            value={analyzeOrderText}
            onChange={(e) => onAnalyzeOrderTextChange(e.target.value)}
            rows={8}
            placeholder={t('analyze.orderPlaceholder')}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-[#2f8f87] focus:outline-none focus:ring-2 focus:ring-[#2f8f87]/25"
          />
        </label>
        {showAnalyzeStats ? (
          <div className="mt-4">
            <p className="text-xs text-slate-600" aria-live="polite">
              {durationMs != null ? (
                <>
                  {t('analyze.totalDuration')}
                  <span className="font-semibold text-slate-900">{formatDuration(durationMs)}</span>
                  {avgDurationMsPerOrder != null ? (
                    <> {t('analyze.avgPerOrder', { duration: formatDuration(avgDurationMsPerOrder) })}</>
                  ) : null}
                </>
              ) : null}
              {apiTiming ? (
                <>
                  {durationMs != null ? ' · ' : null}
                  {t('analyze.imileApi')}
                  <span className="font-semibold text-slate-900">{formatDuration(apiTiming.imileMs)}</span>
                  {avgImileMsPerOrder != null ? (
                    <> {t('analyze.avgPerOrder', { duration: formatDuration(avgImileMsPerOrder) })}</>
                  ) : null}
                  {' · '}
                  {t('analyze.aiApi')}
                  <span className="font-semibold text-slate-900">{formatDuration(apiTiming.aiMs)}</span>
                  {avgAiMsPerOrder != null ? (
                    <> {t('analyze.avgPerOrder', { duration: formatDuration(avgAiMsPerOrder) })}</>
                  ) : null}
                </>
              ) : null}
              {tokenUsage ? (
                <>
                  {durationMs != null || apiTiming != null ? ' · ' : null}
                  {t('analyze.tokenUsage')}
                  <span className="font-semibold text-slate-900">{formatTokenCount(tokenUsage.totalTokens)}</span>{' '}
                  {t('analyze.tokenInOut', {
                    prompt: formatTokenCount(tokenUsage.promptTokens),
                    completion: formatTokenCount(tokenUsage.completionTokens),
                  })}
                  {tokenUsage.apiCalls > 0 ? (
                    <> {t('analyze.apiCalls', { count: formatTokenCount(tokenUsage.apiCalls) })}</>
                  ) : null}
                  {avgTokensPerOrder != null ? (
                    <> {t('analyze.avgTokenPerOrder', { count: formatTokenCount(avgTokensPerOrder) })}</>
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
        emptyText={t('analyze.emptyResultsHint')}
        submittedJobBanner={submittedJobBanner}
        onDismissSubmittedJobBanner={onDismissSubmittedJobBanner}
        onGoToJobsTab={onGoToJobsTab}
        showPushSection
      />
    </div>
  )
}
