import { Router, type Request, type Response, type NextFunction } from 'express'
import { loadDispatchAlarmShareSnapshot } from '../feishu/dispatchAlarmShareSnapshot'

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
