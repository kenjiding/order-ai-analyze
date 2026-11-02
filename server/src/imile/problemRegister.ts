/**
 * 问题件上报：图片先传 iMile OSS 换 file key，再用 file key 调用问题件上报接口。
 * 接口来自收件地址校验页「不可派送」人工上报流程，鉴权头与 track.ts 等共用 buildImileAuthHeaders。
 */
import { buildImileAuthHeaders, envFirstOr } from './shared'
import { requestImileApi } from './client'
import { AUS_TZ } from './ausTimezone'

const OSS_UPLOAD_URL = 'https://ds.imile.com/ipep/oss/upload'
const PROBLEM_REGISTER_URL = 'https://ds.imile.com/saastms/v1/biz/problem/register'
const PROBLEM_SEARCH_URL = 'https://ds.imile.com/saastms/v1/biz/problem/search'
const UPLOAD_TIMEOUT_MS = 30000

function buildProblemAuthHeaders(token: string, resourceCode: string): Record<string, string> {
  return buildImileAuthHeaders({
    token,
    resourceCode: envFirstOr(['IMILE_PROBLEM_RESOURCE_CODE'], resourceCode),
    sysName: envFirstOr(['IMILE_TRACK_SYS_NAME'], 'DS'),
    sysPortal: envFirstOr(['IMILE_TRACK_SYS_PORTAL'], 'DS'),
    origin: envFirstOr(['IMILE_TRACK_ORIGIN'], 'https://ds.imile.com'),
    referer: envFirstOr(['IMILE_TRACK_REFERER'], 'https://ds.imile.com/'),
    frontSecEnvKeys: ['IMILE_TRACK_FRONT_SEC'],
    hubcodeEnvKeys: ['IMILE_TRACK_HUBCODE'],
    langEnvKeys: ['IMILE_TRACK_LANG'],
    timezoneEnvKeys: ['IMILE_TRACK_TIMEZONE'],
    cookieEnvKeys: ['IMILE_TRACK_COOKIE'],
  })
}

export type UploadProofResult = { ok: true; fileKey: string } | { ok: false; status: number; message: string }

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl.trim())
  if (!match) return null
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') }
}

export async function uploadProblemProofImage(
  imileToken: string,
  dataUrl: string,
  fileName: string,
): Promise<UploadProofResult> {
  const decoded = decodeDataUrl(dataUrl)
  if (!decoded) return { ok: false, status: 400, message: '图片数据格式无效' }

  const headers = buildProblemAuthHeaders(imileToken, 'ossUpload')

  const form = new FormData()
  form.append('file', new Blob([decoded.buffer], { type: decoded.mimeType }), fileName)
  form.append('userId', '')
  form.append('bucketType', '1')
  form.append('directory', 'hermes/ent/image')

  let response: Response
  try {
    response = await fetch(OSS_UPLOAD_URL, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
  } catch (e) {
    return { ok: false, status: 502, message: `图片上传请求失败：${(e as Error).message || '网络异常'}` }
  }

  const text = await response.text()
  let json: unknown
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    return { ok: false, status: response.status, message: '图片上传接口返回非 JSON' }
  }

  const obj = json as { resultCode?: string; resultObject?: string }
  const fileKey = String(obj.resultObject ?? '').trim()
  if (obj.resultCode !== 'success' || !fileKey) {
    return { ok: false, status: response.status, message: '图片上传失败' }
  }
  return { ok: true, fileKey }
}

export type RegisterProblemResult =
  | { ok: true; success: boolean; failWaybillNosStr: string }
  | { ok: false; status: number; message: string }

export async function registerDeliveryProblem(
  imileToken: string,
  params: { waybillNo: string; problemCountry: string; description: string; proofs: string[] },
): Promise<RegisterProblemResult> {
  const headers = buildProblemAuthHeaders(imileToken, 'problemRegister')
  headers['Content-Type'] = 'application/json'

  const body = {
    description: params.description,
    problemCountry: params.problemCountry,
    problemReason: 'PR008701',
    problemType: 'Undelivered',
    proofs: params.proofs,
    registerType: 'waybill',
    scenesCode: '',
    waybillNo: params.waybillNo,
  }

  const result = await requestImileApi({ url: PROBLEM_REGISTER_URL, method: 'POST', headers, body, label: '问题件上报' })
  if (!result.ok) return { ok: false, status: result.status, message: result.message }

  const obj = (result.json as { resultObject?: { success?: boolean; failWaybillNosStr?: string } })?.resultObject
  return { ok: true, success: !!obj?.success, failWaybillNosStr: String(obj?.failWaybillNosStr ?? '') }
}

/** 阿德莱德本地「今天」±1 天 / -1 个月的查询窗口，格式 'YYYY-MM-DD HH:mm:ss'；只用于日历字段加减，不做真实时区换算。 */
function buildAuPostSearchWindow(): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AUS_TZ.Adelaide,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  const base = new Date(Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')))

  const end = new Date(base)
  end.setUTCDate(end.getUTCDate() + 1)
  const start = new Date(base)
  start.setUTCMonth(start.getUTCMonth() - 1)

  const fmt = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  }
  return { start: fmt(start), end: fmt(end) }
}

export type SearchReportedResult =
  | { ok: true; reportedWaybillNos: Set<string> }
  | { ok: false; status: number; message: string }

/** 批量查某批运单是否已上报过「AUS|邮政信箱」（PR008701 / Undelivered）问题件。 */
export async function searchReportedAuPostProblems(
  imileToken: string,
  waybillNos: string[],
): Promise<SearchReportedResult> {
  if (!waybillNos.length) return { ok: true, reportedWaybillNos: new Set() }

  const headers = buildProblemAuthHeaders(imileToken, 'problemSearch')
  headers['Content-Type'] = 'application/json'
  const { start, end } = buildAuPostSearchWindow()

  const body = {
    clientCode: '',
    currentPage: 1,
    end,
    isBtw: '',
    problemReasons: ['PR008701'],
    problemTypes: ['Undelivered'],
    selectAll: false,
    showCount: 1000,
    start,
    waybillNos,
  }

  const result = await requestImileApi({ url: PROBLEM_SEARCH_URL, method: 'POST', headers, body, label: '问题件上报查询' })
  if (!result.ok) return { ok: false, status: result.status, message: result.message }

  const results = (result.json as { resultObject?: { results?: Array<{ waybillNo?: string }> } })?.resultObject?.results
  const reportedWaybillNos = new Set(
    (results ?? []).map((r) => String(r.waybillNo ?? '').trim()).filter(Boolean),
  )
  return { ok: true, reportedWaybillNos }
}
