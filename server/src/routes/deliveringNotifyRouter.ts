import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import { readImileTokenFromRequest } from './imileAuth'
import { fetchSearchWaybillByNos } from '../imile/inboundWaybillIndex'
import { resolveRegionTz, localDateInTz } from '../imile/ausTimezone'
import { buildDeliveringNotifyCard, type DeliveringNotifyCourierGroup } from '../feishu/buildDeliveringNotifyCard'
import { classifyDeliveringNotifyWaybill } from '../feishu/deliveringNotifyClassify'
import { uploadFeishuImageFromBase64 } from '../feishu/feishuImageUpload'
import { sendSupplierPushCard } from '../feishu/sendSupplierPushCard'
import { getFeishuTenantAccessToken } from '../feishuServerEnv'
import { isSupplierPushConfigured, listSupplierPushConfigs, supplierDisplayName } from '../supplierPushConfigs'

export const deliveringNotifyRouter = Router()

const MAX_PUSH_IMAGES = 6

type WaybillDeliveryRow = {
  waybillNo?: string
  courier?: string
  courierCode?: string
  courierVendor?: string
  courierVendorCode?: string
  routeCode?: string
  deliveryTime?: string
  lastScanStatusCode?: unknown
  /** 签收时间；非空即代表运单已签收，不再推送 */
  signDate?: string
  [key: string]: unknown
}

type CourierMap = Map<string, DeliveringNotifyCourierGroup>

type VendorBucket = {
  outForDelivery: CourierMap
  oversizedUncollected: CourierMap
}

type PushResult = {
  vendorCode: string
  vendorName: string
  waybillCount: number
  outForDelivery: DeliveringNotifyCourierGroup[]
  oversizedUncollected: DeliveringNotifyCourierGroup[]
  pushed: boolean
  error?: string
}

type NoConfigVendor = {
  courierVendorCode: string
  waybillCount: number
  outForDelivery: DeliveringNotifyCourierGroup[]
  oversizedUncollected: DeliveringNotifyCourierGroup[]
}

function courierGroupsOf(map: CourierMap): DeliveringNotifyCourierGroup[] {
  return Array.from(map.values())
}

function waybillCountOf(outForDelivery: DeliveringNotifyCourierGroup[], oversized: DeliveringNotifyCourierGroup[]): number {
  const count = (groups: DeliveringNotifyCourierGroup[]) => groups.reduce((sum, c) => sum + c.waybillNos.length, 0)
  return count(outForDelivery) + count(oversized)
}

function addWaybillToCourierMap(map: CourierMap, record: WaybillDeliveryRow, waybillNo: string): void {
  const courierCode = (record.courierCode ?? '').trim()
  const courier = (record.courier ?? '').trim()
  const key = courierCode || courier || '未知司机'
  if (!map.has(key)) map.set(key, { courier, courierCode, waybillNos: [] })
  map.get(key)!.waybillNos.push(waybillNo)
}

deliveringNotifyRouter.post('/push', async (req: AuthenticatedRequest, res: Response) => {
  const token = readImileTokenFromRequest(req)
  if (!token) {
    res.status(401).json({ ok: false, error: '缺少 iMile token' })
    return
  }

  type PushBody = { waybillNos?: unknown; stationCode?: unknown; stationName?: unknown; images?: unknown }
  const body = req.body as PushBody

  const stationCode = typeof body.stationCode === 'string' ? body.stationCode.trim() : ''
  if (!stationCode) {
    res.status(400).json({ ok: false, error: '缺少必填字段: stationCode' })
    return
  }
  // 卡片展示站点名，取不到时退回编码
  const stationName = (typeof body.stationName === 'string' ? body.stationName.trim() : '') || stationCode

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

  const images = Array.isArray(body.images)
    ? body.images.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, MAX_PUSH_IMAGES)
    : []

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
  const notInDeliveryWaybillNos: string[] = []
  const vendorGroups = new Map<string, VendorBucket>()

  for (const no of waybillNos) {
    const record = recordByWaybillNo.get(no)
    if (!record) continue
    const kind = classifyDeliveringNotifyWaybill(record)
    if (kind === 'skip') {
      notInDeliveryWaybillNos.push(no)
      continue
    }
    const vendorCode = (record.courierVendorCode ?? '').trim()
    if (!vendorCode) {
      notInDeliveryWaybillNos.push(no)
      continue
    }
    if (!vendorGroups.has(vendorCode)) {
      vendorGroups.set(vendorCode, { outForDelivery: new Map(), oversizedUncollected: new Map() })
    }
    const bucket = vendorGroups.get(vendorCode)!
    addWaybillToCourierMap(kind === 'outForDelivery' ? bucket.outForDelivery : bucket.oversizedUncollected, record, no)
  }

  const configs = (await listSupplierPushConfigs(req.authUser?.regionCode ?? undefined)).filter((c) =>
    isSupplierPushConfigured(c),
  )
  const configByVendorCode = new Map(configs.map((c) => [c.vendorCode.trim().toUpperCase(), c]))

  const pushResults: PushResult[] = []
  const noConfigVendors: NoConfigVendor[] = []
  const vendorsToPush = [...vendorGroups.entries()].filter(([vendorCode]) =>
    configByVendorCode.has(vendorCode.toUpperCase()),
  )

  let imageKeys: string[] = []
  if (images.length > 0 && vendorsToPush.length > 0) {
    const tenantRes = await getFeishuTenantAccessToken()
    if (!tenantRes.ok) {
      res.status(tenantRes.reason === 'not_configured' ? 400 : 502).json({
        ok: false,
        error:
          tenantRes.reason === 'not_configured'
            ? '服务器未配置飞书开放接口凭证（FEISHU_APP_ID / FEISHU_APP_SECRET），无法上传现场照片'
            : tenantRes.error || '获取飞书凭证失败，无法上传现场照片',
      })
      return
    }
    for (let i = 0; i < images.length; i += 1) {
      const upload = await uploadFeishuImageFromBase64(tenantRes.token, images[i]!)
      if (!upload.ok) {
        res.status(502).json({ ok: false, error: `第 ${i + 1} 张现场照片上传失败：${upload.error}` })
        return
      }
      imageKeys.push(upload.imageKey)
    }
  }

  for (const [vendorCode, bucket] of vendorGroups) {
    const outForDelivery = courierGroupsOf(bucket.outForDelivery)
    const oversizedUncollected = courierGroupsOf(bucket.oversizedUncollected)
    const waybillCount = waybillCountOf(outForDelivery, oversizedUncollected)
    const config = configByVendorCode.get(vendorCode.toUpperCase())

    if (!config) {
      noConfigVendors.push({ courierVendorCode: vendorCode, waybillCount, outForDelivery, oversizedUncollected })
      continue
    }

    const vendorName = supplierDisplayName(config)
    const card = buildDeliveringNotifyCard({
      vendorName,
      stationName,
      date: dateStr,
      tz,
      outForDelivery,
      oversizedUncollected,
      imageKeys,
    })

    const sent = await sendSupplierPushCard(config, card)
    if (sent.ok) {
      pushResults.push({ vendorCode, vendorName, waybillCount, outForDelivery, oversizedUncollected, pushed: true })
    } else {
      pushResults.push({
        vendorCode,
        vendorName,
        waybillCount,
        outForDelivery,
        oversizedUncollected,
        pushed: false,
        error: sent.reason ?? '推送失败',
      })
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
