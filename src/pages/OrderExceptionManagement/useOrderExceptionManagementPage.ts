import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ORDER_EXCEPTION_ANALYZE_MAX_BATCH,
  captureRegressionCase,
  deleteRegressionCase,
  listRegressionCases,
  postOrderExceptionAnalyze,
  runRegression,
  type OrderAnalyzeInterceptLog,
  type OrderAnalyzeAiProvider,
  type OrderAnalyzeApiTiming,
  type OrderAnalyzeResultItem,
  type OrderAnalyzeResponsibilityOwner,
  type ResponsibilityTrackMarker,
  type OrderAnalyzeTokenUsage,
  type RegressionCaseListItem,
  type RegressionCaseResult,
} from './orderExceptionApi'
import type { TrackEvent } from './types'
import { useAppSettings } from '../../context/AppSettingsContext'
import { parseOrderNumbersFromFile } from './parseOrderNumbersFromFile'
import { parseOrderNumbersUnique } from '../../utils/orderNoInput'
import { showToast } from '../../utils/toast'

const ANALYZE_AI_PROVIDER_KEY = 'order_exception_analyze_ai_v1'
const BATCH_ANALYZE_KEY = 'order_exception_batch_analyze_v1'
const TRACK_DRIVER_ID_RE = /\bID\s*[:：]\s*(D[0-9A-Za-z-]+)/i

function readStoredAnalyzeAiProvider(): OrderAnalyzeAiProvider {
  if (typeof localStorage === 'undefined') return 'deepseek'
  try {
    const raw = localStorage.getItem(ANALYZE_AI_PROVIDER_KEY)
    if (raw === 'openai') return 'openai'
    return 'deepseek'
  } catch {
    return 'deepseek'
  }
}

function readStoredBatchAnalyze(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(BATCH_ANALYZE_KEY) === '1'
  } catch {
    return false
  }
}

export type TabId = 'analyze' | 'regression'

export type AnalysisRowStatus = 'pending' | 'analyzing' | 'done' | 'error'

export type AnalysisRow = {
  orderNo: string
  lossScope: string
  categoryName: string
  currentResponsibilityParty: string
  activeResponsibilityOwner?: OrderAnalyzeResponsibilityOwner
  reason: string
  confidence: string
  trackEvents: TrackEvent[]
  interceptLogs: OrderAnalyzeInterceptLog[]
  latestResponsibilityTrackMarker?: ResponsibilityTrackMarker | null
  detectedDriverId?: string
  needsReview?: boolean
  crossCheckedBy?: string | null
  status?: AnalysisRowStatus
}

export type AnalyzeProgress = {
  total: number
  completed: number
  succeeded: number
  failed: number
}

export type ImportedAnalyzeOrders = {
  fileName: string
  orderNos: string[]
}

function mergeAnalyzeTokenUsage(
  acc: OrderAnalyzeTokenUsage | null,
  next: OrderAnalyzeTokenUsage
): OrderAnalyzeTokenUsage {
  if (!acc) return { ...next }
  return {
    promptTokens: acc.promptTokens + next.promptTokens,
    completionTokens: acc.completionTokens + next.completionTokens,
    totalTokens: acc.totalTokens + next.totalTokens,
    apiCalls: acc.apiCalls + next.apiCalls,
  }
}

function mergeAnalyzeApiTiming(
  acc: OrderAnalyzeApiTiming | null,
  next: OrderAnalyzeApiTiming
): OrderAnalyzeApiTiming {
  if (!acc) return { ...next }
  return {
    imileMs: acc.imileMs + next.imileMs,
    aiMs: acc.aiMs + next.aiMs,
  }
}

function createPendingAnalysisRow(orderNo: string): AnalysisRow {
  return {
    orderNo,
    lossScope: '—',
    categoryName: '—',
    currentResponsibilityParty: '—',
    reason: '待分析',
    confidence: '—',
    trackEvents: [],
    interceptLogs: [],
    detectedDriverId: '',
    status: 'pending',
  }
}

function extractDriverIdFromTrackContent(content: string): string {
  const match = TRACK_DRIVER_ID_RE.exec(content)
  return match?.[1]?.trim() ?? ''
}

