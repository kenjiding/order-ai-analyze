import { Router, type Response } from 'express'
import { and, eq } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getDb, schema } from '../db'
import { getGlobalImileToken } from '../feishu/globalImileToken'
import { queryImileInboundScansExport } from '../imile/inbound'
import { queryImilePendingSplitBox } from '../imile/pendingSplitBox'
import { runWithImileHubcode } from '../imile/shared'
import { dedupeScansByWaybill, parseInboundScanRecord } from '../vendorRegionMap/parseInbound'
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
  // 与保存校验同一口径：未选供应商的配置靠路由码匹配，vendorCode 允许为空，但两者不能都空
  const incoming = (body.suppliers as RawSupplier[])
    .map((o) => extractSupplierPushConfigFields(o))
    .filter((s) => s.supplierNickname && (s.vendorCode || s.routeCode.trim()))

  if (!incoming.length) {
    res.status(400).json({
      ok: false,
      error: `无有效供应商数据（共 ${total} 条，均缺少 supplierNickname，或 vendorCode 与 routeCode 都为空）`,
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
          if (!fields.supplierNickname || (!fields.vendorCode && !fields.routeCode.trim())) continue
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

type PendingSplitBoxScanRow = {
  routeCode: string
  postcode: string
  city: string
  orderKey: string
  clientCode?: string
}

function readStringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return value == null ? '' : String(value).trim()
}

/** pendingSplitBox 原始记录 → FleetScanRow 兼容字段；缺 routeCode 的行按「选择扫描文件」同一口径丢弃
 *  fallbackKeyPrefix：多站点合并查询时按站点区分兜底 key，避免同 index 跨站点撞号；单站旧调用不传，保持原 key 格式 */
function mapPendingSplitBoxRecord(
  raw: unknown,
  index: number,
  fallbackKeyPrefix?: string,
): PendingSplitBoxScanRow | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const routeCode = readStringField(row, 'routeCode')
  if (!routeCode) return null
  const clientCode = readStringField(row, 'clientCode')
  const fallbackKey = fallbackKeyPrefix
    ? `pendingSplitBox#${fallbackKeyPrefix}#${index}`
    : `pendingSplitBox#${index}`
  return {
    routeCode,
    postcode: readStringField(row, 'consigneeZipCode') || '—',
    city: readStringField(row, 'city') || '—',
    orderKey: readStringField(row, 'waybillNo') || fallbackKey,
    ...(clientCode ? { clientCode } : {}),
  }
}

// POST /api/fleet-supplier-push/pending-split-box
fleetSupplierPushRouter.post('/pending-split-box', async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as { startTime?: unknown; endTime?: unknown; hubCodes?: unknown }
  const startTime = String(body.startTime ?? '').trim()
  const endTime = String(body.endTime ?? '').trim()
  const hubCodes = Array.isArray(body.hubCodes)
    ? Array.from(new Set(body.hubCodes.map((c) => String(c ?? '').trim()).filter(Boolean)))
    : []
  if (!startTime || !endTime) {
    res.status(400).json({ ok: false, error: '缺少 startTime / endTime' })
    return
  }

  const userId = req.authUser?.id
  const imileToken = userId ? await getGlobalImileToken(userId) : ''
  if (!imileToken) {
    res.status(400).json({ ok: false, error: '未配置 iMile token，请先在「系统设置」中保存' })
    return
  }

  const rows: PendingSplitBoxScanRow[] = []
  let droppedRows = 0
  let totalResult = 0
  const hubErrors: { hubCode: string; error: string }[] = []

  if (!hubCodes.length) {
    // 未传站点列表（旧调用方）：按原行为跟随请求头/环境变量默认站点查询一次
    const result = await queryImilePendingSplitBox({ imileToken, startTime, endTime })
    if (!result.ok) {
      res.status(502).json({ ok: false, error: result.message })
      return
    }
    totalResult = result.totalResult
    result.records.forEach((record, index) => {
      const row = mapPendingSplitBoxRecord(record, index)
      if (row) rows.push(row)
      else droppedRows += 1
    })
  } else {
    // 按站点逐个覆盖请求上下文的 hubcode（优先级高于显式参数，不能直传），顺序查询避免对 iMile 并发打爆限流
    for (const hubCode of hubCodes) {
      try {
        const result = await runWithImileHubcode(hubCode, () =>
          queryImilePendingSplitBox({ imileToken, startTime, endTime }),
        )
        if (!result.ok) {
          hubErrors.push({ hubCode, error: result.message })
          continue
        }
        totalResult += result.totalResult
        result.records.forEach((record, index) => {
          const row = mapPendingSplitBoxRecord(record, index, hubCode)
          if (row) rows.push(row)
          else droppedRows += 1
        })
      } catch (e) {
        // 单站异常不拖垮整批：降级为该站的 hubErrors 记录，其余站点继续
        hubErrors.push({ hubCode, error: e instanceof Error ? e.message : String(e) })
      }
    }
    if (hubErrors.length === hubCodes.length) {
      res.status(502).json({ ok: false, error: hubErrors.map((e) => `${e.hubCode}: ${e.error}`).join('；') })
      return
    }
  }

  res.json({ ok: true, data: { rows, droppedRows, totalResult, hubErrors } })
})

