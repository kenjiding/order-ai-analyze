import { Input, Select, Tag } from 'antd'
import { Loader2, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { DataTable, type DataTableColumn, type DataTableRow } from '../../ScannerEfficiency/components/ui'
import type {
  OrderAnalyzeAiProvider,
  OrderAnalyzeResultItem,
  OrderAnalyzeTokenUsage,
  RegressionCaseListItem,
  RegressionCaseResult,
} from '../orderExceptionApi'

const LOSS_SCOPE_OPTIONS: OrderAnalyzeResultItem['lossScope'][] = [
  '库内丢失',
  '库外丢失',
  '3PL丢件',
  '虚假转运',
  '暂无异常',
  '需人工判断',
]

const SUB_TYPE_BY_SCOPE: Partial<Record<OrderAnalyzeResultItem['lossScope'], string[]>> = {
  库内丢失: ['扫描员丢失'],
  库外丢失: ['快递员丢失'],
  暂无异常: ['退返商家', '暂存', ''],
}

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
  const subTypeOptions = useMemo(() => {
    const list = SUB_TYPE_BY_SCOPE[captureLossScope]
    if (!list) return [{ label: '（无子类型）', value: '' }]
    return list.map((v) => ({ label: v || '（无子类型）', value: v }))
  }, [captureLossScope])

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
          aria-label={`删除用例 ${orderNo}`}
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          )}
          删除
        </button>
      )
    }

    return [
      { key: 'caseSummary', title: '订单号 / 异常类型 / 子类型', render: renderCaseSummary },
      { key: 'trackCount', title: '轨迹条数' },
      { key: 'interceptLogCount', title: '阻断日志' },
      { key: 'capturedAt', title: '录入时间' },
      { key: 'actions', title: '操作', render: renderActions },
    ]
  }, [isDeletingId, onDeleteCase])

  const resultColumns = useMemo(
    (): DataTableColumn[] => [
      { key: 'orderNo', title: '订单号' },
      {
        key: 'pass',
        title: '结果',
        render: (row) =>
          row.pass === true ? (
            <Tag color="success" className="m-0">
              通过
            </Tag>
          ) : (
            <Tag color="error" className="m-0">
              失败
            </Tag>
          ),
      },
      { key: 'expected', title: '期望类型/子类型' },
      { key: 'actual', title: '实际类型/子类型' },
      { key: 'confidence', title: '置信度' },
      { key: 'expectedReason', title: '期望判定依据' },
      { key: 'actualReason', title: '实际判定依据' },
    ],
    []
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
        <h3 className="text-sm font-semibold text-slate-950">录入测试用例</h3>
        <p className="mt-1 text-xs text-slate-600">
          填写订单号与期望判定后，系统将从 iMile 拉取轨迹与阻断日志并固化为服务端 JSON；回归测试不再调用
          iMile。通过标准：异常类型与子类型与录入一致。
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block min-w-[180px] flex-1 text-xs font-medium text-slate-600">
            订单号
            <Input
              className="mt-1 font-mono"
              value={captureOrderNo}
              onChange={(e) => onCaptureOrderNoChange(e.target.value)}
              placeholder="单个订单号"
            />
          </label>
          <label className="block min-w-[140px] text-xs font-medium text-slate-600">
            异常类型
            <Select
              className="mt-1 w-full"
              value={captureLossScope}
              options={LOSS_SCOPE_OPTIONS.map((v) => ({ label: v, value: v }))}
              onChange={(v) => {
                onCaptureLossScopeChange(v)
                const subs = SUB_TYPE_BY_SCOPE[v]
                onCaptureSubTypeChange(subs?.[0] ?? '')
              }}
            />
          </label>
          <label className="block min-w-[140px] text-xs font-medium text-slate-600">
            子类型
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
            判定依据（存档展示，不参与通过判定）
            <Input.TextArea
              className="mt-1"
              rows={3}
              value={captureReason}
              onChange={(e) => onCaptureReasonChange(e.target.value)}
              placeholder="人工判定的依据说明"
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
            录入并固化
          </button>
          <button type="button" onClick={onRefreshCases} className="admin-btn admin-btn-secondary">
            刷新列表
          </button>
        </div>
      </section>

      <section className="admin-panel p-5">
        <h3 className="text-sm font-semibold text-slate-950">已录入用例</h3>
        <div className="mt-4">
          <DataTable
            columns={caseColumns}
            rows={caseRows}
            emptyText="暂无用例，请先录入。"
            boundedScroll
          />
        </div>
      </section>

      <section className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-950">运行回归测试</h3>
          <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
            <span className="shrink-0">分析模型</span>
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
            运行全部回归
          </button>
          {regressionSummary ? (
            <p className="text-xs text-slate-600">
              结果：
              <span className="font-semibold text-emerald-700">{regressionSummary.passed} 通过</span>
              {' / '}
              <span className="font-semibold text-red-700">{regressionSummary.failed} 失败</span>
              {' / 共 '}
              {regressionSummary.total} 条
              {regressionTokenUsage ? (
                <>
                  {' '}
                  · Token {regressionTokenUsage.totalTokens.toLocaleString('zh-CN')}
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="mt-4">
          <DataTable
            columns={resultColumns}
            rows={resultRows}
            emptyText="尚未运行回归，或暂无结果。"
            boundedScroll
          />
        </div>
      </section>
    </div>
  )
}
