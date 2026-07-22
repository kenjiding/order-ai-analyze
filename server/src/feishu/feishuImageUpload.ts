import {
  FEISHU_UPLOAD_IMAGES_URL,
  inferFeishuImagePartMeta,
  splitDataUrlBase64,
} from '../feishuWebhookHelpers'
import { fetchFeishuJson } from './feishuHttpClient'

export type FeishuImageUploadResult =
  | { ok: true; imageKey: string; feishu: unknown }
  | { ok: false; error: string; httpStatus?: number; feishu?: unknown }

export async function uploadFeishuImageFromBase64(
  tenantToken: string,
  imageBase64: string,
): Promise<FeishuImageUploadResult> {
  const { base64: b64, mimeFromDataUrl } = splitDataUrlBase64(imageBase64)
  if (!b64) {
    return { ok: false, error: '图片 Base64 为空' }
  }

  let buf: Buffer
  try {
    buf = Buffer.from(b64, 'base64')
  } catch {
    return { ok: false, error: 'imageBase64 不是合法 Base64' }
  }

  if (buf.length < 16) {
    return { ok: false, error: '图片数据过小' }
  }
  if (buf.length > 9 * 1024 * 1024) {
    return { ok: false, error: '图片超过 9MB，请压缩后重试（飞书上传上限 10MB）' }
  }

  const { contentType: imageContentType, filename: imageFilename } = inferFeishuImagePartMeta(buf, mimeFromDataUrl)
  const form = new FormData()
  form.append('image_type', 'message')
  form.append('image', new Blob([new Uint8Array(buf)], { type: imageContentType }), imageFilename)

  const uploadResult = await fetchFeishuJson(FEISHU_UPLOAD_IMAGES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tenantToken}` },
    body: form,
  })
  if (!uploadResult.ok) {
    return { ok: false, error: uploadResult.error }
  }
  const uploadJson = uploadResult.json
  const uploadHttpStatus = uploadResult.httpStatus

  const uploadObj =
    typeof uploadJson === 'object' && uploadJson !== null ? (uploadJson as Record<string, unknown>) : null
  const uploadCode = uploadObj && typeof uploadObj.code === 'number' ? uploadObj.code : NaN
  const data = uploadObj?.data && typeof uploadObj.data === 'object' ? (uploadObj.data as Record<string, unknown>) : null
  const imageKey = typeof data?.image_key === 'string' && data.image_key.trim() !== '' ? data.image_key.trim() : ''

  if (uploadCode !== 0 || !imageKey) {
    const msg =
      uploadObj && typeof uploadObj.msg === 'string'
        ? uploadObj.msg
        : uploadHttpStatus && uploadHttpStatus !== 200
          ? `飞书上传图片 HTTP ${uploadHttpStatus}`
          : '飞书上传图片失败（请核对 tenant_access_token 权限 im:resource / im:resource:upload 与机器人能力）'
    return { ok: false, error: msg, httpStatus: uploadHttpStatus, feishu: uploadJson }
  }

  return { ok: true, imageKey, feishu: uploadJson }
}
