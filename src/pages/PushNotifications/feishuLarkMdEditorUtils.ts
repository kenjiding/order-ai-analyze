/** 飞书 lark_md 单段建议上限（与 text 推送分段一致） */
export const FEISHU_LARK_MD_CHUNK = 3600

export function splitFeishuLarkMdChunks(text: string, maxLen = FEISHU_LARK_MD_CHUNK): string[] {
  const t = text.trim()
  if (!t) return []
  if (t.length <= maxLen) return [t]

  const lines = t.split(/\r?\n/)
  const out: string[] = []
  let buf = ''

  const flush = () => {
    const s = buf.trim()
    if (s) out.push(s)
    buf = ''
  }

  for (const line of lines) {
    const candidate = buf.length ? `${buf}\n${line}` : line
    if (candidate.length > maxLen && buf.length) {
      flush()
      if (line.length > maxLen) {
        for (let i = 0; i < line.length; i += maxLen) {
          out.push(line.slice(i, i + maxLen))
        }
      } else {
        buf = line
      }
      continue
    }
    if (candidate.length > maxLen && !buf.length) {
      for (let i = 0; i < line.length; i += maxLen) {
        out.push(line.slice(i, i + maxLen))
      }
      continue
    }
    buf = candidate
  }
  flush()
  return out
}

/** 表格预览：去掉常见 lark_md 标记 */
export function stripLarkMdForPreview(text: string, maxLen = 80): string {
  const plain = text
    .replace(/<font[^>]*>([\s\S]*?)<\/font>/gi, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~(.+?)~/g, '$1')
    .replace(/\[(.+?)\]\([^)]+\)/g, '$1')
    .replace(/^-\s+/gm, '• ')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= maxLen) return plain
  return `${plain.slice(0, maxLen - 1)}…`
}
