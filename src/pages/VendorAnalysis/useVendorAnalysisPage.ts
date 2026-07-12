import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Dayjs } from 'dayjs'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useAuthStore } from '../../stores/authStore'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
import { postFeishuPushCard } from '../PushNotifications/feishuWebhookTestApi'
import type {
  DriverPerformanceRow,
  VendorMetricRow,
} from './vendorAnalysisTypes'
import type { VendorAnalyzeSummary } from './vendorAnalysisSummary'
import {
  cancelJobApi,
  deleteJobApi,
  getJobById,
  getVendorAnalyzeSnapshot,
  listJobs,
  postVendorAnalyzeAsync,
  updateVendorAnalyzeConfig,
  type PublicJob,
  type VendorAnalyzeArtifact,
  type VendorAnalyzeAsyncParams,
} from './vendorAnalysisApi'
import {
  isSupplierPushEligible,
  useSupplierConfigScopeBinding,
  useSupplierPushCatalog,
} from '../../shared/supplierPushConfig'
import { fleetConfigsToVendorPushConfigs } from '../PushNotifications/supplierConfigAdapter'
import { ALL_METRIC_KEYS } from './metricsRegistry'
import { prevWorkday } from './sortingWorkday'

const VENDOR_ANALYSIS_PUSH_SCOPE = 'vendor-analysis.push' as const
import { nowIn, resolveRegionTz } from '../../utils/ausTimezone'

/** 单任务进度轮询间隔（新建分析提交后跟踪当前任务） */
const JOB_POLL_INTERVAL_MS = 3000
/** 任务队列列表自动刷新间隔 */
const JOBS_LIST_POLL_INTERVAL_MS = 10_000
/** 供应商分析任务在通用 jobs 队列里的 type，与 server/src/jobs/handlers/vendorAnalyzeHandler.ts 的 VENDOR_ANALYZE_JOB_TYPE 保持一致 */
const JOBS_LIST_TYPE = 'vendor.analyze'

export type TabId = 'analyze' | 'preview'

function normalizeVendorCode(code: string): string {
  return code.trim()
}

/** 从任务 payload 读取「输出配置」（推送供应商范围 + AI 开关）；老任务缺字段时兜底空/开 */
function readJobOutputConfig(payload: Record<string, unknown>): { pushEnabledIds: string[]; aiSummaryEnabled: boolean } {
  const pushEnabledIds = Array.isArray(payload.pushEnabledIds)
    ? (payload.pushEnabledIds as unknown[]).filter((s): s is string => typeof s === 'string')
    : []
  return { pushEnabledIds, aiSummaryEnabled: payload.aiSummaryEnabled !== false }
}

/**
 * 从任务 payload 反推出重新提交所需的筛选参数（complaintStart/complaintEnd 未落库，从 startTime/endTime 反推）。
 * 不带 metricKeys：payload 里的 dataSources 无法唯一反推回指标勾选集合，重试统一按全量抓取（更安全的简化取舍）。
 */
