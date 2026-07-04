import { htmlToLarkMd, larkMdToHtml } from './feishuLarkMdConvert'
import { feishuImageMarker } from './feishuLarkMdMarkers'

/** 判断存储值是否为 TipTap HTML（兼容旧版 lark_md 纯文本） */
export function isEditorHtml(value: string): boolean {
  const t = value.trim()
  if (!t.startsWith('<')) return false
  return /<(p|ul|ol|div|img|strong|em|a|span|u|blockquote|hr)\b/i.test(t)
}

export function editorContentFromStored(value: string): string {
  if (!value.trim()) return ''
  if (isEditorHtml(value)) return value
  return larkMdToHtml(value)
}

export function mergeEditorHtmlParts(parts: string[]): string {
  const htmlParts = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (isEditorHtml(p) ? p : larkMdToHtml(p)))
  if (!htmlParts.length) return ''
  return htmlParts.join('<p></p>')
}

/** 飞书卡片 img size 自定义像素上限（官方允许 [1,1000]px） */
const FEISHU_IMG_MAX_PX = 1000

/** 等比缩放进 [1,1000]px，避免独立钳制破坏宽高比 */
function fitFeishuImgSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, FEISHU_IMG_MAX_PX / width, FEISHU_IMG_MAX_PX / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function probeImageNaturalSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const probe = new Image()
    probe.onload = () => {
      if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        resolve({ width: probe.naturalWidth, height: probe.naturalHeight })
      } else {
        resolve(null)
      }
    }
    probe.onerror = () => resolve(null)
    probe.src = src
  })
}

/** 编辑器中调整过大小的图片带 width/height 属性；只有 width 时按自然比例补算高度 */
async function resolveEditorImageSize(
  img: HTMLImageElement,
  src: string,
): Promise<{ width: number; height: number } | undefined> {
  const attrW = Number.parseInt(img.getAttribute('width') ?? '', 10)
  const attrH = Number.parseInt(img.getAttribute('height') ?? '', 10)
  if (attrW > 0 && attrH > 0) {
    return fitFeishuImgSize(attrW, attrH)
  }
  if (attrW > 0) {
    const natural = await probeImageNaturalSize(src)
    if (natural) {
      return fitFeishuImgSize(attrW, (attrW * natural.height) / natural.width)
    }
  }
  return undefined
}

export async function prepareFleetRichPayload(
  editorHtml: string,
  extraImageDataUrls: string[],
): Promise<{ content: string; images: string[] }> {
  const trimmed = editorHtml.trim()
  const inlineImages: string[] = []

  let textHtml = ''
  if (trimmed) {
    const doc = new DOMParser().parseFromString(
      trimmed.startsWith('<') ? trimmed : `<div>${larkMdToHtml(trimmed)}</div>`,
      'text/html',
    )
    const root = doc.body
    for (const img of Array.from(root.querySelectorAll('img'))) {
      const src = img.getAttribute('src')?.trim() ?? ''
      if (src.startsWith('data:')) {
        // 原位置写入占位标记（含展示尺寸），后端按标记把图片插回同一位置，保持编辑顺序与大小
        const size = await resolveEditorImageSize(img, src)
        const marker = doc.createElement('p')
        marker.textContent = feishuImageMarker(inlineImages.length, size)
        inlineImages.push(src)
        img.replaceWith(marker)
      } else {
        img.remove()
      }
    }
    textHtml = root.innerHTML
  }

  const content = textHtml ? htmlToLarkMd(textHtml).trim() : ''
  const images = [...inlineImages, ...extraImageDataUrls.filter((u) => u.trim().startsWith('data:'))]
  return { content, images }
}

export function hasEditorContent(value: string): boolean {
  const t = value.trim()
  if (!t) return false
  if (isEditorHtml(t)) {
    if (/<img\b/i.test(t)) return true
    const text = (new DOMParser().parseFromString(t, 'text/html').body.textContent ?? '').replace(/\u00a0/g, ' ').trim()
    return text.length > 0
  }
  return t.length > 0
}

/** 表格预览：兼容 HTML 与 lark_md */
export function stripEditorContentForPreview(text: string, maxLen = 80): string {
  const t = text.trim()
  if (!t) return ''
  if (isEditorHtml(t)) {
    const doc = new DOMParser().parseFromString(t, 'text/html')
    doc.querySelectorAll('img').forEach((img) => {
      img.replaceWith(doc.createTextNode('🖼'))
    })
    const plain = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (plain.length <= maxLen) return plain
    return `${plain.slice(0, maxLen - 1)}…`
  }
  const plain = t
    .replace(/<font[^>]*>([\s\S]*?)<\/font>/gi, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/~(.+?)~/g, '$1')
    .replace(/<u>([\s\S]*?)<\/u>/gi, '$1')
    .replace(/<at id=all><\/at>/gi, '@所有人')
    .replace(/\[(.+?)\]\([^)]+\)/g, '$1')
    .replace(/^-\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= maxLen) return plain
  return `${plain.slice(0, maxLen - 1)}…`
}
