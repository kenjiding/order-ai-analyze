import { ZKT_ATTENDANCE_BASE_URL } from './constants'
import { getZktToken, invalidateZktToken, zktAuthHeaders } from './token'

const DEPARTMENT_PATH = '/personnel/api/departments/'
const PAGE_SIZE = 200
const MAX_PAGES = 50

export type ZktDepartmentNode = {
  id: number
  name: string
  pId: number
}

export type ZktDepartmentTreeSuccess = {
  ok: true
  departments: ZktDepartmentNode[]
}

export type ZktDepartmentTreeError = {
  ok: false
  status: number
  message: string
  rawText?: string
}

type DepartmentPage = {
  count?: number
  next?: string | null
  code?: number
  msg?: string
  data?: unknown[]
}

function normalizeBaseUrl(): string {
  return ZKT_ATTENDANCE_BASE_URL.replace(/\/+$/, '')
}

function buildDepartmentUrl(input: { baseUrl: string; page: number }): string {
  const params = new URLSearchParams({
    page: String(input.page),
    page_size: String(PAGE_SIZE),
  })
  return `${input.baseUrl}${DEPARTMENT_PATH}?${params.toString()}`
}

function readPageError(page: DepartmentPage): string | null {
  if (page.code != null && page.code !== 0) {
    return page.msg?.trim() || `ZKT 部门接口 code=${page.code}`
  }
  return null
}

/** 对外 API 字段：dept_name 对应 name，parent_dept 为 null 表示根节点 */
function parseDepartmentNodes(rows: unknown[]): ZktDepartmentNode[] {
  const departments: ZktDepartmentNode[] = []
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = Number(row.id)
    const name = String(row.dept_name ?? '').trim()
    const parentId = Number(row.parent_dept ?? 0)
    if (!Number.isFinite(id) || !name) continue
    departments.push({
      id,
      pId: Number.isFinite(parentId) ? parentId : 0,
      name,
    })
  }
  return departments
}

async function fetchDepartmentPage(input: {
  url: string
  token: string
}): Promise<{ ok: true; page: DepartmentPage; text: string } | { ok: false; status: number; text: string }> {
  const res = await fetch(input.url, {
    method: 'GET',
    headers: zktAuthHeaders(input.token),
  })
  const text = await res.text()
  if (!res.ok) {
    return { ok: false, status: res.status, text }
  }
  try {
    return { ok: true, page: JSON.parse(text) as DepartmentPage, text }
  } catch {
    return { ok: false, status: 502, text }
  }
}

export async function queryZktDepartmentTree(input: {
  username: string
  password: string
}): Promise<ZktDepartmentTreeSuccess | ZktDepartmentTreeError> {
  const baseUrl = normalizeBaseUrl()
  const credentials = { username: input.username, password: input.password }

  let token = await getZktToken(credentials)
  const departments: ZktDepartmentNode[] = []
  let page = 1
  let totalCount = 0
  let retried = false

  while (true) {
    const url = buildDepartmentUrl({ baseUrl, page })
    let result = await fetchDepartmentPage({ url, token })

    if (!result.ok && (result.status === 401 || result.status === 403) && !retried) {
      invalidateZktToken(credentials)
      token = await getZktToken(credentials, true)
      retried = true
      result = await fetchDepartmentPage({ url, token })
    }

    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        message:
          result.status === 401 || result.status === 403
            ? 'ZKT 考勤 token 已失效，请检查系统设置中的账号密码'
            : `ZKT 部门接口 HTTP ${result.status}`,
        rawText: result.text.slice(0, 500),
      }
    }

    const pageError = readPageError(result.page)
    if (pageError) {
      return { ok: false, status: 502, message: pageError, rawText: result.text.slice(0, 500) }
    }

    const batch = Array.isArray(result.page.data) ? result.page.data : []
    if (page === 1) {
      totalCount = typeof result.page.count === 'number' ? result.page.count : batch.length
    }
    departments.push(...parseDepartmentNodes(batch))

    if (departments.length >= totalCount) break
    if (!result.page.next) break
    page += 1
    if (page > MAX_PAGES) {
      return { ok: false, status: 502, message: 'ZKT 部门分页超过上限' }
    }
  }

  return { ok: true, departments }
}
