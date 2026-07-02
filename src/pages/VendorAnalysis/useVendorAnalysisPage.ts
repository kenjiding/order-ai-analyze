import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
import { postFeishuPushCard } from '../PushNotifications/feishuWebhookTestApi'
import type {
  Before11ExitRateResult,
  ComplaintTicketRow,
  DriverPerformanceRow,
  DriverReturnRawRow,
  DriverWaybillRow,
  HubUnprocessedTicketRow,
  LongTailOrderRow,
  NormalUnprocessedTicketRow,
  UnprocessedTicketsData,
  VendorMetricRow,
  VendorOption,
  VendorPushConfig,
  VendorPushConfigDraft,
  WaybillRow,
} from './vendorAnalysisTypes'
import {
  cancelJobApi,
  createConfig,
  deleteConfig,
  deleteJobApi,
  fetchVendors,
  getJobById,
  getVendorAnalyzeSnapshot,
  listJobs,
  loadConfigs,
  postVendorAnalyzeAsync,
  updateConfig,
  type PublicJob,
  type VendorAnalyzeArtifact,
  type VendorAnalyzeAsyncParams,
} from './vendorAnalysisApi'
import { AUS_TZ, fromIMileTime, iMileTimeMs, nowIn } from '../../utils/ausTimezone'

/** 任务轮询间隔，与 OrderExceptionManagement 里的既有节奏保持一致 */
const JOB_POLL_INTERVAL_MS = 3000
/** 供应商分析任务在通用 jobs 队列里的 type，与 server/src/jobs/handlers/vendorAnalyzeHandler.ts 的 VENDOR_ANALYZE_JOB_TYPE 保持一致 */
const JOBS_LIST_TYPE = 'vendor.analyze'

export type TabId = 'analyze' | 'jobs'

export type VendorAnalyzeJobProgress = {
  phase?: string
  message?: string
  percent?: number
  step?: number
  totalSteps?: number
}

function normalizeVendorCode(code: string): string {
  return code.trim()
}

/** 从任务 payload 反推出重新提交所需的筛选参数（complaintStart/complaintEnd 未落库，从 startTime/endTime 反推）。 */
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


export type FetchedData = {
  tickets: ComplaintTicketRow[]
  waybills: WaybillRow[]
  unprocessedTickets: UnprocessedTicketsData
  longTailOrders: LongTailOrderRow[]
  before11ExitRateByVendor: Record<string, Before11ExitRateResult>
  driverYesterdayWaybills: DriverWaybillRow[]
  driverDayBeforeWaybills: DriverWaybillRow[]
  driverReturnRows: DriverReturnRawRow[]
  fetchedAt: Date
  startTime: string
  endTime: string
  ticketStartTime: string
  ticketEndTime: string
  /** 11点前出仓率：昨天 */
  before11Date: string
  /** 24小时派签率数据日期：参考日期的前天 */
  dayBeforeDate: string
}

