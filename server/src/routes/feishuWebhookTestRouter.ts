import type { Request, Response } from 'express'
import { Router } from 'express'
import { getFeishuTenantAccessToken } from '../feishuServerEnv'
import {
  FEISHU_UPLOAD_IMAGES_URL,
  computeFeishuWebhookSign,
  inferFeishuImagePartMeta,
  parseSafeWebhookUrl,
  splitDataUrlBase64,
} from '../feishuWebhookHelpers'
import {
  generateSortEfficiencyFeishuAnalysis,
  splitFeishuWebhookTextChunks,
} from '../sortEfficiencyFeishuAnalysis'

export const feishuWebhookTestRouter = Router()

type TestBody = {
  webhookUrl?: unknown
  signingSecret?: unknown
  pushName?: unknown
}

feishuWebhookTestRouter.post('/test', async (req: Request, res: Response) => {
  const body = req.body as TestBody
  let webhookHref: string
  try {
    webhookHref = parseSafeWebhookUrl(body.webhookUrl).href
  } catch {
    res.status(400).json({
      ok: false,
      error: '仅允许访问飞书开放平台官方 webhook 地址（HTTPS，open.feishu.cn/open-apis/bot/v2/hook/…）。',
    })
    return
  }

  const secretRaw = body.signingSecret
  const secret =
    typeof secretRaw === 'string' && secretRaw.trim() !== '' ? secretRaw.trim() : undefined

  const pushName = typeof body.pushName === 'string' && body.pushName.trim() ? body.pushName.trim() : '未命名推送'

  const stamp = new Date()
  const timeStr =
    `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')} ` +
    `${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`

  const text = `[仓库管理] 「${pushName}」推送测试 ${timeStr}。若群内收到本消息则说明 webhook 与网络正常；含「推送测试」便于自定义关键词校验。`

  const payload: Record<string, unknown> = {
    msg_type: 'text',
    content: { text },
  }

  const timestampSec = Math.floor(Date.now() / 1000)
  if (secret) {
    payload.timestamp = String(timestampSec)
    payload.sign = computeFeishuWebhookSign(secret, timestampSec)
  }

  try {
    const upstream = await fetch(webhookHref, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    let feishu: unknown
    try {
      feishu = await upstream.json()
    } catch {
      feishu = await upstream.text().catch(() => '')
    }

    const data = typeof feishu === 'object' && feishu !== null ? (feishu as Record<string, unknown>) : {}
    const code = data.code
    const codeOk = typeof code === 'number' && code === 0
    const ok = upstream.ok === true && codeOk

    res.status(ok ? 200 : 502).json({
      ok,
      httpStatus: upstream.status,
      feishu,
    })
  } catch {
    res.status(502).json({
      ok: false,
      error: '无法连接飞书 webhook，请检查本机后端是否启动、Webhook 是否正确或稍后重试。',
    })
  }
})

type PushTextBody = {
  webhookUrl?: unknown
  signingSecret?: unknown
  /** 完整可见正文（建议由前端加好前缀如 [仓库管理]） */
  text?: unknown
}

/** 仅推送文本：无需图片与 tenant_access_token；长文案按段拆分发送 */
feishuWebhookTestRouter.post('/push-text', async (req: Request, res: Response) => {
  const body = req.body as PushTextBody
  let webhookHref: string
  try {
    webhookHref = parseSafeWebhookUrl(body.webhookUrl).href
  } catch {
    res.status(400).json({
      ok: false,
      error: '仅允许访问飞书开放平台官方 webhook 地址（HTTPS，open.feishu.cn/open-apis/bot/v2/hook/…）。',
    })
    return
  }

  const textRaw = typeof body.text === 'string' ? body.text : ''
  const fullText = textRaw.trim()
  if (!fullText) {
    res.status(400).json({ ok: false, error: '缺少 text 或文案为空' })
    return
  }

  const chunks = splitFeishuWebhookTextChunks(fullText)
  if (!chunks.length) {
    res.status(400).json({ ok: false, error: '文案为空' })
    return
  }

  const secretRaw = body.signingSecret
  const secret =
    typeof secretRaw === 'string' && secretRaw.trim() !== '' ? secretRaw.trim() : undefined

  try {
    let lastFeishu: unknown
    let lastHttp = 200
    for (const segment of chunks) {
      const trimmed = segment.trim()
      if (!trimmed) continue
      const textPayload: Record<string, unknown> = {
        msg_type: 'text',
        content: { text: trimmed },
      }
      if (secret) await appendWebhookSign(textPayload, secret)
      const r = await postWebhookJson(webhookHref, textPayload)
      lastFeishu = r.feishu
      lastHttp = r.httpStatus
      if (!r.ok) {
        res.status(502).json({
          ok: false,
          error: '飞书 webhook 文案消息发送失败。',
          httpStatus: r.httpStatus,
          feishu: r.feishu,
        })
        return
      }
    }

    res.status(200).json({
      ok: true,
      httpStatus: lastHttp,
      feishu: lastFeishu,
    })
  } catch {
    res.status(502).json({
      ok: false,
      error: '推送文案时发生网络错误，请稍后重试。',
    })
  }
})

type PushImageBody = {
  webhookUrl?: unknown
  signingSecret?: unknown
  imageBase64?: unknown
  /** 先发一条文本做关键词占位（默认含「仓库管理」「一级分拣」）；传空字符串可跳过 */
  headlineText?: unknown
  /** 分拣效率 JSON（kind=sort_efficiency_v1）；若服务端配置了 DEEPSEEK_API_KEY，将生成解读后再发图片 */
  dataSnapshot?: unknown
}

async function appendWebhookSign(payload: Record<string, unknown>, secret: string): Promise<number> {
  const timestampSec = Math.floor(Date.now() / 1000)
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
  payload.timestamp = String(timestampSec)
  payload.sign = computeFeishuWebhookSign(secret, timestampSec)
  return timestampSec
}

async function postWebhookJson(webhookHref: string, payload: Record<string, unknown>): Promise<{ ok: boolean; httpStatus: number; feishu: unknown }> {
  const upstream = await fetch(webhookHref, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  let feishu: unknown
  try {
    feishu = await upstream.json()
  } catch {
    feishu = await upstream.text().catch(() => '')
  }
  const data = typeof feishu === 'object' && feishu !== null ? (feishu as Record<string, unknown>) : {}
  const code = data.code
  const codeOk = typeof code === 'number' && code === 0
  const ok = upstream.ok === true && codeOk
  return { ok, httpStatus: upstream.status, feishu }
}

feishuWebhookTestRouter.post('/push-image', async (req: Request, res: Response) => {
  const body = req.body as PushImageBody
  let webhookHref: string
  try {
    webhookHref = parseSafeWebhookUrl(body.webhookUrl).href
  } catch {
    res.status(400).json({
      ok: false,
      error: '仅允许访问飞书开放平台官方 webhook 地址（HTTPS，open.feishu.cn/open-apis/bot/v2/hook/…）。',
    })
    return
  }

  const tenantRes = await getFeishuTenantAccessToken()
  if (!tenantRes.ok) {
    if (tenantRes.reason === 'not_configured') {
      res.status(400).json({
        ok: false,
        error:
          '服务器未配置飞书开放接口凭证。请在运行后端的 .env 中设置 FEISHU_APP_ID 与 FEISHU_APP_SECRET（后端将请求 tenant_access_token/internal 换取 token；应用需具备上传图片等相关权限）。',
      })
      return
    }
    res.status(502).json({
      ok: false,
      error: tenantRes.error || '获取 tenant_access_token 失败',
      feishuAuth: tenantRes.feishuAuth,
    })
    return
  }
  const tenant = tenantRes.token

  const b64Raw = typeof body.imageBase64 === 'string' ? body.imageBase64 : ''
  const { base64: b64, mimeFromDataUrl } = splitDataUrlBase64(b64Raw)
  if (!b64) {
    res.status(400).json({ ok: false, error: '缺少 imageBase64' })
    return
  }

  let buf: Buffer
  try {
    buf = Buffer.from(b64, 'base64')
  } catch {
    res.status(400).json({ ok: false, error: 'imageBase64 不是合法 Base64' })
    return
  }

  if (buf.length < 16) {
    res.status(400).json({ ok: false, error: '图片数据过小' })
    return
  }
  if (buf.length > 9 * 1024 * 1024) {
    res.status(400).json({ ok: false, error: '图片超过 9MB，请压缩后重试（飞书上传上限 10MB）' })
    return
  }

  const secretRaw = body.signingSecret
  const secret =
    typeof secretRaw === 'string' && secretRaw.trim() !== '' ? secretRaw.trim() : undefined

  const { contentType: imageContentType, filename: imageFilename } = inferFeishuImagePartMeta(buf, mimeFromDataUrl)
  const form = new FormData()
  form.append('image_type', 'message')
  form.append('image', new Blob([new Uint8Array(buf)], { type: imageContentType }), imageFilename)

  let uploadJson: unknown
  let uploadHttpStatus = 0
  try {
    const up = await fetch(FEISHU_UPLOAD_IMAGES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tenant}` },
      body: form,
    })
    uploadHttpStatus = up.status
    uploadJson = await up.json().catch(async () => await up.text().catch(() => ''))
  } catch {
    res.status(502).json({ ok: false, error: '无法连接飞书图片上传接口' })
    return
  }

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
    res.status(502).json({
      ok: false,
      error: msg,
      feishuUpload: uploadJson,
    })
    return
  }

  const headlineDefault =
    typeof body.headlineText === 'undefined'
      ? `[仓库管理] 一级分拣效率报表图（截图）。若机器人启用了自定义关键词，本行用于命中关键词后再发图片消息。`
      : typeof body.headlineText === 'string'
        ? body.headlineText
        : ''

  let aiAnalysisGenerated = false
  let aiAnalysisError: string | undefined
  let analysisChunksResolved: string[] = []

  const snapRaw = body.dataSnapshot
  if (snapRaw !== undefined && snapRaw !== null && typeof snapRaw === 'object' && !Array.isArray(snapRaw)) {
    const gen = await generateSortEfficiencyFeishuAnalysis(snapRaw)
    if (gen.ok) {
      analysisChunksResolved = splitFeishuWebhookTextChunks(gen.text)
      aiAnalysisGenerated = analysisChunksResolved.length > 0
    } else {
      aiAnalysisError = gen.error
    }
  }

  try {
    const textMessages: string[] = []
    if (headlineDefault.trim()) textMessages.push(headlineDefault.trim())
    textMessages.push(...analysisChunksResolved)

    for (const segment of textMessages) {
      const trimmed = segment.trim()
      if (!trimmed) continue
      const headPayload: Record<string, unknown> = {
        msg_type: 'text',
        content: { text: trimmed },
      }
      if (secret) await appendWebhookSign(headPayload, secret)
      const headRes = await postWebhookJson(webhookHref, headPayload)
      if (!headRes.ok) {
        res.status(502).json({
          ok: false,
          error: '飞书 webhook 文案消息发送失败。',
          webhookTextHttpStatus: headRes.httpStatus,
          webhookTextFeishu: headRes.feishu,
          aiAnalysisGenerated,
          aiAnalysisError,
        })
        return
      }
    }

    const imgPayload: Record<string, unknown> = {
      msg_type: 'image',
      content: { image_key: imageKey },
    }
    if (secret) await appendWebhookSign(imgPayload, secret)

    const imgRes = await postWebhookJson(webhookHref, imgPayload)
    const ok = imgRes.ok
    res.status(ok ? 200 : 502).json({
      ok,
      httpStatus: imgRes.httpStatus,
      feishu: imgRes.feishu,
      imageUploaded: Boolean(imageKey),
      aiAnalysisGenerated,
      aiAnalysisError,
    })
  } catch {
    res.status(502).json({
      ok: false,
      error: '已向飞书上载图片但推送 webhook 时出现网络错误。',
      aiAnalysisGenerated,
      aiAnalysisError,
    })
  }
})
