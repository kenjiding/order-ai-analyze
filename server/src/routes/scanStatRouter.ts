import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { getFeishuTenantAccessToken } from '../feishuServerEnv'
import { getGlobalImileToken } from '../feishu/globalImileToken'
import { sendFeishuAppMessage } from '../feishu/feishuAppMessage'
import { normalizeImileToken } from '../imile/shared'
import {
  buildScanStatSummaryText,
  fetchScanStatWaybills,
  groupScanStatWaybills,
  normalizeScanWaybillNos,
  SCAN_STAT_MAX_WAYBILLS,
  type ScanStatGroup,
} from '../imile/scanStatWaybills'

export const scanStatRouter = Router()

function readWaybillNos(raw: unknown): string[] | { error: string } {
  const waybillNos = normalizeScanWaybillNos(raw)
  if (!waybillNos || waybillNos.length === 0) return { error: '缺少必填字段: waybillNos' }
  if (waybillNos.length > SCAN_STAT_MAX_WAYBILLS) {
    return { error: `单次最多 ${SCAN_STAT_MAX_WAYBILLS} 个运单号` }
  }
  return waybillNos
}

function readSendTarget(body: { stationName?: unknown; openId?: unknown; recipientName?: unknown }):
  | { stationName: string; openId: string; recipientName: string }
  | { error: string } {
  const openId = typeof body.openId === 'string' ? body.openId.trim() : ''
  if (!openId) return { error: '缺少必填字段: openId' }
  return {
    stationName: typeof body.stationName === 'string' ? body.stationName.trim() : '',
    openId,
    recipientName: typeof body.recipientName === 'string' ? body.recipientName.trim() : '',
  }
}

async function sendFeishuText(
  openId: string,
  text: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const tenant = await getFeishuTenantAccessToken()
  if (!tenant.ok) {
    return {
      ok: false,
      status: tenant.reason === 'not_configured' ? 400 : 502,
      error:
        tenant.reason === 'not_configured'
          ? '服务器未配置飞书开放接口凭证（FEISHU_APP_ID / FEISHU_APP_SECRET）'
          : tenant.error || '获取飞书凭证失败',
    }
  }
  const sent = await sendFeishuAppMessage(tenant.token, openId, 'text', { text }, 'open_id')
  if (!sent.ok) return { ok: false, status: 502, error: sent.error }
  return { ok: true }
}

/** 查商家：查到的商家分组直接发给飞书接收人。 */
scanStatRouter.post('/lookup', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser?.id
  if (!userId) {
    res.status(401).json({ ok: false, error: '未登录' })
    return
  }
  const token = normalizeImileToken(await getGlobalImileToken(userId))
  if (!token) {
    res.status(400).json({ ok: false, error: '请先在电脑端「系统设置」中配置 iMile Token' })
    return
  }
  const waybillNos = readWaybillNos((req.body as { waybillNos?: unknown }).waybillNos)
  if ('error' in waybillNos) {
    res.status(400).json({ ok: false, error: waybillNos.error })
    return
  }
  const target = readSendTarget(req.body as { stationName?: unknown; openId?: unknown; recipientName?: unknown })
  if ('error' in target) {
    res.status(400).json({ ok: false, error: target.error })
    return
  }

  const fetched = await fetchScanStatWaybills({ token, waybillNos })
  if (!fetched.ok) {
    res.status(fetched.status >= 400 ? fetched.status : 502).json({ ok: false, error: `运单查询失败: ${fetched.message}` })
    return
  }
  const groups: ScanStatGroup[] = groupScanStatWaybills(waybillNos, fetched.hits)

  const sent = await sendFeishuText(target.openId, buildScanStatSummaryText(target.stationName, groups))
  if (!sent.ok) {
    res.status(sent.status).json({ ok: false, error: sent.error })
    return
  }
  res.json({
    ok: true,
    data: { total: waybillNos.length, groups, recipientName: target.recipientName },
  })
})

/** 单纯把扫到的运单号发给飞书接收人，不查商家。 */
scanStatRouter.post('/send-nos', async (req: AuthenticatedRequest, res: Response) => {
  const waybillNos = readWaybillNos((req.body as { waybillNos?: unknown }).waybillNos)
  if ('error' in waybillNos) {
    res.status(400).json({ ok: false, error: waybillNos.error })
    return
  }
  const target = readSendTarget(req.body as { stationName?: unknown; openId?: unknown; recipientName?: unknown })
  if ('error' in target) {
    res.status(400).json({ ok: false, error: target.error })
    return
  }

  const text = [
    target.stationName ? `${target.stationName} 运单号（${waybillNos.length}）：` : `运单号（${waybillNos.length}）：`,
    ...waybillNos,
  ].join('\n')
  const sent = await sendFeishuText(target.openId, text)
  if (!sent.ok) {
    res.status(sent.status).json({ ok: false, error: sent.error })
    return
  }
  res.json({ ok: true, data: { total: waybillNos.length, recipientName: target.recipientName } })
})
