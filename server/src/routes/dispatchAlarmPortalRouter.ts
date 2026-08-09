import { Router, type Request, type Response, type NextFunction } from 'express'
import { loadDispatchAlarmShareSnapshot } from '../feishu/dispatchAlarmShareSnapshot'
import {
  ensureProblemReasons,
  geocodePendingMapPoints,
  hasDriverMapWaybillRows,
  populateDriverMapCache,
  queryDriverMapPoints,
  readDriverMapImileToken,
} from '../driverMap/driverMapPointsQuery'
import { AUS_TZ } from '../imile/ausTimezone'

/**
 * 24小时派签告警外部门户（无登录鉴权，仅凭高熵分享 token）。
 * 安全约束与催派推送门户一致：统一 404、token 不入日志、限流。
 */
export const dispatchAlarmPortalRouter = Router()

const SHARE_TOKEN_PATTERN = /^[0-9a-f]{64}$/

const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60_000
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now()
  const ip = req.ip ?? 'unknown'
  const bucket = rateBuckets.get(ip)
  if (!bucket || bucket.resetAt <= now) {
    if (rateBuckets.size > 10_000) {
      for (const [key, value] of rateBuckets) {
        if (value.resetAt <= now) rateBuckets.delete(key)
      }
    }
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    next()
    return
  }
  bucket.count += 1
  if (bucket.count > RATE_LIMIT_MAX) {
    res.status(429).json({ ok: false, error: 'Too many requests' })
    return
  }
  next()
}

function sendNotFound(res: Response): void {
  res.status(404).json({ ok: false, error: 'not_found' })
}

/**
 * 司机地图：落地页站点/日期/供应商直接取自本次推送的快照（单站点单供应商，无需像供应商日报那样兜底多站点）。
 * 这张缓存表现在唯一的数据来源就是这个路由：该站点该日第一次被打开时，现场做一次全量同步（含地理编码）；
 * 之后同站点同日期的访问（含其它供应商）只需增量补坐标，不用重新整站拉取。
 * geocodePendingMapPoints 有时间预算，一次可能补不全坐标，由前端自行轮询重试。
 */
dispatchAlarmPortalRouter.get('/driver-map/:token', rateLimit, async (req: Request, res: Response) => {
  const token = String(req.params.token ?? '').trim().toLowerCase()
  if (!SHARE_TOKEN_PATTERN.test(token)) {
    sendNotFound(res)
    return
  }
  try {
    const snapshot = await loadDispatchAlarmShareSnapshot(token)
    if (!snapshot) {
      sendNotFound(res)
      return
    }
    if (!snapshot.showDriverMap) {
      res.json({ ok: true, data: null })
      return
    }
    const { stationCode, date: dataDate, vendorCode } = snapshot
    if (!stationCode || !/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) {
      res.json({ ok: true, data: null })
      return
    }

    const hasRows = await hasDriverMapWaybillRows({ stationCode, dataDate })
    if (!hasRows) {
      const imileToken = await readDriverMapImileToken()
      if (!imileToken) {
        res.json({ ok: true, data: null })
        return
      }
      const synced = await populateDriverMapCache({
        token: imileToken,
        stationCode,
        dataDate,
        tz: AUS_TZ.Adelaide,
        vendorCode,
        label: '24H派签告警落地页首次同步',
      })
      if (!synced.ok) {
        res.status(502).json({ ok: false, error: synced.message })
        return
      }
      res.json({ ok: true, data: synced.data.points })
      return
    }

    await ensureProblemReasons({ stationCode, dataDate, vendorCode })
    await geocodePendingMapPoints({ stationCode, dataDate, vendorCode })
    const points = await queryDriverMapPoints({ stationCode, dataDate, vendorCode })
    if (!points.ok) {
      res.status(502).json({ ok: false, error: points.message })
      return
    }
    res.json({ ok: true, data: points.data })
  } catch (err) {
    console.error('[dispatch-alarm-portal/driver-map]', err)
    res.status(500).json({ ok: false, error: 'internal_error' })
  }
})

dispatchAlarmPortalRouter.get('/:token', rateLimit, async (req: Request, res: Response) => {
  const token = String(req.params.token ?? '').trim().toLowerCase()
  if (!SHARE_TOKEN_PATTERN.test(token)) {
    sendNotFound(res)
    return
  }
  try {
    const data = await loadDispatchAlarmShareSnapshot(token)
    if (!data) {
      sendNotFound(res)
      return
    }
    res.json({ ok: true, data })
  } catch (err) {
    console.error('[dispatch-alarm-portal] 读取失败:', err)
    sendNotFound(res)
  }
})
