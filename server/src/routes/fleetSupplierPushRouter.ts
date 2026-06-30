import { Router, type Response } from 'express'
import { and, eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'

export const fleetSupplierPushRouter = Router()

// GET /api/fleet-supplier-push/configs
fleetSupplierPushRouter.get('/configs', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) { res.status(401).json({ ok: false, error: '未登录' }); return }
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(schema.fleetSupplierPushConfigs)
      .where(eq(schema.fleetSupplierPushConfigs.userId, userId))
      .orderBy(schema.fleetSupplierPushConfigs.createdAt)
    res.json({ ok: true, data: rows })
  } catch {
    res.status(500).json({ ok: false, error: '读取供应商配置失败' })
  }
})

type ConfigBody = {
  supplierName?: unknown
  routeCode?: unknown
  webhookUrl?: unknown
  signingSecret?: unknown
  pushContent?: unknown
}

function extractConfigFields(body: ConfigBody) {
  return {
    supplierName: typeof body.supplierName === 'string' ? body.supplierName.trim() : '',
    routeCode: typeof body.routeCode === 'string' ? body.routeCode : '',
    webhookUrl: typeof body.webhookUrl === 'string' ? body.webhookUrl.trim() : '',
    signingSecret:
      typeof body.signingSecret === 'string' && body.signingSecret.trim()
        ? body.signingSecret.trim()
        : null,
    pushContent: typeof body.pushContent === 'string' ? body.pushContent : '',
  }
}

// POST /api/fleet-supplier-push/configs
fleetSupplierPushRouter.post('/configs', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) { res.status(401).json({ ok: false, error: '未登录' }); return }
  const body = req.body as ConfigBody
  if (typeof body.supplierName !== 'string' || !body.supplierName.trim()) {
    res.status(400).json({ ok: false, error: '缺少必填字段: supplierName' })
    return
  }
  try {
    const db = getDb()
    const [row] = await db
      .insert(schema.fleetSupplierPushConfigs)
      .values({ userId, ...extractConfigFields(body) })
      .returning()
    res.status(201).json({ ok: true, data: row })
  } catch {
    res.status(500).json({ ok: false, error: '创建供应商配置失败' })
  }
})

// PUT /api/fleet-supplier-push/configs/:id
fleetSupplierPushRouter.put('/configs/:id', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) { res.status(401).json({ ok: false, error: '未登录' }); return }
  const id = String(req.params.id ?? '').trim()
  const body = req.body as ConfigBody
  if (typeof body.supplierName !== 'string' || !body.supplierName.trim()) {
    res.status(400).json({ ok: false, error: '缺少必填字段: supplierName' })
    return
  }
  try {
    const db = getDb()
    const [row] = await db
      .update(schema.fleetSupplierPushConfigs)
      .set({ ...extractConfigFields(body), updatedAt: new Date() })
      .where(
        and(
          eq(schema.fleetSupplierPushConfigs.id, id),
          eq(schema.fleetSupplierPushConfigs.userId, userId),
        ),
      )
      .returning()
    if (!row) { res.status(404).json({ ok: false, error: '配置不存在' }); return }
    res.json({ ok: true, data: row })
  } catch {
    res.status(500).json({ ok: false, error: '更新供应商配置失败' })
  }
})

// DELETE /api/fleet-supplier-push/configs/:id
fleetSupplierPushRouter.delete('/configs/:id', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) { res.status(401).json({ ok: false, error: '未登录' }); return }
  const id = String(req.params.id ?? '').trim()
  try {
    const db = getDb()
    await db
      .delete(schema.fleetSupplierPushConfigs)
      .where(
        and(
          eq(schema.fleetSupplierPushConfigs.id, id),
          eq(schema.fleetSupplierPushConfigs.userId, userId),
        ),
      )
    res.json({ ok: true })
  } catch {
    res.status(500).json({ ok: false, error: '删除供应商配置失败' })
  }
})

type ImportBody = { mode?: unknown; suppliers?: unknown }
type RawSupplier = Record<string, unknown>

// POST /api/fleet-supplier-push/configs/import
fleetSupplierPushRouter.post('/configs/import', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) { res.status(401).json({ ok: false, error: '未登录' }); return }

  const body = req.body as ImportBody
  if (body.mode !== 'merge' && body.mode !== 'replace') {
    res.status(400).json({ ok: false, error: 'mode 必须为 merge 或 replace' })
    return
  }
  if (!Array.isArray(body.suppliers)) {
    res.status(400).json({ ok: false, error: '缺少 suppliers 数组' })
    return
  }

  const incoming = (body.suppliers as RawSupplier[])
    .map((o) => ({
      id: typeof o.id === 'string' ? o.id.trim() : '',
      supplierName: typeof o.supplierName === 'string' ? o.supplierName.trim() : '',
      routeCode: typeof o.routeCode === 'string' ? o.routeCode : '',
      webhookUrl: typeof o.webhookUrl === 'string' ? o.webhookUrl.trim() : '',
      signingSecret:
        typeof o.signingSecret === 'string' && o.signingSecret.trim()
          ? o.signingSecret.trim()
          : null,
      pushContent: typeof o.pushContent === 'string' ? o.pushContent : '',
    }))
    .filter((s) => s.supplierName)

  if (!incoming.length) {
    res.status(400).json({ ok: false, error: '无有效供应商数据' })
    return
  }

  try {
    const db = getDb()
    await db.transaction(async (tx) => {
      if (body.mode === 'replace') {
        await tx
          .delete(schema.fleetSupplierPushConfigs)
          .where(eq(schema.fleetSupplierPushConfigs.userId, userId))
        await tx.insert(schema.fleetSupplierPushConfigs).values(
          incoming.map(({ id: _id, ...rest }) => ({ userId, ...rest })),
        )
      } else {
        // merge: match by id within this user's records
        const existing = await tx
          .select({ id: schema.fleetSupplierPushConfigs.id })
          .from(schema.fleetSupplierPushConfigs)
          .where(eq(schema.fleetSupplierPushConfigs.userId, userId))
        const existingIds = new Set(existing.map((r) => r.id))
        for (const s of incoming) {
          if (s.id && existingIds.has(s.id)) {
            await tx
              .update(schema.fleetSupplierPushConfigs)
              .set({
                supplierName: s.supplierName,
                routeCode: s.routeCode,
                webhookUrl: s.webhookUrl,
                signingSecret: s.signingSecret,
                pushContent: s.pushContent,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.fleetSupplierPushConfigs.id, s.id),
                  eq(schema.fleetSupplierPushConfigs.userId, userId),
                ),
              )
          } else {
            const { id: _id, ...rest } = s
            await tx.insert(schema.fleetSupplierPushConfigs).values({ userId, ...rest })
          }
        }
      }
    })
    const rows = await db
      .select()
      .from(schema.fleetSupplierPushConfigs)
      .where(eq(schema.fleetSupplierPushConfigs.userId, userId))
      .orderBy(schema.fleetSupplierPushConfigs.createdAt)
    res.json({ ok: true, data: rows })
  } catch (err) {
    console.error('[fleet-supplier-push] import error:', err)
    res.status(500).json({ ok: false, error: '导入失败' })
  }
})
