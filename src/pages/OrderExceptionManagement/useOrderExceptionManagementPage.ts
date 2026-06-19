import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ORDER_EXCEPTION_ANALYZE_MAX_BATCH,
  captureRegressionCase,
  cancelJobApi,
  deleteJobApi,
  deleteRegressionCase,
  listRegressionCases,
  listJobsApi,
  postOrderExceptionAnalyze,
  postOrderExceptionAnalyzeAsync,
  getJobById,
  getJobArtifact,
  runRegression,
  type PublicJob,
  type OrderAnalyzeInterceptLog,
  type OrderAnalyzeAiProvider,
  type OrderAnalyzeApiTiming,
  type OrderAnalyzeResultItem,
  type OrderAnalyzeResponsibilityOwner,
  type OrderTrackFacts,
  type ResponsibilityTrackMarker,
  type OrderAnalyzeTokenUsage,
  type OrderQueryInfo,
  type RegressionCaseListItem,
  type RegressionCaseResult,
} from './orderExceptionApi'
import type { TrackEvent } from './types'
import { useAppSettings } from '../../context/AppSettingsContext'
import { parseOrderNumbersFromFile } from './parseOrderNumbersFromFile'
import { parseOrderNumbersUnique } from '../../utils/orderNoInput'
import { showToast } from '../../utils/toast'
import { cloneDefaultWarehouseConfig } from './warehouseConfig/defaults'
import { fetchWarehouseConfig, saveWarehouseConfigApi } from './warehouseConfig/warehouseConfigApi'
import type { WarehouseConfigDto } from './warehouseConfig/types'
import { validateWarehouseConfig } from './warehouseConfig/validateWarehouseConfig'
import { DEFAULT_POST_FILTER_CONFIG } from './postFilter/defaults'
import { applyPostFilter } from './postFilter/applyPostFilter'
import type { PostFilterConfig } from './postFilter/types'

const ANALYZE_AI_PROVIDER_KEY = 'order_exception_analyze_ai_v1'
const BATCH_ANALYZE_KEY = 'order_exception_batch_analyze_v1'
const TRACK_DRIVER_ID_RE = /\bID\s*[:：]\s*(D[0-9A-Za-z-]+)/i
const JOBS_POLL_INTERVAL_MS = 3000
const JOBS_LIST_TYPE = 'order.analyze'

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

export type TabId = 'analyze' | 'jobs' | 'regression' | 'warehouse-config'

export type SubmittedJobBanner = {
  jobId: string
  orderCount: number
}

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
  orderInfo?: OrderQueryInfo | null
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

