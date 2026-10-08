import { Router, type Request, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import {
  createDispatchPerformanceException,
  deleteDispatchPerformanceException,
  listDispatchPerformanceExceptions,
  listDispatchPerformanceSuppliers,
  listSettledArrivalDates,
  queryDispatchPerformance,
  queryDispatchProfitTrend,
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
import { readDispatchPerformanceImileToken, resolveStationCalendar } from '../dispatch24hStats/dailyStatsJob'
import { DEFAULT_SETTLE_TIME, isValidSettleTime } from '../dispatch24hStats/settleTime'
import { dispatchBatchSettleMs, resolveExitSettledArrivalDates } from '../dispatch24hStats/settledArrivalDates'
import { getOrFetchInboundWaybillNos, loadInboundWaybillIndex } from '../imile/inboundWaybillIndex'
import { upsertStationDayWaybillRecords } from '../imile/stationDayWaybillSync'
import { resolveEnqueueRegionCode, sendJobAccessDenied } from '../jobs/access'
import {
  DISPATCH_PERFORMANCE_SETTLE_JOB_TYPE,
  DISPATCH_PERFORMANCE_UPLOAD_SETTLE_JOB_TYPE,
} from '../jobs/handlers'
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

/** 报备的运单号：数组或按行/逗号分隔的文本都接受，去重、去空白 */
function parseWaybillNos(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? raw.split(/[\n,]/)
      : []
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))]
}

/**
 * 未传该字段（key 缺失）= 不改；显式传 null = 清空覆盖、改回沿用全局默认；
 * 非法数字报错，避免存进一个 0 或负数把这个站点的统计整体锁死（isNoSortingBatch 恒为 false/true）。
 */
function parseMinSortingWaybills(body: Record<string, unknown>): { value: number | null | undefined; error?: string } {
  if (!('minSortingWaybills' in body)) return { value: undefined }
  const raw = body.minSortingWaybills
  if (raw === null) return { value: null }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    return { value: undefined, error: '开仓判定阈值应为正整数' }
  }
  return { value: n }
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

function requestUserName(req: Request): string {
  const user = (req as AuthenticatedRequest).authUser
  return user?.displayName?.trim() || user?.username?.trim() || ''
}

/**
 * 同州账号共享同一份配置（读写都算），global/空是老数据的历史兜底、谁都能碰。
 * 与 fleetSupplierPushRouter 的 canManageSupplierConfig 同一套规则、也要跟
 * regionVisible() 的三选一保持一致——否则会出现「列表里看得到，点进去却 403」。
 */
function canAccessDispatchPerformanceConfig(configRegionCode: string, userRegionCode: string): boolean {
  const region = configRegionCode.trim()
  return region === '' || region === LEGACY_GLOBAL_SUPPLIER_REGION_CODE || region === userRegionCode
}