function deriveAnalyzeParamsFromPayload(payload: Record<string, unknown>): VendorAnalyzeAsyncParams | null {
  const str = (key: string): string => (typeof payload[key] === 'string' ? (payload[key] as string) : '')
  const stationCodes = Array.isArray(payload.stationCodes)
    ? (payload.stationCodes as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : []
  const referenceDate = str('referenceDate')
  const startTime = str('startTime')
  const endTime = str('endTime')
  const before11Date = str('before11Date')
  if (!referenceDate || !startTime || !endTime || !before11Date || stationCodes.length === 0) return null

  return {
    stationCodes,
    referenceDate,
    complaintStart: startTime.slice(0, 10),
    complaintEnd: endTime.slice(0, 10),
    startTime,
    endTime,
    ticketStartTime: str('ticketStartTime'),
    ticketEndTime: str('ticketEndTime'),
    yesterdayStartTime: str('yesterdayStartTime'),
    yesterdayEndTime: str('yesterdayEndTime'),
    dayBeforeStartTime: str('dayBeforeStartTime'),
    dayBeforeEndTime: str('dayBeforeEndTime'),
    unprocessedStartTime: str('unprocessedStartTime'),
    before11Date,
    dayBeforeDate: str('dayBeforeDate'),
  }
}


/** 「数据预览」展示的一份分析结果：worker 落库的汇总 + 前端加载时刻 */
export type FetchedData = VendorAnalyzeSummary & {
  fetchedAt: Date
}

export function useVendorAnalysisPage() {
  const { imileToken } = useAppSettings()
  const { selectedStations } = useGlobalFilterStore()
  const regionCode = useAuthStore((s) => s.user?.regionCode ?? null)
  const targetTz = useMemo(() => resolveRegionTz(regionCode), [regionCode])

  const [referenceDate, setReferenceDate] = useState<Dayjs | null>(() => nowIn(targetTz))
  const [complaintDateRange, setComplaintDateRange] = useState<[Dayjs, Dayjs] | null>(() => {
    const today = nowIn(targetTz)
    const dow = today.day() // 0=Sun, 1=Mon, ..., 6=Sat
    const daysFromMonday = dow === 0 ? 6 : dow - 1
    const lastMonday = today.subtract(daysFromMonday + 7, 'day')
    const lastSunday = today.subtract(daysFromMonday + 1, 'day')
    return [lastMonday, lastSunday]
  })

  const catalog = useSupplierPushCatalog()
  const configs = useMemo(
    () => fleetConfigsToVendorPushConfigs(catalog.configs),
    [catalog.configs],
  )
  const configsLoading = catalog.loading
  const scopeBinding = useSupplierConfigScopeBinding(VENDOR_ANALYSIS_PUSH_SCOPE, catalog.configs)

  // 「数据预览」展示的这份任务自身的输出配置（查看/新建完成时从任务 payload 写入），
  // 与「新建分析」抽屉里的全局 scopeBinding / aiSummaryEnabled 相互独立：预览的推送与快照按这份走。
  const [viewedJobId, setViewedJobId] = useState<string | null>(null)
  const [viewedPushEnabledIds, setViewedPushEnabledIds] = useState<string[]>([])
  const [viewedAiSummaryEnabled, setViewedAiSummaryEnabled] = useState(true)

  const applyJobOutputConfig = useCallback((jobId: string, payload: Record<string, unknown>) => {
    const { pushEnabledIds, aiSummaryEnabled } = readJobOutputConfig(payload)
    setViewedJobId(jobId)
    setViewedPushEnabledIds(pushEnabledIds)
    setViewedAiSummaryEnabled(aiSummaryEnabled)
  }, [])

  // 预览的推送目标 = 该任务 push 范围 ∩ 当前有效（已配置 Webhook）的供应商配置
  const selectedPushConfigs = useMemo(() => {
    const enabled = new Set(viewedPushEnabledIds)
    return fleetConfigsToVendorPushConfigs(
      catalog.configs.filter((c) => enabled.has(c.id) && isSupplierPushEligible(c)),
    )
  }, [catalog.configs, viewedPushEnabledIds])

  // 指标配置：每次新建分析的本地选择，默认全选，不落库（无服务端偏好）
  const [metricSelection, setMetricSelection] = useState<string[]>(ALL_METRIC_KEYS)
  // AI 分析总结开关：生成快照/推送时是否调用 AI，动作级设置，默认开
  const [aiSummaryEnabled, setAiSummaryEnabled] = useState(true)
  // 「数据预览」Tab 当前展示的这份结果按哪些指标渲染（由新建完成 / 查看历史写入，与上面的新建选择相互独立）
  const [viewedMetricKeys, setViewedMetricKeys] = useState<string[]>(ALL_METRIC_KEYS)
  const viewedMetricSet = useMemo(() => new Set(viewedMetricKeys), [viewedMetricKeys])

  const [fetchedData, setFetchedData] = useState<FetchedData | null>(null)
  const [dataFetching, setDataFetching] = useState(false)
  const [jobError, setJobError] = useState<string | null>(null)
  const [isPushingAll, setIsPushingAll] = useState(false)

  const [activeTab, setActiveTab] = useState<TabId>('analyze')
  const [jobsList, setJobsList] = useState<PublicJob[]>([])
  const [isJobsLoading, setIsJobsLoading] = useState(false)
  /** 任务队列里点击「查看数据」时，正在加载哪个任务的完整结果（结果体积可能很大，需要明确的加载中反馈） */
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null)
  const jobsPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeTabRef = useRef<TabId>(activeTab)
  const refreshJobsRef = useRef<(silent?: boolean) => Promise<void>>(async () => {})

  // 「11点前出仓率」「24H派签率」反映的是抓取那一刻的实时状态，参考日期非当天时数据可能不准确；
  // 此处仅用于在新建分析抽屉里给出提示，不再过滤掉这些指标。
  // 按日历日字符串比较，避免 DatePicker 返回的 dayjs 与 nowIn(targetTz) 时区对象不一致导致误判
  const isReferenceDateToday = useMemo(
    () => !!referenceDate && referenceDate.format('YYYY-MM-DD') === nowIn(targetTz).format('YYYY-MM-DD'),
    [referenceDate, targetTz],
  )

  // 筛选条件（参考日期/客诉时间/站点）现在只定义「下一次新建分析」的参数，
  // 与「数据预览」Tab 正在展示的这份结果相互独立，改动筛选不再清空已展示的结果。

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  // 展示一份分析结果：新建完成 / 查看历史都用它整体替换当前「数据预览」展示的结果（不再做增量合并）
  const applyArtifact = useCallback((artifact: VendorAnalyzeArtifact) => {
    setFetchedData({ ...artifact, fetchedAt: new Date() })
  }, [])

  const buildEnqueueParams = useCallback(() => {
    if (!referenceDate || !complaintDateRange) return null

    // 客诉 & 揽收量：使用客诉成立量时间
    const startTime = complaintDateRange[0].format('YYYY-MM-DD 00:00:00')
    const endTime = complaintDateRange[1].format('YYYY-MM-DD 23:59:59')

    // 参考日期作为"今天"，推导两个日期敏感指标的目标日：
    // 出仓率目标日 = 往前第一个工作日；派签率目标日 = 出仓率目标日再往前一个工作日。
    // 避开周六/日（不分拣、无数据）导致周一/周二取到空数据。详见 sortingWorkday.ts。
    const yesterday = prevWorkday(referenceDate)
    const dayBefore = prevWorkday(yesterday)
    // 未处理工单：参考日期上周周一 00:00:00 ~ 昨天 23:59:59
    const lastMonday = referenceDate.startOf('week').subtract(6, 'day')

    return {
      stationCodes: selectedStations,
      referenceDate: referenceDate.format('YYYY-MM-DD'),
      complaintStart: complaintDateRange[0].format('YYYY-MM-DD'),
      complaintEnd: complaintDateRange[1].format('YYYY-MM-DD'),
      startTime,
      endTime,
      ticketStartTime: startTime,
      ticketEndTime: endTime,
      yesterdayStartTime: yesterday.format('YYYY-MM-DD 00:00:00'),
      yesterdayEndTime: yesterday.format('YYYY-MM-DD 23:59:59'),
      dayBeforeStartTime: dayBefore.format('YYYY-MM-DD 00:00:00'),
      dayBeforeEndTime: dayBefore.format('YYYY-MM-DD 23:59:59'),
      unprocessedStartTime: lastMonday.format('YYYY-MM-DD 00:00:00'),
      before11Date: yesterday.format('YYYY-MM-DD'),
      dayBeforeDate: dayBefore.format('YYYY-MM-DD'),
      // 勾选的指标决定后端抓取哪些数据源；未勾选的不请求。日期敏感指标（11点前出仓率/24H派签率）
      // 与其他指标一致直接提交，参考日期非当天时只在抽屉里提示可能不准确，不再过滤。
      metricKeys: metricSelection,
      // 输出配置随任务落库：把新建时的全局推送范围 + AI 开关快照进本任务，之后可在任务队列单独编辑
      pushEnabledIds: scopeBinding.enabledIds,
      aiSummaryEnabled,
    }
  }, [referenceDate, complaintDateRange, selectedStations, metricSelection, scopeBinding.enabledIds, aiSummaryEnabled])

  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  const stopJobsPolling = useCallback(() => {
    if (jobsPollingRef.current) {
      clearInterval(jobsPollingRef.current)
      jobsPollingRef.current = null
    }
  }, [])

  const startJobsPolling = useCallback(() => {
    if (activeTabRef.current !== 'analyze') return
    if (jobsPollingRef.current) return
    jobsPollingRef.current = setInterval(() => {
      void refreshJobsRef.current(true)
    }, JOBS_LIST_POLL_INTERVAL_MS)
  }, [])

  const refreshJobs = useCallback(async (silent = false) => {
    setIsJobsLoading(true)
    try {
      const { jobs } = await listJobs({ type: JOBS_LIST_TYPE, limit: 30 })
      setJobsList(jobs)
      const hasActive = jobs.some((j) => j.status === 'pending' || j.status === 'running')
      if (hasActive) startJobsPolling()
      else stopJobsPolling()
    } catch (e) {
      if (!silent) showToast((e as Error).message || '任务列表加载失败', 'error')
    } finally {
      setIsJobsLoading(false)
    }
  }, [stopJobsPolling, startJobsPolling])

  // 让轮询定时器里的 refreshJobsRef 始终指向最新的 refreshJobs（在 effect 里同步，避免渲染期写 ref）
  useEffect(() => {
    refreshJobsRef.current = refreshJobs
  }, [refreshJobs])

  const pollJob = useCallback((jobId: string, metricKeys: string[]) => {
    stopPolling()
    pollTimerRef.current = setInterval(async () => {
      try {
        const job = await getJobById(jobId)
        // 同步写回 jobsList，让任务队列「进度」列在列表轮询间隔内也能更新
        setJobsList((prev) => {
          const index = prev.findIndex((j) => j.id === jobId)
          if (index < 0) return prev
          const next = [...prev]
          next[index] = job
          return next
        })
        if (job.status === 'succeeded') {
          stopPolling()
          const snapshotRes = await getVendorAnalyzeSnapshot(jobId)
          if (!snapshotRes.ok) {
            setDataFetching(false)
            setJobError(snapshotRes.error)
            showToast(`数据获取失败: ${snapshotRes.error}`, 'error')
            return
          }
          applyArtifact(snapshotRes.data)
          setViewedMetricKeys(metricKeys)
          applyJobOutputConfig(jobId, job.payload as Record<string, unknown>)
          // 完成态切到「数据预览」前先刷新任务队列，避免切走后队列轮询停掉、完成态漏进列表
          void refreshJobs(true)
          setActiveTab('preview')
          setDataFetching(false)
          showToast('数据获取成功', 'success')
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          stopPolling()
          setDataFetching(false)
          setJobError(job.error ?? '任务失败')
          showToast(`数据获取失败: ${job.error ?? '未知错误'}`, 'error')
        }
        // pending / running：继续轮询
      } catch (err) {
        // 单次轮询失败不中断整体流程，等待下一次重试
        console.warn('[vendor-analysis] 轮询任务状态失败', err)
      }
    }, JOB_POLL_INTERVAL_MS)
  }, [stopPolling, applyArtifact, refreshJobs, applyJobOutputConfig])

  const enqueueAndAttach = useCallback(async () => {
    if (!referenceDate) { showToast('请先选择数据参考日期', 'error'); return }
    if (!complaintDateRange) { showToast('请先选择客诉成立量时间', 'error'); return }
    if (selectedStations.length === 0) { showToast('请先选择责任站点', 'error'); return }

    const params = buildEnqueueParams()
    if (!params) return

    // 每次新建都按当前指标选择全量提交（新建态与查看态互相独立，没有「增量补拉」这一说）
    const requestParams = params
    const submittedKeys = params.metricKeys

    // 让状态更新发生在微任务中，避免在 effect 里同步触发级联渲染
    await Promise.resolve()

    setDataFetching(true)
    setJobError(null)

    try {
      let res = await postVendorAnalyzeAsync(imileToken, { ...requestParams, force: false })
      if (!res.ok) {
        setDataFetching(false)
        showToast(`任务提交失败: ${res.error}`, 'error')
        return
      }

      // 幂等命中的是一个已失败/取消的旧任务：静默重新提交一次，换成一个可用的新任务
      if (res.data.status === 'failed' || res.data.status === 'cancelled') {
        res = await postVendorAnalyzeAsync(imileToken, { ...requestParams, force: true })
        if (!res.ok) {
          setDataFetching(false)
          showToast(`任务提交失败: ${res.error}`, 'error')
          return
        }
      }

      // 返回时已经是 running/succeeded，说明命中了别处（同筛选条件 / 其他用户）已经在跑的任务，而非本次全新创建

      // 提交成功后立即刷新任务队列，让新任务马上出现在列表里，而不用等下一次 10 秒轮询
      void refreshJobs(true)

      if (res.data.status === 'succeeded') {
        // 幂等命中一个此前已完成的任务：直接取 snapshot，无需轮询
        const snapshotRes = await getVendorAnalyzeSnapshot(res.data.jobId)
        if (!snapshotRes.ok) {
          setDataFetching(false)
          showToast(`数据获取失败: ${snapshotRes.error}`, 'error')
          return
        }
        applyArtifact(snapshotRes.data)
        setViewedMetricKeys(submittedKeys)
        // 幂等命中的是既有任务：以该任务自身落库的输出配置为准（可能与当前全局 scope 不同）
        try {
          const job = await getJobById(res.data.jobId)
          applyJobOutputConfig(res.data.jobId, job.payload as Record<string, unknown>)
        } catch { /* 取不到任务不阻断展示，预览沿用上一份配置 */ }
        setActiveTab('preview')
        setDataFetching(false)
        showToast('已获取此前完成的数据', 'success')
        return
      }

      pollJob(res.data.jobId, submittedKeys)
    } catch {
      setDataFetching(false)
      showToast('任务提交失败，请重试', 'error')
    }
  }, [referenceDate, complaintDateRange, selectedStations, imileToken, buildEnqueueParams, applyArtifact, pollJob, refreshJobs, applyJobOutputConfig])

  const fetchData = enqueueAndAttach

  useEffect(() => stopJobsPolling, [stopJobsPolling])

  // 挂载时立即拉取一次，任务队列 Tab 的角标不依赖用户先切过去；用 setTimeout 让 setState 脱离 effect 的同步提交阶段
  useEffect(() => {
    const timer = setTimeout(() => void refreshJobs(true), 0)
    return () => clearTimeout(timer)
  }, [refreshJobs])

  // 停留在「分析任务」Tab 时拉列表并由 refreshJobs 按是否有进行中任务启停轮询；离开后清定时器
  useEffect(() => {
    if (activeTab !== 'analyze') return
    const timer = setTimeout(() => void refreshJobs(true), 0)
    return () => {
      clearTimeout(timer)
      stopJobsPolling()
    }
  }, [activeTab, refreshJobs, stopJobsPolling])

  const loadJobResults = useCallback(async (jobId: string) => {
    setLoadingJobId(jobId)
    try {
      const job = await getJobById(jobId)
      if (job.status !== 'succeeded') throw new Error('任务尚未完成')
      const snapshotRes = await getVendorAnalyzeSnapshot(jobId)
      if (!snapshotRes.ok) throw new Error(snapshotRes.error)
      const artifact = snapshotRes.data

      // 查看历史 = 把这份结果展示到「数据预览」Tab（只读回放），不触碰「新建分析」的表单/指标选择
      applyArtifact(artifact)
      // 预览按该任务提交时的指标渲染；老任务未落 metricKeys（迁移前）视为全量
      const jobMetricKeys = Array.isArray(job.payload.metricKeys)
        ? (job.payload.metricKeys as unknown[]).filter((k): k is string => typeof k === 'string')
        : null
      setViewedMetricKeys(jobMetricKeys ?? ALL_METRIC_KEYS)
      applyJobOutputConfig(jobId, job.payload as Record<string, unknown>)
      setJobError(null)
      setActiveTab('preview')

      const jobStations = Array.isArray(job.payload.stationCodes)
        ? (job.payload.stationCodes as unknown[]).filter((s): s is string => typeof s === 'string')
        : []
      const stationsMatch = jobStations.length === selectedStations.length
        && jobStations.every((s) => selectedStations.includes(s))
      if (!stationsMatch) {
        showToast(`已加载该任务的分析数据（该任务基于站点「${jobStations.join('、') || '—'}」统计，与当前已选站点不同，指标会按当前站点重新过滤）`, 'info')
      } else {
        showToast('已加载该任务的分析数据', 'success')
      }
    } catch (e) {
      showToast((e as Error).message || '加载结果失败', 'error')
    } finally {
      setLoadingJobId(null)
    }
  }, [applyArtifact, selectedStations, applyJobOutputConfig])

  // 编辑某任务的输出配置（推送供应商范围 + AI 开关），不重跑分析；若正在预览该任务则同步生效。
  const updateJobConfig = useCallback(
    async (jobId: string, config: { pushEnabledIds: string[]; aiSummaryEnabled: boolean }) => {
      const res = await updateVendorAnalyzeConfig(jobId, config)
      if (!res.ok) { showToast(`保存失败: ${res.error}`, 'error'); return false }
      if (jobId === viewedJobId) {
        setViewedPushEnabledIds(config.pushEnabledIds)
        setViewedAiSummaryEnabled(config.aiSummaryEnabled)
      }
      await refreshJobs(true)
      showToast('已保存', 'success')
      return true
    },
    [viewedJobId, refreshJobs],
  )

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
    const params = deriveAnalyzeParamsFromPayload(job.payload)
    if (!params) { showToast('任务参数不完整，无法重新提交', 'error'); return }
    try {
      const res = await postVendorAnalyzeAsync(imileToken, { ...params, force: true })
      if (!res.ok) { showToast(`重新提交失败: ${res.error}`, 'error'); return }
      await refreshJobs()
      showToast('重新提交成功', 'success')
    } catch (e) {
      showToast((e as Error).message || '重新提交失败', 'error')
    }
  }, [imileToken, refreshJobs])

  const activeJobCount = jobsList.filter((j) => j.status === 'pending' || j.status === 'running').length

  // 供应商指标行：直接读 worker 落库的汇总，按 vendorCode join 配置（名称/昵称/id）；
  // 以 configs 为主循环，已配置但本次无数据的供应商补 0（保持既有展示行为）。
  const vendorMetrics = useMemo<VendorMetricRow[]>(() => {
    if (!fetchedData) return []
    const byVendor = new Map(fetchedData.vendors.map((v) => [v.vendorCode, v]))
    return configs.map((config) => {
      const vendorCode = normalizeVendorCode(config.vendorCode)
      const s = byVendor.get(vendorCode)
      return {
        id: config.id,
        vendorCode,
        vendorName: config.vendorName,
        supplierNickname: config.supplierNickname,
        complaintCount: s?.complaintCount ?? 0,
        waybillCount: s?.waybillCount ?? 0,
        complaintRate: s?.complaintRate ?? 0,
        unprocessedTicketCount: s?.unprocessedTicketCount ?? 0,
        unprocessedTicketOrderCodes: s?.unprocessedTicketOrderCodes ?? [],
        longTailCount: s?.longTailCount ?? 0,
        before11ExitRate: s?.before11ExitRate ?? null,
        before11ExitVolume: s?.before11ExitVolume ?? null,
        before11TotalReceived: s?.before11TotalReceived ?? null,
        before11UnmetWaybillNos: s?.before11UnmetWaybillNos ?? [],
        dispatchRate24hText: s?.dispatchRate24hText ?? null,
        notMet24hSignCount: s?.notMet24hSignCount ?? null,
        dispatch24hTotal: s?.dispatch24hTotal ?? null,
        dispatch24hCount: s?.dispatch24hCount ?? null,
        dispatch24hUnmetWaybillNos: s?.dispatch24hUnmetWaybillNos ?? [],
        complaintOrderCodes: s?.complaintOrderCodes ?? [],
      }
    })
  }, [fetchedData, configs])

  // 司机绩效：读汇总里每供应商的 drivers，补上配置的 vendorName（汇总不含供应商名）。
  const driverPerformanceByVendor = useMemo<Record<string, DriverPerformanceRow[]>>(() => {
    if (!fetchedData) return {}
    const byVendor = new Map(fetchedData.vendors.map((v) => [v.vendorCode, v]))
    const result: Record<string, DriverPerformanceRow[]> = {}
    for (const config of configs) {
      const vendorCode = normalizeVendorCode(config.vendorCode)
      const s = byVendor.get(vendorCode)
      result[vendorCode] = (s?.drivers ?? []).map((d) => ({
        ...d,
        vendorCode,
        vendorName: config.vendorName,
      }))
    }
    return result
  }, [fetchedData, configs])

  const pushAll = useCallback(async () => {
    if (!fetchedData) { showToast('请先点击「获取数据」', 'error'); return }
    if (selectedStations.length === 0) { showToast('请先选择责任站点', 'error'); return }

    const enabledConfigs = selectedPushConfigs
    if (enabledConfigs.length === 0) {
      showToast('请先在下方启用要推送的供应商（须已配置 Webhook）', 'error')
      return
    }

    setIsPushingAll(true)

    const metricByVendor = new Map(vendorMetrics.map((m) => [m.vendorCode, m]))
    const fmt = (s: string) => s.slice(5, 10).replace('-', '/')
    const dateLabel = `${fmt(fetchedData.startTime)}—${fmt(fetchedData.endTime)}`
    const ticketDateLabel = `${fmt(fetchedData.ticketStartTime)}—${fmt(fetchedData.ticketEndTime)}`
    const stationLabel = fetchedData.stationCodes.join('、')

    let successCount = 0
    let failCount = 0

    for (const config of enabledConfigs) {
      const m = metricByVendor.get(normalizeVendorCode(config.vendorCode))
      const ratePercent = ((m?.complaintRate ?? 0) * 100).toFixed(2)
      const before11ExitPercent = m?.before11ExitRate != null
        ? (m.before11ExitRate * 100).toFixed(2)
        : '—'

      const card = buildVendorFeishuCard({
        vendorName: config.vendorName,
        dateLabel,
        ticketDateLabel,
        stationLabel,
        complaintCount: m?.complaintCount ?? 0,
        waybillCount: m?.waybillCount ?? 0,
        ratePercent,
        before11ExitPercent,
        before11ExitVolume: m?.before11ExitVolume ?? null,
        before11TotalReceived: m?.before11TotalReceived ?? null,
        dispatchRate24hText: m?.dispatchRate24hText ?? null,
        notMet24hSignCount: m?.notMet24hSignCount ?? null,
        unprocessedTicketCount: m?.unprocessedTicketCount ?? 0,
        longTailCount: m?.longTailCount ?? 0,
        pushDescription: config.pushDescription ?? '',
      })

      const res = await postFeishuPushCard({
        pushScope: 'vendor-analysis',
        webhookUrl: config.webhookUrl,
        signingSecret: config.signingSecret ?? undefined,
        card,
      })

      if (res.ok) {
        successCount++
      } else {
        failCount++
        const errMsg = 'error' in res ? res.error : '未知错误'
        console.warn(`[vendor-push] 「${config.vendorName}」推送失败: ${errMsg}`)
      }
    }

    setIsPushingAll(false)

    if (failCount === 0) {
      showToast(`全部 ${successCount} 个配置已成功推送至飞书群`, 'success')
    } else if (successCount === 0) {
      showToast(`推送失败，共 ${failCount} 个配置发送异常`, 'error')
    } else {
      showToast(`推送完成：${successCount} 成功 · ${failCount} 失败`, 'warning')
    }
  }, [fetchedData, vendorMetrics, selectedStations, selectedPushConfigs])

  return {
    referenceDate,
    setReferenceDate,
    complaintDateRange,
    setComplaintDateRange,
    selectedStations,
    catalog,
    configs,
    configsLoading,
    scopeBinding,
    selectedPushConfigs,
    fetchedData,
    dataFetching,
    jobError,
    fetchData,
    isPushingAll,
    pushAll,
    vendorMetrics,
    driverPerformanceByVendor,
    metricSelection,
    setMetricSelection,
    aiSummaryEnabled,
    setAiSummaryEnabled,
    // 预览展示的这份任务自身的 AI 开关（openSnapshot 用它，而非新建抽屉的全局开关）
    viewedAiSummaryEnabled,
    // 预览展示的这份任务 id（发布日报 / 分享链接按它绑定）
    viewedJobId,
    viewedPushEnabledIds,
    viewedMetricKeys,
    viewedMetricSet,
    isReferenceDateToday,
    activeTab,
    setActiveTab,
    jobsList,
    isJobsLoading,
    loadingJobId,
    activeJobCount,
    refreshJobs,
    loadJobResults,
    updateJobConfig,
    cancelJobById,
    deleteJobById,
    retryJob,
  }
}

