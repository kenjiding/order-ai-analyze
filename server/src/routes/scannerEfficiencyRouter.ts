import { and, desc, eq, inArray } from 'drizzle-orm'
import { Router, type Request, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb } from '../db'
import { efficiencyAttendanceDailyRecords } from '../db/schema'
import { queryImileBoxAssignedList } from '../imile/boxAssignedList'
import { analyzeCancelScan } from '../imile/cancelScanAnalysis'
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

function resolveRegionCode(req: AuthenticatedRequest): string {
  return String(req.authUser?.regionCode ?? '').trim() || 'global'
}

function isRecordPayload(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

scannerEfficiencyRouter.get('/daily-records', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const regionCode = resolveRegionCode(req)
    const db = getDb()
    const rows = await db
      .select({
        recordDate: efficiencyAttendanceDailyRecords.recordDate,
        payload: efficiencyAttendanceDailyRecords.payload,
        updatedAt: efficiencyAttendanceDailyRecords.updatedAt,
      })
      .from(efficiencyAttendanceDailyRecords)
      .where(eq(efficiencyAttendanceDailyRecords.regionCode, regionCode))
      .orderBy(desc(efficiencyAttendanceDailyRecords.recordDate))

    res.json({
      items: rows.map((row) => ({
        date: row.recordDate,
        updatedAt: row.updatedAt.toISOString(),
        payload: row.payload,
      })),
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '读取效率考勤记录失败' })
  }
})

scannerEfficiencyRouter.get('/daily-records/:date', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const date = parseDateKey(req.params.date)
    if (!date) {
      res.status(400).json({ error: '无效的日期参数' })
      return
    }

    const regionCode = resolveRegionCode(req)
    const db = getDb()
    const [row] = await db
      .select()
      .from(efficiencyAttendanceDailyRecords)
      .where(
        and(
          eq(efficiencyAttendanceDailyRecords.recordDate, date),
          eq(efficiencyAttendanceDailyRecords.regionCode, regionCode),
        ),
      )
      .limit(1)

    if (!row) {
      res.status(404).json({ error: '未找到该日期的效率考勤记录' })
      return
    }

    res.json({
      date: row.recordDate,
      updatedAt: row.updatedAt.toISOString(),
      payload: row.payload,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '读取效率考勤记录失败' })
  }
})

scannerEfficiencyRouter.post('/daily-records', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = readJson<{ records?: unknown[] }>(req)
    const records = Array.isArray(body.records) ? body.records : []
    if (!records.length) {
      res.status(400).json({ error: '请提供至少一条按日记录' })
      return
    }

    const regionCode = resolveRegionCode(req)
    const db = getDb()
    const now = new Date()
    const validRecords: Array<{ date: string; payload: Record<string, unknown> }> = []

    for (const item of records) {
      if (!isRecordPayload(item)) continue
      const date = parseDateKey(item.date)
      const payload = item
      if (!date || (payload.schemaVersion !== 1 && payload.schemaVersion !== 2)) continue
      validRecords.push({ date, payload })
    }

    if (!validRecords.length) {
      res.status(400).json({ error: '没有有效的按日记录可保存' })
      return
    }

    await db.transaction(async (tx) => {
      for (const { date, payload } of validRecords) {
        await tx
          .insert(efficiencyAttendanceDailyRecords)
          .values({
            recordDate: date,
            regionCode,
            payload,
            savedBy: req.authUser?.id ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              efficiencyAttendanceDailyRecords.recordDate,
              efficiencyAttendanceDailyRecords.regionCode,
            ],
            set: {
              payload,
              savedBy: req.authUser?.id ?? null,
              updatedAt: now,
            },
          })
      }
    })

    res.json({ savedCount: validRecords.length })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '保存效率考勤记录失败' })
  }
})

scannerEfficiencyRouter.post('/daily-records/batch-delete', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = readJson<{ dates?: unknown[] }>(req)
    const rawDates = Array.isArray(body.dates) ? body.dates : []
    const dates = Array.from(
      new Set(
        rawDates
          .map((item) => parseDateKey(item))
          .filter((date): date is string => date != null),
      ),
    )

    if (!dates.length) {
      res.status(400).json({ error: '请提供至少一个有效日期' })
      return
    }

    const regionCode = resolveRegionCode(req)
    const db = getDb()
    const deleted = await db
      .delete(efficiencyAttendanceDailyRecords)
      .where(
        and(
          eq(efficiencyAttendanceDailyRecords.regionCode, regionCode),
          inArray(efficiencyAttendanceDailyRecords.recordDate, dates),
        ),
      )
      .returning({ recordDate: efficiencyAttendanceDailyRecords.recordDate })

    res.json({
      deletedCount: deleted.length,
      deletedDates: deleted.map((row) => row.recordDate).sort((a, b) => a.localeCompare(b)),
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '批量删除效率考勤记录失败' })
  }
})

scannerEfficiencyRouter.delete('/daily-records/:date', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const date = parseDateKey(req.params.date)
    if (!date) {
      res.status(400).json({ error: '无效的日期参数' })
      return
    }

    const regionCode = resolveRegionCode(req)
    const db = getDb()
    const deleted = await db
      .delete(efficiencyAttendanceDailyRecords)
      .where(
        and(
          eq(efficiencyAttendanceDailyRecords.recordDate, date),
          eq(efficiencyAttendanceDailyRecords.regionCode, regionCode),
        ),
      )
      .returning({ id: efficiencyAttendanceDailyRecords.id })

    if (!deleted.length) {
      res.status(404).json({ error: '未找到该日期的效率考勤记录' })
      return
    }

    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '删除效率考勤记录失败' })
  }
})

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

scannerEfficiencyRouter.post('/box-assigned-list', async (req: Request, res: Response) => {
  try {
    const body = readJson<{
      imileToken?: string
      startDate?: string
      endDate?: string
      country?: string
      pendingHubCode?: string
      pendingHubName?: string
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

    const portal = parseImilePortalOverrides(body.imilePortal)

    const result = await queryImileBoxAssignedList({
      imileToken: token,
      startTime: `${startDate} 00:00:00`,
      endTime: `${endDate} 23:59:59`,
      country: String(body.country ?? '').trim() || undefined,
      pendingHubCode: String(body.pendingHubCode ?? '').trim() || undefined,
      pendingHubName: String(body.pendingHubName ?? '').trim() || undefined,
      portal,
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
    res.status(500).json({ error: (e as Error).message || '前台箱号分配拉取失败' })
  }
})

scannerEfficiencyRouter.post('/cancel-scan-analysis', async (req: Request, res: Response) => {
  try {
    const body = readJson<{
      imileToken?: string
      startDate?: string
      endDate?: string
      scanStationCode?: string
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

    const portal = parseImilePortalOverrides(body.imilePortal)
    const scanStationCode = String(body.scanStationCode ?? '').trim() || undefined

    const result = await analyzeCancelScan({
      imileToken: token,
      startTime: `${startDate} 00:00:00`,
      endTime: `${endDate} 23:59:59`,
      scanStationCode,
      portal,
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
      cancelScanRecords: result.cancelScanRecords,
      waybillRecords: result.waybillRecords,
      routeCodeDistribution: result.routeCodeDistribution,
      dailyRouteCodeCounts: result.dailyRouteCodeCounts,
      raw: result.raw,
      meta: {
        startDate,
        endDate,
        cancelScanTotal: result.cancelScanTotal,
        cancelScanFetched: result.cancelScanRecords.length,
        waybillCount: result.waybillNos.length,
        waybillFetched: result.waybillRecords.length,
      },
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '取消扫描分析失败' })
  }
})
