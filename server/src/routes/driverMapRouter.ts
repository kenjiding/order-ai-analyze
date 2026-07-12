import { Router, type Response } from 'express'
import { requirePermission, type AuthenticatedRequest } from '../auth/middleware'
import { envFirst } from '../imile/shared'
import { listSupplierPushConfigs } from '../supplierPushConfigs'
import { queryDriverMapPoints, refreshDriverMapPoints } from '../driverMap/driverMapPointsQuery'

export const driverMapRouter = Router()

const requireDriverMap = requirePermission('btn:vendor-analysis:driver-map')

// ─── 前端展示配置：有站点编码的供应商 + 是否已配置地图 Key ─────────────────────────

driverMapRouter.get('/config', requireDriverMap, async (_req: AuthenticatedRequest, res: Response) => {
  const configs = await listSupplierPushConfigs()
  const enabledVendors = configs
    .filter((c) => c.stationCode.trim())
    .map((c) => ({ vendorCode: c.vendorCode, vendorName: c.vendorName, stationCode: c.stationCode }))
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName))
  res.json({
    ok: true,
    data: {
      enabledVendors,
      hasBrowserMapsKey: !!envFirst('GOOGLE_MAPS_BROWSER_API_KEY'),
    },
  })
})

driverMapRouter.get('/maps-key', requireDriverMap, async (_req: AuthenticatedRequest, res: Response) => {
  const browserKey = envFirst('GOOGLE_MAPS_BROWSER_API_KEY') ?? null
  res.json({ ok: true, data: { browserKey } })
})

// ─── 点位查询：读缓存表，按司机分组 ───────────────────────────────────────────────

driverMapRouter.get('/points', requireDriverMap, async (req: AuthenticatedRequest, res: Response) => {
  const stationCode = typeof req.query.stationCode === 'string' ? req.query.stationCode.trim() : ''
  const dataDate = typeof req.query.dataDate === 'string' ? req.query.dataDate.trim() : ''
  const vendorCode = typeof req.query.vendorCode === 'string' ? req.query.vendorCode.trim() : ''
  if (!stationCode || !/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) {
    res.status(400).json({ ok: false, error: '缺少必填字段: stationCode, dataDate(YYYY-MM-DD)' })
    return
  }

  try {
    const result = await queryDriverMapPoints({ stationCode, dataDate, vendorCode: vendorCode || undefined })
    if (!result.ok) {
      res.status(502).json({ ok: false, error: result.message })
      return
    }
    res.json({ ok: true, data: result.data })
  } catch (err) {
    console.error('[driver-map/points]', err)
    res.status(500).json({ ok: false, error: '查询失败' })
  }
})

// ─── 手动增量刷新（不做定时任务） ────────────────────────────────────────────────

driverMapRouter.post('/refresh', requireDriverMap, async (req: AuthenticatedRequest, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const stationCode = typeof body.stationCode === 'string' ? body.stationCode.trim() : ''
  const dataDate = typeof body.dataDate === 'string' ? body.dataDate.trim() : ''
  const vendorCode = typeof body.vendorCode === 'string' ? body.vendorCode.trim() : ''
  if (!stationCode || !/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) {
    res.status(400).json({ ok: false, error: '缺少必填字段: stationCode, dataDate(YYYY-MM-DD)' })
    return
  }

  try {
    const result = await refreshDriverMapPoints({
      stationCode,
      dataDate,
      vendorCode: vendorCode || undefined,
    })
    if (!result.ok) {
      res.status(502).json({ ok: false, error: result.message })
      return
    }
    res.json({ ok: true, data: result.data })
  } catch (err) {
    console.error('[driver-map/refresh]', err)
    res.status(500).json({ ok: false, error: '触发刷新失败' })
  }
})