function deriveDetectedDriverId(
  latestResponsibilityTrackMarker: ResponsibilityTrackMarker | null | undefined,
  trackEvents: TrackEvent[],
  interceptLogs: OrderAnalyzeInterceptLog[]
): string {
  const marker = latestResponsibilityTrackMarker ?? null

  if (marker?.source === 'track') {
    const matchedTrack = trackEvents.find((event) => event.time === marker.time)
    const fromTrack = matchedTrack ? extractDriverIdFromTrackContent(matchedTrack.content) : ''
    if (fromTrack) return fromTrack
  }

  if (marker?.source === 'intercept') {
    const matchedIntercept = interceptLogs.find((log) => log.gmtIntercept === marker.time)
    const fromIntercept = matchedIntercept?.scanUserCode.trim() ?? ''
    if (fromIntercept) return fromIntercept
  }

  const latestTrackDriverId = [...trackEvents]
    .sort((a, b) => b.time.localeCompare(a.time))
    .map((event) => extractDriverIdFromTrackContent(event.content))
    .find(Boolean)
  if (latestTrackDriverId) return latestTrackDriverId

  const latestInterceptDriverId = [...interceptLogs]
    .sort((a, b) => b.gmtIntercept.localeCompare(a.gmtIntercept))
    .map((log) => log.scanUserCode.trim())
    .find(Boolean)
  return latestInterceptDriverId ?? ''
}

function mapAnalyzeHitToRow(
  orderNo: string,
  hit: OrderAnalyzeResultItem | undefined,
  trackInfo: Record<string, TrackEvent[]>,
  interceptLogsByOrder: Record<string, OrderAnalyzeInterceptLog[]>
): AnalysisRow {
  const trackEvents = trackInfo[orderNo] ?? []
  const interceptLogs = interceptLogsByOrder[orderNo] ?? []
  if (!hit) {
    const hasTrack = trackEvents.length > 0
    return {
      orderNo,
      lossScope: '—',
      categoryName: '—',
      currentResponsibilityParty: '—',
      reason: hasTrack ? '模型未返回该单行，请重试或缩小批量' : '无轨迹数据',
      confidence: '—',
      trackEvents,
      interceptLogs,
      status: 'done',
    }
  }
  return {
    orderNo: hit.orderNo,
    lossScope: hit.lossScope,
    categoryName: hit.exceptionCategoryId || '—',
    currentResponsibilityParty: hit.currentResponsibilityParty || '—',
    activeResponsibilityOwner: hit.activeResponsibilityOwner,
    reason: hit.reason,
    confidence: Number.isFinite(hit.confidence) ? hit.confidence.toFixed(2) : String(hit.confidence),
    trackEvents,
    interceptLogs,
    latestResponsibilityTrackMarker: hit.latestResponsibilityTrackMarker ?? null,
    detectedDriverId: deriveDetectedDriverId(hit.latestResponsibilityTrackMarker, trackEvents, interceptLogs),
    needsReview: hit.needsReview ?? false,
    crossCheckedBy: hit.crossCheckedBy ?? null,
    status: 'done',
  }
}