/**
 * 到件扫描记录（queryImileInboundScansExport）→ FleetScanRow 兼容字段；routeCode/zip/city/waybillNo 复用
 * vendorRegionMap 既有的字段别名解析。注意 ParsedInboundScan.courierVendorCode 是「承运商/车队编码」
 * （给供应商 vendorCode 匹配用的，见 supplierMatcher.ts），不是「优先客户」统计要比对的商家编码 clientCode，
 * 两者是不同字段，这里按 waybillNo 从原始记录另取一份真正的 clientCode。
 */
function mapInboundScanRecords(records: unknown[]): { rows: PendingSplitBoxScanRow[]; droppedRows: number } {
  const clientCodeByWaybill = new Map<string, string>()
  for (const raw of records) {
    const parsed = parseInboundScanRecord(raw)
    if (!parsed || clientCodeByWaybill.has(parsed.waybillNo)) continue
    const clientCode = readStringField(raw as Record<string, unknown>, 'clientCode')
    if (clientCode) clientCodeByWaybill.set(parsed.waybillNo, clientCode)
  }

  const rows: PendingSplitBoxScanRow[] = []
  let droppedRows = 0
  for (const scan of dedupeScansByWaybill(records)) {
    if (!scan.routeCode) {
      droppedRows += 1
      continue
    }
    const clientCode = clientCodeByWaybill.get(scan.waybillNo)
    rows.push({
      routeCode: scan.routeCode,
      postcode: scan.consigneeZipCode || '—',
      city: scan.consigneeSuburb || '—',
      orderKey: scan.waybillNo,
      ...(clientCode ? { clientCode } : {}),
    })
  }
  return { rows, droppedRows }
}

// POST /api/fleet-supplier-push/inbound-scans
fleetSupplierPushRouter.post('/inbound-scans', async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as { startTime?: unknown; endTime?: unknown; hubCodes?: unknown }
  const startTime = String(body.startTime ?? '').trim()
  const endTime = String(body.endTime ?? '').trim()
  const hubCodes = Array.isArray(body.hubCodes)
    ? Array.from(new Set(body.hubCodes.map((c) => String(c ?? '').trim()).filter(Boolean)))
    : []
  if (!startTime || !endTime) {
    res.status(400).json({ ok: false, error: '缺少 startTime / endTime' })
    return
  }
  if (!hubCodes.length) {
    res.status(400).json({ ok: false, error: '请至少选择一个站点' })
    return
  }

  const userId = req.authUser?.id
  const imileToken = userId ? await getGlobalImileToken(userId) : ''
  if (!imileToken) {
    res.status(400).json({ ok: false, error: '未配置 iMile token，请先在「系统设置」中保存' })
    return
  }

  const rows: PendingSplitBoxScanRow[] = []
  let droppedRows = 0
  let totalResult = 0
  const hubErrors: { hubCode: string; error: string }[] = []

  // 与 pending-split-box 同一思路：按站点逐个覆盖请求上下文的 hubcode，顺序查询避免对 iMile 并发打爆限流
  for (const hubCode of hubCodes) {
    try {
      const result = await runWithImileHubcode(hubCode, () =>
        queryImileInboundScansExport({ imileToken, startTime, endTime }),
      )
      if (!result.ok) {
        hubErrors.push({ hubCode, error: result.message })
        continue
      }
      totalResult += result.records.length
      const mapped = mapInboundScanRecords(result.records)
      rows.push(...mapped.rows)
      droppedRows += mapped.droppedRows
    } catch (e) {
      hubErrors.push({ hubCode, error: e instanceof Error ? e.message : String(e) })
    }
  }

  if (hubErrors.length === hubCodes.length) {
    res.status(502).json({ ok: false, error: hubErrors.map((e) => `${e.hubCode}: ${e.error}`).join('；') })
    return
  }

  res.json({ ok: true, data: { rows, droppedRows, totalResult, hubErrors } })
})
