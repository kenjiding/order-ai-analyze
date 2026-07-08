import { getApiBaseUrl } from '../../utils/apiBaseUrl'
import type { TrackEvent } from './types'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

const orderExceptionApi = `${getApiBaseUrl()}/api/order-exception`
const jobsApi = `${getApiBaseUrl()}/api/jobs`
const feishuWebhookApi = `${getApiBaseUrl()}/api/feishu-webhook`

async function readHttpError(res: Response, text: string): Promise<string> {
  try {
    const j = JSON.parse(text) as { error?: string }
    if (j.error) return j.error
  } catch {
    /* ignore */
  }
  return text || `HTTP ${res.status}`
}

/** 异常订单批量分析所用的大模型通道（由服务端 env 决定具体模型名）。 */
export type OrderAnalyzeAiProvider = 'openai' | 'deepseek'

/** 单次「开始分析」请求中，去重后的订单号上限（须与 `server` 的 `/analyze` 一致）。 */
export const ORDER_EXCEPTION_ANALYZE_MAX_BATCH = 500

/** 单次「开始分析」累计的大模型 token 消耗（含主分析、精排、交叉验证/重试）。 */
export type OrderAnalyzeTokenUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  apiCalls: number
}

/** 单次 /analyze 请求内服务端测量的接口耗时（毫秒）。 */
export type OrderAnalyzeApiTiming = {
  imileMs: number
  aiMs: number
}

/** iMile track/query 订单主数据（resultObject.baseInfo + skuInfo）。 */
export type OrderQueryInfo = {
  merchantName: string
  merchantCode: string
  totalWeight: string
  customerDeclaredValueAud: string
  declaredValueUsd: string
}

export type OrderAnalyzeInterceptLog = {
  waybillNo: string
  gmtScan?: string
  scanTypeDesc?: string
  scanOcName?: string
  interceptReasonDesc?: string
  scanUserCode: string
  scanUserName: string
  gmtIntercept: string
  operatorType: 'courier' | 'scanner' | 'unknown'
}

export type ResponsibilityTrackMarker = {
  source: 'track' | 'intercept'
  owner: 'in_warehouse' | 'out_warehouse'
  time: string
}

export type OrderAnalyzeResponsibilityOwner =
  | 'company_warehouse'
  | 'external_carrier'
  | 'merchant'
  | 'unknown'

export type OrderAnalyzeResultItem = {
  orderNo: string
  lossScope: '库内丢失' | '库外丢失' | '3PL丢件' | '虚假转运' | '暂无异常' | '需人工判断'
  exceptionCategoryId: string
  currentResponsibilityParty?: string
  activeResponsibilityOwner?: OrderAnalyzeResponsibilityOwner
  latestResponsibilityTrackMarker?: ResponsibilityTrackMarker | null
  reason: string
  confidence: number
  /** 事实硬校验后需要人工复核 */
  needsReview?: boolean
  /** 交叉验证所用的反向 provider */
  crossCheckedBy?: 'openai' | 'deepseek' | null
  /** 命中的事实校验规则描述 */
  factGuardrailHit?: string
}

export type RegressionExpectedInput = {
  lossScope: OrderAnalyzeResultItem['lossScope']
  exceptionCategoryId: string
  reason: string
}

export type RegressionCaseListItem = {
  id: string
  orderNo: string
  capturedAt: string
  expected: RegressionExpectedInput
  trackCount: number
  interceptLogCount: number
}

export type RegressionCaseResult = {
  id: string
  orderNo: string
  pass: boolean
  mismatches: Array<'lossScope' | 'exceptionCategoryId'>
  expected: RegressionExpectedInput
  actual: {
    lossScope: string
    exceptionCategoryId: string
    currentResponsibilityParty?: string
    reason: string
    confidence: number
    needsReview?: boolean
    crossCheckedBy?: 'openai' | 'deepseek' | null
  }
}

export type RegressionRunReport = {
  summary: { total: number; passed: number; failed: number }
  cases: RegressionCaseResult[]
  tokenUsage: OrderAnalyzeTokenUsage
}

export type ClosureExceptionTypeOption = {
  key:
    | 'aus_Packet_loss_in_the_station'
    | 'aus_packet_loss_out_the_station'
    | 'aus_Theft_and_robbery'
    | 'aus_Damaged_before_entering_the_station'
    | 'aus_Empty_package_before_entering_the_station'
    | 'aus_3PL_lost_items'
  value: string
  label: string | null
}

export type ClosureVendorOption = {
  key: string
  value: string
  label: string | null
}

export async function listRegressionCases(): Promise<{ cases: RegressionCaseListItem[] }> {
  const res = await fetch(`${orderExceptionApi}/regression/cases`)
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as { cases: RegressionCaseListItem[] }
}

