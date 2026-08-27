import { backendFetch } from '../../api/httpClient'

export type ReturnToMerchantSubmitItem = {
  id: string
  scanNumber: string
  clientCode: string
}

export type ReturnToMerchantItemResult = ReturnToMerchantSubmitItem & {
  ok: boolean
  /** iMile resultObject.blockInfo，拦截 / 提示信息 */
  blockInfo?: string
  /** iMile resultObject.operateTypeDesc，本次操作类型描述 */
  operateTypeDesc?: string
  error?: string
}

export type ReturnToMerchantSubmitData = {
  total: number
  successCount: number
  results: ReturnToMerchantItemResult[]
}

export type ReturnToMerchantSubmitFail = { ok: false; error: string; unauthorized?: boolean }

export async function submitReturnToMerchant(params: {
  imileToken: string
  stationCode: string
  items: ReturnToMerchantSubmitItem[]
}): Promise<{ ok: true; data: ReturnToMerchantSubmitData } | ReturnToMerchantSubmitFail> {
  const path = '/api/return-to-merchant/submit'
  try {
    const res = await backendFetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.imileToken}`,
      },
      body: JSON.stringify({ stationCode: params.stationCode, items: params.items }),
    })
    if (res.status === 401) {
      return { ok: false, error: '登录已过期，请重新登录', unauthorized: true }
    }
    type Wire = { ok?: boolean; data?: ReturnToMerchantSubmitData; error?: string }
    const parsed = (await res.json()) as Wire
    if (parsed.ok === true && parsed.data) return { ok: true, data: parsed.data }
    return { ok: false, error: typeof parsed.error === 'string' ? parsed.error : '提交失败' }
  } catch {
    return { ok: false, error: `无法访问后端 (${path})。请确认已运行 server 或检查 VITE_API_BASE。` }
  }
}
