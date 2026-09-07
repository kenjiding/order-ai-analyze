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
    const { stationCode, dataDates, vendorCode, routeCodes, routeCodeWhitelist } = snapshot
    // 同一 vendorCode 可能对应多条供应商配置（ADL-City / ADL-Lu），必须连路由码一起收窄，
    // 否则地图点位与派送单量会把同编码另一家的单也算进来
    const scope = { vendorCode, routeCodes, routeCodeWhitelist }
    // 按快照记录的真实到件日查（可能多天）；snapshot.date 是展示标签，多到件日时是拼接串，不能拿来查库
    const dates = dataDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    if (!stationCode || dates.length === 0) {
      // 勾了司机地图却拿不到业务日期，前端会把整块地图静默隐藏——留一行日志，别再让人对着空白页猜
      console.warn(
        `[dispatch-alarm-portal/driver-map] 快照缺少可用业务日期，跳过地图 token=${token} station=${stationCode} dataDates=${JSON.stringify(dataDates)}`,
      )
      res.json({ ok: true, data: null })
      return
    }

    // 缓存是按「站点+日」整站同步的：没同步过的日子现场补一次，同步过的只增量补坐标
    for (const dataDate of dates) {
      if (await hasDriverMapWaybillRows({ stationCode, dataDate })) {
        await ensureProblemReasons({ stationCode, dataDate, scope })
        await geocodePendingMapPoints({ stationCode, dataDate, scope })
        continue
      }
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
        scope,
        label: '24H派签告警落地页首次同步',
      })
      if (!synced.ok) {
        res.status(502).json({ ok: false, error: synced.message })
        return
      }
    }

    const points = await queryDriverMapPoints({ stationCode, dataDate: dates, scope })
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
