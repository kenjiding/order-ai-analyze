import { requestImileApi } from './client'
import { buildImilePortalHeaders, IMILE_DS_CLOSURE_PORTAL } from './portal'
import { isRecord, normalizeImileToken } from './shared'
import { readResultObject, readResultRows } from './resultObject'

const STATISTICS_URL = 'https://ds.imile.com/dms/migrate/biz/delivery/feedback/searchFeedbackStatistics'
const SEARCH_URL = 'https://ds.imile.com/dms/migrate/biz/delivery/feedback/searchProblemDetail'
const DETAIL_URL = 'https://ds.imile.com/dms/migrate/biz/delivery/feedback/getProblemDetail'

function makeDmsHeaders(token: string): Record<string, string> {
  return buildImilePortalHeaders({
    token,
    envPrefix: 'IMILE_DMS_FEEDBACK',
    defaults: {
      ...IMILE_DS_CLOSURE_PORTAL,
      resourceCode: 'deliveryFeedback',
    },
    sharedEnvPrefixes: ['IMILE_TRACK'],
  })
}

export type FeedbackStatisticsParams = {
  imileToken: string
  start: string
  end: string
  stationCode: string
  currentPage?: number
  showCount?: number
}

export type FeedbackStatisticsResult =
  | { ok: true; rows: unknown[]; total: number }
  | { ok: false; status: number; message: string; rawText?: string }

export async function searchFeedbackStatistics(
  params: FeedbackStatisticsParams,
): Promise<FeedbackStatisticsResult> {
  const headers = makeDmsHeaders(params.imileToken)
  const body = {
    start: params.start,
    end: params.end,
    stationCode: params.stationCode,
    currentPage: params.currentPage ?? 1,
    showCount: params.showCount ?? 20,
    consigneeFeedback: '',
    dtlCode: '',
    followUpType: '',
    isDtlAudit: '',
    payment: '',
    problemReason: '',
    problemType: '',
    stateCode: '',
    vendorCode: '',
    orderTypeList: [],
    vehicleNos: [],
    waybillNos: [],
  }

  const result = await requestImileApi({
    url: STATISTICS_URL,
    method: 'POST',
    headers,
    body,
    label: '问题件统计查询',
    retryBusy: true,
  })

  if (!result.ok) {
    return { ok: false, status: result.status, message: result.message, rawText: result.rawText }
  }

  const rows = readResultRows(result.json)
  const ro = readResultObject(result.json)
  let total = rows.length
  if (isRecord(ro) && isRecord(ro.pagination)) {
    total = Number(ro.pagination.totalResult ?? rows.length)
  }

  return { ok: true, rows, total }
}

export type ProblemPackageSearchParams = {
  imileToken: string
  daCode: string
  stationCode: string
  start: string
  end: string
  ofdDate: string
  currentPage: number
  showCount: number
  dtlProblemAuditStatus?: string
  problemType?: string
  problemReason?: string
  waybillNos?: string[]
  dtlCode?: string
  followUpType?: string
  isDtlAudit?: string
  vendorCode?: string
  vehicleNos?: string[]
  orderTypeList?: string[]
  payment?: string
  stateCode?: string
  consigneeFeedback?: string
}

export type ProblemPackageSearchResult = {
  ok: true
  rows: unknown[]
  total: number
} | {
  ok: false
  status: number
  message: string
  rawText?: string
}

export type ProblemPackageDetailResult = {
  ok: true
  problemReasonDesc: string
  /** 派件员填写的补充描述 */
  problemRemark: string
  images: string[]
  raw: unknown
} | {
  ok: false
  status: number
  message: string
  rawText?: string
}

export async function searchProblemPackages(
  params: ProblemPackageSearchParams,
): Promise<ProblemPackageSearchResult> {
  const headers = makeDmsHeaders(params.imileToken)
  const body = {
    consigneeFeedback: params.consigneeFeedback ?? '',
    currentPage: params.currentPage,
    daCode: params.daCode,
    dtlCode: params.dtlCode ?? '',
    dtlProblemAuditStatus: params.dtlProblemAuditStatus ?? '',
    end: params.end,
    followUpType: params.followUpType ?? '',
    isDtlAudit: params.isDtlAudit ?? '',
    ofdDate: params.ofdDate,
    orderTypeList: params.orderTypeList ?? [],
    payment: params.payment ?? '',
    problemReason: params.problemReason ?? '',
    problemType: params.problemType ?? '',
    showCount: params.showCount,
    start: params.start,
    stateCode: params.stateCode ?? '',
    stationCode: params.stationCode,
    vehicleNos: params.vehicleNos ?? [],
    vendorCode: params.vendorCode ?? '',
    waybillNos: params.waybillNos ?? [],
  }

  const result = await requestImileApi({
    url: SEARCH_URL,
    method: 'POST',
    headers,
    body,
    label: '问题件列表查询',
    retryBusy: true,
  })

  if (!result.ok) {
    return { ok: false, status: result.status, message: result.message, rawText: result.rawText }
  }

  const rows = readResultRows(result.json)
  const ro = readResultObject(result.json)
  let total = rows.length
  if (isRecord(ro) && isRecord(ro.pagination)) {
    total = Number(ro.pagination.totalResult ?? rows.length)
  }

  return { ok: true, rows, total }
}

