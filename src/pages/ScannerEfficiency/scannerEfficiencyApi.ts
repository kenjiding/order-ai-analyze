import { backendFetch } from '../../api/httpClient'
export { fetchZktAttendance, type FetchZktAttendanceResult } from '../../api/zktAttendanceApi'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

async function readHttpError(res: Response, text: string): Promise<string> {
  try {
    const j = JSON.parse(text) as { error?: string }
    if (j.error) return j.error
  } catch {
    /* ignore */
  }
  return text || `HTTP ${res.status}`
}

/** 到件扫描导出任务：整段时间范围一次建任务（第一步），返回 jobId/userCode 供轮询用 */
export async function startInboundScanExport(payload: {
  imileToken: string
  startDate: string
  endDate: string
}): Promise<{ jobId: string; userCode: string }> {
  const res = await backendFetch('/api/scanner-efficiency/inbound-scan-export/start', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as { jobId: string; userCode: string }
}

export type InboundScanExportStatus =
  | { done: true; outFilePath: string }
  | { done: false; outCount: number; totalCount: number }

/** 单次查询导出任务状态（第二步），由调用方自己控制轮询节奏、按 outCount/totalCount 展示进度 */
export async function checkInboundScanExportStatus(payload: {
  imileToken: string
  jobId: string
  userCode: string
}): Promise<InboundScanExportStatus> {
  const res = await backendFetch('/api/scanner-efficiency/inbound-scan-export/status', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as InboundScanExportStatus
}

export type FinishInboundScanExportResult = {
  /** 导出 xlsx 逐行记录，字段未裁剪 */
  records: Record<string, string>[]
  meta: { fetched: number }
}

/** 任务完成后换下载链接并解析 xlsx（第三步） */
export async function finishInboundScanExport(payload: {
  imileToken: string
  outFilePath: string
}): Promise<FinishInboundScanExportResult> {
  const res = await backendFetch('/api/scanner-efficiency/inbound-scan-export/finish', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as FinishInboundScanExportResult
}

export type FetchBoxAssignedListResult = {
  records: unknown[]
  raw: unknown
  meta: {
    startDate: string
    endDate: string
    totalResult: number
    fetched: number
  }
}

export async function fetchBoxAssignedList(payload: {
  imileToken: string
  startDate: string
  endDate: string
  pendingHubCode?: string
  pendingHubName?: string
  country?: string
}): Promise<FetchBoxAssignedListResult> {
  const res = await backendFetch('/api/scanner-efficiency/box-assigned-list', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      imileToken: payload.imileToken,
      startDate: payload.startDate,
      endDate: payload.endDate,
      pendingHubCode: payload.pendingHubCode,
      pendingHubName: payload.pendingHubName,
      country: payload.country,
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as FetchBoxAssignedListResult
}

export type RouteCodeDistributionItem = {
  routeCode: string
  count: number
}

export type FetchCancelScanAnalysisResult = {
  cancelScanRecords: unknown[]
  waybillRecords: unknown[]
  routeCodeDistribution: RouteCodeDistributionItem[]
  dailyRouteCodeCounts: Array<{ date: string; routeCode: string; count: number }>
  raw: unknown
  meta: {
    startDate: string
    endDate: string
    cancelScanTotal: number
    cancelScanFetched: number
    waybillCount: number
    waybillFetched: number
  }
}

export async function fetchCancelScanAnalysis(payload: {
  imileToken: string
  startDate: string
  endDate: string
  scanStationCode?: string
}): Promise<FetchCancelScanAnalysisResult> {
  const res = await backendFetch('/api/scanner-efficiency/cancel-scan-analysis', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      imileToken: payload.imileToken,
      startDate: payload.startDate,
      endDate: payload.endDate,
      scanStationCode: payload.scanStationCode,
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as FetchCancelScanAnalysisResult
}

export type DailyEfficiencyRecordResponse = {
  date: string
  updatedAt: string
  payload: unknown
}

export type DailyEfficiencyRecordsListResponse = {
  items: DailyEfficiencyRecordResponse[]
}

export async function fetchDailyEfficiencyRecords(): Promise<DailyEfficiencyRecordsListResponse> {
  const res = await backendFetch('/api/scanner-efficiency/daily-records')
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as DailyEfficiencyRecordsListResponse
}

export async function fetchDailyEfficiencyRecord(date: string): Promise<DailyEfficiencyRecordResponse> {
  const res = await backendFetch(`/api/scanner-efficiency/daily-records/${encodeURIComponent(date)}`)
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as DailyEfficiencyRecordResponse
}

export async function saveDailyEfficiencyRecords(records: unknown[]): Promise<{ savedCount: number }> {
  const res = await backendFetch('/api/scanner-efficiency/daily-records', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ records }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as { savedCount: number }
}

export async function deleteDailyEfficiencyRecord(date: string): Promise<void> {
  const res = await backendFetch(`/api/scanner-efficiency/daily-records/${encodeURIComponent(date)}`, {
    method: 'DELETE',
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
}

export async function deleteDailyEfficiencyRecords(
  dates: string[],
): Promise<{ deletedCount: number; deletedDates: string[] }> {
  const res = await backendFetch('/api/scanner-efficiency/daily-records/batch-delete', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ dates }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as { deletedCount: number; deletedDates: string[] }
}
