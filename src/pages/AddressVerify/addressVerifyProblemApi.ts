import { backendFetch } from '../../api/httpClient'

export type AddressVerifyApiResult<T> = { ok: true; data: T } | { ok: false; error: string }

export async function uploadAddressVerifyProof(
  dataUrl: string,
  fileName: string,
  imileToken: string,
): Promise<AddressVerifyApiResult<{ fileKey: string }>> {
  try {
    const res = await backendFetch('/api/address-verify/upload-proof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, fileName, imileToken }),
    })
    const json = (await res.json()) as { ok?: boolean; fileKey?: string; error?: string }
    if (!res.ok || json.ok !== true || !json.fileKey) return { ok: false, error: json.error || '图片上传失败' }
    return { ok: true, data: { fileKey: json.fileKey } }
  } catch {
    return { ok: false, error: '无法访问后端' }
  }
}

export async function reportAddressVerifyProblem(params: {
  waybillNo: string
  problemCountry: string
  description: string
  proofs: string[]
  imileToken: string
}): Promise<AddressVerifyApiResult<{ success: boolean; failWaybillNosStr: string }>> {
  try {
    const res = await backendFetch('/api/address-verify/report-problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    const json = (await res.json()) as {
      ok?: boolean
      success?: boolean
      failWaybillNosStr?: string
      error?: string
    }
    if (!res.ok || json.ok !== true) return { ok: false, error: json.error || '问题件上报失败' }
    return { ok: true, data: { success: !!json.success, failWaybillNosStr: json.failWaybillNosStr ?? '' } }
  } catch {
    return { ok: false, error: '无法访问后端' }
  }
}

/** 轨迹文案「View Proof」的 fileKey → 真实图片地址，供 OrderTrackTimeline 预览用。 */
export async function getAddressVerifyTrackProofImageUrl(fileKey: string, imileToken: string): Promise<string> {
  const res = await backendFetch(`/api/address-verify/track-proof-image?fileKey=${encodeURIComponent(fileKey)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${imileToken}` },
  })
  const json = (await res.json()) as { url?: string; error?: string }
  if (!res.ok || !json.url) throw new Error(json.error || '图片地址获取失败')
  return json.url
}
