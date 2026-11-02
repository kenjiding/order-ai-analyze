import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { readImileTokenFromRequest } from './imileAuth'
import { getTrackProofImageUrl, queryImileTracks, type TrackEvent } from '../imile/track'
import { fetchSortingGeocodingByWaybillNos } from '../imile/sortingGeocoding'
import { AUS_TZ, localDateInTz } from '../imile/ausTimezone'
import { reverseLookupPostcodeByPoint, reverseLookupSuburbByPoint } from '../vendorRegionMap/absPostcodePolygons'
import { mapWithConcurrency } from '../orderAnalyze/runtime'
import { registerDeliveryProblem, searchReportedAuPostProblems, uploadProblemProofImage } from '../imile/problemRegister'

export const addressVerifyRouter = Router()

const MAX_ORDER_COUNT = 500
const ABS_LOOKUP_CONCURRENCY = 5

export type AddressVerifyStatus = 'match' | 'mismatch' | 'unresolved' | 'no_coordinate'

export type AddressVerifyRow = {
  orderNo: string
  merchantName: string
  consigneeProvince: string
  consigneeCity: string
  consigneeAddress: string
  consigneeZipCode: string
  resolvedPostcode: string
  resolvedCity: string
  latitude: number | null
  longitude: number | null
  status: AddressVerifyStatus
  error: string
  auPostBlocked: boolean
  auPostReason: string
  /** true = 已上报过「AUS|邮政信箱」问题件（AU Post判断列显示绿色），false = 未上报（显示红色） */
  auPostReported: boolean
  trackEvents: TrackEvent[]
}

function normalizeZip(zip: string): string {
  return zip.trim().replace(/\s+/g, '').toUpperCase()
}

// 以下 AU Post 不可派送判定移植自「地址分布智能看板」工具，口径保持一致：
// 只对反查邮编确认为 5000（Adelaide City）的地址做判断，避免对 Adelaide 以外的 PO Box/LPO 误报。
const AU_POST_KEYWORD_PATTERN =
  /\b(?:AUSTRALIA\s*POST|AUS\s*POST|AUSPOST|POST\s*OFFICE|POST\s*SHOP|PARCEL\s*(?:LOCKER|COLLECT)|ADELAIDE\s*GPO|GPO|LPO|PO\s*BOX|LOCKED\s*BAG)\b/

const AU_POST_OFFICIAL_LOCATIONS: Array<[RegExp, string]> = [
  [/\b141\s+KING\s+WILLIAM\s+(?:STREET|ST)\b/, 'Adelaide GPO · 141 King William Street'],
  [/\b2\s*[-/]\s*10\s+FRANKLIN\s+(?:STREET|ST)\b/, 'Adelaide GPO · 2–10 Franklin Street'],
  [/\b26\s+FRANKLIN\s+(?:STREET|ST)\b/, 'Australia Post Adelaide office · 26 Franklin Street'],
  [/\b59\s+CITY\s+CROSS\s+(?:ARCADE|ARC)\b/, 'Adelaide Rundle Mall Post Shop · 59 City Cross Arcade'],
  [/\b252\s+GOUGER\s+(?:STREET|ST)\b/, 'Adelaide Business Hub · 252 Gouger Street'],
  [/\b216\s+GOUGER\s+(?:STREET|ST)\b/, 'Australia Post Gouger St · 216 Gouger Street'],
  [/\b5\s*[-/]\s*7\s+HALIFAX\s+(?:STREET|ST)\b/, 'Adelaide Halifax St Post Shop · 5–7 Halifax Street'],
  [/\b252\s*[-/]\s*254\s+HALIFAX\s+(?:STREET|ST)\b/, 'Adelaide Halifax St Post Shop · 252–254 Halifax Street'],
  [/\b14\s*[-/]\s*18\s+FENN\s+(?:PLACE|PL)\b/, 'City West Campus LPO · 14–18 Fenn Place'],
  [/\bTENANCY\s*5\b.*\bLEARNING\s+HUB\b.*\bNORTH\s+TERRACE\b/, 'Adelaide University LPO · Learning Hub North Terrace'],
]

