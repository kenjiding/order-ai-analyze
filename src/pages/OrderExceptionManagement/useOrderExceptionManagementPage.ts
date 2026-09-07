import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  postInHubWaybillQuery,
  getJobById,
  getJobArtifact,
  runRegression,
  type PublicJob,
  type OrderAnalyzeAiProvider,
  type OrderAnalyzeApiTiming,
  type OrderAnalyzeResultItem,
  type OrderTrackFacts,
  type OrderAnalyzeTokenUsage,
  type RegressionCaseListItem,
  type RegressionCaseResult,
} from './orderExceptionApi'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
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
import {
  type AnalysisRow,
  type AnalyzeProgress,
  type ImportedAnalyzeOrders,
  type SubmittedJobBanner,
} from './analysisTypes'
import { createPendingAnalysisRow, mapAnalyzeHitToRow } from './mapAnalyzeHitToRow'

export type {
  AnalysisRow,
  AnalysisRowStatus,
  AnalyzeProgress,
  ImportedAnalyzeOrders,
  SubmittedJobBanner,
} from './analysisTypes'

const ANALYZE_AI_PROVIDER_KEY = 'order_exception_analyze_ai_v1'
const BATCH_ANALYZE_KEY = 'order_exception_batch_analyze_v1'
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

export type TabId = 'analyze' | 'jobs' | 'regression' | 'warehouse-config' | 'in-hub'