function metricColumn(label: string, content: string): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: `${label}\n${content}` } }],
  }
}

function buildVendorFeishuCard(params: {
  vendorName: string
  dateLabel: string
  ticketDateLabel: string
  stationLabel: string
  complaintCount: number
  waybillCount: number
  ratePercent: string
  before11ExitPercent: string
  before11ExitVolume: number | null
  before11TotalReceived: number | null
  dispatchRate24hText: string | null
  notMet24hSignCount: number | null
  unprocessedTicketCount: number
  longTailCount: number
  pushDescription: string
}): Record<string, unknown> {
  const {
    vendorName, dateLabel, ticketDateLabel, stationLabel,
    complaintCount, waybillCount, ratePercent, before11ExitPercent,
    before11ExitVolume, before11TotalReceived,
    dispatchRate24hText, notMet24hSignCount,
    unprocessedTicketCount, longTailCount, pushDescription,
  } = params

  const rateNum = parseFloat(ratePercent)
  const headerTemplate = rateNum >= 3 ? 'red' : rateNum >= 1 ? 'orange' : 'blue'
  const rateColor = rateNum >= 3 ? 'red' : rateNum >= 1 ? 'orange' : 'green'
  const before11Num = before11ExitPercent === '—' ? null : parseFloat(before11ExitPercent)
  const before11Color = before11Num == null
    ? 'grey'
    : before11Num >= 98
      ? 'green'
      : before11Num >= 95
        ? 'orange'
        : 'red'
  const dispatch24hRateNum = dispatchRate24hText ? parseFloat(dispatchRate24hText) : null
  const dispatch24hColor = dispatch24hRateNum == null
    ? 'grey'
    : dispatch24hRateNum >= 92
      ? 'green'
      : dispatch24hRateNum >= 75
        ? 'orange'
        : 'red'
  const dispatch24hDisplay = dispatchRate24hText ?? '—'
  const notMet24hDisplay = notMet24hSignCount == null ? '—' : String(notMet24hSignCount)
  const pendingColor = (n: number) => n > 0 ? 'orange' : 'green'

  const dateLine = ticketDateLabel !== dateLabel
    ? `📅 应揽量 ${dateLabel} · 客诉统计 ${ticketDateLabel}`
    : `📅 ${dateLabel}`

  const footerElements: Record<string, unknown>[] = pushDescription
    ? [{ tag: 'hr' }, { tag: 'note', elements: [{ tag: 'plain_text', content: pushDescription }] }]
    : []

  return {
    schema: '2.0',
    header: {
      title: { tag: 'plain_text', content: vendorName },
      subtitle: { tag: 'plain_text', content: '供应商数据分析报告' },
      template: headerTemplate,
    },
    body: {
      direction: 'vertical',
      elements: [
        {
          tag: 'div',
          text: { tag: 'lark_md', content: `${dateLine}\n📍 ${stationLabel}` },
        },
        { tag: 'hr' },
        { tag: 'div', text: { tag: 'lark_md', content: '**核心指标**' } },
        {
          tag: 'column_set',
          flex_mode: 'none',
          background_style: 'grey',
          columns: [
            metricColumn(
              '客诉率',
              `<font color='${rateColor}'>**${ratePercent}%**</font>\n客诉量 ${complaintCount} 件 · 揽收量 ${waybillCount} 件`,
            ),
            metricColumn(
              '11点前出仓率',
              `<font color='${before11Color}'>**${before11ExitPercent}${before11ExitPercent === '—' ? '' : '%'}**</font>${before11ExitVolume != null && before11TotalReceived != null ? `\n${before11ExitVolume} / ${before11TotalReceived} 件` : ''}`,
            ),
            metricColumn(
              '24小时派签率',
              `<font color='${dispatch24hColor}'>**${dispatch24hDisplay}**</font>`,
            ),
            metricColumn(
              '24小时签收未达标',
              `<font color='${notMet24hSignCount != null && notMet24hSignCount > 0 ? 'orange' : 'green'}'>**${notMet24hDisplay}**</font>${notMet24hSignCount != null ? ' 件' : ''}`,
            ),
          ],
        },
        { tag: 'div', text: { tag: 'lark_md', content: '**待处理事项**' } },
        {
          tag: 'column_set',
          flex_mode: 'none',
          background_style: 'grey',
          columns: [
            metricColumn('未处理工单', `<font color='${pendingColor(unprocessedTicketCount)}'>**${unprocessedTicketCount}**</font> 件`),
            metricColumn('长尾单', `<font color='${pendingColor(longTailCount)}'>**${longTailCount}**</font> 件`),
          ],
        },
        ...footerElements,
      ],
    },
  }
}
