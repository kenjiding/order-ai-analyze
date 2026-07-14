import { Router, type Request, type Response } from 'express'
import { fetchNewMerchantWaybills } from '../imile/newMerchantWaybills'
import { readImileTokenFromRequest } from './imileAuth'

export const newMerchantRouter = Router()

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 31
const MAX_CLIENT_CODES = 20

function readJson<T>(req: Request): T {
  return req.body as T
}

function parseDateKey(raw: unknown): string | null {
  const value = String(raw ?? '').trim()
  if (!DATE_KEY_RE.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return value
}

function diffDaysInclusive(start: string, end: string): number {
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const startMs = Date.UTC(sy, sm - 1, sd)
  const endMs = Date.UTC(ey, em - 1, ed)
  return Math.floor((endMs - startMs) / 86_400_000) + 1
}

function parseClientCodes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const cleaned = new Set<string>()
  for (const item of raw) {
    const v = String(item ?? '').trim().toUpperCase()
    if (v) cleaned.add(v)
  }
  return cleaned.size ? Array.from(cleaned) : null
}

newMerchantRouter.post('/waybills', async (req: Request, res: Response) => {
  try {
    const body = readJson<{
      imileToken?: string
      clientCodes?: unknown
      startDate?: string
      endDate?: string
    }>(req)

    const token = readImileTokenFromRequest(req, body.imileToken)
    const startDate = parseDateKey(body.startDate)
    const endDate = parseDateKey(body.endDate)
    const clientCodes = parseClientCodes(body.clientCodes)

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken，请在全局设置中配置' })
      return
    }
    if (!clientCodes) {
      res.status(400).json({ error: '请提供至少一个有效的商家代码 (clientCodes)' })
      return
    }
    if (clientCodes.length > MAX_CLIENT_CODES) {
      res.status(400).json({ error: `商家代码数量不能超过 ${MAX_CLIENT_CODES} 个` })
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

    const rangeDays = diffDaysInclusive(startDate, endDate)
    if (rangeDays > MAX_RANGE_DAYS) {
      res.status(400).json({ error: `日期区间不能超过 ${MAX_RANGE_DAYS} 天` })
      return
    }

    const startTime = `${startDate} 00:00:00`
    const endTime = `${endDate} 23:59:59`

    const result = await fetchNewMerchantWaybills({
      imileToken: token,
      clientCodes,
      startTime,
      endTime,
    })

    if (!result.ok) {
      res.status(502).json({
        error: result.message,
        status: result.status,
        rawText: result.rawText,
      })
      return
    }

    res.json({
      records: result.records,
      meta: {
        startTime,
        endTime,
        clientCodes,
        fetched: result.records.length,
        totalResult: result.totalResult,
      },
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '新商家运单查询失败' })
  }
})