function assessAuPostUndeliverable(address: string, resolvedPostcode: string): { blocked: boolean; reason: string } {
  if (resolvedPostcode !== '5000') return { blocked: false, reason: '' }
  const text = address.toUpperCase().replace(/[.,#()]/g, ' ').replace(/\s+/g, ' ').trim()
  if (AU_POST_KEYWORD_PATTERN.test(text)) {
    return { blocked: true, reason: '地址包含 Australia Post/Post Office/GPO/LPO/Parcel Locker 或邮政信箱标识' }
  }
  const hit = AU_POST_OFFICIAL_LOCATIONS.find(([pattern]) => pattern.test(text))
  return hit ? { blocked: true, reason: hit[1] } : { blocked: false, reason: '' }
}

addressVerifyRouter.post('/check', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = (req.body ?? {}) as { imileToken?: string; orderNos?: string[] }
    const token = readImileTokenFromRequest(req, body.imileToken)
    const orderNos = Array.isArray(body.orderNos)
      ? [...new Set(body.orderNos.map((s) => String(s).trim()).filter(Boolean))]
      : []

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken，请在全局设置中配置' })
      return
    }
    if (!orderNos.length) {
      res.status(400).json({ error: '请提供至少一个单号' })
      return
    }
    if (orderNos.length > MAX_ORDER_COUNT) {
      res.status(400).json({ error: `单号数量超出上限（最多 ${MAX_ORDER_COUNT} 个）` })
      return
    }

    // 收件信息（地址文本展示用）与分拣坐标互不依赖，并发拉取
    const [trackResult, geocoded] = await Promise.all([
      queryImileTracks(token, orderNos),
      fetchSortingGeocodingByWaybillNos({
        token,
        waybillNos: orderNos,
        dataDate: localDateInTz(Date.now(), AUS_TZ.Adelaide),
        label: '收件地址校验',
      }),
    ])

    if (!trackResult.ok) {
      res.status(trackResult.status || 502).json({ error: trackResult.message })
      return
    }
    if (!geocoded.ok) {
      res.status(geocoded.status || 502).json({ error: geocoded.message })
      return
    }

    const rows = await mapWithConcurrency(orderNos, ABS_LOOKUP_CONCURRENCY, async (orderNo): Promise<AddressVerifyRow> => {
      const info = trackResult.orderInfo[orderNo]
      const trackEvents = trackResult.trackInfo[orderNo] ?? []
      const base = {
        orderNo,
        merchantName: info?.merchantName ?? '',
        consigneeProvince: info?.consigneeProvince ?? '',
        consigneeCity: info?.consigneeCity ?? '',
        consigneeAddress: info?.consigneeAddress ?? '',
        consigneeZipCode: info?.consigneeZipCode ?? '',
      }

      const coord = geocoded.coordsByWaybillNo.get(orderNo)
      if (!coord) {
        const auPost = assessAuPostUndeliverable(base.consigneeAddress, '')
        return {
          ...base,
          resolvedPostcode: '',
          resolvedCity: '',
          latitude: null,
          longitude: null,
          status: 'no_coordinate',
          error: info ? '未查到该运单的分拣坐标（可能是较早期的订单）' : '未查到运单信息',
          auPostBlocked: auPost.blocked,
          auPostReason: auPost.reason,
          auPostReported: false,
          trackEvents,
        }
      }

      // 邮编（POA）与地名（SAL）是两套独立的 ABS 官方边界，各自反查：SAL 是地名粒度边界，
      // 不经过「邮编→固定地名」的静态表，避免一个邮编覆盖多个地名时取错（如 5062 下 Netherby/Mitcham 等 11 个地名）
      const [postcode, resolvedCity] = await Promise.all([
        reverseLookupPostcodeByPoint(coord.latitude, coord.longitude),
        reverseLookupSuburbByPoint(coord.latitude, coord.longitude),
      ])

      if (!postcode) {
        const auPost = assessAuPostUndeliverable(base.consigneeAddress, '')
        return {
          ...base,
          resolvedPostcode: '',
          resolvedCity: resolvedCity ?? '',
          latitude: coord.latitude,
          longitude: coord.longitude,
          status: 'unresolved',
          error: '坐标未落在任何已知邮区边界内',
          auPostBlocked: auPost.blocked,
          auPostReason: auPost.reason,
          auPostReported: false,
          trackEvents,
        }
      }

      const match = !!base.consigneeZipCode && normalizeZip(postcode) === normalizeZip(base.consigneeZipCode)
      const auPost = assessAuPostUndeliverable(base.consigneeAddress, postcode)
      return {
        ...base,
        resolvedPostcode: postcode,
        resolvedCity: resolvedCity ?? '',
        latitude: coord.latitude,
        longitude: coord.longitude,
        status: match ? 'match' : 'mismatch',
        error: '',
        auPostBlocked: auPost.blocked,
        auPostReason: auPost.reason,
        auPostReported: false,
        trackEvents,
      }
    })

    const blockedWaybillNos = [...new Set(rows.filter((r) => r.auPostBlocked).map((r) => r.orderNo))]
    let auPostSearchError = ''
    if (blockedWaybillNos.length) {
      const searchResult = await searchReportedAuPostProblems(token, blockedWaybillNos)
      if (searchResult.ok) {
        for (const row of rows) {
          if (row.auPostBlocked) row.auPostReported = searchResult.reportedWaybillNos.has(row.orderNo)
        }
      } else {
        // 查询失败不影响主流程，仅提示：此时所有「不可派送」行按未上报（红色）展示，可能有误判为未上报的
        auPostSearchError = `AU Post 上报状态查询失败，已按未上报展示：${searchResult.message}`
      }
    }

    res.json({ ok: true, rows, auPostSearchError: auPostSearchError || undefined })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : '服务异常' })
  }
})

