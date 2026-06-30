import { htmlToLarkMd, larkMdToHtml } from './feishuLarkMdConvert'

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

export function prepareFleetRichPayload(
  editorHtml: string,
  extraImageDataUrls: string[],
): { content: string; images: string[] } {
  const trimmed = editorHtml.trim()
  const inlineImages: string[] = []

  let textHtml = ''
  if (trimmed) {
    const doc = new DOMParser().parseFromString(
      trimmed.startsWith('<') ? trimmed : `<div>${larkMdToHtml(trimmed)}</div>`,
      'text/html',
    )
    const root = doc.body
    root.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src')?.trim() ?? ''
      if (src.startsWith('data:')) inlineImages.push(src)
      img.remove()
    })
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
