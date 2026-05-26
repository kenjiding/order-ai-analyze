import crypto from 'node:crypto'

/** 飞书 IM 上传图片（取得 image_key，用于 webhook 图片消息）。需 `Authorization: Bearer <tenant_access_token>`，multipart 字段 `image_type=message`、`image` 文件。 */
export const FEISHU_UPLOAD_IMAGES_URL = 'https://open.feishu.cn/open-apis/im/v1/images'

const FEISHU_WEBHOOK_HOST = 'open.feishu.cn'
const FEISHU_BOT_HOOK_PREFIX = '/open-apis/bot/v2/hook/'

/**
 * 自定义机器人 webhook 签名校验：将 `timestamp\n秘钥` 作为 HMAC-SHA256 的 key，对空内容签名后 Base64。
 * @see https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 */
export function computeFeishuWebhookSign(secret: string, timestampSec: number): string {
  const key = `${timestampSec}\n${secret}`
  return crypto.createHmac('sha256', key).digest('base64')
}

/** 仅允许飞书开放平台官方自定义机器人 webhook，防止 SSRF */
export function parseSafeWebhookUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new TypeError('webhookUrl')
  }
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new TypeError('webhookUrl')
  }
  if (u.protocol !== 'https:') throw new TypeError('webhookUrl')
  if (u.hostname !== FEISHU_WEBHOOK_HOST) throw new TypeError('webhookUrl')
  if (!u.pathname.startsWith(FEISHU_BOT_HOOK_PREFIX)) throw new TypeError('webhookUrl')
  return u
}

/** 从 `data:image/...;base64,...` 或纯 base64 拆出载荷；若为 data URL 则返回其中的 MIME（不含 `;base64`）。 */
export function splitDataUrlBase64(raw: string): { base64: string; mimeFromDataUrl?: string } {
  const trimmed = raw.trim()
  const comma = trimmed.indexOf(',')
  if (trimmed.startsWith('data:') && comma > 0) {
    const meta = trimmed.slice(5, comma).trim()
    const semi = meta.indexOf(';')
    const mimePart = semi >= 0 ? meta.slice(0, semi).trim() : meta.trim()
    const base64 = trimmed.slice(comma + 1).trim()
    return {
      base64,
      mimeFromDataUrl: mimePart.includes('/') ? mimePart : undefined,
    }
  }
  return { base64: trimmed }
}

function normalizeFeishuImageMime(m: string): string | undefined {
  const lower = m.trim().toLowerCase()
  if (lower === 'image/jpg' || lower === 'image/jpeg') return 'image/jpeg'
  const allowed = new Set([
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'image/tiff',
    'image/heic',
    'image/heif',
  ])
  if (allowed.has(lower)) return lower
  return undefined
}

function extensionForImageMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/bmp':
      return 'bmp'
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return 'ico'
    case 'image/tiff':
      return 'tiff'
    case 'image/heic':
    case 'image/heif':
      return 'heic'
    default:
      return 'bin'
  }
}

/**
 * 供 `im/v1/images` multipart 的 `image` 部分：优先 data URL 的 MIME，否则按魔数推断，减少 234011「无法识别格式」。
 */
export function inferFeishuImagePartMeta(buf: Buffer, mimeHint?: string | undefined): { contentType: string; filename: string } {
  const fromHint = mimeHint ? normalizeFeishuImageMime(mimeHint) : undefined
  if (fromHint) {
    return {
      contentType: fromHint,
      filename: `feishu-push.${extensionForImageMime(fromHint)}`,
    }
  }

  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { contentType: 'image/jpeg', filename: 'feishu-push.jpg' }
  }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { contentType: 'image/png', filename: 'feishu-push.png' }
  }
  if (
    buf.length >= 6 &&
    (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')
  ) {
    return { contentType: 'image/gif', filename: 'feishu-push.gif' }
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { contentType: 'image/webp', filename: 'feishu-push.webp' }
  }
  if (buf.length >= 2 && buf.toString('ascii', 0, 2) === 'BM') {
    return { contentType: 'image/bmp', filename: 'feishu-push.bmp' }
  }
  if (
    buf.length >= 4 &&
    buf.readUInt16LE(0) === 0 &&
    (buf.readUInt16LE(2) === 1 || buf.readUInt16LE(2) === 2)
  ) {
    return { contentType: 'image/x-icon', filename: 'feishu-push.ico' }
  }
  if (buf.length >= 4) {
    const le = buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00
    const be = buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a
    if (le || be) {
      return { contentType: 'image/tiff', filename: 'feishu-push.tiff' }
    }
  }
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12)
    if (/heic|heix|hevc|heim|heis|hevm|hevs|mif1|msf1/i.test(brand)) {
      return { contentType: 'image/heic', filename: 'feishu-push.heic' }
    }
  }

  return { contentType: 'application/octet-stream', filename: 'feishu-push.bin' }
}
