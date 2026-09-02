import { Router, type Request, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import {
  listDispatchPerformanceSuppliers,
  listSettledArrivalDates,
  queryDispatchPerformance,
} from '../dispatch24hStats/repository'
import {
  createDispatchPerformanceConfig,
  deleteDispatchPerformanceConfig,
  findDispatchPerformanceConfig,
  isStationTaken,
  listDispatchPerformanceConfigViews,
  listRecentSettledBatches,
  updateDispatchPerformanceConfig,
} from '../dispatch24hStats/configRepository'
import { resolveStationTz } from '../dispatch24hStats/dailyStatsJob'
import { DEFAULT_SETTLE_TIME, isValidSettleTime } from '../dispatch24hStats/settleTime'
import {
  isWorkdayArrival,
  resolveExitSettledArrivalDates,
} from '../dispatch24hStats/settledArrivalDates'
import { resolveRegionTz } from '../imile/ausTimezone'
import { resolveEnqueueRegionCode, sendJobAccessDenied } from '../jobs/access'
import { DISPATCH_PERFORMANCE_SETTLE_JOB_TYPE } from '../jobs/handlers'
import { enqueueJob, listJobs } from '../jobs/queue'
import { toPublicJob } from '../jobs/types'
import { LEGACY_GLOBAL_SUPPLIER_REGION_CODE, parsePushConfigIds } from '../supplierPushConfigs'

export const dispatchPerformanceRouter = Router()

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
/** 查询区间上限：日度表按格子存，跨度过大时前端表格也失去可读性 */
const MAX_RANGE_DAYS = 62

function parseDateKey(raw: unknown): string | null {
  const value = String(raw ?? '').trim()
  if (!DATE_KEY_RE.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return value
}

function diffDaysInclusive(start: string, end: string): number {
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  return Math.floor((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000) + 1
}

function parseRange(
  source: Record<string, unknown>,
): { startDate: string; endDate: string } | { error: string } {
  const startDate = parseDateKey(source.startDate)
  const endDate = parseDateKey(source.endDate)
  if (!startDate || !endDate) return { error: '日期格式应为 YYYY-MM-DD' }
  if (startDate > endDate) return { error: '开始日期不能晚于结束日期' }
  const days = diffDaysInclusive(startDate, endDate)
  if (days > MAX_RANGE_DAYS) return { error: `查询区间最多 ${MAX_RANGE_DAYS} 天，当前 ${days} 天` }
  return { startDate, endDate }
}

function parseSupplierKeys(raw: unknown): string[] | undefined {
  if (typeof raw === 'string') {
    const keys = raw.split(',').map((k) => k.trim()).filter(Boolean)
    return keys.length ? keys : undefined
  }
  if (Array.isArray(raw)) {
    const keys = raw.map((k) => String(k).trim()).filter(Boolean)
    return keys.length ? keys : undefined
  }
  return undefined
}

function requestRegionCode(req: Request): string {
  return (
    String((req as AuthenticatedRequest).authUser?.regionCode ?? '').trim() ||
    LEGACY_GLOBAL_SUPPLIER_REGION_CODE
  )
}

function requestUserId(req: Request): string | null {
  return (req as AuthenticatedRequest).authUser?.id ?? null
}

// ── 站点配置：添加一条即开启该站点的每日两趟结算 ──────────────────────────────

dispatchPerformanceRouter.get('/configs', async (req: Request, res: Response) => {
  try {
    const regionCode = (req as AuthenticatedRequest).authUser?.regionCode ?? null
    return res.json({ configs: await listDispatchPerformanceConfigViews(regionCode) })
  } catch (err) {
    console.error('[dispatch-performance] 配置列表查询失败:', err)
    return res.status(500).json({ error: '查询失败' })
  }
})

dispatchPerformanceRouter.post('/configs', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const stationCode = String(body.stationCode ?? '').trim()
  const stationName = String(body.stationName ?? '').trim()
  if (!stationCode) return res.status(400).json({ error: '请选择站点' })
  // 必须至少勾一家：统计范围不再从 stationCode 反查，空列表会让这个站点每天空跑
  const pushConfigIds = parsePushConfigIds(body.pushConfigIds)
  if (pushConfigIds.length === 0) return res.status(400).json({ error: '请至少选择一个供应商' })
  const settleTime = body.settleTime == null ? DEFAULT_SETTLE_TIME : String(body.settleTime).trim()
  if (!isValidSettleTime(settleTime)) return res.status(400).json({ error: '触发统计时间格式应为 HH:mm' })

  try {
    // 站点全局唯一：结算产出的是共享数据，同一站点两条配置会重复结算、重复打 iMile
    if (await isStationTaken(stationCode)) {
      return res.status(409).json({ error: '该站点已有统计配置，不能重复添加' })
    }
    const config = await createDispatchPerformanceConfig({
      stationCode,
      stationName,
      regionCode: requestRegionCode(req),
      pushConfigIds,
      settleTime,
      isEnabled: body.isEnabled !== false,
      userId: requestUserId(req),
    })
    return res.json(config)
  } catch (err) {
    console.error('[dispatch-performance] 新增配置失败:', err)
    return res.status(500).json({ error: '新增失败' })
  }
})

dispatchPerformanceRouter.put('/configs/:id', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const id = String(req.params.id ?? '').trim()
  const stationCode = body.stationCode == null ? undefined : String(body.stationCode).trim()
  if (stationCode != null && !stationCode) return res.status(400).json({ error: '请选择站点' })
  const pushConfigIds = body.pushConfigIds == null ? undefined : parsePushConfigIds(body.pushConfigIds)
  if (pushConfigIds != null && pushConfigIds.length === 0) {
    return res.status(400).json({ error: '请至少选择一个供应商' })
  }
  const settleTime = body.settleTime == null ? undefined : String(body.settleTime).trim()
  if (settleTime != null && !isValidSettleTime(settleTime)) {
    return res.status(400).json({ error: '触发统计时间格式应为 HH:mm' })
  }

  try {
    const existing = await findDispatchPerformanceConfig(id)
    if (!existing) return res.status(404).json({ error: '配置不存在' })
    if (stationCode && (await isStationTaken(stationCode, id))) {
      return res.status(409).json({ error: '该站点已有统计配置，不能重复添加' })
    }
    const updated = await updateDispatchPerformanceConfig(id, {
      stationCode,
      stationName: body.stationName == null ? undefined : String(body.stationName).trim(),
      pushConfigIds,
      settleTime,
      isEnabled: typeof body.isEnabled === 'boolean' ? body.isEnabled : undefined,
      userId: requestUserId(req),
    })
    if (!updated) return res.status(404).json({ error: '配置不存在' })
    return res.json(updated)
  } catch (err) {
    console.error('[dispatch-performance] 更新配置失败:', err)
    return res.status(500).json({ error: '更新失败' })
  }
})

/** 删除配置只停止今后的统计；已结算的历史数据保留，重新添加同一站点即可再看到 */
dispatchPerformanceRouter.delete('/configs/:id', async (req: Request, res: Response) => {
  try {
    const ok = await deleteDispatchPerformanceConfig(String(req.params.id ?? '').trim())
    if (!ok) return res.status(404).json({ error: '配置不存在' })
    return res.json({ ok: true })
  } catch (err) {
    console.error('[dispatch-performance] 删除配置失败:', err)
    return res.status(500).json({ error: '删除失败' })
  }
})

// ── 单站点数据：详情页 ────────────────────────────────────────────────────────

/**
 * 某条配置对应站点的三层达成结果：供应商 → 路由码 → 司机。
 * 数据全部由每日结算任务产出，本接口只读不算。
 *
 * missingDates 给的是「日历上出仓趟已该跑完、台账里却没有跑过记录」的到件日 —— 只有这种
 * 才是真的漏跑。不能拿「日度表有没有行」去比：周末不分拣本就没有批次，不分拣的工作日
 * 聚合出 0 个格子也照样是跑过的，还有供应商筛选会让有数据的天看起来也是空的。
 */
dispatchPerformanceRouter.get('/configs/:id/data', async (req: Request, res: Response) => {
  const range = parseRange(req.query as Record<string, unknown>)
  if ('error' in range) return res.status(400).json({ error: range.error })

  try {
    const config = await findDispatchPerformanceConfig(String(req.params.id ?? '').trim())
    if (!config) return res.status(404).json({ error: '配置不存在' })

    const result = await queryDispatchPerformance({
      stationCode: config.stationCode,
      ...range,
      supplierKeys: parseSupplierKeys(req.query.supplierKey ?? req.query.supplierKeys),
    })
    // 时区必须与结算任务一致；本行 regionCode 就是结算取的那个州，只有空/global 才需要
    // 回落到 resolveStationTargets 那条重路径（全量供应商配置 + 建索引）
    const configRegion = config.regionCode?.trim()
    const tz =
      configRegion && configRegion !== LEGACY_GLOBAL_SUPPLIER_REGION_CODE
        ? resolveRegionTz(configRegion)
        : await resolveStationTz(config.stationCode)

    // 周末不分拣、没有到件批次，结算任务本就跳过（isWorkdayArrival），不算漏跑
    const dueDates = resolveExitSettledArrivalDates(Date.now(), tz, MAX_RANGE_DAYS).filter(
      (d) => d >= range.startDate && d <= range.endDate && isWorkdayArrival(d),
    )
    const [supplierOptions, recentBatches, exitSettled] = await Promise.all([
      listDispatchPerformanceSuppliers({ stationCode: config.stationCode, ...range }),
      listRecentSettledBatches(config.stationCode),
      listSettledArrivalDates(config.stationCode, dueDates, 'exit'),
    ])
    const missingDates = dueDates.filter((d) => !exitSettled.has(d))

    return res.json({
      config: {
        id: config.id,
        stationCode: config.stationCode,
        stationName: config.stationName,
        isEnabled: config.isEnabled,
      },
      ...result,
      missingDates,
      supplierOptions,
      recentBatches,
    })
  } catch (err) {
    console.error('[dispatch-performance] 数据查询失败:', err)
    return res.status(500).json({ error: '查询失败' })
  }
})


/**
 * 「立刻统计」：入队一个手动结算任务，由 worker 独占执行。
 *
 * 不在这里直接跑：调度器在 worker 进程，结算任务的 isRunning 互斥锁是进程内的，
 * 两个进程同时对同一个 (station, arrivalDate) 做 delete+insert 会互相打架。
 *
 * 出仓趟落库、派签趟只试算——原因见 dispatchPerformanceSettleHandler 的文件头。
 */
dispatchPerformanceRouter.post('/configs/:id/settle-now', async (req: Request, res: Response) => {
  try {
    const config = await findDispatchPerformanceConfig(String(req.params.id ?? '').trim())
    if (!config) return res.status(404).json({ error: '配置不存在' })
    if (!config.isEnabled) return res.status(400).json({ error: '该站点统计已停用，请先启用' })

    // 同一站点已有排队/执行中的任务就复用，避免连点打出多份 iMile 请求
    const { rows } = await listJobs({ type: DISPATCH_PERFORMANCE_SETTLE_JOB_TYPE, limit: 100 })
    const running = rows.find(
      (row) =>
        (row.status === 'pending' || row.status === 'running') &&
        (row.payload as { stationCode?: unknown } | null)?.stationCode === config.stationCode,
    )
    if (running) return res.json({ job: toPublicJob(running), reused: true })

    // 与 jobsRouter 用同一套归属判定，保证任务能被创建者按 canAccessJob 读回
    const regionCode = resolveEnqueueRegionCode(req as AuthenticatedRequest, null)
    if (regionCode === 'forbidden' || regionCode === 'invalid') {
      sendJobAccessDenied(res)
      return
    }

    const job = await enqueueJob({
      type: DISPATCH_PERFORMANCE_SETTLE_JOB_TYPE,
      regionCode,
      payload: { stationCode: config.stationCode },
      createdBy: requestUserId(req),
      // 中途失败重试是安全的：出仓趟已落库的到件日会被台账挡掉，不会重复写
      maxAttempts: 2,
    })
    return res.status(201).json({ job: toPublicJob(job), reused: false })
  } catch (err) {
    console.error('[dispatch-performance] 立刻统计入队失败:', err)
    return res.status(500).json({ error: (err as Error).message || '入队失败' })
  }
})