export function useVendorAnalysisPage() {
  const { imileToken } = useAppSettings()
  const { selectedStations } = useGlobalFilterStore()

  const [referenceDate, setReferenceDate] = useState<Dayjs | null>(() => nowIn(AUS_TZ.Adelaide))
  const [complaintDateRange, setComplaintDateRange] = useState<[Dayjs, Dayjs] | null>(() => {
    const today = nowIn(AUS_TZ.Adelaide)
    const dow = today.day() // 0=Sun, 1=Mon, ..., 6=Sat
    const daysFromMonday = dow === 0 ? 6 : dow - 1
    const lastMonday = today.subtract(daysFromMonday + 7, 'day')
    const lastSunday = today.subtract(daysFromMonday + 1, 'day')
    return [lastMonday, lastSunday]
  })

  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [vendorsLoading, setVendorsLoading] = useState(false)

  const [configs, setConfigs] = useState<VendorPushConfig[]>([])
  const [configsLoading, setConfigsLoading] = useState(false)

  const [fetchedData, setFetchedData] = useState<FetchedData | null>(null)
  const [dataFetching, setDataFetching] = useState(false)
  const [jobProgress, setJobProgress] = useState<VendorAnalyzeJobProgress | null>(null)
  const [jobError, setJobError] = useState<string | null>(null)
  /** 点击「获取数据」时命中了别处（同筛选条件跨用户共享）已经在跑/已完成的任务，而非本次全新创建 */
  const [jobReused, setJobReused] = useState(false)
  const [isPushingAll, setIsPushingAll] = useState(false)

  const [activeTab, setActiveTab] = useState<TabId>('analyze')
  const [jobsList, setJobsList] = useState<PublicJob[]>([])
  const [isJobsLoading, setIsJobsLoading] = useState(false)
  /** 任务队列里点击「查看数据」时，正在加载哪个任务的完整结果（结果体积可能很大，需要明确的加载中反馈） */
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null)
  const jobsPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    setVendorsLoading(true)
    void fetchVendors(imileToken).then((res) => {
      setVendorsLoading(false)
      if (res.ok) setVendors(res.data)
      else showToast(`供应商加载失败: ${res.error}`, 'error')
    })

    setConfigsLoading(true)
    void loadConfigs().then((res) => {
      setConfigsLoading(false)
      if (res.ok) setConfigs(res.data)
      else showToast(`推送配置加载失败: ${res.error}`, 'error')
    })
  }, [imileToken])

  const handleReferenceDateChange = useCallback((date: Dayjs | null) => {
    setReferenceDate(date)
    if (fetchedData) {
      setFetchedData(null)
      showToast('参考日期已变更，请重新获取数据', 'info')
    }
  }, [fetchedData])

  const handleComplaintDateRangeChange = useCallback((range: [Dayjs, Dayjs] | null) => {
    setComplaintDateRange(range)
    if (fetchedData) {
      setFetchedData(null)
      showToast('客诉成立量时间已变更，请重新获取数据', 'info')
    }
  }, [fetchedData])

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const applyArtifact = useCallback((artifact: VendorAnalyzeArtifact) => {
    setFetchedData({ ...artifact, fetchedAt: new Date() })
  }, [])

  const buildEnqueueParams = useCallback(() => {
    if (!referenceDate || !complaintDateRange) return null

    // 客诉 & 揽收量：使用客诉成立量时间
    const startTime = complaintDateRange[0].format('YYYY-MM-DD 00:00:00')
    const endTime = complaintDateRange[1].format('YYYY-MM-DD 23:59:59')

    // 参考日期作为"今天"，推导昨天、前天
    const yesterday = referenceDate.subtract(1, 'day')
    const dayBefore = referenceDate.subtract(2, 'day')
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
    }
  }, [referenceDate, complaintDateRange, selectedStations])

  const pollJob = useCallback((jobId: string) => {
    stopPolling()
    pollTimerRef.current = setInterval(async () => {
      try {
        const job = await getJobById(jobId)
        setJobProgress(job.progress as VendorAnalyzeJobProgress)
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
  }, [stopPolling, applyArtifact])

  const enqueueAndAttach = useCallback(async () => {
    if (!referenceDate) { showToast('请先选择数据参考日期', 'error'); return }
    if (!complaintDateRange) { showToast('请先选择客诉成立量时间', 'error'); return }
    if (selectedStations.length === 0) { showToast('请先选择责任站点', 'error'); return }

    const params = buildEnqueueParams()
    if (!params) return

    // 让状态更新发生在微任务中，避免在 effect 里同步触发级联渲染
    await Promise.resolve()

    setDataFetching(true)
    setJobError(null)
    setJobProgress(null)
    setJobReused(false)

    try {
      let res = await postVendorAnalyzeAsync(imileToken, { ...params, force: false })
      if (!res.ok) {
        setDataFetching(false)
        showToast(`任务提交失败: ${res.error}`, 'error')
        return
      }

      // 幂等命中的是一个已失败/取消的旧任务：静默重新提交一次，换成一个可用的新任务
      if (res.data.status === 'failed' || res.data.status === 'cancelled') {
        res = await postVendorAnalyzeAsync(imileToken, { ...params, force: true })
        if (!res.ok) {
          setDataFetching(false)
          showToast(`任务提交失败: ${res.error}`, 'error')
          return
        }
      }

      // 返回时已经是 running/succeeded，说明命中了别处（同筛选条件 / 其他用户）已经在跑的任务，而非本次全新创建
      setJobReused(res.data.status === 'running' || res.data.status === 'succeeded')

      if (res.data.status === 'succeeded') {
        // 幂等命中一个此前已完成的任务：直接取 snapshot，无需轮询
        const snapshotRes = await getVendorAnalyzeSnapshot(res.data.jobId)
        if (!snapshotRes.ok) {
          setDataFetching(false)
          showToast(`数据获取失败: ${snapshotRes.error}`, 'error')
          return
        }
        applyArtifact(snapshotRes.data)
        setDataFetching(false)
        showToast('已获取此前完成的数据', 'success')
        return
      }

      pollJob(res.data.jobId)
    } catch {
      setDataFetching(false)
      showToast('任务提交失败，请重试', 'error')
    }
  }, [referenceDate, complaintDateRange, selectedStations, imileToken, buildEnqueueParams, applyArtifact, pollJob])

  const fetchData = enqueueAndAttach

  const stopJobsPolling = useCallback(() => {
    if (jobsPollingRef.current) {
      clearInterval(jobsPollingRef.current)
      jobsPollingRef.current = null
    }
  }, [])

  useEffect(() => stopJobsPolling, [stopJobsPolling])

  const refreshJobs = useCallback(async (silent = false) => {
    setIsJobsLoading(true)
    try {
      const { jobs } = await listJobs({ type: JOBS_LIST_TYPE, limit: 30 })
      setJobsList(jobs)
      const hasActive = jobs.some((j) => j.status === 'pending' || j.status === 'running')
      if (!hasActive) stopJobsPolling()
    } catch (e) {
      if (!silent) showToast((e as Error).message || '任务列表加载失败', 'error')
    } finally {
      setIsJobsLoading(false)
    }
  }, [stopJobsPolling])

  // 挂载时立即拉取一次，任务队列 Tab 的角标不依赖用户先切过去；用 setTimeout 让 setState 脱离 effect 的同步提交阶段
  useEffect(() => {
    const timer = setTimeout(() => void refreshJobs(true), 0)
    return () => clearTimeout(timer)
  }, [refreshJobs])

  // 停留在任务队列 Tab 时开启轮询，离开后自动停止
  useEffect(() => {
    if (activeTab !== 'jobs') return
    const timer = setTimeout(() => void refreshJobs(true), 0)
    jobsPollingRef.current = setInterval(() => void refreshJobs(true), JOB_POLL_INTERVAL_MS)
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

      setReferenceDate(dayjs(artifact.referenceDate))
      setComplaintDateRange([dayjs(artifact.startTime.slice(0, 10)), dayjs(artifact.endTime.slice(0, 10))])
      applyArtifact(artifact)
      setJobError(null)
      setJobReused(false)
      setActiveTab('analyze')

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
  }, [applyArtifact, selectedStations])

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

  const indexedData = useMemo(() => {
    if (!fetchedData) return null
    const stationSet = new Set(selectedStations)

    const waybillsByVendor = new Map<string, WaybillRow[]>()
    for (const w of fetchedData.waybills) {
      const key = w.courierVendorCode ?? ''
      let arr = waybillsByVendor.get(key)
      if (!arr) { arr = []; waybillsByVendor.set(key, arr) }
      arr.push(w)
    }

    const ticketsByVendor = new Map<string, ComplaintTicketRow[]>()
    for (const t of fetchedData.tickets) {
      if (stationSet.size > 0 && !stationSet.has(t.relatedResponsibleHubCode ?? '')) continue
      const key = t.responsibleDeptCode ?? ''
      let arr = ticketsByVendor.get(key)
      if (!arr) { arr = []; ticketsByVendor.set(key, arr) }
      arr.push(t)
    }

    const longTailByVendor = new Map<string, LongTailOrderRow[]>()
    for (const o of fetchedData.longTailOrders) {
      const key = o.driverVendorCode ?? ''
      let arr = longTailByVendor.get(key)
      if (!arr) { arr = []; longTailByVendor.set(key, arr) }
      arr.push(o)
    }

    const unprocessedCountByVendor = new Map<string, number>()
    const { normalTickets, complaintTickets, arbitrationTickets } = fetchedData.unprocessedTickets
    for (const t of normalTickets) {
      const row = t as NormalUnprocessedTicketRow
      if (stationSet.size > 0 && !stationSet.has(row.currentHandleStationCode ?? '')) continue
      const key = row.currentHandleCode ?? ''
      unprocessedCountByVendor.set(key, (unprocessedCountByVendor.get(key) ?? 0) + 1)
    }
    for (const t of [...complaintTickets, ...arbitrationTickets]) {
      const row = t as HubUnprocessedTicketRow
      if (stationSet.size > 0 && !stationSet.has(row.relatedResponsibleHubCode ?? '')) continue
      const key = row.responsibleDeptCode ?? ''
      unprocessedCountByVendor.set(key, (unprocessedCountByVendor.get(key) ?? 0) + 1)
    }

    // 24H 派签率：前天运单，按站点过滤后按供应商统计达标情况
    const dispatch24hByVendor = new Map<string, { total: number; met: number; unmetNos: string[] }>()
    for (const row of fetchedData.driverDayBeforeWaybills) {
      const vendorCode = row.courierVendorCode ?? ''
      if (!vendorCode) continue
      // 按最新派件网点过滤：lastScanSiteCode 必须在选中站点内
      if (stationSet.size > 0 && !stationSet.has(row.lastScanSiteCode ?? '')) continue
      if (!row.deliveryTime) continue

      const deliveryAdelaide = fromIMileTime(row.deliveryTime, AUS_TZ.Adelaide)
      const deliveryMs = deliveryAdelaide.valueOf()
      const signMs = row.signDate ? iMileTimeMs(row.signDate) : null
      const problemMs = row.lastProblemDate ? iMileTimeMs(row.lastProblemDate) : null
      const dow = deliveryAdelaide.day() // 0=Sun,1=Mon,...,6=Sat

      let met = false
      if (dow >= 1 && dow <= 4) {
        // 周一~周四：signDate 或 lastProblemDate 距 deliveryTime <= 24h 之一达标即算
        const within24h = (ms: number | null) => ms != null && ms - deliveryMs <= 24 * 60 * 60 * 1000
        met = within24h(signMs) || within24h(problemMs)
      } else {
        // 周五(5)、周六(6)、周日(0)：下周一 23:59:59（阿德莱德）前签收达标
        const daysToMonday = dow === 0 ? 1 : dow === 5 ? 3 : 2
        const nextMondayMs = deliveryAdelaide
          .add(daysToMonday, 'day')
          .hour(23).minute(59).second(59).millisecond(0)
          .valueOf()
        met = signMs != null && signMs <= nextMondayMs
      }

      let stat = dispatch24hByVendor.get(vendorCode)
      if (!stat) { stat = { total: 0, met: 0, unmetNos: [] }; dispatch24hByVendor.set(vendorCode, stat) }
      stat.total += 1
      if (met) {
        stat.met += 1
      } else {
        const wbNo = row.waybillNo ?? ''
        if (wbNo) stat.unmetNos.push(wbNo)
      }
    }

    // 11点前未出仓单号：按供应商聚合（无站点过滤，与 before11ExitRate 口径一致）
    const before11UnmetByVendor = new Map<string, string[]>()
    for (const row of fetchedData.driverYesterdayWaybills) {
      if (row.before11Exit) continue
      const vendorCode = row.courierVendorCode ?? ''
      if (!vendorCode) continue
      const wbNo = row.waybillNo ?? ''
      if (!wbNo) continue
      let arr = before11UnmetByVendor.get(vendorCode)
      if (!arr) { arr = []; before11UnmetByVendor.set(vendorCode, arr) }
      arr.push(wbNo)
    }

    return { waybillsByVendor, ticketsByVendor, longTailByVendor, unprocessedCountByVendor, stationSet, dispatch24hByVendor, before11UnmetByVendor }
  }, [fetchedData, selectedStations])

  const pushAll = useCallback(async () => {
    if (!fetchedData || !indexedData) { showToast('请先点击「获取数据」', 'error'); return }
    if (selectedStations.length === 0) { showToast('请先选择责任站点', 'error'); return }

    const enabledConfigs = configs.filter((c) => !c.isDisabled && c.webhookUrl.trim())
    if (enabledConfigs.length === 0) {
      showToast('没有可用的推送配置（已全部禁用或缺少 Webhook 地址）', 'error')
      return
    }

    setIsPushingAll(true)

    const { waybillsByVendor, ticketsByVendor, longTailByVendor, unprocessedCountByVendor } = indexedData
    const fmt = (s: string) => s.slice(5, 10).replace('-', '/')
    const dateLabel = `${fmt(fetchedData.startTime)}—${fmt(fetchedData.endTime)}`
    const ticketDateLabel = `${fmt(fetchedData.ticketStartTime)}—${fmt(fetchedData.ticketEndTime)}`
    const stationLabel = selectedStations.join('、')

    let successCount = 0
    let failCount = 0

    for (const config of enabledConfigs) {
      const complaintCount = ticketsByVendor.get(config.vendorCode)?.length ?? 0
      const waybillCount = waybillsByVendor.get(config.vendorCode)?.length ?? 0
      const complaintRate = waybillCount > 0 ? complaintCount / waybillCount : 0
      const ratePercent = (complaintRate * 100).toFixed(2)

      const unprocessedTicketCount = unprocessedCountByVendor.get(config.vendorCode) ?? 0
      const longTailCount = longTailByVendor.get(config.vendorCode)?.length ?? 0
      const before11 = fetchedData.before11ExitRateByVendor[config.vendorCode]
      const dispatch24h = indexedData.dispatch24hByVendor.get(config.vendorCode)
      const before11ExitRate = before11?.before11ExitRate ?? null
      const before11ExitPercent = before11ExitRate != null
        ? (before11ExitRate * 100).toFixed(2)
        : '—'
      const before11ExitVolume = before11?.before11ExitVolume ?? null
      const before11TotalReceived = before11?.totalReceived ?? null
      const dispatchRate24hText = dispatch24h && dispatch24h.total > 0
        ? `${(dispatch24h.met / dispatch24h.total * 100).toFixed(2)}%`
        : null
      const notMet24hSignCount = dispatch24h ? dispatch24h.total - dispatch24h.met : null

      const card = buildVendorFeishuCard({
        vendorName: config.vendorName,
        dateLabel,
        ticketDateLabel,
        stationLabel,
        complaintCount,
        waybillCount,
        ratePercent,
        before11ExitPercent,
        before11ExitVolume,
        before11TotalReceived,
        dispatchRate24hText,
        notMet24hSignCount,
        unprocessedTicketCount,
        longTailCount,
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
  }, [fetchedData, indexedData, selectedStations, configs])

  const addConfig = useCallback(async (draft: VendorPushConfigDraft) => {
    const res = await createConfig(draft)
    if (!res.ok) { showToast(`新增失败: ${res.error}`, 'error'); return false }
    setConfigs((prev) => [...prev, res.data])
    showToast(`已添加「${res.data.vendorName}」推送配置`, 'success')
    return true
  }, [])

  const editConfig = useCallback(async (id: string, draft: VendorPushConfigDraft) => {
    const res = await updateConfig(id, draft)
    if (!res.ok) { showToast(`更新失败: ${res.error}`, 'error'); return false }
    setConfigs((prev) => prev.map((c) => (c.id === id ? res.data : c)))
    showToast(`已更新「${res.data.vendorName}」推送配置`, 'success')
    return true
  }, [])

  const removeConfig = useCallback(async (id: string, vendorName: string) => {
    const res = await deleteConfig(id)
    if (!res.ok) { showToast(`删除失败: ${res.error}`, 'error'); return }
    setConfigs((prev) => prev.filter((c) => c.id !== id))
    showToast(`已删除「${vendorName}」推送配置`, 'success')
  }, [])

  const toggleDisabled = useCallback(async (id: string, nextDisabled: boolean) => {
    const config = configs.find((c) => c.id === id)
    if (!config) return
    const res = await updateConfig(id, {
      vendorCode: config.vendorCode,
      vendorName: config.vendorName,
      webhookUrl: config.webhookUrl,
      signingSecret: config.signingSecret,
      pushDescription: config.pushDescription,
      isDisabled: nextDisabled,
    })
    if (!res.ok) { showToast(`操作失败: ${res.error}`, 'error'); return }
    setConfigs((prev) => prev.map((c) => (c.id === id ? res.data : c)))
    showToast(`已${nextDisabled ? '禁用' : '启用'}「${config.vendorName}」推送配置`, 'success')
  }, [configs])

  const driverPerformanceByVendor = useMemo<Record<string, DriverPerformanceRow[]>>(() => {
    if (!fetchedData) return {}

    // ── 归班预警：以查询发起时刻为基准，ofdDate（墨尔本时间）转换后距基准>=48h 则计入 ──
    const cutoffMs = nowIn(AUS_TZ.Adelaide).valueOf()

    const returnWarningMap = new Map<string, { count: number; waybillNos: string[] }>()
    for (const row of fetchedData.driverReturnRows) {
      if (!row.driverCode || !row.ofdDate) continue
      if (cutoffMs - iMileTimeMs(row.ofdDate) >= 48 * 60 * 60 * 1000) {
        const entry = returnWarningMap.get(row.driverCode) ?? { count: 0, waybillNos: [] }
        entry.count += 1
        if (row.waybillNo) entry.waybillNos.push(row.waybillNo)
        returnWarningMap.set(row.driverCode, entry)
      }
    }

    const result: Record<string, DriverPerformanceRow[]> = {}

    for (const config of configs) {
      // ── 今日取件量：昨日运单，按 courierVendorCode 匹配，按 courierCode 计数 ──
      type PickupAgg = { courierName: string; routeCode: string; count: number; before11Count: number; waybillNos: string[]; before11UnmetWaybillNos: string[] }
      const pickupMap = new Map<string, PickupAgg>()
      for (const row of fetchedData.driverYesterdayWaybills) {
        if (!row.courierCode || row.courierVendorCode !== config.vendorCode) continue
        const agg = pickupMap.get(row.courierCode)
        const wbNo = row.waybillNo ?? ''
        if (agg) {
          agg.count += 1
          if (row.before11Exit) {
            agg.before11Count += 1
          } else if (wbNo) {
            agg.before11UnmetWaybillNos.push(wbNo)
          }
          if (wbNo) agg.waybillNos.push(wbNo)
        } else {
          pickupMap.set(row.courierCode, {
            courierName: row.courier ?? '',
            routeCode: row.consigneeRouteCode ?? '',
            count: 1,
            before11Count: row.before11Exit ? 1 : 0,
            waybillNos: wbNo ? [wbNo] : [],
            before11UnmetWaybillNos: !row.before11Exit && wbNo ? [wbNo] : [],
          })
        }
      }

      // ── 24H派签率：前天运单，按站点+供应商过滤，按规则判断是否达标 ──
      const stationSet = new Set(selectedStations)
      type DispatchAgg = { total: number; completed: number; routeCode: string; unmetNos: string[] }
      const dispatchMap = new Map<string, DispatchAgg>()
      for (const row of fetchedData.driverDayBeforeWaybills) {
        if (!row.courierCode || row.courierVendorCode !== config.vendorCode) continue
        if (!row.deliveryTime) continue
        // 按最新派件网点过滤（与供应商级指标保持一致）
        if (stationSet.size > 0 && !stationSet.has(row.lastScanSiteCode ?? '')) continue

        // iMile 时间为墨尔本本地时间，需先转为阿德莱德时间再判断星期和截止时间
        const deliveryAdelaide = fromIMileTime(row.deliveryTime, AUS_TZ.Adelaide)
        const deliveryMs = deliveryAdelaide.valueOf()
        const signMs = row.signDate ? iMileTimeMs(row.signDate) : null
        const problemMs = row.lastProblemDate ? iMileTimeMs(row.lastProblemDate) : null
        const dow = deliveryAdelaide.day() // 0=Sun,1=Mon,...,6=Sat

        let completed = false
        if (dow >= 1 && dow <= 4) {
          // 周一~周四：signDate 或 lastProblemDate 距 deliveryTime <= 24h 之一达标即算
          const within24h = (ms: number | null) => ms != null && ms - deliveryMs <= 24 * 60 * 60 * 1000
          completed = within24h(signMs) || within24h(problemMs)
        } else {
          // 周五(5)、周六(6)、周日(0)：下周一 23:59:59（阿德莱德时间）前签收即达标
          const daysToMonday = dow === 0 ? 1 : dow === 5 ? 3 : 2
          const nextMondayMs = deliveryAdelaide
            .add(daysToMonday, 'day')
            .hour(23).minute(59).second(59).millisecond(0)
            .valueOf()
          completed = signMs != null && signMs <= nextMondayMs
        }

        const wbNo = row.waybillNo ?? ''
        const agg = dispatchMap.get(row.courierCode)
        if (agg) {
          agg.total += 1
          if (completed) {
            agg.completed += 1
          } else if (wbNo) {
            agg.unmetNos.push(wbNo)
          }
        } else {
          dispatchMap.set(row.courierCode, {
            total: 1,
            completed: completed ? 1 : 0,
            routeCode: row.consigneeRouteCode ?? '',
            unmetNos: !completed && wbNo ? [wbNo] : [],
          })
        }
      }

      // ── 长尾单：按司机 driverCode 聚合（与当前供应商匹配） ──
      type LongTailAgg = { count: number; waybillNos: string[] }
      const longTailByDriver = new Map<string, LongTailAgg>()
      for (const order of fetchedData.longTailOrders) {
        if (!order.driverCode || order.driverVendorCode !== config.vendorCode) continue
        const waybillNo = typeof order.waybillNo === 'string' ? order.waybillNo : ''
        const agg = longTailByDriver.get(order.driverCode)
        if (agg) {
          agg.count += 1
          if (waybillNo) agg.waybillNos.push(waybillNo)
        } else {
          longTailByDriver.set(order.driverCode, { count: 1, waybillNos: waybillNo ? [waybillNo] : [] })
        }
      }

      // ── 合并所有司机（取件量 + 24H派签 + 归班预警 + 长尾单 四个来源） ──
      const allCourierCodes = new Set([
        ...pickupMap.keys(),
        ...dispatchMap.keys(),
        ...longTailByDriver.keys(),
        ...[...returnWarningMap.keys()].filter((code) => {
          const returnRow = fetchedData.driverReturnRows.find(
            (r) => r.driverCode === code && r.driverVendorCode === config.vendorCode,
          )
          return !!returnRow
        }),
      ])

      const drivers: DriverPerformanceRow[] = []
      for (const courierCode of allCourierCodes) {
        const pickup = pickupMap.get(courierCode)
        const dispatch = dispatchMap.get(courierCode)

        let courierName = pickup?.courierName ?? ''
        if (!courierName) {
          const dispatchRow = fetchedData.driverDayBeforeWaybills.find(
            (r) => r.courierCode === courierCode && r.courierVendorCode === config.vendorCode,
          )
          courierName = dispatchRow?.courier ?? ''
        }
        if (!courierName) {
          const returnRow = fetchedData.driverReturnRows.find(
            (r) => r.driverCode === courierCode && r.driverVendorCode === config.vendorCode,
          )
          courierName = returnRow?.driverName ?? ''
        }
        if (!courierName) {
          const longTailRow = fetchedData.longTailOrders.find(
            (o) => o.driverCode === courierCode && o.driverVendorCode === config.vendorCode,
          )
          courierName = longTailRow?.driverName ?? courierCode
        }

        const totalDispatch = dispatch?.total ?? 0
        const dispatch24hCount = dispatch?.completed ?? 0
        const dispatchRate24h = totalDispatch > 0 ? dispatch24hCount / totalDispatch : null

        drivers.push({
          courierCode,
          courierName,
          vendorCode: config.vendorCode,
          vendorName: config.vendorName,
          routeCode: pickup?.routeCode || dispatch?.routeCode || '',
          ofdCount: pickup?.count ?? 0,
          ofdWaybillNos: pickup?.waybillNos ?? [],
          before11OfdCount: pickup?.before11Count ?? 0,
          before11UnmetWaybillNos: pickup?.before11UnmetWaybillNos ?? [],
          returnWarningCount: returnWarningMap.get(courierCode)?.count ?? 0,
          returnWarningWaybillNos: returnWarningMap.get(courierCode)?.waybillNos ?? [],
          dispatch24hCount,
          totalDispatchCount: totalDispatch,
          dispatchRate24h,
          dispatch24hUnmetWaybillNos: dispatch?.unmetNos ?? [],
          longTailCount: longTailByDriver.get(courierCode)?.count ?? 0,
          longTailWaybillNos: longTailByDriver.get(courierCode)?.waybillNos ?? [],
        })
      }

      drivers.sort((a, b) => b.returnWarningCount - a.returnWarningCount || b.ofdCount - a.ofdCount)
      result[config.vendorCode] = drivers
    }

    return result
  }, [fetchedData, configs])

  const vendorMetrics = useMemo<VendorMetricRow[]>(() => {
    if (!fetchedData || !indexedData) return []
    const { waybillsByVendor, ticketsByVendor, longTailByVendor, unprocessedCountByVendor, dispatch24hByVendor, before11UnmetByVendor } = indexedData
    return configs.map((config) => {
      const complaintCount = ticketsByVendor.get(config.vendorCode)?.length ?? 0
      const waybillCount = waybillsByVendor.get(config.vendorCode)?.length ?? 0
      const complaintRate = waybillCount > 0 ? complaintCount / waybillCount : 0
      const unprocessedTicketCount = unprocessedCountByVendor.get(config.vendorCode) ?? 0
      const longTailCount = longTailByVendor.get(config.vendorCode)?.length ?? 0
      const vendorCode = normalizeVendorCode(config.vendorCode)
      const before11 = fetchedData.before11ExitRateByVendor[vendorCode]
      const dispatch24h = dispatch24hByVendor.get(vendorCode)
      const dispatch24hTotal = dispatch24h?.total ?? null
      const dispatch24hCount = dispatch24h?.met ?? null
      const dispatchRate24hText = dispatch24h && dispatch24h.total > 0
        ? `${(dispatch24h.met / dispatch24h.total * 100).toFixed(2)}%`
        : null
      const notMet24hSignCount = dispatch24h ? dispatch24h.total - dispatch24h.met : null
      const complaintOrderCodes = ticketsByVendor.get(config.vendorCode)
        ?.map((t) => String((t as Record<string, unknown>).orderCode ?? '')).filter(Boolean) ?? []
      return {
        vendorCode,
        vendorName: config.vendorName,
        complaintCount,
        waybillCount,
        complaintRate,
        unprocessedTicketCount,
        longTailCount,
        before11ExitRate: before11?.before11ExitRate ?? null,
        before11ExitVolume: before11?.before11ExitVolume ?? null,
        before11TotalReceived: before11?.totalReceived ?? null,
        before11UnmetWaybillNos: before11UnmetByVendor.get(vendorCode) ?? [],
        dispatchRate24hText,
        notMet24hSignCount,
        dispatch24hTotal,
        dispatch24hCount,
        dispatch24hUnmetWaybillNos: dispatch24h?.unmetNos ?? [],
        complaintOrderCodes,
        isDisabled: config.isDisabled,
      }
    })
  }, [fetchedData, indexedData, configs])

  return {
    referenceDate,
    setReferenceDate: handleReferenceDateChange,
    complaintDateRange,
    setComplaintDateRange: handleComplaintDateRangeChange,
    selectedStations,
    vendors,
    vendorsLoading,
    configs,
    configsLoading,
    fetchedData,
    dataFetching,
    jobProgress,
    jobError,
    jobReused,
    fetchData,
    isPushingAll,
    pushAll,
    addConfig,
    editConfig,
    removeConfig,
    toggleDisabled,
    vendorMetrics,
    driverPerformanceByVendor,
    activeTab,
    setActiveTab,
    jobsList,
    isJobsLoading,
    loadingJobId,
    activeJobCount,
    refreshJobs,
    loadJobResults,
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
