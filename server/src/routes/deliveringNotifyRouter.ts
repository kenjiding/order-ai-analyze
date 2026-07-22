import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { readImileTokenFromRequest } from './imileAuth'
import { fetchSearchWaybillByNos } from '../imile/inboundWaybillIndex'
import { resolveRegionTz, localDateInTz } from '../imile/ausTimezone'
import { computeFeishuWebhookSign, parseSafeWebhookUrl } from '../feishuWebhookHelpers'
import { buildDeliveringNotifyCard, type DeliveringNotifyCourierGroup } from '../feishu/buildDeliveringNotifyCard'
import { isSupplierWebhookConfigured, listSupplierPushConfigs, supplierDisplayName } from '../supplierPushConfigs'

export const deliveringNotifyRouter = Router()

type WaybillDeliveryRow = {
  waybillNo?: string
  courier?: string
  courierCode?: string
  courierVendor?: string
  courierVendorCode?: string
  routeCode?: string
  /** 签收时间；非空即代表运单已签收，不再是「派送中」状态 */
  signDate?: string
  [key: string]: unknown
}

type PushResult = {
  vendorCode: string
  vendorName: string
  waybillCount: number
  couriers: DeliveringNotifyCourierGroup[]
  pushed: boolean
  error?: string
}

type NoConfigVendor = {
  courierVendorCode: string
  waybillCount: number
  couriers: DeliveringNotifyCourierGroup[]
}

deliveringNotifyRouter.post('/push', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(401).json({ ok: false, error: '缺少 iMile token' })
    return
  }

  type PushBody = { waybillNos?: unknown; stationCode?: unknown }
  const body = req.body as PushBody

  const stationCode = typeof body.stationCode === 'string' ? body.stationCode.trim() : ''
  if (!stationCode) {
    res.status(400).json({ ok: false, error: '缺少必填字段: stationCode' })
    return
  }

  const waybillNos = Array.isArray(body.waybillNos)
    ? Array.from(
        new Set(
          body.waybillNos
            .filter((no): no is string => typeof no === 'string' && no.trim().length > 0)
            .map((no) => no.trim()),
        ),
      )
    : []
  if (waybillNos.length === 0) {
    res.status(400).json({ ok: false, error: '缺少必填字段: waybillNos' })
    return
  }

  const tz = resolveRegionTz(req.authUser?.regionCode)
  const dateStr = localDateInTz(Date.now(), tz)

  const searchResult = await fetchSearchWaybillByNos({
    token,
    stationCode,
    dateStr,
    waybillNos,
    label: '派送中包裹通知查询',
    tz,
  })

  if (!searchResult.ok) {
    res.status(502).json({ ok: false, error: `运单查询失败: ${searchResult.message}` })
    return
  }

  const records = searchResult.records as WaybillDeliveryRow[]
  const recordByWaybillNo = new Map<string, WaybillDeliveryRow>()
  for (const record of records) {
    const no = (record.waybillNo ?? '').trim()
    if (no) recordByWaybillNo.set(no, record)
  }

  const unmatchedWaybillNos = waybillNos.filter((no) => !recordByWaybillNo.has(no))

  // signDate 非空说明已签收，最新状态不再是「派送中」，不参与推送
  const notInDeliveryWaybillNos: string[] = []

  // 按 courierVendorCode → courierCode 分组
  const vendorGroups = new Map<string, Map<string, DeliveringNotifyCourierGroup>>()
  for (const no of waybillNos) {
    const record = recordByWaybillNo.get(no)
    if (!record) continue
    if ((record.signDate ?? '').trim()) {
      notInDeliveryWaybillNos.push(no)
      continue
    }
    const vendorCode = (record.courierVendorCode ?? '').trim()
    if (!vendorCode) continue
    const courierCode = (record.courierCode ?? '').trim()
    const courier = (record.courier ?? '').trim()

    if (!vendorGroups.has(vendorCode)) vendorGroups.set(vendorCode, new Map())
    const courierGroups = vendorGroups.get(vendorCode)!
    const key = courierCode || courier || '未知司机'
    if (!courierGroups.has(key)) courierGroups.set(key, { courier, courierCode, waybillNos: [] })
    courierGroups.get(key)!.waybillNos.push(no)
  }

  const configs = (await listSupplierPushConfigs(req.authUser?.regionCode ?? undefined)).filter((c) =>
    isSupplierWebhookConfigured(c.webhookUrl),
  )
  const configByVendorCode = new Map(configs.map((c) => [c.vendorCode.trim().toUpperCase(), c]))

  const pushResults: PushResult[] = []
  const noConfigVendors: NoConfigVendor[] = []

  for (const [vendorCode, courierGroups] of vendorGroups) {
    const couriers = Array.from(courierGroups.values())
    const waybillCount = couriers.reduce((sum, c) => sum + c.waybillNos.length, 0)
    const config = configByVendorCode.get(vendorCode.toUpperCase())

    if (!config) {
      noConfigVendors.push({ courierVendorCode: vendorCode, waybillCount, couriers })
      continue
    }

    const vendorName = supplierDisplayName(config)
    const card = buildDeliveringNotifyCard({ vendorName, stationCode, date: dateStr, tz, couriers })

    try {
      const webhookHref = parseSafeWebhookUrl(config.webhookUrl).href
      const payload: Record<string, unknown> = { msg_type: 'interactive', card }
      if (config.signingSecret) {
        const timestampSec = Math.floor(Date.now() / 1000)
        payload.timestamp = String(timestampSec)
        payload.sign = computeFeishuWebhookSign(config.signingSecret, timestampSec)
      }
      const upstream = await fetch(webhookHref, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const feishuData = (await upstream.json().catch(() => ({}))) as Record<string, unknown>
      const code = feishuData.code
      if (upstream.ok && typeof code === 'number' && code === 0) {
        pushResults.push({ vendorCode, vendorName, waybillCount, couriers, pushed: true })
      } else {
        pushResults.push({
          vendorCode,
          vendorName,
          waybillCount,
          couriers,
          pushed: false,
          error: `飞书返回 code=${String(code)}`,
        })
      }
    } catch {
      pushResults.push({ vendorCode, vendorName, waybillCount, couriers, pushed: false, error: '网络错误' })
    }
  }

  res.json({
    ok: true,
    data: {
      totalScanned: waybillNos.length,
      matchedCount: waybillNos.length - unmatchedWaybillNos.length - notInDeliveryWaybillNos.length,
      unmatchedWaybillNos,
      notInDeliveryWaybillNos,
      pushResults,
      noConfigVendors,
    },
  })
})
