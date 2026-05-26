import { getApiBaseUrl } from '../../utils/apiBaseUrl'

export type FeishuPushTestPayload = {
  webhookUrl: string
  signingSecret?: string | undefined
  pushName: string
}

export type FeishuPushImagePayload = {
  webhookUrl: string
  signingSecret?: string | undefined
  /** 纯 base64 或 data:image/png;base64,... */
  imageBase64: string
  /** 先发关键词/说明文案（空字符串跳过） */
  headlineText?: string
  /** 分拣效率等结构化数据；服务端若配置 DEEPSEEK_API_KEY，将生成解读文案后于图片前推送 */
  dataSnapshot?: Record<string, unknown>
}

export type FeishuPushTestOk = { ok: true; httpStatus: number; feishu: unknown }
export type FeishuPushTestFail = {
  ok: false
  httpStatus?: number
  feishu?: unknown
  error?: string
}

export type FeishuPushImageOk = {
  ok: true
  httpStatus: number
  feishu: unknown
  imageUploaded?: boolean
  aiAnalysisGenerated?: boolean
  aiAnalysisError?: string
}
export type FeishuPushImageFail = {
  ok: false
  httpStatus?: number
  feishu?: unknown
  feishuUpload?: unknown
  error?: string
}

export async function postFeishuPushTest(payload: FeishuPushTestPayload): Promise<FeishuPushTestOk | FeishuPushTestFail> {
  const url = `${getApiBaseUrl()}/api/feishu-webhook/test`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    type Wire = {
      ok?: boolean
      httpStatus?: number
      feishu?: unknown
      error?: string
    }
    const parsed = (await res.json()) as Wire
    if (parsed && typeof parsed === 'object') {
      if (parsed.ok === true) {
        return { ok: true, httpStatus: parsed.httpStatus ?? res.status, feishu: parsed.feishu }
      }
      return {
        ok: false,
        httpStatus: parsed.httpStatus ?? res.status,
        feishu: parsed.feishu,
        error: typeof parsed.error === 'string' ? parsed.error : '推送测试失败。',
      }
    }
    return { ok: false, httpStatus: res.status, error: '无法解析服务端响应。' }
  } catch {
    return { ok: false, error: `无法访问后端 (${url})。请确认已运行 server（如 pnpm dev:server）或检查 VITE_API_BASE。` }
  }
}

export async function postFeishuPushText(payload: {
  webhookUrl: string
  signingSecret?: string
  text: string
}): Promise<FeishuPushTestOk | FeishuPushTestFail> {
  const url = `${getApiBaseUrl()}/api/feishu-webhook/push-text`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl: payload.webhookUrl.trim(),
        signingSecret: payload.signingSecret,
        text: payload.text,
      }),
    })
    type Wire = {
      ok?: boolean
      httpStatus?: number
      feishu?: unknown
      error?: string
    }
    const parsed = (await res.json()) as Wire
    if (parsed && typeof parsed === 'object') {
      if (parsed.ok === true) {
        return { ok: true, httpStatus: parsed.httpStatus ?? res.status, feishu: parsed.feishu }
      }
      return {
        ok: false,
        httpStatus: parsed.httpStatus ?? res.status,
        feishu: parsed.feishu,
        error: typeof parsed.error === 'string' ? parsed.error : '文案推送失败。',
      }
    }
    return { ok: false, httpStatus: res.status, error: '无法解析服务端响应。' }
  } catch {
    return { ok: false, error: `无法访问后端 (${url})。请确认已运行 server 或检查 VITE_API_BASE。` }
  }
}

export function summarizeFeishuTestFailure(result: FeishuPushTestFail): string {
  if (result.error && !result.feishu) return result.error
  const fb = result.feishu as Record<string, unknown> | null | undefined
  const msg = fb && typeof fb.msg === 'string' ? fb.msg : ''
  const code = fb && typeof fb.code !== 'undefined' ? String(fb.code) : ''
  const suffix = msg || code ? `飞书响应：${[code ? `code ${code}` : '', msg].filter(Boolean).join(' · ')}` : ''
  return [result.error ?? '推送测试失败。', suffix].filter(Boolean).join(' ')
}

export async function postFeishuPushImage(
  payload: FeishuPushImagePayload,
): Promise<FeishuPushImageOk | FeishuPushImageFail> {
  const url = `${getApiBaseUrl()}/api/feishu-webhook/push-image`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl: payload.webhookUrl.trim(),
        signingSecret: payload.signingSecret,
        imageBase64: payload.imageBase64,
        headlineText: typeof payload.headlineText === 'string' ? payload.headlineText : undefined,
        ...(payload.dataSnapshot && typeof payload.dataSnapshot === 'object'
          ? { dataSnapshot: payload.dataSnapshot }
          : {}),
      }),
    })
    type WireOk = {
      ok?: boolean
      httpStatus?: number
      feishu?: unknown
      imageUploaded?: boolean
      error?: string
      feishuUpload?: unknown
      aiAnalysisGenerated?: boolean
      aiAnalysisError?: string
    }
    const parsed = (await res.json()) as WireOk
    if (parsed && typeof parsed === 'object') {
      if (parsed.ok === true) {
        return {
          ok: true,
          httpStatus: parsed.httpStatus ?? res.status,
          feishu: parsed.feishu,
          imageUploaded: parsed.imageUploaded,
          aiAnalysisGenerated: parsed.aiAnalysisGenerated,
          aiAnalysisError: typeof parsed.aiAnalysisError === 'string' ? parsed.aiAnalysisError : undefined,
        }
      }
      return {
        ok: false,
        httpStatus: parsed.httpStatus ?? res.status,
        feishu: parsed.feishu,
        feishuUpload: parsed.feishuUpload,
        error: typeof parsed.error === 'string' ? parsed.error : '图片推送失败。',
      }
    }
    return { ok: false, httpStatus: res.status, error: '无法解析服务端响应。' }
  } catch {
    return {
      ok: false,
      error: `无法访问后端 (${url})。请确认已运行 server 或检查 VITE_API_BASE。`,
    }
  }
}

export function summarizeFeishuPushImageFailure(result: FeishuPushImageFail): string {
  if (result.feishuUpload && typeof result.feishuUpload === 'object') {
    const upl = result.feishuUpload as Record<string, unknown>
    const umsg = typeof upl.msg === 'string' ? upl.msg : ''
    const ucode = typeof upl.code !== 'undefined' ? String(upl.code) : ''
    if (umsg || ucode)
      return [result.error ?? '上传图片失败', `飞书上载：${[ucode ? `code ${ucode}` : '', umsg].filter(Boolean).join(' · ')}`].join(
        ' · ',
      )
  }
  if (result.error && !result.feishu) return result.error
  const fb = result.feishu as Record<string, unknown> | null | undefined
  const msg = fb && typeof fb.msg === 'string' ? fb.msg : ''
  const code = fb && typeof fb.code !== 'undefined' ? String(fb.code) : ''
  const suffix = msg || code ? `飞书 webhook：${[code ? `code ${code}` : '', msg].filter(Boolean).join(' · ')}` : ''
  return [result.error ?? '图片推送失败', suffix].filter(Boolean).join(' · ')
}
