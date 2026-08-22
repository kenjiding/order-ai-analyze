import { ZKT_ATTENDANCE_BASE_URL } from './constants'
import { getZktToken, invalidateZktToken, zktAuthHeaders } from './token'

const REPORT_PATH = '/att/api/totalTimeCardReportV2/'
const MAX_PAGE_SIZE = 10_000

export type ZktTimeCardQueryInput = {
  username: string
  password: string
  startDate: string
  endDate: string
  departmentId: string
  areas?: string
  groups?: string
  employees?: string
}

export type ZktTimeCardQuerySuccess = {
  ok: true
  records: unknown[]
  totalCount: number
  fetched: number
  pageCount: number
  raw: unknown
}

export type ZktTimeCardQueryError = {
  ok: false
  status: number
  message: string
  rawText?: string
}

type ReportPage = {
  count?: number
  next?: string | null
  code?: number
  msg?: string
  data?: unknown[]
}

function normalizeBaseUrl(): string {
  return ZKT_ATTENDANCE_BASE_URL.replace(/\/+$/, '')
}

function buildReportUrl(input: {
  baseUrl: string
  page: number
  pageSize: number
  startDate: string
  endDate: string
  departmentId: string
  areas: string
  groups: string
  employees: string
}): string {
  const params = new URLSearchParams({
    page: String(input.page),
    page_size: String(input.pageSize),
    start_date: input.startDate,
    end_date: input.endDate,
    departments: input.departmentId,
    areas: input.areas,
    groups: input.groups,
    employees: input.employees,
  })
  return `${input.baseUrl}${REPORT_PATH}?${params.toString()}`
}

function readPageError(page: ReportPage): string | null {
  if (page.code != null && page.code !== 0) {
    return page.msg?.trim() || `ZKT 考勤接口 code=${page.code}`
  }
  return null
}

async function fetchReportPage(input: {
  url: string
  token: string
}): Promise<{ ok: true; page: ReportPage; text: string } | { ok: false; status: number; text: string }> {
  const res = await fetch(input.url, {
    method: 'GET',
    headers: zktAuthHeaders(input.token),
  })
  const text = await res.text()
  if (!res.ok) {
    return { ok: false, status: res.status, text }
  }
  try {
    return { ok: true, page: JSON.parse(text) as ReportPage, text }
  } catch {
    return { ok: false, status: res.status, text }
  }
}

export async function queryZktTimeCardReport(
  input: ZktTimeCardQueryInput,
): Promise<ZktTimeCardQuerySuccess | ZktTimeCardQueryError> {
  const baseUrl = normalizeBaseUrl()
  const credentials = { username: input.username, password: input.password }
  const areas = String(input.areas ?? '-1').trim() || '-1'
  const groups = String(input.groups ?? '-1').trim() || '-1'
  const employees = String(input.employees ?? '-1').trim() || '-1'

  let token = await getZktToken(credentials)
  const records: unknown[] = []
  const rawPages: unknown[] = []
  let page = 1
  let totalCount = 0
  let retried = false

  while (true) {
    const url = buildReportUrl({
      baseUrl,
      page,
      pageSize: MAX_PAGE_SIZE,
      startDate: input.startDate,
      endDate: input.endDate,
      departmentId: input.departmentId,
      areas,
      groups,
      employees,
    })

    let result = await fetchReportPage({ url, token })

    if (!result.ok && (result.status === 401 || result.status === 403) && !retried) {
      invalidateZktToken(credentials)
      token = await getZktToken(credentials, true)
      retried = true
      result = await fetchReportPage({ url, token })
    }

    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        message:
          result.status === 401 || result.status === 403
            ? 'ZKT 考勤 token 已失效，请检查系统设置中的账号密码'
            : `ZKT 考勤接口 HTTP ${result.status}`,
        rawText: result.text.slice(0, 500),
      }
    }

    rawPages.push(JSON.parse(result.text))
    const pageError = readPageError(result.page)
    if (pageError) {
      return { ok: false, status: 502, message: pageError, rawText: result.text.slice(0, 500) }
    }

    const batch = Array.isArray(result.page.data) ? result.page.data : []
    if (page === 1) {
      totalCount = typeof result.page.count === 'number' ? result.page.count : batch.length
    }
    records.push(...batch)

    if (records.length >= totalCount) break
    if (!result.page.next) break
    page += 1
    if (page > 100) {
      return { ok: false, status: 502, message: 'ZKT 考勤分页超过上限，请缩小日期区间' }
    }
  }

  if (totalCount > 0 && records.length < totalCount) {
    return {
      ok: false,
      status: 502,
      message: `ZKT 考勤数据不完整：count=${totalCount}，实际拉取 ${records.length} 条`,
      rawText: `pages=${rawPages.length}`,
    }
  }

  return {
    ok: true,
    records,
    totalCount,
    fetched: records.length,
    pageCount: rawPages.length,
    raw: rawPages.length === 1 ? rawPages[0] : rawPages,
  }
}
