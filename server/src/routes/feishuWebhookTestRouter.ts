import type { Response } from 'express'
import { Router } from 'express'
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type { AuthenticatedRequest } from '../auth/middleware'
import { requirePushApiScope } from '../permissions/pushNotificationAccess'
import { getFeishuTenantAccessToken } from '../feishuServerEnv'
import { getDb, schema } from '../db'
import {
  LEGACY_GLOBAL_SUPPLIER_REGION_CODE,
  listSupplierPushConfigs,
  supplierDisplayName,
} from '../supplierPushConfigs'
import {
  listFeishuCardClickEventsByMessageId,
  listFeishuCardClickEventsByMessageIds,
} from '../feishu/feishuCardClickEventRepository'
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
import { buildFleetRichMessageCard } from '../feishu/buildFleetRichMessageCard'
import { uploadFeishuImageFromBase64 } from '../feishu/feishuImageUpload'
import { upsertFeishuPushSnapshot } from '../feishu/pushSnapshotRepository'
import { fetchFeishuJson } from '../feishu/feishuHttpClient'
import {
  getFeishuMessageReadUsers,
  listFeishuBotChats,
  listFeishuChatMembers,
  sendFeishuAppMessage,
} from '../feishu/feishuAppMessage'
import {
  getFeishuPushMessageById,
  getFeishuPushMessagesByIds,
  insertFeishuPushMessage,
  listFeishuPushMessagesBySupplier,
} from '../feishu/pushMessageRepository'
import {
  buildOrderExceptionFeishuCard,
  buildOrderExceptionPushStats,
  generateOrderExceptionFeishuSummary,
  type OrderExceptionPushRow,
} from '../orderExceptionFeishuAnalysis'
import { fetchBomDailyForecast } from '../weather/bomWeatherClient'
import { buildDeliveryWeather, renderDeliveryWeatherLarkMd } from '../weather/deliveryWeatherSummary'
import { generateDeliveryWeatherText } from '../weather/deliveryWeatherAi'

export const feishuWebhookTestRouter = Router()

/**
 * 派送天气预报（明天/后天）——供「车队供应商推送」附加恶劣天气提示。
 * 返回 BOM 官方预报渲染的 lark_md 文本，供前端合并进富文本推送。
 */
feishuWebhookTestRouter.get('/delivery-weather', async (req: AuthenticatedRequest, res: Response) => {
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  const label = typeof req.query.label === 'string' && req.query.label.trim() ? req.query.label.trim() : '派送区域'
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ ok: false, error: '缺少或非法的经纬度参数 lat/lng' })
    return
  }
  const forecast = await fetchBomDailyForecast(lat, lng)
  if (!forecast) {
    res.status(502).json({ ok: false, error: '获取 BOM 天气预报失败，请稍后重试' })
    return
  }
  const block = buildDeliveryWeather(forecast, label)
  if (!block) {
    res.status(502).json({ ok: false, error: '预报数据不足，无法生成明天/后天天气' })
    return
  }
  // 优先用 AI 结合预报数据生成播报文案，失败则回退机械渲染
  const aiText = await generateDeliveryWeatherText(block)
  const larkMd = aiText
    ? `🌦️ **${block.locationLabel} Weather Forecast**\n${aiText}`
    : renderDeliveryWeatherLarkMd(block)
  res.json({ ok: true, data: { block, larkMd } })
})

type TestBody = {
  webhookUrl?: unknown
  signingSecret?: unknown
  pushName?: unknown
  pushScope?: unknown
}

feishuWebhookTestRouter.post('/test', async (req: AuthenticatedRequest, res: Response) => {
  if (!requirePushApiScope(req, res)) return

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

  const result = await fetchFeishuJson(webhookHref, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.error })
    return
  }

  const data = typeof result.json === 'object' && result.json !== null ? (result.json as Record<string, unknown>) : {}
  const code = data.code
  const codeOk = typeof code === 'number' && code === 0
  const ok = result.httpStatus >= 200 && result.httpStatus < 300 && codeOk

  res.status(ok ? 200 : 502).json({
    ok,
    httpStatus: result.httpStatus,
    feishu: result.json,
  })
})

type PushTextBody = {
  webhookUrl?: unknown
  signingSecret?: unknown
  /** 完整可见正文（建议由前端加好前缀如 [仓库管理]） */
  text?: unknown
  pushScope?: unknown
}