export function useOrderExceptionManagementPage() {
  const { imileToken } = useAppSettings()
  const [activeTab, setActiveTab] = useState<TabId>('analyze')

  const [analyzeOrderText, setAnalyzeOrderText] = useState('')
  const [importedAnalyzeOrders, setImportedAnalyzeOrders] = useState<ImportedAnalyzeOrders | null>(
    null
  )
  const [analyzeAiProvider, setAnalyzeAiProvider] =
    useState<OrderAnalyzeAiProvider>(readStoredAnalyzeAiProvider)
  const [batchAnalyze, setBatchAnalyze] = useState(readStoredBatchAnalyze)

  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeTokenUsage, setAnalyzeTokenUsage] = useState<OrderAnalyzeTokenUsage | null>(null)
  const [lastAnalyzeOrderCount, setLastAnalyzeOrderCount] = useState(0)
  const [analyzeDurationMs, setAnalyzeDurationMs] = useState<number | null>(null)
  const [analyzeApiTiming, setAnalyzeApiTiming] = useState<OrderAnalyzeApiTiming | null>(null)

  const [analysisRows, setAnalysisRows] = useState<AnalysisRow[]>([])
  const [analyzeProgress, setAnalyzeProgress] = useState<AnalyzeProgress | null>(null)
  const analyzeRunIdRef = useRef(0)

  const [regressionCases, setRegressionCases] = useState<RegressionCaseListItem[]>([])
  const [captureOrderNo, setCaptureOrderNo] = useState('')
  const [captureLossScope, setCaptureLossScope] =
    useState<OrderAnalyzeResultItem['lossScope']>('库内丢失')
  const [captureSubType, setCaptureSubType] = useState('扫描员丢失')
  const [captureReason, setCaptureReason] = useState('')
  const [isCapturing, setIsCapturing] = useState(false)
  const [isDeletingRegressionId, setIsDeletingRegressionId] = useState<string | null>(null)
  const [isRunningRegression, setIsRunningRegression] = useState(false)
  const [regressionResults, setRegressionResults] = useState<RegressionCaseResult[]>([])
  const [regressionSummary, setRegressionSummary] = useState<{
    total: number
    passed: number
    failed: number
  } | null>(null)
  const [regressionTokenUsage, setRegressionTokenUsage] = useState<OrderAnalyzeTokenUsage | null>(
    null
  )

  useEffect(() => {
    try {
      localStorage.setItem(ANALYZE_AI_PROVIDER_KEY, analyzeAiProvider)
    } catch {
      /* ignore */
    }
  }, [analyzeAiProvider])

  useEffect(() => {
    try {
      localStorage.setItem(BATCH_ANALYZE_KEY, batchAnalyze ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [batchAnalyze])

  const ensureToken = useCallback((): string | null => {
    const t = imileToken.trim()
    if (!t) {
      showToast('请在右上角系统设置中填写 iMile Bearer Token', 'error')
      return null
    }
    return t
  }, [imileToken])

  const loadRegressionCases = useCallback(async () => {
    try {
      const { cases } = await listRegressionCases()
      setRegressionCases(cases)
    } catch (e) {
      showToast((e as Error).message || '加载用例失败', 'error')
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'regression') {
      void loadRegressionCases()
    }
  }, [activeTab, loadRegressionCases])

  const onAnalyze = useCallback(async () => {
    const token = ensureToken()
    if (!token) return
    const orderNos = parseOrderNumbersUnique(
      [analyzeOrderText, importedAnalyzeOrders?.orderNos.join('\n') ?? ''].filter(Boolean).join('\n')
    )
    if (!orderNos.length) {
      showToast('请填写待分析订单号或导入文件', 'error')
      return
    }
    if (orderNos.length > ORDER_EXCEPTION_ANALYZE_MAX_BATCH) {
      showToast(
        `去重后一次最多分析 ${ORDER_EXCEPTION_ANALYZE_MAX_BATCH} 个订单，请删减后重试`,
        'error'
      )
      return
    }

    const runId = analyzeRunIdRef.current + 1
    analyzeRunIdRef.current = runId
    const isStaleRun = () => analyzeRunIdRef.current !== runId

    setIsAnalyzing(true)
    setAnalysisRows(orderNos.map(createPendingAnalysisRow))
    setAnalyzeProgress({ total: orderNos.length, completed: 0, succeeded: 0, failed: 0 })
    setAnalyzeTokenUsage(null)
    setLastAnalyzeOrderCount(orderNos.length)
    setAnalyzeDurationMs(null)
    setAnalyzeApiTiming(null)
    const analyzeStartedAt = performance.now()

    let succeeded = 0
    let failed = 0

    if (batchAnalyze) {
      setAnalysisRows((prev) =>
        prev.map((row) => ({
          ...row,
          status: 'analyzing' as const,
          reason: '批量分析中…',
        }))
      )

      try {
        const { results, trackInfo, interceptLogs, tokenUsage, timing } = await postOrderExceptionAnalyze({
          imileToken: token,
          orderNos,
          aiProvider: analyzeAiProvider,
        })
        if (isStaleRun()) return

        setAnalysisRows(
          orderNos.map((orderNo) =>
            mapAnalyzeHitToRow(
              orderNo,
              results.find((r) => r.orderNo === orderNo),
              trackInfo,
              interceptLogs
            )
          )
        )
        setAnalyzeTokenUsage(tokenUsage)
        if (timing) setAnalyzeApiTiming(timing)
        succeeded = orderNos.length
        setAnalyzeProgress({
          total: orderNos.length,
          completed: orderNos.length,
          succeeded: orderNos.length,
          failed: 0,
        })
      } catch (e) {
        if (isStaleRun()) return
        const message = (e as Error).message || '分析失败'
        setAnalysisRows((prev) =>
          prev.map((r) => ({
            ...r,
            status: 'error' as const,
            reason: message,
            lossScope: '—',
            categoryName: '—',
            currentResponsibilityParty: '—',
            confidence: '—',
          }))
        )
        failed = orderNos.length
        setAnalyzeProgress({
          total: orderNos.length,
          completed: orderNos.length,
          succeeded: 0,
          failed: orderNos.length,
        })
      }
    } else {
      let accumulatedTokenUsage: OrderAnalyzeTokenUsage | null = null
      let accumulatedApiTiming: OrderAnalyzeApiTiming | null = null

      for (const orderNo of orderNos) {
        if (isStaleRun()) return

        setAnalysisRows((prev) =>
          prev.map((row) =>
            row.orderNo === orderNo
              ? { ...row, status: 'analyzing' as const, reason: '分析中…' }
              : row
          )
        )

        try {
          const { results, trackInfo, interceptLogs, tokenUsage, timing } = await postOrderExceptionAnalyze({
            imileToken: token,
            orderNos: [orderNo],
            aiProvider: analyzeAiProvider,
          })
          if (isStaleRun()) return

          const row = mapAnalyzeHitToRow(
            orderNo,
            results.find((r) => r.orderNo === orderNo),
            trackInfo,
            interceptLogs
          )
          setAnalysisRows((prev) => prev.map((r) => (r.orderNo === orderNo ? row : r)))
          accumulatedTokenUsage = mergeAnalyzeTokenUsage(accumulatedTokenUsage, tokenUsage)
          setAnalyzeTokenUsage(accumulatedTokenUsage)
          if (timing) {
            accumulatedApiTiming = mergeAnalyzeApiTiming(accumulatedApiTiming, timing)
            setAnalyzeApiTiming(accumulatedApiTiming)
          }
          succeeded += 1
        } catch (e) {
          if (isStaleRun()) return
          const message = (e as Error).message || '分析失败'
          setAnalysisRows((prev) =>
            prev.map((r) =>
              r.orderNo === orderNo
                ? {
                    ...r,
                    status: 'error' as const,
                    reason: message,
                    lossScope: '—',
                    categoryName: '—',
                    currentResponsibilityParty: '—',
                    confidence: '—',
                  }
                : r
            )
          )
          failed += 1
        }

        const completed = succeeded + failed
        setAnalyzeProgress({
          total: orderNos.length,
          completed,
          succeeded,
          failed,
        })
      }
    }

    if (isStaleRun()) return

    setAnalyzeDurationMs(Math.round(performance.now() - analyzeStartedAt))
    setIsAnalyzing(false)

    if (failed === 0) {
      showToast('分析完成', 'success')
    } else if (succeeded === 0) {
      showToast('全部分析失败，请检查网络或 Token 后重试', 'error')
    } else {
      showToast(`分析结束：${succeeded} 单成功，${failed} 单失败`, 'error')
    }
  }, [analyzeAiProvider, analyzeOrderText, batchAnalyze, ensureToken, importedAnalyzeOrders])

  const onAnalyzeOrderFileUpload = useCallback(
    async (file: File) => {
      if (isAnalyzing) return

      const result = await parseOrderNumbersFromFile(file)
      if (!result.ok) {
        showToast(result.error, 'error')
        return
      }

      setImportedAnalyzeOrders({ fileName: file.name, orderNos: result.orderNos })

      if (result.orderNos.length > ORDER_EXCEPTION_ANALYZE_MAX_BATCH) {
        showToast(
          `已从 ${file.name} 提取 ${result.orderNos.length} 个订单号，超出单次上限 ${ORDER_EXCEPTION_ANALYZE_MAX_BATCH}，请删减后分析`,
          'error'
        )
        return
      }

      showToast(`已从 ${file.name} 提取 ${result.orderNos.length} 个订单号，点击「开始分析」继续`, 'success')
    },
    [isAnalyzing]
  )

  const onClearImportedAnalyzeOrders = useCallback(() => {
    setImportedAnalyzeOrders(null)
  }, [])

  const onCaptureRegression = useCallback(async () => {
    const token = ensureToken()
    if (!token) return
    const orderNo = captureOrderNo.trim()
    if (!orderNo) {
      showToast('请填写订单号', 'error')
      return
    }

    setIsCapturing(true)
    try {
      await captureRegressionCase({
        imileToken: token,
        orderNo,
        expected: {
          lossScope: captureLossScope,
          exceptionCategoryId: captureSubType,
          reason: captureReason.trim(),
        },
      })
      await loadRegressionCases()
      showToast(`用例 ${orderNo} 已固化`, 'success')
    } catch (e) {
      showToast((e as Error).message || '录入失败', 'error')
    } finally {
      setIsCapturing(false)
    }
  }, [
    captureLossScope,
    captureOrderNo,
    captureReason,
    captureSubType,
    ensureToken,
    loadRegressionCases,
  ])

  const onDeleteRegressionCase = useCallback(
    async (id: string) => {
      setIsDeletingRegressionId(id)
      try {
        await deleteRegressionCase(id)
        await loadRegressionCases()
        showToast('已删除用例', 'success')
      } catch (e) {
        showToast((e as Error).message || '删除失败', 'error')
      } finally {
        setIsDeletingRegressionId(null)
      }
    },
    [loadRegressionCases]
  )

  const onRunRegression = useCallback(async () => {
    if (!regressionCases.length) {
      showToast('暂无回归用例', 'error')
      return
    }

    setIsRunningRegression(true)
    setRegressionResults([])
    setRegressionSummary(null)
    setRegressionTokenUsage(null)
    try {
      const report = await runRegression({ aiProvider: analyzeAiProvider })
      setRegressionResults(report.cases)
      setRegressionSummary(report.summary)
      setRegressionTokenUsage(report.tokenUsage)
      const text =
        report.summary.failed === 0
          ? `回归全部通过（${report.summary.passed}/${report.summary.total}）`
          : `回归完成：${report.summary.passed} 通过，${report.summary.failed} 失败`
      showToast(text, report.summary.failed === 0 ? 'success' : 'error')
    } catch (e) {
      showToast((e as Error).message || '回归测试失败', 'error')
    } finally {
      setIsRunningRegression(false)
    }
  }, [analyzeAiProvider, regressionCases.length])

  return {
    activeTab,
    setActiveTab,
    analyzeOrderText,
    setAnalyzeOrderText,
    analyzeAiProvider,
    setAnalyzeAiProvider,
    batchAnalyze,
    setBatchAnalyze,
    onAnalyze,
    onAnalyzeOrderFileUpload,
    onClearImportedAnalyzeOrders,
    importedAnalyzeOrders,
    isAnalyzing,
    analysisRows,
    analyzeProgress,
    analyzeTokenUsage,
    lastAnalyzeOrderCount,
    analyzeDurationMs,
    analyzeApiTiming,
    regressionCases,
    captureOrderNo,
    setCaptureOrderNo,
    captureLossScope,
    setCaptureLossScope,
    captureSubType,
    setCaptureSubType,
    captureReason,
    setCaptureReason,
    onCaptureRegression,
    isCapturing,
    loadRegressionCases,
    onDeleteRegressionCase,
    isDeletingRegressionId,
    onRunRegression,
    isRunningRegression,
    regressionResults,
    regressionSummary,
    regressionTokenUsage,
  }
}