addressVerifyRouter.post('/upload-proof', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = (req.body ?? {}) as { imileToken?: string; dataUrl?: string; fileName?: string }
    const token = readImileTokenFromRequest(req, body.imileToken)
    const dataUrl = String(body.dataUrl ?? '')
    const fileName = String(body.fileName ?? 'proof.jpg').trim() || 'proof.jpg'

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken，请在全局设置中配置' })
      return
    }
    if (!dataUrl) {
      res.status(400).json({ error: '缺少图片数据' })
      return
    }

    const result = await uploadProblemProofImage(token, dataUrl, fileName)
    if (!result.ok) {
      res.status(result.status || 502).json({ error: result.message })
      return
    }
    res.json({ ok: true, fileKey: result.fileKey })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : '服务异常' })
  }
})

addressVerifyRouter.post('/report-problem', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      imileToken?: string
      waybillNo?: string
      problemCountry?: string
      description?: string
      proofs?: unknown
    }
    const token = readImileTokenFromRequest(req, body.imileToken)
    const waybillNo = String(body.waybillNo ?? '').trim()
    const problemCountry = String(body.problemCountry ?? '').trim()
    const description = String(body.description ?? '').trim()
    const proofs = Array.isArray(body.proofs) ? body.proofs.map((v) => String(v).trim()).filter(Boolean) : []

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken，请在全局设置中配置' })
      return
    }
    if (!waybillNo || !problemCountry || !description) {
      res.status(400).json({ error: '参数不完整' })
      return
    }

    const result = await registerDeliveryProblem(token, { waybillNo, problemCountry, description, proofs })
    if (!result.ok) {
      res.status(result.status || 502).json({ error: result.message })
      return
    }
    res.json({ ok: true, success: result.success, failWaybillNosStr: result.failWaybillNosStr })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : '服务异常' })
  }
})

/** 轨迹文案里「View Proof」的 fileKey → 真实图片地址，供问题件上报 Drawer 预览轨迹凭证图片。 */
addressVerifyRouter.get('/track-proof-image', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = readImileTokenFromRequest(req, undefined)
    const fileKey = String(req.query.fileKey ?? '').trim()

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken，请在全局设置中配置' })
      return
    }
    if (!fileKey) {
      res.status(400).json({ error: '缺少 fileKey' })
      return
    }

    const result = await getTrackProofImageUrl(token, fileKey)
    if (!result.ok) {
      res.status(result.status || 502).json({ error: result.message })
      return
    }
    res.json({ url: result.url })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : '服务异常' })
  }
})
