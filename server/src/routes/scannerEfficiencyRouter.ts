import { Router, type Request, type Response } from 'express'
import { queryImileInboundScans } from '../imile/inbound'
import type { ImilePortalOverrides } from '../imile/portal'
import { readImileTokenFromRequest } from './imileAuth'

export const scannerEfficiencyRouter = Router()

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 31

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

function parseImilePortalOverrides(raw: unknown): ImilePortalOverrides | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const input = raw as Record<string, unknown>
  const hubcode = String(input.hubcode ?? '').trim()
  const resourceCode = String(input.resourceCode ?? '').trim()
  const userCode = String(input.userCode ?? '').trim()
  if (!hubcode && !resourceCode && !userCode) return undefined
  return {
    ...(hubcode ? { hubcode } : {}),
    ...(resourceCode ? { resourceCode } : {}),
    ...(userCode ? { userCode } : {}),
  }
}

scannerEfficiencyRouter.post('/inbound-scans', async (req: Request, res: Response) => {
  try {
    const body = readJson<{
      imileToken?: string
      startDate?: string
      endDate?: string
      imilePortal?: unknown
    }>(req)
    const token = readImileTokenFromRequest(req, body.imileToken)
    const startDate = parseDateKey(body.startDate)
    const endDate = parseDateKey(body.endDate)

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken，请在全局设置中配置' })
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

    const result = await queryImileInboundScans({
      imileToken: token,
      startTime: `${startDate} 00:00:00`,
      endTime: `${endDate} 23:59:59`,
      portal: parseImilePortalOverrides(body.imilePortal),
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
      raw: result.raw,
      meta: {
        startDate,
        endDate,
        totalResult: result.totalResult,
        fetched: result.records.length,
      },
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '到件扫描拉取失败' })
  }
})
