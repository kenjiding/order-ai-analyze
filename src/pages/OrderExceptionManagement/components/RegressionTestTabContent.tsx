import { Input, Select, Tag } from 'antd'
import { Loader2, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTable, type DataTableColumn, type DataTableRow } from '../../ScannerEfficiency/components/ui'
import type {
  OrderAnalyzeAiProvider,
  OrderAnalyzeResultItem,
  OrderAnalyzeTokenUsage,
  RegressionCaseListItem,
  RegressionCaseResult,
} from '../orderExceptionApi'
import {
  SUB_TYPE_BY_SCOPE,
  regressionLossScopeOptions,
  subTypeOptionsForScope,
} from '../orderExceptionDomain'

const ANALYZE_MODEL_OPTIONS: { value: OrderAnalyzeAiProvider; label: string }[] = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openai', label: 'OpenAI' },
]

type Props = {
  captureOrderNo: string
  onCaptureOrderNoChange: (v: string) => void
  captureLossScope: OrderAnalyzeResultItem['lossScope']
  onCaptureLossScopeChange: (v: OrderAnalyzeResultItem['lossScope']) => void
  captureSubType: string
  onCaptureSubTypeChange: (v: string) => void
  captureReason: string
  onCaptureReasonChange: (v: string) => void
  onCapture: () => void
  isCapturing: boolean
  cases: RegressionCaseListItem[]
  onRefreshCases: () => void
  onDeleteCase: (id: string) => void
  isDeletingId: string | null
  analyzeAiProvider: OrderAnalyzeAiProvider
  onAnalyzeAiProviderChange: (v: OrderAnalyzeAiProvider) => void
  onRunRegression: () => void
  isRunningRegression: boolean
  regressionResults: RegressionCaseResult[]
  regressionSummary: { total: number; passed: number; failed: number } | null
  regressionTokenUsage: OrderAnalyzeTokenUsage | null
}

