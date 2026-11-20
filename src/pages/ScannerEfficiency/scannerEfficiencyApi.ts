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

export type FetchInboundScansPageResult = {
  /** iMile resultObject.results 原始项，字段未裁剪（仅本页） */
  records: unknown[]
  raw: unknown
  currentPage: number
  totalPages: number
  meta: {
    startDate: string
    endDate: string
    totalResult: number
    fetched: number
  }
}

/** 只拉一页，用于需要展示真实拉取进度的场景（逐页调用、逐页更新进度） */
export async function fetchInboundScansPage(payload: {
  imileToken: string
  startDate: string
  endDate: string
  page: number
}): Promise<FetchInboundScansPageResult> {
  const res = await backendFetch('/api/scanner-efficiency/inbound-scans', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      imileToken: payload.imileToken,
      startDate: payload.startDate,
      endDate: payload.endDate,
      page: payload.page,
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as FetchInboundScansPageResult
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