function sendCrossRegionDenied(res: Response, action: '查看' | '编辑' | '删除' | '触发'): void {
  res.status(403).json({ error: `无权${action}其他州的统计配置` })
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
  const minSortingWaybills = parseMinSortingWaybills(body)
  if (minSortingWaybills.error) return res.status(400).json({ error: minSortingWaybills.error })

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
      minSortingWaybills: minSortingWaybills.value,
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
  const minSortingWaybills = parseMinSortingWaybills(body)
  if (minSortingWaybills.error) return res.status(400).json({ error: minSortingWaybills.error })

  try {
    const existing = await findDispatchPerformanceConfig(id)
    if (!existing) return res.status(404).json({ error: '配置不存在' })
    if (!canAccessDispatchPerformanceConfig(existing.regionCode, requestRegionCode(req))) {
      return sendCrossRegionDenied(res, '编辑')
    }
    if (stationCode && (await isStationTaken(stationCode, id))) {
      return res.status(409).json({ error: '该站点已有统计配置，不能重复添加' })
    }
    const updated = await updateDispatchPerformanceConfig(id, {
      stationCode,
      stationName: body.stationName == null ? undefined : String(body.stationName).trim(),
      pushConfigIds,
      settleTime,
      minSortingWaybills: minSortingWaybills.value,
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
  const id = String(req.params.id ?? '').trim()
  try {
    const existing = await findDispatchPerformanceConfig(id)
    if (!existing) return res.status(404).json({ error: '配置不存在' })
    if (!canAccessDispatchPerformanceConfig(existing.regionCode, requestRegionCode(req))) {
      return sendCrossRegionDenied(res, '删除')
    }
    const ok = await deleteDispatchPerformanceConfig(id)
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
    if (!canAccessDispatchPerformanceConfig(config.regionCode, requestRegionCode(req))) {
      return sendCrossRegionDenied(res, '查看')
    }

    const result = await queryDispatchPerformance({
      stationCode: config.stationCode,
      ...range,
      supplierKeys: parseSupplierKeys(req.query.supplierKey ?? req.query.supplierKeys),
      // 口径开关：缺省（含老链接）= 剔除白名单，只有显式要全量才带 whitelist=include
      includeWhitelist: req.query.whitelist === 'include',
    })
    const { tz, overrides } = await resolveStationCalendar(config)

    // 周末也照常结算（没开仓的日子台账记「跑过」、不写格子），所以不再按星期几排除
    const dueDates = resolveExitSettledArrivalDates(Date.now(), tz, MAX_RANGE_DAYS, overrides).filter(
      (d) => d >= range.startDate && d <= range.endDate,
    )
    const [supplierOptions, recentBatches, exitSettled] = await Promise.all([
      listDispatchPerformanceSuppliers({ stationCode: config.stationCode, ...range }),
      listRecentSettledBatches(config.stationCode, tz, overrides),
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
 * 司机利润趋势的原始明细：按 (到件日, 供应商, 司机) 不合桶。天/周/月切换、按司机全局合并
 * （同一人可能跨供应商接单）都由前端本地算，与 /data 共享同一套权限校验。
 */
dispatchPerformanceRouter.get('/configs/:id/profit-trend', async (req: Request, res: Response) => {
  const range = parseRange(req.query as Record<string, unknown>)
  if ('error' in range) return res.status(400).json({ error: range.error })

  try {
    const config = await findDispatchPerformanceConfig(String(req.params.id ?? '').trim())
    if (!config) return res.status(404).json({ error: '配置不存在' })
    if (!canAccessDispatchPerformanceConfig(config.regionCode, requestRegionCode(req))) {
      return sendCrossRegionDenied(res, '查看')
    }

    const rows = await queryDispatchProfitTrend({
      stationCode: config.stationCode,
      ...range,
      supplierKeys: parseSupplierKeys(req.query.supplierKey ?? req.query.supplierKeys),
      includeWhitelist: req.query.whitelist === 'include',
    })
    return res.json({ rows })
  } catch (err) {
    console.error('[dispatch-performance] 司机利润趋势查询失败:', err)
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
    if (!canAccessDispatchPerformanceConfig(config.regionCode, requestRegionCode(req))) {
      return sendCrossRegionDenied(res, '触发')
    }
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

/** 上传表格里允许落缓存的字段（searchWaybill 的字段名，由前端从中心运单查询表的中文列转来） */
const UPLOAD_RECORD_FIELDS = [
  'waybillNo',
  'deliveryTime',
  'signDate',
  'lastProblemDate',
  'problemReason',
  'courier',
  'courierCode',
  'courierVendorCode',
  'clientCode',
  'consigneeRouteCode',
  'consigneeZipCode',
  'consigneeCity',
  'consigneeProvince',
  'consigneeAddress',
] as const

/**
 * 「上传运单表结算」：iMile 拦截 searchWaybill（网关 429）时，用中心运单查询导出的表格补某个到件日。
 *
 * 只替换「拉明细」这一步：表格明细按 searchWaybill 的字段写进运单缓存，再入队一个作业，
 * 由 worker 以 fromUpload 模式走与定时结算相同的 settleOneArrivalDate（见 dispatchPerformanceUploadSettleHandler）。
 *
 * 写缓存前必须全部通过，任何一条不过都不动数据库：
 * 1. 派签窗口已关闭 —— 窗口没到期就结算会把还在派送的单记成未达标，且这里落的是权威值
 * 2. 这天没被权威结算过 —— 已结算的历史不覆盖（临时值除外，权威结果本就该覆盖它）
 * 3. 到件索引 100% 被表格覆盖 —— 缺单直接拒绝并返回缺失单号；结算不回补，残缺数据写进去就永久偏了
 */
dispatchPerformanceRouter.post('/configs/:id/upload-settle', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const arrivalDate = parseDateKey(body.arrivalDate)
  if (!arrivalDate) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' })
  if (!Array.isArray(body.records) || body.records.length === 0) {
    return res.status(400).json({ error: '没有解析到任何运单，请上传「中心运单查询」导出的表格' })
  }

  try {
    const config = await findDispatchPerformanceConfig(String(req.params.id ?? '').trim())
    if (!config) return res.status(404).json({ error: '配置不存在' })
    if (!canAccessDispatchPerformanceConfig(config.regionCode, requestRegionCode(req))) {
      return sendCrossRegionDenied(res, '触发')
    }
    if (!config.isEnabled) return res.status(400).json({ error: '该站点统计已停用，请先启用' })
    const stationCode = config.stationCode

    const calendar = await resolveStationCalendar(config)
    const windowCloseMs = dispatchBatchSettleMs(arrivalDate, calendar.tz, calendar.overrides)
    if (Date.now() <= windowCloseMs) {
      const closeAt = new Intl.DateTimeFormat('sv-SE', {
        timeZone: calendar.tz,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(windowCloseMs))
      return res.status(400).json({ error: `${arrivalDate} 的派签窗口要到 ${closeAt}（站点当地时间）才关闭，之后才能上传结算` })
    }

    const settled = await listSettledArrivalDates(stationCode, [arrivalDate], 'dispatch', {
      excludeProvisional: true,
    })
    if (settled.has(arrivalDate)) {
      return res.status(400).json({ error: `${arrivalDate} 已经结算过，不再覆盖` })
    }

    // 上传写缓存与 worker 读缓存之间不能再插进一次上传
    const { rows: jobRows } = await listJobs({ type: DISPATCH_PERFORMANCE_UPLOAD_SETTLE_JOB_TYPE, limit: 100 })
    const busy = jobRows.some(
      (row) =>
        (row.status === 'pending' || row.status === 'running') &&
        (row.payload as { stationCode?: unknown } | null)?.stationCode === stationCode,
    )
    if (busy) return res.status(409).json({ error: '该站点已有上传结算任务在跑，请等它完成' })

    // 到件索引（分母）：优先现拉最新的；iMile 拦截时退回本地缓存
    const token = await readDispatchPerformanceImileToken(requestUserId(req))
    let indexNos: string[] | null = null
    let indexError = '缺少 iMile token'
    if (token) {
      const fetched = await getOrFetchInboundWaybillNos({
        token,
        stationCode,
        dateStr: arrivalDate,
        label: '上传运单表结算 到件索引',
        forceRefresh: true,
      })
      if (fetched.ok) indexNos = fetched.waybillNos
      else indexError = fetched.message
    }
    if (!indexNos || indexNos.length === 0) indexNos = await loadInboundWaybillIndex(stationCode, arrivalDate)
    if (!indexNos || indexNos.length === 0) {
      return res.status(400).json({ error: `拿不到 ${arrivalDate} 的到件索引（${indexError}），本地也没有缓存` })
    }

    const recordsByNo = new Map<string, Record<string, string>>()
    for (const raw of body.records) {
      if (raw == null || typeof raw !== 'object') continue
      const src = raw as Record<string, unknown>
      const record: Record<string, string> = {}
      for (const key of UPLOAD_RECORD_FIELDS) {
        const v = src[key]
        record[key] = v == null ? '' : String(v).trim()
      }
      if (!record.waybillNo) continue
      // 与 searchWaybill 的 lastScanStationCode 过滤对齐：最新扫描已不在本站的单落缓存但不计入统计
      // （聚合按 lastScanSiteCode 过滤）。表格里只有网点名，按站点配置的展示名比对。
      const siteName = src.lastScanSiteName == null ? '' : String(src.lastScanSiteName).trim()
      const isHere = !siteName || !config.stationName || siteName.toLowerCase() === config.stationName.trim().toLowerCase()
      record.lastScanSiteCode = isHere ? stationCode : siteName
      recordsByNo.set(record.waybillNo, record)
    }

    const missingWaybillNos = indexNos.filter((no) => !recordsByNo.has(no))
    if (missingWaybillNos.length > 0) {
      return res.status(400).json({
        error: `到件 ${indexNos.length} 单，表格只覆盖 ${indexNos.length - missingWaybillNos.length} 单，缺 ${missingWaybillNos.length} 单，请补导后重新上传`,
        indexCount: indexNos.length,
        missingWaybillNos,
      })
    }

    // 只落索引内的单：表格常按首次到件时间导出，会混进不属于这天到件的单
    await upsertStationDayWaybillRecords({
      stationCode,
      dataDate: arrivalDate,
      records: indexNos.map((no) => recordsByNo.get(no)!),
    })

    const regionCode = resolveEnqueueRegionCode(req as AuthenticatedRequest, null)
    if (regionCode === 'forbidden' || regionCode === 'invalid') {
      sendJobAccessDenied(res)
      return
    }
    const job = await enqueueJob({
      type: DISPATCH_PERFORMANCE_UPLOAD_SETTLE_JOB_TYPE,
      regionCode,
      payload: { stationCode, arrivalDate },
      createdBy: requestUserId(req),
      // 只读缓存、不打 iMile，重试安全：已落库会被台账挡掉
      maxAttempts: 2,
    })
    return res.status(201).json({ job: toPublicJob(job), indexCount: indexNos.length })
  } catch (err) {
    console.error('[dispatch-performance] 上传运单表结算失败:', err)
    return res.status(500).json({ error: (err as Error).message || '上传结算失败' })
  }
})

// ── 派签异常报备：司机事故/车坏等不可抗力，按件剔除派送类指标 ──────────────────────

/**
 * 新增报备：不校验运单号是否真的「未签收」——报备时刻通常早于结算（事故当天就要报，
 * 派签要 D+2 才结算），此时格子可能还没落库。是否生效交给查询侧的交集逻辑。
 */
dispatchPerformanceRouter.post('/configs/:id/exceptions', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const arrivalDate = parseDateKey(body.arrivalDate)
  if (!arrivalDate) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' })
  const supplierKey = String(body.supplierKey ?? '').trim()
  if (!supplierKey) return res.status(400).json({ error: '请选择供应商' })
  const routeCode = String(body.routeCode ?? '').trim()
  if (!routeCode) return res.status(400).json({ error: '请填写路由码' })
  const courierCode = String(body.courierCode ?? '').trim()
  if (!courierCode) return res.status(400).json({ error: '请填写司机' })
  const waybillNos = parseWaybillNos(body.waybillNos)
  if (waybillNos.length === 0) return res.status(400).json({ error: '请至少填写一个运单号' })
  const reason = String(body.reason ?? '').trim()
  if (!reason) return res.status(400).json({ error: '请填写报备原因' })

  try {
    const config = await findDispatchPerformanceConfig(String(req.params.id ?? '').trim())
    if (!config) return res.status(404).json({ error: '配置不存在' })
    if (!canAccessDispatchPerformanceConfig(config.regionCode, requestRegionCode(req))) {
      return sendCrossRegionDenied(res, '编辑')
    }
    const row = await createDispatchPerformanceException({
      stationCode: config.stationCode,
      arrivalDate,
      supplierKey,
      routeCode,
      courierCode,
      waybillNos,
      reason,
      reportedBy: requestUserId(req),
      reportedByName: requestUserName(req),
    })
    return res.status(201).json(row)
  } catch (err) {
    console.error('[dispatch-performance] 新增异常报备失败:', err)
    return res.status(500).json({ error: '新增失败' })
  }
})

/** 列出报备记录：默认按当前详情页选中的日期区间，可选按供应商/路由码/司机再窄一层 */
dispatchPerformanceRouter.get('/configs/:id/exceptions', async (req: Request, res: Response) => {
  const range = parseRange(req.query as Record<string, unknown>)
  if ('error' in range) return res.status(400).json({ error: range.error })

  try {
    const config = await findDispatchPerformanceConfig(String(req.params.id ?? '').trim())
    if (!config) return res.status(404).json({ error: '配置不存在' })
    if (!canAccessDispatchPerformanceConfig(config.regionCode, requestRegionCode(req))) {
      return sendCrossRegionDenied(res, '查看')
    }
    const supplierKey = typeof req.query.supplierKey === 'string' ? req.query.supplierKey.trim() : undefined
    const routeCode = typeof req.query.routeCode === 'string' ? req.query.routeCode.trim() : undefined
    const courierCode = typeof req.query.courierCode === 'string' ? req.query.courierCode.trim() : undefined
    const exceptions = await listDispatchPerformanceExceptions({
      stationCode: config.stationCode,
      ...range,
      supplierKey: supplierKey || undefined,
      routeCode: routeCode || undefined,
      courierCode: courierCode || undefined,
    })
    return res.json({ exceptions })
  } catch (err) {
    console.error('[dispatch-performance] 异常报备查询失败:', err)
    return res.status(500).json({ error: '查询失败' })
  }
})

dispatchPerformanceRouter.delete('/configs/:id/exceptions/:exceptionId', async (req: Request, res: Response) => {
  try {
    const config = await findDispatchPerformanceConfig(String(req.params.id ?? '').trim())
    if (!config) return res.status(404).json({ error: '配置不存在' })
    if (!canAccessDispatchPerformanceConfig(config.regionCode, requestRegionCode(req))) {
      return sendCrossRegionDenied(res, '删除')
    }
    const ok = await deleteDispatchPerformanceException(
      String(req.params.exceptionId ?? '').trim(),
      config.stationCode,
    )
    if (!ok) return res.status(404).json({ error: '报备记录不存在' })
    return res.json({ ok: true })
  } catch (err) {
    console.error('[dispatch-performance] 撤回异常报备失败:', err)
    return res.status(500).json({ error: '撤回失败' })
  }
})