export function RegressionTestTabContent({
  captureOrderNo,
  onCaptureOrderNoChange,
  captureLossScope,
  onCaptureLossScopeChange,
  captureSubType,
  onCaptureSubTypeChange,
  captureReason,
  onCaptureReasonChange,
  onCapture,
  isCapturing,
  cases,
  onRefreshCases,
  onDeleteCase,
  isDeletingId,
  analyzeAiProvider,
  onAnalyzeAiProviderChange,
  onRunRegression,
  isRunningRegression,
  regressionResults,
  regressionSummary,
  regressionTokenUsage,
}: Props) {
  const { t, i18n } = useTranslation('orderException')
  const { t: tc } = useTranslation('common')

  const subTypeOptions = useMemo(
    () => subTypeOptionsForScope(t, captureLossScope),
    [captureLossScope, t],
  )

  const lossScopeOptions = useMemo(() => regressionLossScopeOptions(t), [t])

  const caseColumns = useMemo((): DataTableColumn[] => {
    const renderCaseSummary = (row: DataTableRow) => {
      const orderNo = String(row.orderNo ?? '')
      const lossScope = String(row.lossScope ?? '')
      const subType = String(row.subType ?? '')
      return (
        <span className="font-mono text-slate-900">
          {orderNo}
          <span className="mx-2 text-slate-300">|</span>
          <span className="font-sans">{lossScope}</span>
          {subType ? (
            <>
              <span className="mx-2 text-slate-300">|</span>
              <span className="font-sans">{subType}</span>
            </>
          ) : null}
        </span>
      )
    }

    const renderActions = (row: DataTableRow) => {
      const id = String(row.id ?? '')
      const orderNo = String(row.orderNo ?? '')
      const deleting = isDeletingId === id
      return (
        <button
          type="button"
          disabled={deleting}
          onClick={() => onDeleteCase(id)}
          className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
          aria-label={t('regression.deleteCaseAria', { orderNo })}
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          )}
          {tc('delete')}
        </button>
      )
    }

    return [
      { key: 'caseSummary', title: t('regression.caseSummaryCol'), render: renderCaseSummary },
      { key: 'trackCount', title: t('regression.trackCountCol') },
      { key: 'interceptLogCount', title: t('regression.interceptLogCountCol') },
      { key: 'capturedAt', title: t('regression.capturedAtCol') },
      { key: 'actions', title: tc('actions'), render: renderActions },
    ]
  }, [isDeletingId, onDeleteCase, t, tc])

  const resultColumns = useMemo(
    (): DataTableColumn[] => [
      { key: 'orderNo', title: t('regression.orderNo') },
      {
        key: 'pass',
        title: t('regression.resultCol'),
        render: (row) =>
          row.pass === true ? (
            <Tag color="success" className="m-0">
              {t('regression.pass')}
            </Tag>
          ) : (
            <Tag color="error" className="m-0">
              {t('regression.fail')}
            </Tag>
          ),
      },
      { key: 'expected', title: t('regression.expectedCol') },
      { key: 'actual', title: t('regression.actualCol') },
      { key: 'confidence', title: t('regression.confidenceCol') },
      { key: 'expectedReason', title: t('regression.expectedReasonCol') },
      { key: 'actualReason', title: t('regression.actualReasonCol') },
    ],
    [t],
  )

  const caseRows: DataTableRow[] = cases.map((c) => ({
    id: c.id,
    orderNo: c.orderNo,
    lossScope: c.expected.lossScope,
    subType: c.expected.exceptionCategoryId,
    trackCount: String(c.trackCount),
    interceptLogCount: String(c.interceptLogCount),
    capturedAt: c.capturedAt.slice(0, 19).replace('T', ' '),
  }))

  const resultRows: DataTableRow[] = regressionResults.map((r) => ({
    orderNo: r.orderNo,
    pass: r.pass,
    expected: `${r.expected.lossScope}${r.expected.exceptionCategoryId ? ` / ${r.expected.exceptionCategoryId}` : ''}`,
    actual: `${r.actual.lossScope}${r.actual.exceptionCategoryId ? ` / ${r.actual.exceptionCategoryId}` : ''}`,
    confidence: Number.isFinite(r.actual.confidence) ? r.actual.confidence.toFixed(2) : '—',
    expectedReason: r.expected.reason || '—',
    actualReason: r.actual.reason || '—',
  }))

  return (
    <div className="space-y-5">
      <section className="admin-panel p-5">
        <h3 className="text-sm font-semibold text-slate-950">{t('regression.captureTitle')}</h3>
        <p className="mt-1 text-xs text-slate-600">{t('regression.captureDescription')}</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block min-w-[180px] flex-1 text-xs font-medium text-slate-600">
            {t('regression.orderNo')}
            <Input
              className="mt-1 font-mono"
              value={captureOrderNo}
              onChange={(e) => onCaptureOrderNoChange(e.target.value)}
              placeholder={t('regression.orderNoPlaceholder')}
            />
          </label>
          <label className="block min-w-[140px] text-xs font-medium text-slate-600">
            {t('regression.exceptionType')}
            <Select
              className="mt-1 w-full"
              value={captureLossScope}
              options={lossScopeOptions}
              onChange={(v) => {
                onCaptureLossScopeChange(v)
                const subs = SUB_TYPE_BY_SCOPE[v]
                onCaptureSubTypeChange(subs?.[0] ?? '')
              }}
            />
          </label>
          <label className="block min-w-[140px] text-xs font-medium text-slate-600">
            {t('regression.subType')}
            <Select
              className="mt-1 w-full"
              value={captureSubType}
              options={subTypeOptions}
              onChange={onCaptureSubTypeChange}
            />
          </label>
        </div>
        <div className="mt-4">
          <label className="block text-xs font-medium text-slate-600">
            {t('regression.reasonLabel')}
            <Input.TextArea
              className="mt-1"
              rows={3}
              value={captureReason}
              onChange={(e) => onCaptureReasonChange(e.target.value)}
              placeholder={t('regression.reasonPlaceholder')}
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={isCapturing}
            onClick={onCapture}
            className="admin-btn admin-btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCapturing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {t('regression.captureAndPersist')}
          </button>
          <button type="button" onClick={onRefreshCases} className="admin-btn admin-btn-secondary">
            {t('regression.refreshList')}
          </button>
        </div>
      </section>

      <section className="admin-panel p-5">
        <h3 className="text-sm font-semibold text-slate-950">{t('regression.casesTitle')}</h3>
        <div className="mt-4">
          <DataTable
            columns={caseColumns}
            rows={caseRows}
            emptyText={t('regression.casesEmpty')}
            boundedScroll
          />
        </div>
      </section>

      <section className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-950">{t('regression.runTitle')}</h3>
          <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
            <span className="shrink-0">{t('analyze.analyzeModel')}</span>
            <Select<OrderAnalyzeAiProvider>
              className="min-w-[140px]"
              value={analyzeAiProvider}
              options={ANALYZE_MODEL_OPTIONS}
              disabled={isRunningRegression}
              onChange={onAnalyzeAiProviderChange}
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={isRunningRegression || cases.length === 0}
            onClick={onRunRegression}
            className="admin-btn admin-btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunningRegression ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {t('regression.runAll')}
          </button>
          {regressionSummary ? (
            <p className="text-xs text-slate-600">
              {t('regression.resultSummary')}
              <span className="font-semibold text-emerald-700">
                {t('regression.passedCount', { count: regressionSummary.passed })}
              </span>
              {' / '}
              <span className="font-semibold text-red-700">
                {t('regression.failedCount', { count: regressionSummary.failed })}
              </span>
              {' / '}
              {t('regression.totalCount', { count: regressionSummary.total })}
              {regressionTokenUsage ? (
                <>
                  {' '}
                  · Token {regressionTokenUsage.totalTokens.toLocaleString(i18n.language)}
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="mt-4">
          <DataTable
            columns={resultColumns}
            rows={resultRows}
            emptyText={t('regression.resultsEmpty')}
            boundedScroll
          />
        </div>
      </section>
    </div>
  )
}
