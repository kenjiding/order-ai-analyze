import { getApiBaseUrl } from '../../utils/apiBaseUrl'
import {
  cancelJobApi,
  deleteJobApi,
  getJobById,
  listJobs,
  type JobStatus,
  type PublicJob,
} from '../../api/jobsClient'
import type {
  Before11ExitRateResult,
  ComplaintTicketRow,
  DriverWaybillRow,
  DriverReturnRawRow,
  LongTailOrderRow,
  StationOption,
  UnprocessedTicketsData,
  VendorOption,
  WaybillRow,
} from './vendorAnalysisTypes'

export { getJobById, listJobs, cancelJobApi, deleteJobApi }
export type { JobStatus, PublicJob }

async function apiFetch<T>(
  path: string,
  options?: RequestInit & { signal?: AbortSignal },
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    type Wire = { ok?: boolean; data?: T; error?: string }
    const json = (await res.json()) as Wire
    if (json.ok === true) return { ok: true, data: json.data as T }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '请求失败' }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    return { ok: false, error: `无法访问后端 (${path})` }
  }
}

export async function fetchStations(
  imileToken: string,
): Promise<{ ok: true; data: StationOption[] } | { ok: false; error: string }> {
  return apiFetch<StationOption[]>('/api/vendor-analysis/stations', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` },
  })
}

export async function fetchVendors(
  imileToken: string,
): Promise<{ ok: true; data: VendorOption[] } | { ok: false; error: string }> {
  return apiFetch<VendorOption[]>('/api/vendor-analysis/vendors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` },
    body: JSON.stringify({}),
  })
}

export type VendorAnalyzeArtifact = {
  referenceDate: string
  /** 本次任务实际抓取的数据源；老任务无该字段（视为全量） */
  dataSources?: string[]
  tickets: ComplaintTicketRow[]
  waybills: WaybillRow[]
  unprocessedTickets: UnprocessedTicketsData
  longTailOrders: LongTailOrderRow[]
  before11ExitRateByVendor: Record<string, Before11ExitRateResult>
  driverYesterdayWaybills: DriverWaybillRow[]
  driverDayBeforeWaybills: DriverWaybillRow[]
  driverReturnRows: DriverReturnRawRow[]
  startTime: string
  endTime: string
  ticketStartTime: string
  ticketEndTime: string
  before11Date: string
  dayBeforeDate: string
}

export type VendorAnalyzeAsyncParams = {
  stationCodes: string[]
  referenceDate: string
  complaintStart: string
  complaintEnd: string
  startTime: string
  endTime: string
  ticketStartTime: string
  ticketEndTime: string
  yesterdayStartTime: string
  yesterdayEndTime: string
  dayBeforeStartTime: string
  dayBeforeEndTime: string
  unprocessedStartTime: string
  before11Date: string
  dayBeforeDate: string
  force?: boolean
  /** 勾选的指标 key；不传 = 全量抓取（老行为） */
  metricKeys?: string[]
  /** 增量拉取：直接指定本次要抓取的数据源，优先于 metricKeys（只用于补拉已缺失的部分） */
  dataSources?: string[]
}