/** 仅推送文本：无需图片与 tenant_access_token；长文案按段拆分发送 */
feishuWebhookTestRouter.post('/push-text', async (req: AuthenticatedRequest, res: Response) => {
  if (!requirePushApiScope(req, res)) return

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
          error: r.networkError ?? '飞书 webhook 文案消息发送失败。',
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

type PushCardBody = {
  pushScope?: unknown
  webhookUrl?: unknown
  signingSecret?: unknown
  /** 飞书交互式卡片 JSON（card 字段） */
  card?: unknown
}

/** 推送飞书交互式卡片（富文本 / HTML 样式） */
feishuWebhookTestRouter.post('/push-card', async (req: AuthenticatedRequest, res: Response) => {
  if (!requirePushApiScope(req, res)) return

  const body = req.body as PushCardBody
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

  if (!body.card || typeof body.card !== 'object' || Array.isArray(body.card)) {
    res.status(400).json({ ok: false, error: '缺少 card 卡片内容' })
    return
  }

  const secretRaw = body.signingSecret
  const secret =
    typeof secretRaw === 'string' && secretRaw.trim() !== '' ? secretRaw.trim() : undefined

  const payload: Record<string, unknown> = {
    msg_type: 'interactive',
    card: body.card,
  }
  if (secret) await appendWebhookSign(payload, secret)

  try {
    const r = await postWebhookJson(webhookHref, payload)
    if (!r.ok) {
      res.status(502).json({
        ok: false,
        error: r.networkError ?? '飞书 webhook 卡片消息发送失败。',
        httpStatus: r.httpStatus,
        feishu: r.feishu,
      })
      return
    }
    res.status(200).json({ ok: true, httpStatus: r.httpStatus, feishu: r.feishu })
  } catch {
    res.status(502).json({
      ok: false,
      error: '推送卡片时发生网络错误，请稍后重试。',
    })
  }
})

type PushRichMessageBody = {
  pushScope?: unknown
  webhookUrl?: unknown
  signingSecret?: unknown
  /** lark_md 富文本正文 */
  content?: unknown
  /** data URL 或纯 base64 图片列表 */
  images?: unknown
  /** 勾选「@ 相关人员」时，前端传入该供应商花名册里选中的全部联系人 open_id */
  mentionOpenIds?: unknown
}

/** 富文本 + 多图合并为一条交互式卡片消息 */
feishuWebhookTestRouter.post('/push-rich-message', async (req: AuthenticatedRequest, res: Response) => {
  if (!requirePushApiScope(req, res)) return

  const body = req.body as PushRichMessageBody
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

  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const imagesRaw = Array.isArray(body.images) ? body.images : []
  const images = imagesRaw.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  const mentionOpenIds = (Array.isArray(body.mentionOpenIds) ? body.mentionOpenIds : [])
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .map((x) => x.trim())

  if (!content && images.length === 0) {
    res.status(400).json({ ok: false, error: '缺少文案与图片，无法推送' })
    return
  }

  const secretRaw = body.signingSecret
  const secret =
    typeof secretRaw === 'string' && secretRaw.trim() !== '' ? secretRaw.trim() : undefined

  const imageKeys: string[] = []
  if (images.length > 0) {
    const tenantRes = await getFeishuTenantAccessToken()
    if (!tenantRes.ok) {
      if (tenantRes.reason === 'not_configured') {
        res.status(400).json({
          ok: false,
          error:
            '服务器未配置飞书开放接口凭证。请在运行后端的 .env 中设置 FEISHU_APP_ID 与 FEISHU_APP_SECRET（含图片上传权限）。',
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

    for (let i = 0; i < images.length; i++) {
      const upload = await uploadFeishuImageFromBase64(tenantRes.token, images[i]!)
      if (!upload.ok) {
        res.status(502).json({
          ok: false,
          error: `第 ${i + 1} 张图片上传失败：${upload.error}`,
          feishuUpload: upload.feishu,
          imageIndex: i,
        })
        return
      }
      imageKeys.push(upload.imageKey)
    }
  }

  // 纯图片（无文案）：每张图单独发 msg_type: 'image'，飞书会折叠为可点击的缩略图
  if (!content && imageKeys.length > 0) {
    try {
      let lastFeishu: unknown
      let lastHttp = 200
      for (const key of imageKeys) {
        const imgPayload: Record<string, unknown> = {
          msg_type: 'image',
          content: { image_key: key },
        }
        if (secret) await appendWebhookSign(imgPayload, secret)
        const r = await postWebhookJson(webhookHref, imgPayload)
        lastFeishu = r.feishu
        lastHttp = r.httpStatus
        if (!r.ok) {
          res.status(502).json({
            ok: false,
            error: r.networkError ?? '飞书 webhook 图片消息发送失败。',
            httpStatus: r.httpStatus,
            feishu: r.feishu,
            imageUploadedCount: imageKeys.length,
          })
          return
        }
      }
      res.status(200).json({ ok: true, httpStatus: lastHttp, feishu: lastFeishu, imageUploadedCount: imageKeys.length })
    } catch {
      res.status(502).json({ ok: false, error: '推送图片时发生网络错误，请稍后重试。', imageUploadedCount: imageKeys.length })
    }
    return
  }

  const card = buildFleetRichMessageCard({
    content,
    imageKeys,
    mentions: mentionOpenIds.map((openId) => ({ name: '', openId })),
  })
  const payload: Record<string, unknown> = { msg_type: 'interactive', card }
  if (secret) await appendWebhookSign(payload, secret)

  try {
    const r = await postWebhookJson(webhookHref, payload)
    if (!r.ok) {
      res.status(502).json({
        ok: false,
        error: r.networkError ?? '飞书 webhook 富文本卡片消息发送失败。',
        httpStatus: r.httpStatus,
        feishu: r.feishu,
        imageUploadedCount: imageKeys.length,
      })
      return
    }
    res.status(200).json({
      ok: true,
      httpStatus: r.httpStatus,
      feishu: r.feishu,
      imageUploadedCount: imageKeys.length,
    })
  } catch {
    res.status(502).json({
      ok: false,
      error: '推送富文本卡片时发生网络错误，请稍后重试。',
      imageUploadedCount: imageKeys.length,
    })
  }
})

type PushImageBody = {
  pushScope?: unknown
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

async function postWebhookJson(
  webhookHref: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; httpStatus: number; feishu: unknown; networkError?: string }> {
  const result = await fetchFeishuJson(webhookHref, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!result.ok) {
    return { ok: false, httpStatus: 0, feishu: undefined, networkError: result.error }
  }
  const data = typeof result.json === 'object' && result.json !== null ? (result.json as Record<string, unknown>) : {}
  const code = data.code
  const codeOk = typeof code === 'number' && code === 0
  const ok = result.httpStatus >= 200 && result.httpStatus < 300 && codeOk
  return { ok, httpStatus: result.httpStatus, feishu: result.json }
}

feishuWebhookTestRouter.post('/push-image', async (req: AuthenticatedRequest, res: Response) => {
  if (!requirePushApiScope(req, res)) return

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

  const uploadResult = await fetchFeishuJson(FEISHU_UPLOAD_IMAGES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tenant}` },
    body: form,
  })
  if (!uploadResult.ok) {
    res.status(502).json({ ok: false, error: uploadResult.error })
    return
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
    // 将快照保存到服务端 DB，供定时调度器复用（失败不影响本次推送）
    const regionCode = req.authUser?.regionCode?.trim() || 'global'
    const periodLabel = typeof (snapRaw as { periodLabel?: string }).periodLabel === 'string'
      ? (snapRaw as { periodLabel?: string }).periodLabel as string
      : ''
    upsertFeishuPushSnapshot(regionCode, periodLabel, snapRaw).catch((err) => {
      console.error('[push-image] 快照保存失败（不影响推送）:', err)
    })

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
          error: headRes.networkError ?? '飞书 webhook 文案消息发送失败。',
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
      error: ok ? undefined : (imgRes.networkError ?? '飞书 webhook 图片消息发送失败。'),
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

type PushOrderExceptionBody = {
  pushScope?: unknown
  webhookUrl?: unknown
  signingSecret?: unknown
  /** 已完成分析的行（done 状态），从前端过滤后传入 */
  rows?: unknown
  analysisDate?: unknown
  /** 'deepseek' | 'openai'，默认 deepseek */
  aiProvider?: unknown
}

/** 订单异常分析结果推送：AI 总结 + 富文本卡片 */
feishuWebhookTestRouter.post('/push-order-exception', async (req: AuthenticatedRequest, res: Response) => {
  if (!requirePushApiScope(req, res)) return

  const body = req.body as PushOrderExceptionBody
  let webhookHref: string
  try {
    webhookHref = parseSafeWebhookUrl(body.webhookUrl).href
  } catch {
    res.status(400).json({ ok: false, error: '仅允许访问飞书开放平台官方 webhook 地址（HTTPS，open.feishu.cn/open-apis/bot/v2/hook/…）。' })
    return
  }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    res.status(400).json({ ok: false, error: '缺少分析结果数据（rows 为空）' })
    return
  }

  const secretRaw = body.signingSecret
  const secret = typeof secretRaw === 'string' && secretRaw.trim() !== '' ? secretRaw.trim() : undefined
  const analysisDate = typeof body.analysisDate === 'string' && body.analysisDate
    ? body.analysisDate
    : new Date().toISOString().slice(0, 10)
  const aiProvider = body.aiProvider === 'openai' ? 'openai' : 'deepseek'

  const rows = (body.rows as unknown[]).map((r) => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
    return {
      lossScope: String(o.lossScope ?? ''),
      categoryName: String(o.categoryName ?? ''),
      currentResponsibilityParty: String(o.currentResponsibilityParty ?? ''),
      confidence: String(o.confidence ?? ''),
    } satisfies OrderExceptionPushRow
  })

  const stats = buildOrderExceptionPushStats(rows, analysisDate)

  const aiResult = await generateOrderExceptionFeishuSummary(stats, aiProvider)
  const aiSummary = aiResult.ok ? aiResult.text : null
  const aiError = aiResult.ok ? undefined : aiResult.error

  const card = buildOrderExceptionFeishuCard(stats, aiSummary)

  const payload: Record<string, unknown> = { msg_type: 'interactive', card }
  if (secret) await appendWebhookSign(payload, secret)

  try {
    const r = await postWebhookJson(webhookHref, payload)
    if (!r.ok) {
      res.status(502).json({
        ok: false,
        error: r.networkError ?? '飞书 webhook 卡片消息发送失败。',
        httpStatus: r.httpStatus,
        feishu: r.feishu,
      })
      return
    }
    res.status(200).json({ ok: true, httpStatus: r.httpStatus, feishu: r.feishu, aiSummaryGenerated: Boolean(aiSummary), aiError })
  } catch {
    res.status(502).json({ ok: false, error: '推送卡片时发生网络错误，请稍后重试。' })
  }
})

/**
 * 列出自建应用机器人当前所在的群，供前端「选群」下拉填 chat_id。
 * 前提：该群已由群主/管理员手动把这个自建应用机器人拉进去。
 */
feishuWebhookTestRouter.get('/app-bot/chats', async (_req: AuthenticatedRequest, res: Response) => {
  const tenantRes = await getFeishuTenantAccessToken()
  if (!tenantRes.ok) {
    if (tenantRes.reason === 'not_configured') {
      res.status(400).json({ ok: false, error: '服务器未配置飞书开放接口凭证（FEISHU_APP_ID / FEISHU_APP_SECRET）。' })
      return
    }
    res.status(502).json({ ok: false, error: tenantRes.error || '获取 tenant_access_token 失败' })
    return
  }
  const result = await listFeishuBotChats(tenantRes.token)
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.error })
    return
  }
  res.json({ ok: true, data: result.chats })
})

/**
 * 列出某个群的全量成员（含外部联系人，不含机器人），供「@ 外部联系人」下拉选择，
 * 免去手动查/填 open_id。
 */
feishuWebhookTestRouter.get('/app-bot/chats/:chatId/members', async (req: AuthenticatedRequest, res: Response) => {
  const chatId = String(req.params.chatId ?? '').trim()
  if (!chatId) {
    res.status(400).json({ ok: false, error: '缺少 chatId' })
    return
  }
  const tenantRes = await getFeishuTenantAccessToken()
  if (!tenantRes.ok) {
    if (tenantRes.reason === 'not_configured') {
      res.status(400).json({ ok: false, error: '服务器未配置飞书开放接口凭证（FEISHU_APP_ID / FEISHU_APP_SECRET）。' })
      return
    }
    res.status(502).json({ ok: false, error: tenantRes.error || '获取 tenant_access_token 失败' })
    return
  }
  const result = await listFeishuChatMembers(tenantRes.token, chatId)
  if (!result.ok) {
    res.status(502).json({ ok: false, error: result.error })
    return
  }
  res.json({ ok: true, data: result.members })
})

type PushRichMessageAppBody = {
  pushScope?: unknown
  supplierConfigId?: unknown
  chatId?: unknown
  pushLabel?: unknown
  content?: unknown
  images?: unknown
  mentionOpenIds?: unknown
}

/**
 * 富文本 + 多图，通过自建应用机器人（im/v1/messages）发送，而非 webhook。
 * 仅当供应商配置了 chatId 时前端才会调用本接口；发送成功后落库 message_id，供「查看已读」使用。
 */
feishuWebhookTestRouter.post('/push-rich-message-app', async (req: AuthenticatedRequest, res: Response) => {
  if (!requirePushApiScope(req, res)) return

  const body = req.body as PushRichMessageAppBody
  const chatId = typeof body.chatId === 'string' ? body.chatId.trim() : ''
  if (!chatId) {
    res.status(400).json({ ok: false, error: '缺少 chatId' })
    return
  }
  const supplierConfigId =
    typeof body.supplierConfigId === 'string' && body.supplierConfigId.trim() ? body.supplierConfigId.trim() : null
  const pushLabel = typeof body.pushLabel === 'string' && body.pushLabel.trim() ? body.pushLabel.trim() : null

  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const imagesRaw = Array.isArray(body.images) ? body.images : []
  const images = imagesRaw.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  const mentionOpenIds = (Array.isArray(body.mentionOpenIds) ? body.mentionOpenIds : [])
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .map((x) => x.trim())

  if (!content && images.length === 0) {
    res.status(400).json({ ok: false, error: '缺少文案与图片，无法推送' })
    return
  }

  const tenantRes = await getFeishuTenantAccessToken()
  if (!tenantRes.ok) {
    if (tenantRes.reason === 'not_configured') {
      res.status(400).json({ ok: false, error: '服务器未配置飞书开放接口凭证（FEISHU_APP_ID / FEISHU_APP_SECRET）。' })
      return
    }
    res.status(502).json({ ok: false, error: tenantRes.error || '获取 tenant_access_token 失败' })
    return
  }
  const tenant = tenantRes.token

  const imageKeys: string[] = []
  for (let i = 0; i < images.length; i++) {
    const upload = await uploadFeishuImageFromBase64(tenant, images[i]!)
    if (!upload.ok) {
      res.status(502).json({ ok: false, error: `第 ${i + 1} 张图片上传失败：${upload.error}` })
      return
    }
    imageKeys.push(upload.imageKey)
  }

  // 纯图片（无文案）：与 webhook 通道保持一致，逐张以 msg_type: 'image' 发送，飞书折叠为可点击的缩略图
  if (!content && imageKeys.length > 0) {
    let lastMessageId = ''
    try {
      for (const key of imageKeys) {
        const sendRes = await sendFeishuAppMessage(tenant, chatId, 'image', { image_key: key })
        if (!sendRes.ok) {
          res.status(502).json({ ok: false, error: sendRes.error, feishu: sendRes.feishu })
          return
        }
        lastMessageId = sendRes.messageId
      }
    } catch {
      res.status(502).json({ ok: false, error: '推送图片时发生网络错误，请稍后重试。' })
      return
    }

    let pushMessageId: string | undefined
    try {
      const record = await insertFeishuPushMessage({
        supplierConfigId,
        chatId,
        messageId: lastMessageId,
        msgType: 'image',
        pushLabel,
        createdBy: req.authUser?.id ?? null,
      })
      pushMessageId = record.id
    } catch (err) {
      console.error('[push-rich-message-app] 记录 message_id 失败（不影响本次推送，仅无法查已读）:', err)
    }

    res.status(200).json({ ok: true, messageId: lastMessageId, pushMessageId })
    return
  }

  const card = buildFleetRichMessageCard({
    content,
    imageKeys,
    mentions: mentionOpenIds.map((openId) => ({ name: '', openId })),
  })

  const sendRes = await sendFeishuAppMessage(tenant, chatId, 'interactive', card)
  if (!sendRes.ok) {
    res.status(502).json({ ok: false, error: sendRes.error, feishu: sendRes.feishu })
    return
  }

  // 消息已经发到群里了：记录 message_id 失败不该让这次推送在前端显示为失败（会被 withRetry 重试导致重复发送）
  let pushMessageId: string | undefined
  try {
    const record = await insertFeishuPushMessage({
      supplierConfigId,
      chatId,
      messageId: sendRes.messageId,
      msgType: 'interactive',
      pushLabel,
      createdBy: req.authUser?.id ?? null,
    })
    pushMessageId = record.id
  } catch (err) {
    console.error('[push-rich-message-app] 记录 message_id 失败（不影响本次推送，仅无法查已读）:', err)
  }

  res.status(200).json({ ok: true, messageId: sendRes.messageId, pushMessageId })
})

/** 某供应商最近的应用机器人推送记录（供「查看已读」入口列表） */
feishuWebhookTestRouter.get('/push-messages', async (req: AuthenticatedRequest, res: Response) => {
  const supplierConfigId = typeof req.query.supplierConfigId === 'string' ? req.query.supplierConfigId.trim() : ''
  if (!supplierConfigId) {
    res.status(400).json({ ok: false, error: '缺少 supplierConfigId' })
    return
  }
  try {
    const rows = await listFeishuPushMessagesBySupplier(supplierConfigId)
    res.json({ ok: true, data: rows })
  } catch {
    res.status(500).json({ ok: false, error: '读取推送记录失败' })
  }
})

/** 按 chatId 去重后并发拉取群成员，避免同一个群在批量接口里被重复查询多次 */
async function fetchChatMembersByChatIds(
  tenant: string,
  chatIds: string[],
): Promise<{ ok: true; membersByChatId: Map<string, Map<string, string>> } | { ok: false; error: string }> {
  const uniqueChatIds = [...new Set(chatIds)]
  const results = await Promise.all(uniqueChatIds.map((chatId) => listFeishuChatMembers(tenant, chatId)))
  const membersByChatId = new Map<string, Map<string, string>>()
  for (let i = 0; i < uniqueChatIds.length; i++) {
    const result = results[i]
    if (!result.ok) return { ok: false, error: result.error }
    membersByChatId.set(uniqueChatIds[i], new Map(result.members.map((m) => [m.userId, m.name])))
  }
  return { ok: true, membersByChatId }
}

/**
 * 「推送数据监控」批量已读详情：一次性查询多条消息的已读/未读名单。
 * 展开一个日期行时该日期下可能有几十条消息，前端不再逐条调用单条接口，改为一次批量请求；
 * 同一 chatId 的群成员查询在此去重，飞书 read_users 本身不支持批量仍需逐条并发调用。
 */
feishuWebhookTestRouter.get('/push-messages/read-status', async (req: AuthenticatedRequest, res: Response) => {
  const idsRaw = typeof req.query.ids === 'string' ? req.query.ids : ''
  const ids = idsRaw.split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) {
    res.json({ ok: true, data: {} })
    return
  }

  let records: Awaited<ReturnType<typeof getFeishuPushMessagesByIds>>
  try {
    records = await getFeishuPushMessagesByIds(ids)
  } catch {
    res.status(500).json({ ok: false, error: '读取推送记录失败' })
    return
  }
  if (records.length === 0) {
    res.json({ ok: true, data: {} })
    return
  }

  const tenantRes = await getFeishuTenantAccessToken()
  if (!tenantRes.ok) {
    if (tenantRes.reason === 'not_configured') {
      res.status(400).json({ ok: false, error: '服务器未配置飞书开放接口凭证（FEISHU_APP_ID / FEISHU_APP_SECRET）。' })
      return
    }
    res.status(502).json({ ok: false, error: tenantRes.error || '获取 tenant_access_token 失败' })
    return
  }
  const tenant = tenantRes.token

  const membersRes = await fetchChatMembersByChatIds(tenant, records.map((r) => r.chatId))
  if (!membersRes.ok) {
    res.status(502).json({ ok: false, error: membersRes.error })
    return
  }

  const readResults = await Promise.all(records.map((r) => getFeishuMessageReadUsers(tenant, r.messageId)))
  const data: Record<string, unknown> = {}
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    const readRes = readResults[i]
    if (!readRes.ok) {
      res.status(502).json({ ok: false, error: readRes.error })
      return
    }
    const memberMap = membersRes.membersByChatId.get(record.chatId) ?? new Map<string, string>()
    const readIdSet = new Set(readRes.readUsers.map((u) => u.userId))
    const readUsers = readRes.readUsers.map((u) => ({
      userId: u.userId,
      name: memberMap.get(u.userId) ?? '',
      readAtMs: u.readAtMs,
    }))
    const unreadUsers = [...memberMap.entries()]
      .filter(([userId]) => !readIdSet.has(userId))
      .map(([userId, name]) => ({ userId, name }))
    data[record.id] = {
      messageId: record.messageId,
      sentAt: record.createdAt,
      totalMembers: memberMap.size,
      readCount: readUsers.length,
      readUsers,
      unreadUsers,
    }
  }

  res.json({ ok: true, data })
})

/** 查询某条应用机器人消息的已读/未读名单：已读来自 read_users，未读 = 群成员 - 已读 */
feishuWebhookTestRouter.get('/push-messages/:id/read-status', async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id ?? '').trim()
  let record: Awaited<ReturnType<typeof getFeishuPushMessageById>>
  try {
    record = await getFeishuPushMessageById(id)
  } catch {
    res.status(500).json({ ok: false, error: '读取推送记录失败' })
    return
  }
  if (!record) {
    res.status(404).json({ ok: false, error: '推送记录不存在' })
    return
  }

  const tenantRes = await getFeishuTenantAccessToken()
  if (!tenantRes.ok) {
    if (tenantRes.reason === 'not_configured') {
      res.status(400).json({ ok: false, error: '服务器未配置飞书开放接口凭证（FEISHU_APP_ID / FEISHU_APP_SECRET）。' })
      return
    }
    res.status(502).json({ ok: false, error: tenantRes.error || '获取 tenant_access_token 失败' })
    return
  }
  const tenant = tenantRes.token

  const [readRes, membersRes] = await Promise.all([
    getFeishuMessageReadUsers(tenant, record.messageId),
    listFeishuChatMembers(tenant, record.chatId),
  ])
  if (!readRes.ok) {
    res.status(502).json({ ok: false, error: readRes.error })
    return
  }
  if (!membersRes.ok) {
    res.status(502).json({ ok: false, error: membersRes.error })
    return
  }

  const readIdSet = new Set(readRes.readUsers.map((u) => u.userId))
  const memberMap = new Map(membersRes.members.map((m) => [m.userId, m.name]))

  const readUsers = readRes.readUsers.map((u) => ({
    userId: u.userId,
    name: memberMap.get(u.userId) ?? '',
    readAtMs: u.readAtMs,
  }))
  const unreadUsers = membersRes.members
    .filter((m) => !readIdSet.has(m.userId))
    .map((m) => ({ userId: m.userId, name: m.name }))

  res.json({
    ok: true,
    data: {
      messageId: record.messageId,
      sentAt: record.createdAt,
      totalMembers: membersRes.members.length,
      readCount: readUsers.length,
      readUsers,
      unreadUsers,
    },
  })
})

const READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 「推送数据监控」列表：出仓/24H派签/催派/工单 4 类定时推送的已发送记录，按日期/推送类型/供应商/州筛选。
 * 已读数不在这里带（避免对着一屏幕的行逐条实时调用飞书 API），只标注是否已超过飞书 7 天可查窗口；
 * 点击数是我方数据库聚合，随列表一次性返回。
 */
feishuWebhookTestRouter.get('/push-engagement', async (req: AuthenticatedRequest, res: Response) => {
  const startDateRaw = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : ''
  const endDateRaw = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : ''
  const pushLabel = typeof req.query.pushLabel === 'string' ? req.query.pushLabel.trim() : ''
  const supplierConfigId = typeof req.query.supplierConfigId === 'string' ? req.query.supplierConfigId.trim() : ''
  const regionFilter = typeof req.query.regionCode === 'string' ? req.query.regionCode.trim() : ''

  // 同州 + 历史遗留 global 两类可见，与「供应商配置」列表接口（fleetSupplierPushRouter）口径一致
  const userRegionCode = req.authUser?.regionCode?.trim() || LEGACY_GLOBAL_SUPPLIER_REGION_CODE
  let configs = await listSupplierPushConfigs(userRegionCode)
  if (supplierConfigId) configs = configs.filter((c) => c.id === supplierConfigId)
  if (regionFilter) configs = configs.filter((c) => c.regionCode === regionFilter)
  if (configs.length === 0) {
    res.json({ ok: true, data: [] })
    return
  }
  const configById = new Map(configs.map((c) => [c.id, c]))

  const conditions = [inArray(schema.feishuPushMessages.supplierConfigId, [...configById.keys()])]
  if (pushLabel) conditions.push(eq(schema.feishuPushMessages.pushLabel, pushLabel))
  const startDate = startDateRaw ? new Date(`${startDateRaw}T00:00:00`) : null
  const endDate = endDateRaw ? new Date(`${endDateRaw}T23:59:59.999`) : null
  if (startDate && !Number.isNaN(startDate.getTime())) conditions.push(gte(schema.feishuPushMessages.createdAt, startDate))
  if (endDate && !Number.isNaN(endDate.getTime())) conditions.push(lte(schema.feishuPushMessages.createdAt, endDate))

  const db = getDb()
  const messages = await db
    .select()
    .from(schema.feishuPushMessages)
    .where(and(...conditions))
    .orderBy(desc(schema.feishuPushMessages.createdAt))
    .limit(500)

  const messageIds = messages.map((m) => m.messageId)
  const clickRows = messageIds.length
    ? await db
        .select({
          messageId: schema.feishuCardClickEvents.messageId,
          actionType: schema.feishuCardClickEvents.actionType,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.feishuCardClickEvents)
        .where(inArray(schema.feishuCardClickEvents.messageId, messageIds))
        .groupBy(schema.feishuCardClickEvents.messageId, schema.feishuCardClickEvents.actionType)
    : []
  const clicksByMessageId = new Map<string, Record<string, number>>()
  for (const row of clickRows) {
    const bucket = clicksByMessageId.get(row.messageId) ?? {}
    bucket[row.actionType] = row.count
    clicksByMessageId.set(row.messageId, bucket)
  }

  const now = Date.now()
  const data = messages.map((m) => {
    const config = m.supplierConfigId ? configById.get(m.supplierConfigId) : undefined
    return {
      id: m.id,
      messageId: m.messageId,
      supplierConfigId: m.supplierConfigId,
      vendorName: config ? supplierDisplayName(config) : '',
      regionCode: config?.regionCode ?? '',
      pushLabel: m.pushLabel,
      createdAt: m.createdAt,
      readWindowExpired: now - new Date(m.createdAt).getTime() > READ_WINDOW_MS,
      clicks: clicksByMessageId.get(m.messageId) ?? {},
    }
  })

  res.json({ ok: true, data })
})

/**
 * 「推送数据监控」批量点击详情：一次性查询多条消息的点击记录。
 * click-events 完全是我方数据库数据，直接用 inArray 一次查完；群成员查询同样按 chatId 去重。
 */
feishuWebhookTestRouter.get('/push-messages/click-events', async (req: AuthenticatedRequest, res: Response) => {
  const idsRaw = typeof req.query.ids === 'string' ? req.query.ids : ''
  const ids = idsRaw.split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) {
    res.json({ ok: true, data: {} })
    return
  }

  let records: Awaited<ReturnType<typeof getFeishuPushMessagesByIds>>
  try {
    records = await getFeishuPushMessagesByIds(ids)
  } catch {
    res.status(500).json({ ok: false, error: '读取推送记录失败' })
    return
  }
  if (records.length === 0) {
    res.json({ ok: true, data: {} })
    return
  }

  let events: Awaited<ReturnType<typeof listFeishuCardClickEventsByMessageIds>>
  try {
    events = await listFeishuCardClickEventsByMessageIds(records.map((r) => r.messageId))
  } catch {
    res.status(500).json({ ok: false, error: '读取点击记录失败' })
    return
  }

  // 点击事件本身不受 7 天限制（我方落库），姓名映射尽力而为：拿不到 tenant token / 群成员时退化成只显示 openId
  const nameByOpenId = new Map<string, string>()
  const tenantRes = await getFeishuTenantAccessToken()
  if (tenantRes.ok) {
    const membersRes = await fetchChatMembersByChatIds(tenantRes.token, records.map((r) => r.chatId))
    if (membersRes.ok) {
      for (const memberMap of membersRes.membersByChatId.values()) {
        for (const [userId, name] of memberMap) nameByOpenId.set(userId, name)
      }
    }
  }

  const eventsByMessageId = new Map<string, typeof events>()
  for (const e of events) {
    const bucket = eventsByMessageId.get(e.messageId) ?? []
    bucket.push(e)
    eventsByMessageId.set(e.messageId, bucket)
  }

  const data: Record<string, unknown> = {}
  for (const record of records) {
    const recordEvents = eventsByMessageId.get(record.messageId) ?? []
    data[record.id] = recordEvents.map((e) => ({
      openId: e.openId,
      name: nameByOpenId.get(e.openId) ?? '',
      actionType: e.actionType,
      clickedAt: e.clickedAt,
    }))
  }

  res.json({ ok: true, data })
})

/** 「推送数据监控」点击详情：某条推送记录里，谁点了哪个按钮、什么时间 */
feishuWebhookTestRouter.get('/push-messages/:id/click-events', async (req: AuthenticatedRequest, res: Response) => {
  const id = String(req.params.id ?? '').trim()
  let record: Awaited<ReturnType<typeof getFeishuPushMessageById>>
  try {
    record = await getFeishuPushMessageById(id)
  } catch {
    res.status(500).json({ ok: false, error: '读取推送记录失败' })
    return
  }
  if (!record) {
    res.status(404).json({ ok: false, error: '推送记录不存在' })
    return
  }

  let events: Awaited<ReturnType<typeof listFeishuCardClickEventsByMessageId>>
  try {
    events = await listFeishuCardClickEventsByMessageId(record.messageId)
  } catch {
    res.status(500).json({ ok: false, error: '读取点击记录失败' })
    return
  }
  if (events.length === 0) {
    res.json({ ok: true, data: [] })
    return
  }

  // 点击事件本身不受 7 天限制（我方落库），姓名映射尽力而为：拿不到 tenant token / 群成员时退化成只显示 openId
  let nameByOpenId = new Map<string, string>()
  const tenantRes = await getFeishuTenantAccessToken()
  if (tenantRes.ok) {
    const membersRes = await listFeishuChatMembers(tenantRes.token, record.chatId)
    if (membersRes.ok) nameByOpenId = new Map(membersRes.members.map((m) => [m.userId, m.name]))
  }

  res.json({
    ok: true,
    data: events.map((e) => ({
      openId: e.openId,
      name: nameByOpenId.get(e.openId) ?? '',
      actionType: e.actionType,
      clickedAt: e.clickedAt,
    })),
  })
})