function logOrderAnalysisFacts(orderNo: string, facts: OrderTrackFacts | undefined): void {
  if (!facts) return
  console.group(`%c[程序化关键判断点] ${orderNo}`, 'color:#1677ff;font-weight:bold')
  console.log('📅 今天 / 最后轨迹更新:', facts.todayStr, '/', facts.lastEventTime, `(距今 ${facts.lastEventDaysDiff} 天)`)
  console.log('📦 当前最新事件:', facts.latestEventKind)
  console.log('🏭 当前责任主体:', facts.activeResponsibilityOwner, '|', facts.activeWarehouseName ?? '未知仓库', facts.activeWarehouseKnown ? '' : '(未配置)')
  console.log('⏱️ 当前仓库丢失阈值:', facts.activeWarehouseLossTimeoutDays, '天')
  console.log('📍 责任段状态:', facts.activeSegmentStatus, '| 起算:', facts.activeSegmentStartTime ?? '-', `(距今 ${facts.activeSegmentDaysDiff} 天)`)
  console.log('✅ 真实操作员扫描:', facts.hasRealOperatorScan ? '有' : '无')
  if (facts.inWarehouseStartTime) {
    console.log('🔒 库内责任起算:', facts.inWarehouseStartTime, `(距今 ${facts.inWarehouseDaysDiff} 天)`, '|', facts.inWarehouseBasis ?? '')
    console.log('   库内责任已被出库覆盖:', facts.inWarehouseStartSupersededByDispatch ? '是' : '否')
  } else {
    console.log('🔒 库内责任起算: 无法确定')
  }
  if (facts.lastDispatchedOutTime) {
    console.log('🚚 最近出库时间:', facts.lastDispatchedOutTime, `(距今 ${facts.outWarehouseDaysDiff} 天)`, '| 出库后有回仓:', facts.lastDispatchHasReturn ? '是' : '否')
  }
  if (facts.finalResponsibilityOwner) {
    console.log('⚖️ 最终责任点:', facts.finalResponsibilityOwner, '|', facts.finalResponsibilityStartTime ?? '-', `(距今 ${facts.finalResponsibilityDaysDiff} 天)`)
    console.log('   依据:', facts.finalResponsibilityBasis ?? '-')
  }
  console.log('📊 派送分配次数:', facts.deliveryAssignmentCount, '| 取消分配次数:', facts.deliveryCancelCount, '| 问题件次数:', facts.problemCount)
  console.log('🔄 分配-取消循环(无出库):', facts.assignCancelLoopWithoutDispatch ? '是' : '否')
  if (facts.hasDeliveryCompletion) {
    console.log('✔️ 正常完结:', facts.deliveryCompletionTime ?? '-', facts.deliveryCompletionEvidence ?? '')
  }
  if (facts.latestOrderExceptionClosed) console.log('🔚 订单异常完结终态: 是')
  if (facts.stationLossCompletion) console.log('🏪 承运商站内丢包标记: 是')
  if (facts.merchantDestroyConfirmed) console.log('🗑️ 商家销毁确认: 是 |', facts.merchantDestroyConfirmTime ?? '-')
  if (facts.merchantAbandonActive) console.log('🗑️ 商家Abandon销毁: 是')
  if (facts.merchantStorageActive) console.log('📦 商家暂存: 是')
  if (facts.merchantReturnClosed) console.log('↩️ 退返商家闭环: 是')
  if (facts.merchantReturnRequested) console.log('↩️ 退返商家待处理: 是')
  if (facts.unknownWarehouseInActiveSegment) console.log('⚠️ 当前仓库未匹配配置: 是')
  if (facts.hasInterceptLogs) {
    console.log('🚫 阻断日志最新时间:', facts.latestInterceptTime ?? '-', '| 操作员:', facts.latestInterceptUserCode ?? '-', `(${facts.latestInterceptOperatorType ?? '未知'})`)
    if (facts.interceptAdjustedResponsibilityOwner) {
      console.log('   阻断日志调整后责任:', facts.interceptAdjustedResponsibilityOwner, `(距今 ${facts.interceptAdjustedResponsibilityDaysDiff} 天)`, '|', facts.interceptAdjustedResponsibilityBasis ?? '')
    }
  }
  console.groupEnd()
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
  interceptLogsByOrder: Record<string, OrderAnalyzeInterceptLog[]>,
  orderInfoByOrder: Record<string, OrderQueryInfo | null>
): AnalysisRow {
  const trackEvents = trackInfo[orderNo] ?? []
  const interceptLogs = interceptLogsByOrder[orderNo] ?? []
  const orderInfo = orderInfoByOrder[orderNo] ?? null
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
      orderInfo,
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
    orderInfo,
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
  const [submittedJobBanner, setSubmittedJobBanner] = useState<SubmittedJobBanner | null>(null)
  const analyzeRunIdRef = useRef(0)

  const [jobsList, setJobsList] = useState<PublicJob[]>([])
  const [isJobsLoading, setIsJobsLoading] = useState(false)
  const jobsPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  const [warehouseDraftConfig, setWarehouseDraftConfig] = useState<WarehouseConfigDto>(() =>
    cloneDefaultWarehouseConfig()
  )
  const [warehouseSavedConfig, setWarehouseSavedConfig] = useState<WarehouseConfigDto>(() =>
    cloneDefaultWarehouseConfig()
  )
  const [selectedWarehouseHubId, setSelectedWarehouseHubId] = useState<string | null>(
    () => cloneDefaultWarehouseConfig().profiles[0]?.hubId ?? null
  )
  const [isSavingWarehouseConfig, setIsSavingWarehouseConfig] = useState(false)
  const [isWarehouseConfigLoaded, setIsWarehouseConfigLoaded] = useState(false)

  const [postFilterDraft, setPostFilterDraft] = useState<PostFilterConfig>(DEFAULT_POST_FILTER_CONFIG)
  const [appliedPostFilter, setAppliedPostFilter] = useState<PostFilterConfig>(DEFAULT_POST_FILTER_CONFIG)

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

  useEffect(() => {
    void (async () => {
      try {
        const remote = await fetchWarehouseConfig()
        if (remote) {
          setWarehouseDraftConfig(remote)
          setWarehouseSavedConfig(remote)
          setSelectedWarehouseHubId(remote.profiles[0]?.hubId ?? null)
        }
      } catch {
        /* 加载失败静默回退到默认值 */
      } finally {
        setIsWarehouseConfigLoaded(true)
      }
    })()
  }, [])

  const runPostFilter = useCallback(() => {
    setAppliedPostFilter(postFilterDraft)
  }, [postFilterDraft])

  const filteredAnalysisRows = useMemo(
    () => applyPostFilter(analysisRows, appliedPostFilter),
    [analysisRows, appliedPostFilter]
  )

  const persistWarehouseConfig = useCallback(async () => {
    const issues = validateWarehouseConfig(warehouseDraftConfig)
    if (issues.length) {
      showToast(issues[0].message, 'error')
      return
    }
    setIsSavingWarehouseConfig(true)
    try {
      await saveWarehouseConfigApi(warehouseDraftConfig)
      setWarehouseSavedConfig(warehouseDraftConfig)
      showToast('仓库配置已保存', 'success')
    } catch (e) {
      showToast((e as Error).message || '保存失败', 'error')
    } finally {
      setIsSavingWarehouseConfig(false)
    }
  }, [warehouseDraftConfig])

  const resetWarehouseConfig = useCallback(() => {
    const defaults = cloneDefaultWarehouseConfig()
    setWarehouseDraftConfig(defaults)
    setSelectedWarehouseHubId(defaults.profiles[0]?.hubId ?? null)
    showToast('已恢复默认配置（尚未保存）', 'success')
  }, [])

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

  const refreshJobs = useCallback(async (silent = false) => {
    setIsJobsLoading(true)
    try {
      const { jobs } = await listJobsApi({ type: JOBS_LIST_TYPE, limit: 30 })
      setJobsList(jobs)
      const hasActive = jobs.some((j) => j.status === 'pending' || j.status === 'running')
      if (!hasActive && jobsPollingRef.current) {
        clearInterval(jobsPollingRef.current)
        jobsPollingRef.current = null
      }
    } catch (e) {
      if (!silent) showToast((e as Error).message || '任务列表加载失败', 'error')
    } finally {
      setIsJobsLoading(false)
    }
  }, [])

  // 挂载时立即拉取一次，badge 和列表不依赖用户先切 Tab
  useEffect(() => {
    void refreshJobs(true)
  }, [refreshJobs])

  // 在任务队列 Tab 时开启轮询
  useEffect(() => {
    if (activeTab !== 'jobs') return
    void refreshJobs(true)
    jobsPollingRef.current = setInterval(() => void refreshJobs(true), JOBS_POLL_INTERVAL_MS)
    return () => {
      if (jobsPollingRef.current) clearInterval(jobsPollingRef.current)
      jobsPollingRef.current = null
    }
  }, [activeTab, refreshJobs])

  const loadJobResults = useCallback(async (jobId: string) => {
    try {
      const job = await getJobById(jobId)
      if (!job) throw new Error('任务不存在')
      if (job.status !== 'succeeded') throw new Error('任务尚未完成')
      const artifact = await getJobArtifact(jobId)
      const orderNos = Array.isArray(job.payload.orderNos) ? (job.payload.orderNos as string[]) : []
      const rows = orderNos.map((orderNo) =>
        mapAnalyzeHitToRow(
          orderNo,
          artifact.results.find((r) => r.orderNo === orderNo),
          artifact.trackInfo,
          artifact.interceptLogs,
          artifact.orderInfo ?? {}
        )
      )
      if (artifact.trackFacts) {
        rows.forEach((row) => logOrderAnalysisFacts(row.orderNo, artifact.trackFacts![row.orderNo]))
      }
      setAnalysisRows(rows)
      setAnalyzeTokenUsage(artifact.tokenUsage)
      setAnalyzeProgress({
        total: orderNos.length,
        completed: orderNos.length,
        succeeded: orderNos.length,
        failed: 0,
      })
      setLastAnalyzeOrderCount(orderNos.length)
      setSubmittedJobBanner(null)
      setActiveTab('analyze')
      showToast(`已加载 ${orderNos.length} 单分析结果`, 'success')
    } catch (e) {
      showToast((e as Error).message || '加载结果失败', 'error')
    }
  }, [])

  const cancelJobById = useCallback(async (jobId: string) => {
    try {
      await cancelJobApi(jobId)
      await refreshJobs()
      showToast('任务已取消', 'success')
    } catch (e) {
      showToast((e as Error).message || '取消失败', 'error')
    }
  }, [refreshJobs])

  const deleteJobById = useCallback(async (jobId: string) => {
    try {
      await deleteJobApi(jobId)
      setJobsList((prev) => prev.filter((j) => j.id !== jobId))
      showToast('已删除', 'success')
    } catch (e) {
      showToast((e as Error).message || '删除失败', 'error')
    }
  }, [])

  const retryJob = useCallback(async (job: PublicJob) => {
    const token = imileToken.trim()
    if (!token) {
      showToast('请先填写 iMile Bearer Token', 'error')
      return
    }
    const orderNos = Array.isArray(job.payload.orderNos) ? (job.payload.orderNos as string[]) : []
    const aiProvider = (job.payload.aiProvider as OrderAnalyzeAiProvider | undefined) ?? 'deepseek'
    if (!orderNos.length) {
      showToast('任务中未找到订单号', 'error')
      return
    }
    try {
      const { jobId } = await postOrderExceptionAnalyzeAsync({ imileToken: token, orderNos, aiProvider })
      await refreshJobs()
      showToast(`重新提交成功（${orderNos.length} 单），任务 ID: ${jobId.slice(0, 8)}…`, 'success')
    } catch (e) {
      showToast((e as Error).message || '重新提交失败', 'error')
    }
  }, [imileToken, refreshJobs])

  const activeJobCount = jobsList.filter((j) => j.status === 'pending' || j.status === 'running').length

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

    if (
      isWarehouseConfigLoaded &&
      JSON.stringify(warehouseDraftConfig) !== JSON.stringify(warehouseSavedConfig)
    ) {
      showToast('仓库配置有未保存修改，本次分析将使用上次保存的版本', 'error')
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
      try {
        const { jobId } = await postOrderExceptionAnalyzeAsync({
          imileToken: token,
          orderNos,
          aiProvider: analyzeAiProvider,
        })
        if (isStaleRun()) return
        setSubmittedJobBanner({ jobId, orderCount: orderNos.length })
        setAnalysisRows([])
        setAnalyzeProgress(null)
        // 乐观更新 jobs 列表（不等 tab 切换再刷新）
        void refreshJobs()
        showToast(`批量任务已提交（${orderNos.length} 单），在「任务队列」标签查看进度`, 'success')
      } catch (e) {
        if (isStaleRun()) return
        showToast((e as Error).message || '提交失败', 'error')
      } finally {
        setIsAnalyzing(false)
        setAnalyzeDurationMs(null)
      }
      return
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
          const { results, trackInfo, orderInfo, interceptLogs, tokenUsage, timing, trackFacts } =
            await postOrderExceptionAnalyze({
            imileToken: token,
            orderNos: [orderNo],
            aiProvider: analyzeAiProvider,
          })
          if (isStaleRun()) return

          const row = mapAnalyzeHitToRow(
            orderNo,
            results.find((r) => r.orderNo === orderNo),
            trackInfo,
            interceptLogs,
            orderInfo ?? {}
          )
          if (trackFacts) logOrderAnalysisFacts(orderNo, trackFacts[orderNo])
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
  }, [
    analyzeAiProvider,
    analyzeOrderText,
    batchAnalyze,
    ensureToken,
    importedAnalyzeOrders,
    isWarehouseConfigLoaded,
    refreshJobs,
    warehouseDraftConfig,
    warehouseSavedConfig,
  ])
  // Note: warehouseSavedConfig kept in deps to detect unsaved-changes warning only

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
    submittedJobBanner,
    dismissSubmittedJobBanner: () => setSubmittedJobBanner(null),
    analyzeTokenUsage,
    lastAnalyzeOrderCount,
    analyzeDurationMs,
    analyzeApiTiming,
    jobsList,
    isJobsLoading,
    activeJobCount,
    refreshJobs,
    loadJobResults,
    cancelJobById,
    deleteJobById,
    retryJob,
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
    warehouseDraftConfig,
    setWarehouseDraftConfig,
    warehouseSavedConfig,
    selectedWarehouseHubId,
    setSelectedWarehouseHubId,
    persistWarehouseConfig,
    resetWarehouseConfig,
    isSavingWarehouseConfig,
    postFilterDraft,
    setPostFilterDraft,
    appliedPostFilter,
    runPostFilter,
    filteredAnalysisRows,
  }
}
