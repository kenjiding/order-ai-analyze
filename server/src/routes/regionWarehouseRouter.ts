import { Router, type Response } from 'express'
import { eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'

export const regionWarehouseRouter = Router()

/** 每个州只有一条主仓记录，归属登录账号所属的州；没有州归属的账号读到空、不能维护 */
function resolveRegionCode(req: AuthenticatedRequest): string {
  return String(req.authUser?.regionCode ?? '').trim()
}

type WarehouseDraft = {
  name: string
  address: string
  lat: number
  lng: number
}

function parseDraft(body: unknown): WarehouseDraft | string {
  const raw = (body ?? {}) as Record<string, unknown>
  const name = String(raw.name ?? '').trim()
  if (!name) return 'name 不能为空'
  if (name.length > 128) return 'name 过长'
  const address = String(raw.address ?? '').trim()
  if (!address) return 'address 不能为空'
  if (address.length > 512) return 'address 过长'
  const lat = Number(raw.lat)
  const lng = Number(raw.lng)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'lat 必须是 -90~90 之间的数字'
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'lng 必须是 -180~180 之间的数字'
  return { name, address, lat, lng }
}

regionWarehouseRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const regionCode = resolveRegionCode(req)
  if (!regionCode) {
    res.json({ ok: true, data: null })
    return
  }
  try {
    const [row] = await getDb()
      .select()
      .from(schema.regionWarehouses)
      .where(eq(schema.regionWarehouses.regionCode, regionCode))
      .limit(1)
    res.json({ ok: true, data: row ?? null })
  } catch {
    res.status(500).json({ ok: false, error: '读取大区主仓地址失败' })
  }
})

regionWarehouseRouter.put('/', async (req: AuthenticatedRequest, res: Response) => {
  const regionCode = resolveRegionCode(req)
  if (!regionCode) {
    res.status(403).json({ ok: false, error: '当前账号未归属任何州，无法维护主仓地址' })
    return
  }
  const draft = parseDraft(req.body)
  if (typeof draft === 'string') {
    res.status(400).json({ ok: false, error: draft })
    return
  }
  try {
    const [row] = await getDb()
      .insert(schema.regionWarehouses)
      .values({ ...draft, regionCode })
      .onConflictDoUpdate({
        target: schema.regionWarehouses.regionCode,
        set: { ...draft, updatedAt: new Date() },
      })
      .returning()
    res.json({ ok: true, data: row })
  } catch {
    res.status(500).json({ ok: false, error: '保存大区主仓地址失败' })
  }
})
