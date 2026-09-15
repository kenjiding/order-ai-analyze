import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { resolveRegionTz } from '../imile/ausTimezone'
import { enumerateDatesInclusive } from '../exitRateQuery/aggregate'
import { queryExitRates } from '../exitRateQuery/query'
import { readImileTokenFromRequest } from './imileAuth'

export const exitRateQueryRouter = Router()

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 7

function parseDateKey(raw: unknown): string | null {
  const value = String(raw ?? '').trim()
  if (!DATE_KEY_RE.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return value
}

exitRateQueryRouter.post('/query', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      imileToken?: string
      stationCode?: string
      startDate?: string
      endDate?: string
    }

    const token = readImileTokenFromRequest(req, body.imileToken)
    const stationCode =
      String(body.stationCode ?? '').trim() || String(req.headers['hubcode'] ?? '').trim()
    const startDate = parseDateKey(body.startDate)
    const endDate = parseDateKey(body.endDate)

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken，请在全局设置中配置' })
      return
    }
    if (!stationCode) {
      res.status(400).json({ error: '请先在顶部选择站点' })
      return
    }
    if (!startDate || !endDate) {
      res.status(400).json({ error: '请提供有效的 startDate / endDate（YYYY-MM-DD）' })
      return
    }
    if (startDate > endDate) {
      res.status(400).json({ error: '开始日期不能晚于结束日期' })
      return
    }
    const rangeDays = enumerateDatesInclusive(startDate, endDate).length
    if (rangeDays > MAX_RANGE_DAYS) {
      res.status(400).json({ error: `到件日期区间不能超过 ${MAX_RANGE_DAYS} 天` })
      return
    }

    const result = await queryExitRates({
      token,
      stationCode,
      startDate,
      endDate,
      tz: resolveRegionTz(req.authUser?.regionCode),
    })
    if (!result.ok) {
      res.status(result.status).json({ ok: false, error: result.message })
      return
    }
    res.json({ ok: true, data: result.data })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '出仓率查询失败' })
  }
})
