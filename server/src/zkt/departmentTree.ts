import { ZKT_ATTENDANCE_BASE_URL } from './constants'
import { getZktSession, invalidateZktSession } from './session'

const DEPARTMENT_TREE_PATH = '/personnel/department_tree/'

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

function normalizeBaseUrl(): string {
  return ZKT_ATTENDANCE_BASE_URL.replace(/\/+$/, '')
}

function parseDepartmentNodes(raw: unknown): ZktDepartmentNode[] | null {
  if (!Array.isArray(raw)) return null
  const departments: ZktDepartmentNode[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = Number(row.id)
    const pId = Number(row.pId)
    const name = String(row.name ?? '').trim()
    if (!Number.isFinite(id) || !name) continue
    departments.push({
      id,
      pId: Number.isFinite(pId) ? pId : 0,
      name,
    })
  }
  return departments
}

async function fetchDepartmentTreePage(input: {
  url: string
  session: { cookieHeader: string; csrfToken: string }
}): Promise<{ ok: true; departments: ZktDepartmentNode[]; text: string } | { ok: false; status: number; text: string }> {
  const res = await fetch(input.url, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Referer: `${input.url.split('/personnel/')[0]}/`,
      Cookie: input.session.cookieHeader,
      'X-CSRFToken': input.session.csrfToken,
    },
  })
  const text = await res.text()
  if (!res.ok) {
    return { ok: false, status: res.status, text }
  }
  try {
    const parsed = JSON.parse(text) as unknown
    const departments = parseDepartmentNodes(parsed)
    if (!departments) {
      return { ok: false, status: 502, text }
    }
    return { ok: true, departments, text }
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
  const url = `${baseUrl}${DEPARTMENT_TREE_PATH}`

  let session = await getZktSession(credentials)
  let result = await fetchDepartmentTreePage({ url, session })
  let retried = false

  if (!result.ok && (result.status === 401 || result.status === 403) && !retried) {
    invalidateZktSession(credentials)
    session = await getZktSession(credentials, true)
    retried = true
    result = await fetchDepartmentTreePage({ url, session })
  }

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      message:
        result.status === 401 || result.status === 403
          ? 'ZKT 考勤会话已失效，请检查系统设置中的账号密码'
          : `ZKT 部门树接口 HTTP ${result.status}`,
      rawText: result.text.slice(0, 500),
    }
  }

  return { ok: true, departments: result.departments }
}
