/**
 * iMile 退返商家（RTC）提交：ds.imile.com/lm/express/ops/v1/biz/rc/rtc/submit。
 * 一次提交一个扫描单号 + 一个商家码，成功时回传 blockInfo / operateTypeDesc 供前端展示。
 */

import { requestImileApi } from './client'
import { buildImilePortalHeaders, IMILE_DC_RTC_PORTAL } from './portal'
import { readResultObject } from './resultObject'
import { envFirstOr, isRecord } from './shared'

const DEFAULT_RTC_SUBMIT_URL = 'https://ds.imile.com/lm/express/ops/v1/biz/rc/rtc/submit'

export type ReturnToMerchantSubmitParams = {
  imileToken: string
  /** 商家码，如 Temu 的 C2104008201 */
  clientCode: string
  /** 当前站点码，取自前端「站点选择器」 */
  currentStationCode: string
  /** 扫描到的条形码 */
  scanNumber: string
}

export type ReturnToMerchantSubmitResult =
  | { ok: true; blockCode: number | null; blockInfo: string; operateTypeDesc: string }
  | { ok: false; status: number; message: string }

/** blockInfo 的实际形态未抓包确认，可能是字符串/对象/数组；统一压成可展示文本，别静默丢掉 */
function toDisplayText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(toDisplayText).filter(Boolean).join('；')
  if (isRecord(value)) {
    const msg = value.message ?? value.msg ?? value.desc ?? value.blockInfo
    if (typeof msg === 'string' && msg.trim()) return msg.trim()
    return JSON.stringify(value)
  }
  return String(value)
}

export async function submitReturnToMerchant(
  params: ReturnToMerchantSubmitParams,
): Promise<ReturnToMerchantSubmitResult> {
  const headers = buildImilePortalHeaders({
    token: params.imileToken,
    envPrefix: 'IMILE_RTC',
    defaults: IMILE_DC_RTC_PORTAL,
    sharedEnvPrefixes: ['IMILE_TRACK'],
    injectUserCode: true,
    overrides: { hubcode: params.currentStationCode },
  })

  const result = await requestImileApi({
    url: envFirstOr(['IMILE_RTC_SUBMIT_URL'], DEFAULT_RTC_SUBMIT_URL),
    method: 'POST',
    headers,
    body: {
      clientCode: params.clientCode,
      currentStationCode: params.currentStationCode,
      scanNumber: params.scanNumber,
    },
    label: '退返商家提交',
    retryBusy: true,
  })

  if (!result.ok) {
    return { ok: false, status: result.status, message: result.message }
  }

  const resultObject = readResultObject(result.json)
  const rawBlockCode = isRecord(resultObject) ? resultObject.blockCode : undefined
  return {
    ok: true,
    // 成功时 iMile 不返回 blockCode，只有被拦截才回非 0 的 blockCode + blockInfo
    blockCode: rawBlockCode == null || rawBlockCode === '' ? null : Number(rawBlockCode),
    blockInfo: isRecord(resultObject) ? toDisplayText(resultObject.blockInfo) : '',
    operateTypeDesc: isRecord(resultObject) ? toDisplayText(resultObject.operateTypeDesc) : '',
  }
}
