import { Router, type Response } from 'express'
import { and, eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import {
  extractSupplierPushConfigFields,
  LEGACY_GLOBAL_SUPPLIER_REGION_CODE,
  listSupplierPushConfigs,
  validateSupplierPushConfigCreate,
  validateSupplierPushConfigUpdate,
} from '../supplierPushConfigs'

export const fleetSupplierPushRouter = Router()

/** 车队供应商推送配置按账号所属州隔离；未设置州时并入历史遗留的全局桶 */
function resolveRegionCode(req: AuthenticatedRequest): string {
  return String(req.authUser?.regionCode ?? '').trim() || LEGACY_GLOBAL_SUPPLIER_REGION_CODE
}

/** 历史遗留的全局配置（未回填州归属）不属于任何一个州，全部州都可编辑/删除，与迁移前行为一致 */
function canManageSupplierConfig(existingRegionCode: string, requestRegionCode: string): boolean {
  return existingRegionCode === LEGACY_GLOBAL_SUPPLIER_REGION_CODE || existingRegionCode === requestRegionCode
}

// GET /api/fleet-supplier-push/configs
fleetSupplierPushRouter.get('/configs', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await listSupplierPushConfigs(resolveRegionCode(req))
    res.json({ ok: true, data: rows })
  } catch {
    res.status(500).json({ ok: false, error: '读取供应商配置失败' })
  }
})

// POST /api/fleet-supplier-push/configs
fleetSupplierPushRouter.post('/configs', async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body
  const validationError = validateSupplierPushConfigCreate(body)
  if (validationError) {
    res.status(400).json({ ok: false, error: validationError })
    return
  }
  try {
    const db = getDb()
    const [row] = await db
      .insert(schema.fleetSupplierPushConfigs)
      .values({
        ...extractSupplierPushConfigFields(body),
        regionCode: resolveRegionCode(req),
        createdBy: req.authUser?.id ?? null,
      })
      .returning()
    res.status(201).json({ ok: true, data: row })
  } catch {
    res.status(500).json({ ok: false, error: '创建供应商配置失败' })
  }
})

// PUT /api/fleet-supplier-push/configs/:id
fleetSupplierPushRouter.put('/configs/:id', async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id ?? '').trim()
  const body = req.body
  const validationError = validateSupplierPushConfigUpdate(body)
  if (validationError) {
    res.status(400).json({ ok: false, error: validationError })
    return
  }
  try {
    const db = getDb()
    const [existing] = await db
      .select({ regionCode: schema.fleetSupplierPushConfigs.regionCode })
      .from(schema.fleetSupplierPushConfigs)
      .where(eq(schema.fleetSupplierPushConfigs.id, id))
      .limit(1)
    if (!existing) { res.status(404).json({ ok: false, error: '配置不存在' }); return }
    if (!canManageSupplierConfig(existing.regionCode, resolveRegionCode(req))) {
      res.status(403).json({ ok: false, error: '无权编辑其他州的供应商配置' })
      return
    }
    const [row] = await db
      .update(schema.fleetSupplierPushConfigs)
      .set({ ...extractSupplierPushConfigFields(body), updatedAt: new Date() })
      .where(eq(schema.fleetSupplierPushConfigs.id, id))
      .returning()
    res.json({ ok: true, data: row })
  } catch {
    res.status(500).json({ ok: false, error: '更新供应商配置失败' })
  }
})

// DELETE /api/fleet-supplier-push/configs/:id
fleetSupplierPushRouter.delete('/configs/:id', async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id ?? '').trim()
  try {
    const db = getDb()
    const [existing] = await db
      .select({ regionCode: schema.fleetSupplierPushConfigs.regionCode })
      .from(schema.fleetSupplierPushConfigs)
      .where(eq(schema.fleetSupplierPushConfigs.id, id))
      .limit(1)
    if (!existing) { res.status(404).json({ ok: false, error: '配置不存在' }); return }
    if (!canManageSupplierConfig(existing.regionCode, resolveRegionCode(req))) {
      res.status(403).json({ ok: false, error: '无权删除其他州的供应商配置' })
      return
    }
    await db.delete(schema.fleetSupplierPushConfigs).where(eq(schema.fleetSupplierPushConfigs.id, id))
    res.json({ ok: true })
  } catch {
    res.status(500).json({ ok: false, error: '删除供应商配置失败' })
  }
})

type ImportBody = { mode?: unknown; suppliers?: unknown }
type RawSupplier = Record<string, unknown>

// POST /api/fleet-supplier-push/configs/import
fleetSupplierPushRouter.post('/configs/import', async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as ImportBody
  if (body.mode !== 'merge' && body.mode !== 'replace') {
    res.status(400).json({ ok: false, error: 'mode 必须为 merge 或 replace' })
    return
  }
  if (!Array.isArray(body.suppliers)) {
    res.status(400).json({ ok: false, error: '缺少 suppliers 数组' })
    return
  }

  const total = (body.suppliers as RawSupplier[]).length
  const incoming = (body.suppliers as RawSupplier[])
    .map((o) => extractSupplierPushConfigFields(o))
    .filter((s) => s.vendorCode && s.supplierNickname)

  if (!incoming.length) {
    res.status(400).json({
      ok: false,
      error: `无有效供应商数据（共 ${total} 条，均缺少 vendorCode 或 supplierNickname）`,
    })
    return
  }

  const skipped = total - incoming.length

  try {
    const db = getDb()
    const userId = req.authUser?.id ?? null
    const regionCode = resolveRegionCode(req)
    await db.transaction(async (tx) => {
      if (body.mode === 'replace') {
        // 只清空/重灌本州的配置，不动其他州和历史遗留的全局数据
        await tx
          .delete(schema.fleetSupplierPushConfigs)
          .where(eq(schema.fleetSupplierPushConfigs.regionCode, regionCode))
        await tx.insert(schema.fleetSupplierPushConfigs).values(
          incoming.map((rest) => ({ ...rest, regionCode, createdBy: userId })),
        )
      } else {
        // 仅允许按 id 覆盖本州已有的配置；id 属于其他州/历史遗留全局数据时，改为在本州新建一条
        const existing = await tx
          .select({ id: schema.fleetSupplierPushConfigs.id })
          .from(schema.fleetSupplierPushConfigs)
          .where(eq(schema.fleetSupplierPushConfigs.regionCode, regionCode))
        const existingIds = new Set(existing.map((r) => r.id))
        for (const s of body.suppliers as RawSupplier[]) {
          const id = typeof s.id === 'string' ? s.id.trim() : ''
          const fields = extractSupplierPushConfigFields(s)
          if (!fields.vendorCode || !fields.supplierNickname) continue
          if (id && existingIds.has(id)) {
            await tx
              .update(schema.fleetSupplierPushConfigs)
              .set({ ...fields, updatedAt: new Date() })
              .where(and(eq(schema.fleetSupplierPushConfigs.id, id), eq(schema.fleetSupplierPushConfigs.regionCode, regionCode)))
          } else {
            await tx.insert(schema.fleetSupplierPushConfigs).values({ ...fields, regionCode, createdBy: userId })
          }
        }
      }
    })
    const rows = await listSupplierPushConfigs(regionCode)
    res.json({ ok: true, data: rows, meta: { imported: incoming.length, skipped } })
  } catch (err) {
    console.error('[fleet-supplier-push] import error:', err)
    res.status(500).json({ ok: false, error: '导入失败' })
  }
})
