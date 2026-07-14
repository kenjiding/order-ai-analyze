import { backendFetch } from '../../api/httpClient'
import type { DaCodeItem, PackageAuditResult, ProblemPackageDetail, ProblemPackageListItem } from './types'

const BASE = '/api/problem-audit'

async function readHttpError(res: Response, text: string): Promise<string> {
  try {
    const j = JSON.parse(text) as { error?: string }
    if (j.error) return j.error
  } catch {
    /* ignore */
  }
  return text || `HTTP ${res.status}`
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await backendFetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(await readHttpError(res, text))
  return JSON.parse(text) as T
}

/** Step 1: 获取 daCode 列表 */
export async function searchFeedbackStatistics(payload: {
  imileToken: string
  start: string
  end: string
  stationCode: string
  currentPage?: number
  showCount?: number
}): Promise<{ results: DaCodeItem[]; total: number }> {
  return postJson('/statistics', payload)
}

/** Step 2: 获取某 daCode 下的问题件列表 */
export async function searchProblemPackages(payload: {
  imileToken: string
  daCode: string
  ofdDate: string
  stationCode: string
  start: string
  end: string
  currentPage?: number
  showCount?: number
}): Promise<{ results: ProblemPackageListItem[]; total: number }> {
  return postJson('/search', {
    ...payload,
    currentPage: payload.currentPage ?? 1,
    showCount: payload.showCount ?? 100,
  })
}

/** Step 3: 获取单个问题件详情（含图片 URL） */
export async function getProblemPackageDetail(
  imileToken: string,
  taskId: string,
): Promise<ProblemPackageDetail> {
  return postJson('/detail', { imileToken, taskId })
}

/** AI 图片审核 */
export async function aiAnalyzeProblemPackage(payload: {
  imileToken: string
  images: string[]
  problemReasonDesc: string
  problemRemark: string
}): Promise<PackageAuditResult> {
  return postJson('/ai-analyze', payload)
}
