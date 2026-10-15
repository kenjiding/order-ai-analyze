import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { readImileTokenFromRequest } from './imileAuth'
import { queryImileTracks } from '../imile/track'
import { fetchSortingGeocodingByWaybillNos } from '../imile/sortingGeocoding'
import { AUS_TZ, localDateInTz } from '../imile/ausTimezone'
import { reverseLookupPostcodeByPoint } from '../vendorRegionMap/absPostcodePolygons'
import { mapWithConcurrency } from '../orderAnalyze/runtime'

export const addressVerifyRouter = Router()

const MAX_ORDER_COUNT = 200
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
  latitude: number | null
  longitude: number | null
  status: AddressVerifyStatus
  error: string
  auPostBlocked: boolean
  auPostReason: string
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
          latitude: null,
          longitude: null,
          status: 'no_coordinate',
          error: info ? '未查到该运单的分拣坐标（可能是较早期的订单）' : '未查到运单信息',
          auPostBlocked: auPost.blocked,
          auPostReason: auPost.reason,
        }
      }

      const postcode = await reverseLookupPostcodeByPoint(coord.latitude, coord.longitude)
      if (!postcode) {
        const auPost = assessAuPostUndeliverable(base.consigneeAddress, '')
        return {
          ...base,
          resolvedPostcode: '',
          latitude: coord.latitude,
          longitude: coord.longitude,
          status: 'unresolved',
          error: '坐标未落在任何已知邮区边界内',
          auPostBlocked: auPost.blocked,
          auPostReason: auPost.reason,
        }
      }

      const match = !!base.consigneeZipCode && normalizeZip(postcode) === normalizeZip(base.consigneeZipCode)
      const auPost = assessAuPostUndeliverable(base.consigneeAddress, postcode)
      return {
        ...base,
        resolvedPostcode: postcode,
        latitude: coord.latitude,
        longitude: coord.longitude,
        status: match ? 'match' : 'mismatch',
        error: '',
        auPostBlocked: auPost.blocked,
        auPostReason: auPost.reason,
      }
    })

    res.json({ ok: true, rows })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : '服务异常' })
  }
})