/** 提交/复用一次供应商数据分析任务；立即返回 jobId，通过 getJobById 轮询状态。 */
export async function postVendorAnalyzeAsync(
  imileToken: string,
  params: VendorAnalyzeAsyncParams,
): Promise<{ ok: true; data: { jobId: string; status: JobStatus } } | { ok: false; error: string }> {
  return apiFetch<{ jobId: string; status: JobStatus }>('/api/vendor-analysis/analyze-async', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imileToken}` },
    body: JSON.stringify(params),
  })
}

/** 从数据库长期读取某个任务的完整分析结果（不受 jobs 表文件 artifact 的 TTL 清理影响）。 */
export async function getVendorAnalyzeSnapshot(
  jobId: string,
): Promise<{ ok: true; data: VendorAnalyzeArtifact } | { ok: false; error: string }> {
  return apiFetch<VendorAnalyzeArtifact>(`/api/vendor-analysis/analyze-jobs/${encodeURIComponent(jobId)}/snapshot`, {
    method: 'GET',
  })
}


export type VendorAiDriverInput = {
  courierName: string
  courierCode: string
  routeCode: string
  /** 以下字段均对应可自由取消的指标，未勾选时省略（不发 0，避免误导模型） */
  ofdCount?: number
  dispatchRate24h?: number | null
  dispatch24hCount?: number
  totalDispatchCount?: number
  returnWarningCount?: number
  longTailCount?: number
}

export type VendorAiInput = {
  vendorCode: string
  vendorName: string
  /** 以下字段均对应可自由取消的指标，未勾选时省略 */
  before11ExitRate?: number | null
  dispatchRate24h?: number | null
  complaintRate?: number
  complaintCount?: number
  waybillCount?: number
  unprocessedTicketCount?: number
  longTailCount?: number
  drivers: VendorAiDriverInput[]
}

import type { AppLocale } from '../../i18n/types'
import type { VendorSnapshotData, VendorSnapshotVendor, VendorSnapshotAiSummaries } from './vendorSnapshotStorage'

export async function fetchVendorAiSummaries(
  vendors: VendorAiInput[],
  locale: AppLocale = 'zh-CN',
  metricKeys?: string[],
): Promise<{ ok: true; data: Record<string, string> } | { ok: false; error: string }> {
  return apiFetch<Record<string, string>>('/api/vendor-analysis/ai-summary', {
    method: 'POST',
    body: JSON.stringify({ vendors, locale, metricKeys }),
  })
}

// ─── 日报发布与分享链接 ───────────────────────────────────────────────────────

/** 发布日报到服务端供外部分享链接读取；剔除 webhookConfigs，webhook 地址与密钥不落库 */
export async function postDailyReport(
  snapshot: VendorSnapshotData,
): Promise<{ ok: true; data: { id: string; createdAt: string } } | { ok: false; error: string }> {
  // 白名单构造，确保 webhookConfigs（含 webhook 地址与签名密钥）不上传
  const payload = {
    reportDate: snapshot.reportDate,
    stations: snapshot.stations,
    complaintDateRange: snapshot.complaintDateRange,
    before11Date: snapshot.before11Date,
    dispatch24hDate: snapshot.dispatch24hDate,
    generatedAt: snapshot.generatedAt,
    vendors: snapshot.vendors,
    aiSummaries: snapshot.aiSummaries,
    enabledMetricKeys: snapshot.enabledMetricKeys,
  }
  return apiFetch<{ id: string; createdAt: string }>('/api/vendor-analysis/daily-reports', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type VendorShareLink = {
  id: string
  vendorCode: string
  vendorName: string
  reportDate: string
  token: string
  isDisabled: boolean
  createdAt: string
  updatedAt: string
  lastAccessedAt: string | null
}

/** 分享链接按 (vendorCode, reportDate) 绑定，发布日报时自动开通；这里只查某一天的 */
export async function listShareLinks(
  reportDate: string,
): Promise<{ ok: true; data: VendorShareLink[] } | { ok: false; error: string }> {
  return apiFetch<VendorShareLink[]>(
    `/api/vendor-analysis/share-links?reportDate=${encodeURIComponent(reportDate)}`,
    { method: 'GET' },
  )
}

/** 重置 token：旧链接立即失效 */
export async function resetShareLink(
  id: string,
): Promise<{ ok: true; data: VendorShareLink } | { ok: false; error: string }> {
  return apiFetch<VendorShareLink>(`/api/vendor-analysis/share-links/${encodeURIComponent(id)}/reset`, {
    method: 'POST',
  })
}

export async function updateShareLink(
  id: string,
  isDisabled: boolean,
): Promise<{ ok: true; data: VendorShareLink } | { ok: false; error: string }> {
  return apiFetch<VendorShareLink>(`/api/vendor-analysis/share-links/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ isDisabled }),
  })
}

// ─── 外部门户（无登录态，凭 token） ────────────────────────────────────────────

export type VendorPortalDaily = {
  reportDate: string
  complaintDateRange: string
  before11Date: string
  dispatch24hDate: string
  generatedAt: string
  vendor: VendorSnapshotVendor
  aiSummary: VendorSnapshotAiSummaries[string] | null
  /** 发布日报时的指标勾选集合；老日报为 null → 全量渲染 */
  enabledMetricKeys: string[] | null
}

export async function fetchVendorPortalDaily(
  token: string,
): Promise<{ ok: true; data: VendorPortalDaily } | { ok: false; error: string }> {
  return apiFetch<VendorPortalDaily>(`/api/vendor-portal/daily/${encodeURIComponent(token)}`, {
    method: 'GET',
  })
}
