import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getFeishuTenantAccessToken } from '../feishuServerEnv'
import { sendFeishuAppMessage, uploadFeishuFile } from '../feishu/feishuAppMessage'
import { readImileTokenFromRequest } from './imileAuth'
import {
  buildScanStatXlsx,
  fetchScanStatWaybills,
  groupScanStatWaybills,
  normalizeScanWaybillNos,
  SCAN_STAT_MAX_WAYBILLS,
  type ScanStatGroup,
} from '../imile/scanStatWaybills'

export const scanStatRouter = Router()

function readStationAndNos(
  body: { stationCode?: unknown; waybillNos?: unknown },
): { stationCode: string; waybillNos: string[] } | { error: string } {
  const stationCode = typeof body.stationCode === 'string' ? body.stationCode.trim() : ''
  if (!stationCode) return { error: '缺少必填字段: stationCode' }
  const waybillNos = normalizeScanWaybillNos(body.waybillNos)
  if (!waybillNos || waybillNos.length === 0) return { error: '缺少必填字段: waybillNos' }
  if (waybillNos.length > SCAN_STAT_MAX_WAYBILLS) {
    return { error: `单次最多 ${SCAN_STAT_MAX_WAYBILLS} 个运单号` }
  }
  return { stationCode, waybillNos }
}

async function resolveGroups(
  token: string,
  stationCode: string,
  waybillNos: string[],
): Promise<{ ok: true; groups: ScanStatGroup[] } | { ok: false; status: number; error: string }> {
  const fetched = await fetchScanStatWaybills({ token, stationCode, waybillNos })
  if (!fetched.ok) {
    return { ok: false, status: fetched.status >= 400 ? fetched.status : 502, error: `运单查询失败: ${fetched.message}` }
  }
  return { ok: true, groups: groupScanStatWaybills(waybillNos, fetched.hits) }
}

scanStatRouter.post('/lookup', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(401).json({ ok: false, error: '缺少 iMile token' })
    return
  }
  const parsed = readStationAndNos(req.body as { stationCode?: unknown; waybillNos?: unknown })
  if ('error' in parsed) {
    res.status(400).json({ ok: false, error: parsed.error })
    return
  }
  const result = await resolveGroups(token, parsed.stationCode, parsed.waybillNos)
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error })
    return
  }
  res.json({
    ok: true,
    data: { total: parsed.waybillNos.length, groups: result.groups },
  })
})

scanStatRouter.post('/push', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(401).json({ ok: false, error: '缺少 iMile token' })
    return
  }
  const body = req.body as {
    stationCode?: unknown
    stationName?: unknown
    waybillNos?: unknown
    openId?: unknown
    recipientName?: unknown
  }
  const parsed = readStationAndNos(body)
  if ('error' in parsed) {
    res.status(400).json({ ok: false, error: parsed.error })
    return
  }
  const openId = typeof body.openId === 'string' ? body.openId.trim() : ''
  if (!openId) {
    res.status(400).json({ ok: false, error: '缺少必填字段: openId' })
    return
  }
  const stationName = (typeof body.stationName === 'string' ? body.stationName.trim() : '') || parsed.stationCode
  const recipientName = typeof body.recipientName === 'string' ? body.recipientName.trim() : ''

  const result = await resolveGroups(token, parsed.stationCode, parsed.waybillNos)
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error })
    return
  }

  const tenant = await getFeishuTenantAccessToken()
  if (!tenant.ok) {
    res.status(tenant.reason === 'not_configured' ? 400 : 502).json({
      ok: false,
      error:
        tenant.reason === 'not_configured'
          ? '服务器未配置飞书开放接口凭证（FEISHU_APP_ID / FEISHU_APP_SECRET）'
          : tenant.error || '获取飞书凭证失败',
    })
    return
  }

  const xlsx = buildScanStatXlsx(result.groups)
  const stationLabel = stationName.replace(/[\\/:*?"<>|]/g, '').trim() || '站点'
  const uploaded = await uploadFeishuFile(tenant.token, `${stationLabel}-扫描统计.xlsx`, xlsx)
  if (!uploaded.ok) {
    res.status(502).json({ ok: false, error: uploaded.error })
    return
  }
  const sent = await sendFeishuAppMessage(tenant.token, openId, 'file', { file_key: uploaded.fileKey }, 'open_id')
  if (!sent.ok) {
    res.status(502).json({ ok: false, error: sent.error })
    return
  }
  res.json({
    ok: true,
    data: { total: parsed.waybillNos.length, groups: result.groups, recipientName },
  })
})
