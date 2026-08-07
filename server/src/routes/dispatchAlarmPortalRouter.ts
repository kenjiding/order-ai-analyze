import { Router, type Request, type Response, type NextFunction } from 'express'
import { loadDispatchAlarmShareSnapshot } from '../feishu/dispatchAlarmShareSnapshot'
import { ensureProblemReasons, geocodePendingMapPoints, queryDriverMapPoints } from '../driverMap/driverMapPointsQuery'

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
    const { stationCode, date: dataDate, vendorCode } = snapshot
    if (!stationCode || !/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) {
      res.json({ ok: true, data: null })
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