export async function captureRegressionCase(payload: {
  imileToken: string
  orderNo: string
  expected: RegressionExpectedInput
}): Promise<{ case: RegressionCaseListItem & { tracks?: unknown[] } }> {
  const res = await fetch(`${orderExceptionApi}/regression/capture`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text)
}

export async function deleteRegressionCase(id: string): Promise<void> {
  const res = await fetch(`${orderExceptionApi}/regression/cases/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
}

export async function runRegression(payload?: {
  caseIds?: string[]
  aiProvider?: OrderAnalyzeAiProvider
}): Promise<RegressionRunReport> {
  const res = await fetch(`${orderExceptionApi}/regression/run`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      caseIds: payload?.caseIds,
      aiProvider: payload?.aiProvider ?? 'deepseek',
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as RegressionRunReport
}

/** 并行预取轨迹与阻断（写入服务端缓存），不调用 AI。多单分析前可调用以加速后续 /track 查询。 */
export async function postOrderExceptionPrefetch(payload: {
  imileToken: string
  orderNos: string[]
}): Promise<{
  trackInfo: Record<string, TrackEvent[]>
  meta: {
    trackCacheHitCount: number
    trackFetchedCount: number
    interceptCacheHitCount: number
    interceptFetchedCount: number
    interceptErrors: Array<{ orderNo: string; message: string }>
  }
}> {
  const res = await fetch(`${orderExceptionApi}/prefetch`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as {
    trackInfo: Record<string, TrackEvent[]>
    meta: {
      trackCacheHitCount: number
      trackFetchedCount: number
      interceptCacheHitCount: number
      interceptFetchedCount: number
      interceptErrors: Array<{ orderNo: string; message: string }>
    }
  }
}

export type OrderTrackFacts = {
  todayStr: string
  lastEventTime: string
  lastEventDaysDiff: number
  latestEventKind: string
  activeResponsibilityOwner: string
  activeSegmentStatus: string
  activeWarehouseName: string | null
  activeWarehouseKnown: boolean
  activeWarehouseLossTimeoutDays: number
  activeExternalCarrierName: string | null
  activeSegmentStartTime: string | null
  activeSegmentDaysDiff: number
  hasRealOperatorScan: boolean
  inWarehouseStartTime: string | null
  inWarehouseBasis: string | null
  inWarehouseDaysDiff: number
  inWarehouseStartSupersededByDispatch: boolean
  lastDispatchedOutTime: string | null
  outWarehouseDaysDiff: number
  lastDispatchHasReturn: boolean
  deliveryAssignmentCount: number
  deliveryCancelCount: number
  problemCount: number
  hasDeliveryCompletion: boolean
  deliveryCompletionTime: string | null
  deliveryCompletionEvidence: string | null
  latestOrderExceptionClosed: boolean
  stationLossCompletion: boolean
  assignCancelLoopWithoutDispatch: boolean
  hasInterceptLogs: boolean
  latestInterceptTime: string | null
  latestInterceptUserCode: string | null
  latestInterceptOperatorType: string | null
  interceptAdjustedResponsibilityOwner: string | null
  interceptAdjustedResponsibilityBasis: string | null
  interceptAdjustedResponsibilityDaysDiff: number
  finalResponsibilityOwner: string | null
  finalResponsibilityStartTime: string | null
  finalResponsibilityDaysDiff: number
  finalResponsibilityBasis: string | null
  merchantDestroyConfirmed: boolean
  merchantDestroyConfirmTime: string | null
  merchantAbandonActive: boolean
  merchantStorageActive: boolean
  merchantReturnClosed: boolean
  merchantReturnRequested: boolean
  unknownWarehouseInActiveSegment: boolean
}

/** 「库外丢失」经取消扫描接口二次核验后的改判统计；error 存在时表示本次未完成核验，结果维持原判。 */
export type CancelScanRecheckMeta = {
  checkedOrderNos: string[]
  reclassifiedOrderNos: string[]
  error?: string
}

export async function postOrderExceptionAnalyze(payload: {
  imileToken: string
  orderNos: string[]
  aiProvider?: OrderAnalyzeAiProvider
  scanStationCode?: string
}): Promise<{
  results: OrderAnalyzeResultItem[]
  trackInfo: Record<string, TrackEvent[]>
  orderInfo: Record<string, OrderQueryInfo | null>
  interceptLogs: Record<string, OrderAnalyzeInterceptLog[]>
  tokenUsage: OrderAnalyzeTokenUsage
  timing?: OrderAnalyzeApiTiming
  trackFacts?: Record<string, OrderTrackFacts>
  cancelScanRecheck?: CancelScanRecheckMeta
}> {
  const res = await fetch(`${orderExceptionApi}/analyze`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ...payload,
      aiProvider: payload.aiProvider ?? 'deepseek',
    }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(await readHttpError(res, text))
  }
  return JSON.parse(text) as {
    results: OrderAnalyzeResultItem[]
    trackInfo: Record<string, TrackEvent[]>
    orderInfo: Record<string, OrderQueryInfo | null>
    interceptLogs: Record<string, OrderAnalyzeInterceptLog[]>
    tokenUsage: OrderAnalyzeTokenUsage
    timing?: OrderAnalyzeApiTiming
    trackFacts?: Record<string, OrderTrackFacts>
    cancelScanRecheck?: CancelScanRecheckMeta
  }
}

export async function getClosureVendors(payload: { imileToken: string }): Promise<{
  vendors: ClosureVendorOption[]
  defaultStationCode: string
}> {
  const res = await fetch(`${orderExceptionApi}/closure/vendors`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${payload.imileToken}`,
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as {
    vendors: ClosureVendorOption[]
    defaultStationCode: string
  }
}

export async function postClosureDriverVendor(payload: {
  imileToken: string
  driverId: string
  stationCode: string
}): Promise<{
  stationCode: string
  result: { driverId: string; vendorCode: string; vendorName: string } | null
}> {
  const res = await fetch(`${orderExceptionApi}/closure/driver-vendor`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as {
    stationCode: string
    result: { driverId: string; vendorCode: string; vendorName: string } | null
  }
}

// ─── 异步 AI 分析（jobs queue）───────────────────────────────────────────────

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type PublicJob = {
  id: string
  type: string
  status: JobStatus
  payload: Record<string, unknown>
  progress: Record<string, unknown>
  error: string | null
  artifactPath: string | null
  artifactExpiresAt: string | null
  attemptCount: number
  maxAttempts: number
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

/** artifact 与同步 /analyze 响应的 shape 一致（无 timing 字段）。 */
export type AnalyzeJobArtifact = {
  results: OrderAnalyzeResultItem[]
  trackInfo: Record<string, TrackEvent[]>
  orderInfo: Record<string, OrderQueryInfo | null>
  interceptLogs: Record<string, OrderAnalyzeInterceptLog[]>
  tokenUsage: OrderAnalyzeTokenUsage
  trackFacts?: Record<string, OrderTrackFacts>
  cancelScanRecheck?: CancelScanRecheckMeta
}

/** 提交批量异步分析任务；立即返回 jobId，通过 getJobById 轮询状态。 */
export async function postOrderExceptionAnalyzeAsync(payload: {
  imileToken: string
  orderNos: string[]
  aiProvider?: OrderAnalyzeAiProvider
  enableAiExplain?: boolean
  scanStationCode?: string
}): Promise<{ jobId: string; status: JobStatus; orderCount: number }> {
  const res = await fetch(`${orderExceptionApi}/analyze-async`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ...payload,
      aiProvider: payload.aiProvider ?? 'deepseek',
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as { jobId: string; status: JobStatus; orderCount: number }
}

export async function getJobById(jobId: string): Promise<PublicJob> {
  const res = await fetch(`${jobsApi}/${encodeURIComponent(jobId)}`, { cache: 'no-store' })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  const parsed = JSON.parse(text) as { job: PublicJob }
  return parsed.job
}

export async function getJobArtifact(jobId: string): Promise<AnalyzeJobArtifact> {
  const res = await fetch(`${jobsApi}/${encodeURIComponent(jobId)}/artifact`, { cache: 'no-store' })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  const parsed = JSON.parse(text) as { artifact: AnalyzeJobArtifact }
  return parsed.artifact
}

export async function listJobsApi(params?: {
  type?: string
  limit?: number
}): Promise<{ jobs: PublicJob[]; total: number }> {
  const qs = new URLSearchParams()
  if (params?.type) qs.set('type', params.type)
  if (params?.limit != null) qs.set('limit', String(params.limit))
  const url = `${jobsApi}?${qs.toString()}`
  const res = await fetch(url, { cache: 'no-store' })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as { jobs: PublicJob[]; total: number }
}

export async function deleteJobApi(jobId: string): Promise<void> {
  const res = await fetch(`${jobsApi}/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(await readHttpError(res, text))
  }
}

export async function cancelJobApi(jobId: string): Promise<PublicJob> {
  const res = await fetch(`${jobsApi}/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({}),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  const parsed = JSON.parse(text) as { job: PublicJob }
  return parsed.job
}

export type OrderExceptionPushRow = {
  lossScope: string
  categoryName: string
  currentResponsibilityParty: string
  confidence: string
}

export type OrderExceptionPushResult = {
  ok: boolean
  aiSummaryGenerated?: boolean
  aiError?: string
  httpStatus?: number
  feishu?: unknown
  error?: string
}

export async function postFeishuPushOrderException(payload: {
  pushScope: 'order-exception'
  webhookUrl: string
  signingSecret?: string
  rows: OrderExceptionPushRow[]
  analysisDate: string
  aiProvider: 'deepseek' | 'openai'
}): Promise<OrderExceptionPushResult> {
  const res = await fetch(`${feishuWebhookApi}/push-order-exception`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as OrderExceptionPushResult
}