export async function getProblemPackageDetail(
  imileToken: string,
  taskId: string,
): Promise<ProblemPackageDetailResult> {
  const headers = makeDmsHeaders(imileToken)
  const url = `${DETAIL_URL}?taskId=${encodeURIComponent(taskId)}`

  const result = await requestImileApi({
    url,
    method: 'GET',
    headers,
    label: '问题件详情查询',
    retryBusy: true,
  })

  if (!result.ok) {
    return { ok: false, status: result.status, message: result.message, rawText: result.rawText }
  }

  const ro = readResultObject(result.json)
  if (!isRecord(ro)) {
    return { ok: false, status: 200, message: '接口返回数据格式异常' }
  }

  const problemReasonDesc = String(ro.problemReasonDesc ?? '')
  const problemRemark = String(ro.problemRemark ?? ro.remark ?? ro.dtlRemark ?? '')
  const rawImages = ro.images
  const images: string[] = Array.isArray(rawImages)
    ? rawImages.map((u) => String(u)).filter(Boolean)
    : []

  return { ok: true, problemReasonDesc, problemRemark, images, raw: ro }
}

/** OpenAI Vision 支持的 MIME 类型 */
const OPENAI_SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/**
 * 从二进制魔数检测图片格式，比 Content-Type header 更可靠。
 * iMile 图片服务常以 application/octet-stream 返回实际是 JPEG 的图片。
 */
function detectMimeFromMagicBytes(buf: Buffer): string | null {
  if (buf.length < 4) return null

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'

  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'

  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif'

  // WebP: RIFF????WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp'

  // HEIC/HEIF: bytes 4-7 == 'ftyp'
  if (buf.length >= 8 && buf.slice(4, 8).toString('ascii') === 'ftyp') return 'image/heic'

  // BMP: 42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp'

  return null
}

export async function downloadImageAsBase64(
  url: string,
  token: string,
): Promise<{ dataUrl: string; mimeType: string }> {
  const normalized = normalizeImileToken(token)
  const authHeaders: Record<string, string> = normalized
    ? { Authorization: `Bearer ${normalized}` }
    : {}

  let res: Response
  try {
    res = await fetch(url, { headers: authHeaders })
  } catch (e) {
    throw new Error(`图片请求失败: ${(e as Error).message}`)
  }

  // 若带 token 失败则尝试不带鉴权（部分图片公开访问）
  if (!res.ok) {
    try {
      res = await fetch(url)
    } catch {
      throw new Error(`图片下载失败: HTTP ${res.status}`)
    }
    if (!res.ok) {
      throw new Error(`图片下载失败: HTTP ${res.status}`)
    }
  }

  const buffer = Buffer.from(await res.arrayBuffer())

  if (buffer.length === 0) {
    throw new Error('图片内容为空，URL 可能已过期')
  }

  // 优先用魔数检测，忽略 Content-Type（iMile 常返回 application/octet-stream）
  const detectedMime = detectMimeFromMagicBytes(buffer)
  const headerMime = (res.headers.get('content-type') ?? '').split(';')[0].trim()

  const mime = detectedMime ?? (headerMime.startsWith('image/') ? headerMime : null)

  if (!mime) {
    // 如果魔数和 header 都无法确认是图片，看看是否是 HTML 错误页面
    const head = buffer.slice(0, 100).toString('utf8').trimStart().toLowerCase()
    if (head.startsWith('<!doc') || head.startsWith('<html')) {
      throw new Error('图片 URL 返回了 HTML 页面，iMile Token 可能已过期')
    }
    throw new Error(`无法识别图片格式（Content-Type: ${headerMime || '未知'}）`)
  }

  if (mime === 'image/heic' || mime === 'image/heif') {
    throw new Error('HEIC/HEIF 格式不被 OpenAI 支持（iPhone 默认拍摄格式），请上传 JPG/PNG')
  }

  // BMP 等非 OpenAI 支持格式：内容仍为原始二进制，改标 jpeg label 会导致解析失败
  // 直接抛出，让调用方跳过该图片
  if (!OPENAI_SUPPORTED_MIME.has(mime)) {
    throw new Error(`不支持的图片格式 ${mime}，OpenAI 仅接受 JPEG/PNG/GIF/WebP`)
  }

  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`
  return { dataUrl, mimeType: mime }
}
