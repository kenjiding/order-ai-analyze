import { Router, type Request, type Response } from 'express'
import { fetchInHubPackageLossWaybills } from '../imile/inHubWaybillInventory'
import { readImileTokenFromRequest } from './imileAuth'

export const packageLossMonitorRouter = Router()

packageLossMonitorRouter.post('/in-hub-waybills', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { imileToken?: string; stationCode?: string }
    const token = readImileTokenFromRequest(req, body.imileToken, { allowQuery: true })
    const stationCode = String(body.stationCode ?? '').trim()

    if (!token) {
      res.status(400).json({ error: '缺少 imileToken' })
      return
    }
    if (!stationCode) {
      res.status(400).json({ error: '缺少责任站点编码' })
      return
    }

    const result = await fetchInHubPackageLossWaybills(token, stationCode)
    if (!result.ok) {
      res.status(502).json({
        error: result.message,
        status: result.status,
        rawText: result.rawText,
      })
      return
    }

    res.json({
      waybillNos: result.waybillNos,
      total: result.total,
      byScanType: result.byScanType,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message || '库内丢包运单查询失败' })
  }
})
