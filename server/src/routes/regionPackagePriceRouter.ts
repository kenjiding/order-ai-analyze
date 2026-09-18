import { Router, type Response } from 'express'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'

export const regionPackagePriceRouter = Router()

/** 每条价格归属登录账号所属的州；没有州归属的账号不允许维护价格 */
function resolveRegionCode(req: AuthenticatedRequest): string {
  return String(req.authUser?.regionCode ?? '').trim()
}

const BULK_MAX_ROWS = 5000

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
    const rows = await getDb()
      .select()
      .from(schema.regionPackagePrices)
      .where(eq(schema.regionPackagePrices.regionCode, regionCode))
      .orderBy(asc(schema.regionPackagePrices.postcode), asc(schema.regionPackagePrices.suburb))
    res.json({ ok: true, data: rows })
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
