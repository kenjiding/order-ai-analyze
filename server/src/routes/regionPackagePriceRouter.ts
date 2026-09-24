import { Router, type Request, type Response } from 'express'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import { queryImileInboundScans } from '../imile/inbound'
import { fetchVendorWaybills, fetchVendors } from '../imile/vendorAnalysis'
import { dedupeScansByWaybill } from '../vendorRegionMap/parseInbound'
import { readImileTokenFromRequest } from './imileAuth'

export const regionPackagePriceRouter = Router()

/** 每条价格归属登录账号所属的州；没有州归属的账号不允许维护价格 */
function resolveRegionCode(req: AuthenticatedRequest): string {
  return String(req.authUser?.regionCode ?? '').trim()
}

const BULK_MAX_ROWS = 5000

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
/** 对齐窗口上限：路由码对齐允许比其他到件统计接口更长的窗口，覆盖低频派件区域 */
const ALIGN_MAX_RANGE_DAYS = 90

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

/** 路由码与 postcode+suburb 三元组的复合 key，用于 Map/Set 去重比较 */
function routeCodeTripleKey(postcode: string, suburb: string, routeCode: string): string {
  return `${postcode}\0${suburb}\0${routeCode}`
}

type WaybillVendorRouteInfo = { vendorCode: string; routeCode: string }

/**
 * 中心运单查询（searchWaybill）单条记录里挑出供应商编码 + 路由码。这两个字段是运单当前状态，
 * 比到件扫描那一刻的快照权威——到件时供应商经常还没回填（见 supplierMatcher.ts 的说明）。
 */
function parseWaybillVendorRoute(raw: unknown): { waybillNo: string; info: WaybillVendorRouteInfo } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const waybillNo = String(row.waybillNo ?? '').trim()
  if (!waybillNo) return null
  return {
    waybillNo,
    info: {
      vendorCode: String(row.courierVendorCode ?? '').trim(),
      routeCode: String(row.consigneeRouteCode ?? '').trim(),
    },
  }
}

/** 同一运单理论上只有一行，仍按「先到先得、缺的字段用后面的补齐」处理，跟到件扫描去重同口径 */
function dedupeWaybillVendorRoutes(records: unknown[]): Map<string, WaybillVendorRouteInfo> {
  const byWaybill = new Map<string, WaybillVendorRouteInfo>()
  for (const raw of records) {
    const parsed = parseWaybillVendorRoute(raw)
    if (!parsed) continue
    const existing = byWaybill.get(parsed.waybillNo)
    if (!existing) {
      byWaybill.set(parsed.waybillNo, parsed.info)
      continue
    }
    if (!existing.vendorCode && parsed.info.vendorCode) existing.vendorCode = parsed.info.vendorCode
    if (!existing.routeCode && parsed.info.routeCode) existing.routeCode = parsed.info.routeCode
  }
  return byWaybill
}

type PriceDraft = {
  postcode: string
  suburb: string
  price: number
  courierPrice: number
  vendorCode: string
  vendorName: string
}

/** 派送员价格默认口径：比包裹价格低 0.25，取两位小数且不为负 */
export function defaultCourierPrice(price: number): number {
  return Math.max(Math.round((price - 0.25) * 100) / 100, 0)
}

