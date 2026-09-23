import { Router, type Request, type Response } from 'express'
import { asc, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'

export const stationCoordinateRouter = Router()

/**
 * 不按 regionCode 隔离：站点坐标是全公司共用的物理地址（一个站点编码全局唯一），
 * 不属于某一个州的账号私有——跟 regionPackagePrices/regionWarehouses 那类按州隔离的配置不同。
 */
type StationDraft = {
  stationCode: string
  stationName: string
  address: string
  lat: number
  lng: number
}

function parseDraft(body: unknown): StationDraft | string {
  const raw = (body ?? {}) as Record<string, unknown>
  const stationCode = String(raw.stationCode ?? '').trim()
  if (!stationCode) return 'stationCode 不能为空'
  if (stationCode.length > 32) return 'stationCode 过长'
  const stationName = String(raw.stationName ?? '').trim()
  if (!stationName) return 'stationName 不能为空'
  if (stationName.length > 128) return 'stationName 过长'
  const address = String(raw.address ?? '').trim()
  if (!address) return 'address 不能为空'
  if (address.length > 512) return 'address 过长'
  const lat = Number(raw.lat)
  const lng = Number(raw.lng)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'lat 必须是 -90~90 之间的数字'
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'lng 必须是 -180~180 之间的数字'
  return { stationCode, stationName, address, lat, lng }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

stationCoordinateRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await getDb()
      .select()
      .from(schema.stationCoordinates)
      .orderBy(asc(schema.stationCoordinates.stationName))
    res.json({ ok: true, data: rows })
  } catch {
    res.status(500).json({ ok: false, error: '读取站点坐标失败' })
  }
})

stationCoordinateRouter.post('/', async (req: Request, res: Response) => {
  const draft = parseDraft(req.body)
  if (typeof draft === 'string') {
    res.status(400).json({ ok: false, error: draft })
    return
  }
  try {
    const [row] = await getDb().insert(schema.stationCoordinates).values(draft).returning()
    res.json({ ok: true, data: row })
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ ok: false, error: `${draft.stationCode} / ${draft.stationName} 已存在` })
      return
    }
    res.status(500).json({ ok: false, error: '新增站点坐标失败' })
  }
})

stationCoordinateRouter.put('/:stationCode', async (req: Request, res: Response) => {
  const draft = parseDraft({ ...(req.body as Record<string, unknown>), stationCode: req.params.stationCode })
  if (typeof draft === 'string') {
    res.status(400).json({ ok: false, error: draft })
    return
  }
  try {
    const [row] = await getDb()
      .update(schema.stationCoordinates)
      .set({
        stationName: draft.stationName,
        address: draft.address,
        lat: draft.lat,
        lng: draft.lng,
        updatedAt: new Date(),
      })
      .where(eq(schema.stationCoordinates.stationCode, draft.stationCode))
      .returning()
    if (!row) {
      res.status(404).json({ ok: false, error: '站点坐标记录不存在' })
      return
    }
    res.json({ ok: true, data: row })
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ ok: false, error: `${draft.stationName} 已被其它站点占用` })
      return
    }
    res.status(500).json({ ok: false, error: '更新站点坐标失败' })
  }
})

stationCoordinateRouter.delete('/:stationCode', async (req: Request, res: Response) => {
  try {
    const [row] = await getDb()
      .delete(schema.stationCoordinates)
      .where(eq(schema.stationCoordinates.stationCode, String(req.params.stationCode)))
      .returning({ stationCode: schema.stationCoordinates.stationCode })
    if (!row) {
      res.status(404).json({ ok: false, error: '站点坐标记录不存在' })
      return
    }
    res.json({ ok: true, data: { stationCode: row.stationCode } })
  } catch {
    res.status(500).json({ ok: false, error: '删除站点坐标失败' })
  }
})
