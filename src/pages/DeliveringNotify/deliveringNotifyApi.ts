import { backendFetch } from '../../api/httpClient'

export type DeliveringNotifyCourierGroup = {
  courier: string
  courierCode: string
  waybillNos: string[]
}

export type DeliveringNotifyPushResult = {
  vendorCode: string
  vendorName: string
  waybillCount: number
  outForDelivery: DeliveringNotifyCourierGroup[]
  oversizedUncollected: DeliveringNotifyCourierGroup[]
  pushed: boolean
  error?: string
}

export type DeliveringNotifyNoConfigVendor = {
  courierVendorCode: string
  waybillCount: number
  outForDelivery: DeliveringNotifyCourierGroup[]
  oversizedUncollected: DeliveringNotifyCourierGroup[]
}

export type DeliveringNotifyPushData = {
  totalScanned: number
  matchedCount: number
  unmatchedWaybillNos: string[]
  /** 已查到运单，但未命中「正在派送」或「超大件未取」，未参与推送 */
  notInDeliveryWaybillNos: string[]
  pushResults: DeliveringNotifyPushResult[]
  noConfigVendors: DeliveringNotifyNoConfigVendor[]
}

export type DeliveringNotifyPushFail = { ok: false; error: string; unauthorized?: boolean }

export async function pushDeliveringNotify(params: {
  imileToken: string
  stationCode: string
  waybillNos: string[]
  images?: string[]
}): Promise<{ ok: true; data: DeliveringNotifyPushData } | DeliveringNotifyPushFail> {
  const path = '/api/delivering-notify/push'
  try {
    const res = await backendFetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.imileToken}`,
      },
      body: JSON.stringify({
        stationCode: params.stationCode,
        waybillNos: params.waybillNos,
        images: params.images,
      }),
    })
    if (res.status === 401) {
      return { ok: false, error: '登录已过期，请重新登录', unauthorized: true }
    }
    type Wire = { ok?: boolean; data?: DeliveringNotifyPushData; error?: string }
    const parsed = (await res.json()) as Wire
    if (parsed.ok === true && parsed.data) return { ok: true, data: parsed.data }
    return { ok: false, error: typeof parsed.error === 'string' ? parsed.error : '推送失败' }
  } catch {
    return { ok: false, error: `无法访问后端 (${path})。请确认已运行 server 或检查 VITE_API_BASE。` }
  }
}