export type InHubQueryMeta = {
  start: string
  end: string
  totalResult: number
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
  console.log('🔄 分配-取消配对(最后一次库内实物确认之后·定子类型):', facts.assignCancelPairWithoutDispatch ? '是' : '否', '| 全轨迹连续循环(≥2组·虚假转运口径):', facts.assignCancelLoopWithoutDispatch ? '是' : '否')
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

export function useOrderExceptionManagementPage() {
  const { t } = useTranslation('orderException')
  const { t: tc } = useTranslation('common')
  const { imileToken } = useAppSettings()
  const scanStationCode = useGlobalFilterStore((state) => state.selectedStations[0])
  const [activeTab, setActiveTab] = useState<TabId>('analyze')

  const [analyzeOrderText, setAnalyzeOrderText] = useState('')
  const [importedAnalyzeOrders, setImportedAnalyzeOrders] = useState<ImportedAnalyzeOrders | null>(
    null
  )
  const [analyzeAiProvider, setAnalyzeAiProvider] =
    useState<OrderAnalyzeAiProvider>(readStoredAnalyzeAiProvider)
  const [batchAnalyze, setBatchAnalyze] = useState(readStoredBatchAnalyze)

  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const isPausedRef = useRef(false)
  const pauseResolveRef = useRef<(() => void) | null>(null)
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

  const [inHubGreaterDays, setInHubGreaterDays] = useState<number | null>(null)
  const [inHubLessDays, setInHubLessDays] = useState<number | null>(null)
  const [isQueryingInHub, setIsQueryingInHub] = useState(false)
  const [inHubQueryMeta, setInHubQueryMeta] = useState<InHubQueryMeta | null>(null)

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
      showToast(t('toast.warehouseConfigSaved'), 'success')
    } catch (e) {
      showToast((e as Error).message || tc('saveFailed'), 'error')
    } finally {
      setIsSavingWarehouseConfig(false)
    }
  }, [warehouseDraftConfig, t, tc])

  const resetWarehouseConfig = useCallback(() => {
    const defaults = cloneDefaultWarehouseConfig()
    setWarehouseDraftConfig(defaults)
    setSelectedWarehouseHubId(defaults.profiles[0]?.hubId ?? null)
    showToast(t('toast.defaultsRestoredNotSaved'), 'success')
  }, [t])

  const ensureToken = useCallback((): string | null => {
    const token = imileToken.trim()
    if (!token) {
      showToast(t('toast.missingImileTokenSettings'), 'error')
      return null
    }
    return token
  }, [imileToken, t])

  const loadRegressionCases = useCallback(async () => {
    try {
      const { cases } = await listRegressionCases()
      setRegressionCases(cases)
    } catch (e) {
      showToast((e as Error).message || t('toast.loadCasesFailed'), 'error')
    }
  }, [t])

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
      if (!silent) showToast((e as Error).message || t('toast.jobsLoadFailed'), 'error')
    } finally {
      setIsJobsLoading(false)
    }
  }, [t])

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
      if (!job) throw new Error(t('toast.jobNotFound'))
      if (job.status !== 'succeeded') throw new Error(t('toast.jobNotFinished'))
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
      showToast(t('toast.loadedResults', { count: orderNos.length }), 'success')
      if (artifact.cancelScanRecheck?.error) {
        showToast(t('toast.cancelScanRecheckIncomplete', { error: artifact.cancelScanRecheck.error }), 'error')
      }
      if (artifact.driverVendorEnrich?.errors.length) {
        showToast(
          t('toast.driverVendorLookupPartial', { error: artifact.driverVendorEnrich.errors[0] }),
          'error',
        )
      }
    } catch (e) {
      showToast((e as Error).message || t('toast.loadResultsFailed'), 'error')
    }
  }, [t])

  const cancelJobById = useCallback(async (jobId: string) => {
    try {
      await cancelJobApi(jobId)
      await refreshJobs()
      showToast(t('toast.jobCancelled'), 'success')
    } catch (e) {
      showToast((e as Error).message || t('toast.cancelFailed'), 'error')
    }
  }, [refreshJobs, t])

  const deleteJobById = useCallback(async (jobId: string) => {
    try {
      await deleteJobApi(jobId)
      setJobsList((prev) => prev.filter((j) => j.id !== jobId))
      showToast(tc('deleted'), 'success')
    } catch (e) {
      showToast((e as Error).message || tc('deleteFailed'), 'error')
    }
  }, [t, tc])

  const retryJob = useCallback(async (job: PublicJob) => {
    const token = imileToken.trim()
    if (!token) {
      showToast(t('toast.missingImileToken'), 'error')
      return
    }
    const orderNos = Array.isArray(job.payload.orderNos) ? (job.payload.orderNos as string[]) : []
    const aiProvider = (job.payload.aiProvider as OrderAnalyzeAiProvider | undefined) ?? 'deepseek'
    if (!orderNos.length) {
      showToast(t('toast.jobNoOrderNos'), 'error')
      return
    }
    try {
      const { jobId } = await postOrderExceptionAnalyzeAsync({ imileToken: token, orderNos, aiProvider, scanStationCode })
      await refreshJobs()
      showToast(
        t('toast.resubmitSuccess', { count: orderNos.length, jobId: jobId.slice(0, 8) }),
        'success',
      )
    } catch (e) {
      showToast((e as Error).message || t('toast.resubmitFailed'), 'error')
    }
  }, [imileToken, refreshJobs, scanStationCode, t])

  const activeJobCount = jobsList.filter((j) => j.status === 'pending' || j.status === 'running').length

  /** 逐单分析循环每轮开始前调用；暂停期间挂起，直到 onResumeAnalyze 被调用 */
  const waitWhilePaused = useCallback(async () => {
    while (isPausedRef.current) {
      await new Promise<void>((resolve) => {
        pauseResolveRef.current = resolve
      })
    }
  }, [])

  const onPauseAnalyze = useCallback(() => {
    isPausedRef.current = true
    setIsPaused(true)
  }, [])

  const onResumeAnalyze = useCallback(() => {
    isPausedRef.current = false
    setIsPaused(false)
    pauseResolveRef.current?.()
    pauseResolveRef.current = null
  }, [])

  const onAnalyze = useCallback(async (explicitOrderNos?: string[]) => {
    const token = ensureToken()
    if (!token) return
    // 必须用 Array.isArray：按钮 onClick={onAnalyze} 会传入 MouseEvent，
    // 若用 ?? 会把事件当成订单号，导致已填写/已导入的单号被忽略。
    const orderNos = Array.isArray(explicitOrderNos)
      ? explicitOrderNos
      : parseOrderNumbersUnique(
          [analyzeOrderText, importedAnalyzeOrders?.orderNos.join('\n') ?? '']
            .filter(Boolean)
            .join('\n')
        )
    if (!orderNos.length) {
      showToast(t('toast.enterOrderNosOrImport'), 'error')
      return
    }
    if (orderNos.length > ORDER_EXCEPTION_ANALYZE_MAX_BATCH) {
      showToast(t('toast.batchLimitExceeded', { max: ORDER_EXCEPTION_ANALYZE_MAX_BATCH }), 'error')
      return
    }

    if (
      isWarehouseConfigLoaded &&
      JSON.stringify(warehouseDraftConfig) !== JSON.stringify(warehouseSavedConfig)
    ) {
      showToast(t('toast.warehouseConfigUnsaved'), 'error')
    }

    const runId = analyzeRunIdRef.current + 1
    analyzeRunIdRef.current = runId
    const isStaleRun = () => analyzeRunIdRef.current !== runId

    isPausedRef.current = false
    setIsPaused(false)
    pauseResolveRef.current = null

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
          scanStationCode,
        })
        if (isStaleRun()) return
        setSubmittedJobBanner({ jobId, orderCount: orderNos.length })
        setAnalysisRows([])
        setAnalyzeProgress(null)
        // 乐观更新 jobs 列表（不等 tab 切换再刷新）
        void refreshJobs()
        showToast(t('toast.batchJobSubmitted', { count: orderNos.length }), 'success')
      } catch (e) {
        if (isStaleRun()) return
        showToast((e as Error).message || t('toast.submitFailed'), 'error')
      } finally {
        setIsAnalyzing(false)
        setAnalyzeDurationMs(null)
      }
      return
    } else {
      let accumulatedTokenUsage: OrderAnalyzeTokenUsage | null = null
      let accumulatedApiTiming: OrderAnalyzeApiTiming | null = null
      let cancelScanRecheckWarned = false
      let driverVendorEnrichWarned = false

      for (const orderNo of orderNos) {
        if (isStaleRun()) return
        await waitWhilePaused()
        if (isStaleRun()) return

        setAnalysisRows((prev) =>
          prev.map((row) =>
            row.orderNo === orderNo
              ? { ...row, status: 'analyzing' as const, reason: t('rowStatus.analyzing') }
              : row
          )
        )

        try {
          const {
            results,
            trackInfo,
            orderInfo,
            interceptLogs,
            tokenUsage,
            timing,
            trackFacts,
            cancelScanRecheck,
            driverVendorEnrich,
          } = await postOrderExceptionAnalyze({
            imileToken: token,
            orderNos: [orderNo],
            aiProvider: analyzeAiProvider,
            scanStationCode,
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
          if (driverVendorEnrich?.errors.length && !driverVendorEnrichWarned) {
            driverVendorEnrichWarned = true
            showToast(t('toast.driverVendorLookupPartial', { error: driverVendorEnrich.errors[0] }), 'error')
          }
          if (cancelScanRecheck?.error && !cancelScanRecheckWarned) {
            cancelScanRecheckWarned = true
            showToast(t('toast.cancelScanRecheckIncomplete', { error: cancelScanRecheck.error }), 'error')
          }
          if (timing) {
            accumulatedApiTiming = mergeAnalyzeApiTiming(accumulatedApiTiming, timing)
            setAnalyzeApiTiming(accumulatedApiTiming)
          }
          succeeded += 1
        } catch (e) {
          if (isStaleRun()) return
          const message = (e as Error).message || t('rowStatus.analyzeFailed')
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

    isPausedRef.current = false
    setIsPaused(false)
    setAnalyzeDurationMs(Math.round(performance.now() - analyzeStartedAt))
    setIsAnalyzing(false)

    if (failed === 0) {
      showToast(t('toast.analyzeComplete'), 'success')
    } else if (succeeded === 0) {
      showToast(t('toast.analyzeAllFailed'), 'error')
    } else {
      showToast(t('toast.analyzePartial', { succeeded, failed }), 'error')
    }
  }, [
    analyzeAiProvider,
    analyzeOrderText,
    batchAnalyze,
    ensureToken,
    importedAnalyzeOrders,
    isWarehouseConfigLoaded,
    refreshJobs,
    scanStationCode,
    t,
    waitWhilePaused,
    warehouseDraftConfig,
    warehouseSavedConfig,
  ])
  // Note: warehouseSavedConfig kept in deps to detect unsaved-changes warning only

  const onAnalyzeInHub = useCallback(async () => {
    const token = ensureToken()
    if (!token) return
    if (!scanStationCode) {
      showToast(t('toast.selectStationFirst'), 'error')
      return
    }
    if (
      inHubGreaterDays == null ||
      inHubLessDays == null ||
      !Number.isFinite(inHubGreaterDays) ||
      !Number.isFinite(inHubLessDays) ||
      inHubGreaterDays < 0 ||
      inHubLessDays < 0
    ) {
      showToast(t('toast.invalidDayRange'), 'error')
      return
    }
    if (inHubLessDays <= inHubGreaterDays) {
      showToast(t('toast.lessMustExceedGreater'), 'error')
      return
    }

    setIsQueryingInHub(true)
    try {
      const { waybillNos, start, end, totalResult } = await postInHubWaybillQuery({
        imileToken: token,
        stationCode: scanStationCode,
        greaterDays: inHubGreaterDays,
        lessDays: inHubLessDays,
      })
      setInHubQueryMeta({ start, end, totalResult })

      if (!waybillNos.length) {
        showToast(t('toast.noInHubWaybills'), 'error')
        return
      }

      setImportedAnalyzeOrders({
        fileName: t('inHub.queryFileName', { start, end }),
        orderNos: waybillNos,
      })
      setActiveTab('analyze')
      await onAnalyze(waybillNos)
    } catch (e) {
      showToast((e as Error).message || t('toast.inHubQueryFailed'), 'error')
    } finally {
      setIsQueryingInHub(false)
    }
  }, [ensureToken, inHubGreaterDays, inHubLessDays, onAnalyze, scanStationCode, t])

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
          t('toast.importExceedsLimit', {
            fileName: file.name,
            count: result.orderNos.length,
            max: ORDER_EXCEPTION_ANALYZE_MAX_BATCH,
          }),
          'error',
        )
        return
      }

      showToast(
        t('toast.importSuccess', { fileName: file.name, count: result.orderNos.length }),
        'success',
      )
    },
    [isAnalyzing, t],
  )

  const onClearImportedAnalyzeOrders = useCallback(() => {
    setImportedAnalyzeOrders(null)
  }, [])

  const onCaptureRegression = useCallback(async () => {
    const token = ensureToken()
    if (!token) return
    const orderNo = captureOrderNo.trim()
    if (!orderNo) {
      showToast(t('toast.enterOrderNo'), 'error')
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
      showToast(t('toast.caseCaptured', { orderNo }), 'success')
    } catch (e) {
      showToast((e as Error).message || t('toast.captureFailed'), 'error')
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
    t,
  ])

  const onDeleteRegressionCase = useCallback(
    async (id: string) => {
      setIsDeletingRegressionId(id)
      try {
        await deleteRegressionCase(id)
        await loadRegressionCases()
        showToast(t('toast.caseDeleted'), 'success')
      } catch (e) {
        showToast((e as Error).message || tc('deleteFailed'), 'error')
      } finally {
        setIsDeletingRegressionId(null)
      }
    },
    [loadRegressionCases, t, tc],
  )

  const onRunRegression = useCallback(async () => {
    if (!regressionCases.length) {
      showToast(t('toast.noRegressionCases'), 'error')
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
          ? t('toast.regressionAllPassed', {
              passed: report.summary.passed,
              total: report.summary.total,
            })
          : t('toast.regressionFinished', {
              passed: report.summary.passed,
              failed: report.summary.failed,
            })
      showToast(text, report.summary.failed === 0 ? 'success' : 'error')
    } catch (e) {
      showToast((e as Error).message || t('toast.regressionFailed'), 'error')
    } finally {
      setIsRunningRegression(false)
    }
  }, [analyzeAiProvider, regressionCases.length, t])

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
    isPaused,
    onPauseAnalyze,
    onResumeAnalyze,
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
    inHubGreaterDays,
    setInHubGreaterDays,
    inHubLessDays,
    setInHubLessDays,
    isQueryingInHub,
    inHubQueryMeta,
    onAnalyzeInHub,
  }
}