/** 解析请求体；返回字符串表示校验失败原因 */
function parseDraft(body: unknown): PriceDraft | string {
  const raw = (body ?? {}) as Record<string, unknown>
  const postcode = String(raw.postcode ?? '').trim()
  if (!postcode) return 'postcode 不能为空'
  if (postcode.length > 16) return 'postcode 过长'
  const suburb = String(raw.suburb ?? '').trim()
  if (!suburb) return 'suburb 不能为空'
  if (suburb.length > 128) return 'suburb 过长'
  // Number('') === 0，空价格不能被当成 0 元静默接受
  const priceText = String(raw.price ?? '').trim()
  const price = priceText ? Number(priceText) : Number.NaN
  if (!Number.isFinite(price) || price < 0) return '价格必须是不小于 0 的数字'
  // 派送员价格可不传，此时按默认口径从 price 推导
  const courierText = String(raw.courierPrice ?? '').trim()
  const courierPrice = courierText ? Number(courierText) : defaultCourierPrice(price)
  if (!Number.isFinite(courierPrice) || courierPrice < 0) return '派送员价格必须是不小于 0 的数字'
  const vendorCode = String(raw.vendorCode ?? '').trim()
  if (vendorCode.length > 64) return '供应商编码过长'
  const vendorName = String(raw.vendorName ?? '').trim()
  if (vendorName.length > 255) return '供应商名称过长'
  return { postcode, suburb, price, courierPrice, vendorCode, vendorName }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

/** 价格变了才把旧价格滚存进 pre_price，否则保留上一次的记录 */
const rollPrePrice = sql`CASE WHEN ${schema.regionPackagePrices.price} <> excluded.price THEN ${schema.regionPackagePrices.price} ELSE ${schema.regionPackagePrices.prePrice} END`

regionPackagePriceRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const regionCode = resolveRegionCode(req)
  if (!regionCode) {
    res.json({ ok: true, data: [] })
    return
  }
  try {
    const db = getDb()
    const [rows, routeCodeRows] = await Promise.all([
      db
        .select()
        .from(schema.regionPackagePrices)
        .where(eq(schema.regionPackagePrices.regionCode, regionCode))
        .orderBy(asc(schema.regionPackagePrices.postcode), asc(schema.regionPackagePrices.suburb)),
      db
        .select({
          postcode: schema.regionPackagePriceRouteCodes.postcode,
          suburb: schema.regionPackagePriceRouteCodes.suburb,
          routeCode: schema.regionPackagePriceRouteCodes.routeCode,
        })
        .from(schema.regionPackagePriceRouteCodes)
        .where(eq(schema.regionPackagePriceRouteCodes.regionCode, regionCode)),
    ])
    // 路由码是一对多，跟价格行按 postcode+suburb（大小写不敏感）拼装，不进唯一键
    const routeCodesByArea = new Map<string, string[]>()
    for (const r of routeCodeRows) {
      const key = `${r.postcode}|${r.suburb.toUpperCase()}`
      const list = routeCodesByArea.get(key)
      if (list) list.push(r.routeCode)
      else routeCodesByArea.set(key, [r.routeCode])
    }
    const data = rows.map((row) => ({
      ...row,
      routeCodes: (routeCodesByArea.get(`${row.postcode}|${row.suburb.toUpperCase()}`) ?? []).sort(),
    }))
    res.json({ ok: true, data })
  } catch {
    res.status(500).json({ ok: false, error: '读取区域包裹价格失败' })
  }
})

regionPackagePriceRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const regionCode = resolveRegionCode(req)
  if (!regionCode) {
    res.status(403).json({ ok: false, error: '当前账号未归属任何州，无法维护价格' })
    return
  }
  const draft = parseDraft(req.body)
  if (typeof draft === 'string') {
    res.status(400).json({ ok: false, error: draft })
    return
  }
  try {
    const [row] = await getDb()
      .insert(schema.regionPackagePrices)
      .values({ ...draft, regionCode })
      .returning()
    res.json({ ok: true, data: row })
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ ok: false, error: `${draft.postcode} / ${draft.suburb} 已存在` })
      return
    }
    res.status(500).json({ ok: false, error: '新增区域包裹价格失败' })
  }
})

regionPackagePriceRouter.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const regionCode = resolveRegionCode(req)
  const draft = parseDraft(req.body)
  if (typeof draft === 'string') {
    res.status(400).json({ ok: false, error: draft })
    return
  }
  try {
    const db = getDb()
    const [existing] = await db
      .select()
      .from(schema.regionPackagePrices)
      .where(
        and(
          eq(schema.regionPackagePrices.id, String(req.params.id)),
          eq(schema.regionPackagePrices.regionCode, regionCode),
        ),
      )
      .limit(1)
    if (!existing) {
      res.status(404).json({ ok: false, error: '价格记录不存在或不属于当前州' })
      return
    }
    const [row] = await db
      .update(schema.regionPackagePrices)
      .set({
        ...draft,
        prePrice: draft.price === existing.price ? existing.prePrice : existing.price,
        updatedAt: new Date(),
      })
      .where(eq(schema.regionPackagePrices.id, existing.id))
      .returning()
    res.json({ ok: true, data: row })
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ ok: false, error: `${draft.postcode} / ${draft.suburb} 已存在` })
      return
    }
    res.status(500).json({ ok: false, error: '更新区域包裹价格失败' })
  }
})

regionPackagePriceRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const regionCode = resolveRegionCode(req)
  try {
    const [row] = await getDb()
      .delete(schema.regionPackagePrices)
      .where(
        and(
          eq(schema.regionPackagePrices.id, String(req.params.id)),
          eq(schema.regionPackagePrices.regionCode, regionCode),
        ),
      )
      .returning({ id: schema.regionPackagePrices.id })
    if (!row) {
      res.status(404).json({ ok: false, error: '价格记录不存在或不属于当前州' })
      return
    }
    res.json({ ok: true, data: { id: row.id } })
  } catch {
    res.status(500).json({ ok: false, error: '删除区域包裹价格失败' })
  }
})

/** 表格批量导入：按 postcode + suburb 覆盖本州已有记录，价格变动时旧价格滚存到 pre_price */
regionPackagePriceRouter.post('/bulk', async (req: AuthenticatedRequest, res: Response) => {
  const regionCode = resolveRegionCode(req)
  if (!regionCode) {
    res.status(403).json({ ok: false, error: '当前账号未归属任何州，无法维护价格' })
    return
  }
  const list = (req.body as { prices?: unknown } | null)?.prices
  if (!Array.isArray(list) || list.length === 0) {
    res.status(400).json({ ok: false, error: '未解析到可导入的数据' })
    return
  }
  if (list.length > BULK_MAX_ROWS) {
    res.status(400).json({ ok: false, error: `单次最多导入 ${BULK_MAX_ROWS} 条` })
    return
  }

  const seen = new Set<string>()
  const drafts: PriceDraft[] = []
  let invalid = 0
  for (const item of list) {
    const draft = parseDraft(item)
    if (typeof draft === 'string') {
      invalid += 1
      continue
    }
    const key = `${draft.postcode.toUpperCase()}|${draft.suburb.toUpperCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    drafts.push(draft)
  }
  if (drafts.length === 0) {
    res.status(400).json({ ok: false, error: '没有有效的价格数据' })
    return
  }

  try {
    const db = getDb()
    const existing = await db
      .select({
        postcode: schema.regionPackagePrices.postcode,
        suburb: schema.regionPackagePrices.suburb,
      })
      .from(schema.regionPackagePrices)
      .where(eq(schema.regionPackagePrices.regionCode, regionCode))
    const existingKeys = new Set(existing.map((r) => `${r.postcode.toUpperCase()}|${r.suburb.toUpperCase()}`))
    const updated = drafts.filter((d) => existingKeys.has(`${d.postcode.toUpperCase()}|${d.suburb.toUpperCase()}`)).length

    await db
      .insert(schema.regionPackagePrices)
      .values(drafts.map((d) => ({ ...d, regionCode })))
      .onConflictDoUpdate({
        target: [
          schema.regionPackagePrices.regionCode,
          schema.regionPackagePrices.postcode,
          schema.regionPackagePrices.suburb,
        ],
        set: {
          prePrice: rollPrePrice,
          price: sql`excluded.price`,
          courierPrice: sql`excluded.courier_price`,
          vendorCode: sql`excluded.vendor_code`,
          vendorName: sql`excluded.vendor_name`,
          updatedAt: new Date(),
        },
      })

    res.json({
      ok: true,
      data: { received: list.length, inserted: drafts.length - updated, updated, invalid },
    })
  } catch {
    res.status(500).json({ ok: false, error: '批量导入区域包裹价格失败' })
  }
})

/**
 * 对齐路由码 + 供应商：用户选的窗口先查到件记录拿每个运单的 postcode+suburb（收件地址只有到件
 * 接口有），再拿这批运单号去中心运单查询（searchWaybill）查运单当前的供应商编码 + 路由码——
 * 运单查询是权威口径，到件扫描那一刻供应商经常还没回填（不能直接信到件记录自带的 courierVendorCode）。
 * 只对齐价格表里已经存在的 postcode+suburb，到件记录里出现但价格表没配的区域不在维护范围内，忽略。
 *
 * 路由码是一对多（子表全量 diff），供应商是价格表上的单值列——窗口内同一区域如果查到不止一个供应商，
 * 取出现次数最多的那个写回，供应商名称按编码去查一遍 iMile 供应商列表，跟手动编辑走的是同一份数据源。
 *
 * 安全阀：路由码和供应商各自独立判断「这次有没有查到有效数据」，没查到就完全不碰对应的表/列——
 * 不会因为运单查询这次没返回供应商数据，就把路由码也一起清空，反之亦然。
 */
regionPackagePriceRouter.post('/align-route-code', async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest
  const regionCode = resolveRegionCode(authReq)
  if (!regionCode) {
    res.status(403).json({ ok: false, error: '当前账号未归属任何州，无法维护价格' })
    return
  }
  const body = (req.body ?? {}) as { imileToken?: string; startDate?: string; endDate?: string }
  const token = readImileTokenFromRequest(req, body.imileToken)
  const startDate = parseDateKey(body.startDate)
  const endDate = parseDateKey(body.endDate)
  if (!token) {
    res.status(400).json({ ok: false, error: '缺少 imileToken，请在全局设置中配置' })
    return
  }
  if (!startDate || !endDate) {
    res.status(400).json({ ok: false, error: '请提供有效的开始/结束日期（YYYY-MM-DD）' })
    return
  }
  if (startDate > endDate) {
    res.status(400).json({ ok: false, error: '开始日期不能晚于结束日期' })
    return
  }
  if (diffDaysInclusive(startDate, endDate) > ALIGN_MAX_RANGE_DAYS) {
    res.status(400).json({ ok: false, error: `日期区间不能超过 ${ALIGN_MAX_RANGE_DAYS} 天` })
    return
  }

  try {
    const db = getDb()
    const priceRows = await db
      .select({
        id: schema.regionPackagePrices.id,
        postcode: schema.regionPackagePrices.postcode,
        suburb: schema.regionPackagePrices.suburb,
        vendorCode: schema.regionPackagePrices.vendorCode,
        vendorName: schema.regionPackagePrices.vendorName,
      })
      .from(schema.regionPackagePrices)
      .where(eq(schema.regionPackagePrices.regionCode, regionCode))
    if (priceRows.length === 0) {
      res.status(400).json({ ok: false, error: '当前州还没有价格配置，无需对齐' })
      return
    }
    const priceByArea = new Map(priceRows.map((r) => [`${r.postcode}|${r.suburb.toUpperCase()}`, r]))

    const timeRange = { startTime: `${startDate} 00:00:00`, endTime: `${endDate} 23:59:59` }
    const [scanResult, waybillResult, vendorsResult] = await Promise.all([
      queryImileInboundScans({ imileToken: token, ...timeRange }),
      fetchVendorWaybills(token, timeRange),
      fetchVendors(token),
    ])
    if (!scanResult.ok) {
      res.status(502).json({ ok: false, error: `到件查询失败：${scanResult.message}`, status: scanResult.status })
      return
    }
    if (!waybillResult.ok) {
      res.status(502).json({ ok: false, error: `运单查询失败：${waybillResult.message}`, status: waybillResult.status })
      return
    }

    const scans = dedupeScansByWaybill(scanResult.records)
    if (scans.length === 0) {
      res.status(400).json({ ok: false, error: '该时间段内没有查到到件记录，未执行任何变更' })
      return
    }
    const waybillInfoByNo = dedupeWaybillVendorRoutes(waybillResult.data)

    // 供应商编码 → 展示名称；查失败不影响路由码对齐，供应商名称退回编码本身，跟手动编辑表单同一个兜底口径
    const vendorNameByCode = new Map<string, string>()
    if (vendorsResult.ok) {
      for (const raw of vendorsResult.data) {
        const row = raw as Record<string, unknown>
        const code = String(row.vendorCode ?? '').trim()
        const name = String(row.vendorNameEn ?? '').trim()
        if (code && name) vendorNameByCode.set(code, name)
      }
    }

    // seen：postcode+suburb+routeCode 组合，postcode/suburb 取价格表原始大小写，跟子表现有记录同口径比较
    const seen = new Map<string, { postcode: string; suburb: string; routeCode: string }>()
    // vendorVotes：区域 → 供应商编码 → 本次窗口命中次数，窗口内多个供应商时取最高票
    const vendorVotes = new Map<string, Map<string, number>>()
    const matchedAreas = new Set<string>()
    for (const scan of scans) {
      const zip = scan.consigneeZipCode.trim()
      const suburbRaw = scan.consigneeSuburb.trim()
      if (!zip || !suburbRaw) continue
      const area = priceByArea.get(`${zip}|${suburbRaw.toUpperCase()}`)
      if (!area) continue
      const info = waybillInfoByNo.get(scan.waybillNo)
      if (!info || (!info.routeCode && !info.vendorCode)) continue
      const areaKey = `${area.postcode}|${area.suburb.toUpperCase()}`
      matchedAreas.add(areaKey)
      if (info.routeCode) {
        seen.set(routeCodeTripleKey(area.postcode, area.suburb, info.routeCode), {
          postcode: area.postcode,
          suburb: area.suburb,
          routeCode: info.routeCode,
        })
      }
      if (info.vendorCode) {
        const votes = vendorVotes.get(areaKey) ?? new Map<string, number>()
        votes.set(info.vendorCode, (votes.get(info.vendorCode) ?? 0) + 1)
        vendorVotes.set(areaKey, votes)
      }
    }

    if (seen.size === 0 && vendorVotes.size === 0) {
      res.json({
        ok: true,
        data: { inserted: 0, deleted: 0, vendorUpdated: 0, matchedAreas: 0, totalAreas: priceRows.length },
      })
      return
    }

    let insertedCount = 0
    let staleIds: string[] = []
    if (seen.size > 0) {
      const existing = await db
        .select({
          id: schema.regionPackagePriceRouteCodes.id,
          postcode: schema.regionPackagePriceRouteCodes.postcode,
          suburb: schema.regionPackagePriceRouteCodes.suburb,
          routeCode: schema.regionPackagePriceRouteCodes.routeCode,
        })
        .from(schema.regionPackagePriceRouteCodes)
        .where(eq(schema.regionPackagePriceRouteCodes.regionCode, regionCode))
      const existingKeys = new Set(existing.map((r) => routeCodeTripleKey(r.postcode, r.suburb, r.routeCode)))
      insertedCount = [...seen.keys()].filter((key) => !existingKeys.has(key)).length
      // 窗口内没再查到的旧组合视为已失效（路由码换绑/区域重新划分），从子表删除
      staleIds = existing
        .filter((r) => !seen.has(routeCodeTripleKey(r.postcode, r.suburb, r.routeCode)))
        .map((r) => r.id)
    }

    // 每个区域取票数最高的供应商编码；跟价格表当前存的编码/名称都一致就不用改
    const vendorUpdates: { id: string; vendorCode: string; vendorName: string }[] = []
    for (const [areaKey, votes] of vendorVotes) {
      const area = priceByArea.get(areaKey)
      if (!area) continue
      let bestCode = ''
      let bestCount = -1
      for (const [code, count] of votes) {
        if (count > bestCount) {
          bestCode = code
          bestCount = count
        }
      }
      if (!bestCode) continue
      const resolvedName = vendorNameByCode.get(bestCode) || bestCode
      if (area.vendorCode !== bestCode || area.vendorName !== resolvedName) {
        vendorUpdates.push({ id: area.id, vendorCode: bestCode, vendorName: resolvedName })
      }
    }

    await db.transaction(async (tx) => {
      if (seen.size > 0) {
        await tx
          .insert(schema.regionPackagePriceRouteCodes)
          .values([...seen.values()].map((v) => ({ ...v, regionCode })))
          .onConflictDoUpdate({
            target: [
              schema.regionPackagePriceRouteCodes.regionCode,
              schema.regionPackagePriceRouteCodes.postcode,
              schema.regionPackagePriceRouteCodes.suburb,
              schema.regionPackagePriceRouteCodes.routeCode,
            ],
            set: { syncedAt: new Date() },
          })
        if (staleIds.length > 0) {
          await tx
            .delete(schema.regionPackagePriceRouteCodes)
            .where(inArray(schema.regionPackagePriceRouteCodes.id, staleIds))
        }
      }
      for (const update of vendorUpdates) {
        await tx
          .update(schema.regionPackagePrices)
          .set({ vendorCode: update.vendorCode, vendorName: update.vendorName, updatedAt: new Date() })
          .where(eq(schema.regionPackagePrices.id, update.id))
      }
    })

    res.json({
      ok: true,
      data: {
        inserted: insertedCount,
        deleted: staleIds.length,
        vendorUpdated: vendorUpdates.length,
        matchedAreas: matchedAreas.size,
        totalAreas: priceRows.length,
      },
    })
  } catch {
    res.status(500).json({ ok: false, error: '对齐失败' })
  }
})
