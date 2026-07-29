import { FEISHU_AT_ALL_LARK, FEISHU_HR_MARKER } from './feishuLarkMdMarkers'

const FEISHU_NAMED_COLORS = new Set(['red', 'orange', 'green', 'blue', 'grey', 'gray'])
const INLINE_MARK_TAGS = new Set(['STRONG', 'B', 'EM', 'I', 'S', 'DEL', 'STRIKE'])

function isWhitespaceOnlyText(text: string): boolean {
  return text.replace(/\u00a0/g, ' ').trim().length === 0
}

/** 合并相邻同类行内标记、去掉仅空白的加粗/斜体等，避免推送后出现 ** ** 等无效语法 */
function normalizeEditorHtmlForLarkMd(html: string): string {
  if (!html.trim()) return html
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const wrapper = doc.body.firstElementChild
  if (!wrapper) return html

  const normalizeParent = (parent: Element) => {
    let index = 0
    while (index < parent.childNodes.length) {
      const node = parent.childNodes[index]
      if (node.nodeType !== Node.ELEMENT_NODE) {
        index += 1
        continue
      }

      const el = node as HTMLElement
      const tag = el.tagName

      if (INLINE_MARK_TAGS.has(tag)) {
        let nextIndex = index + 1
        while (nextIndex < parent.childNodes.length) {
          const between = parent.childNodes[nextIndex]
          if (between.nodeType === Node.TEXT_NODE && isWhitespaceOnlyText(between.textContent ?? '')) {
            el.appendChild(between.cloneNode(true))
            parent.removeChild(between)
            continue
          }
          if (between.nodeType === Node.ELEMENT_NODE && (between as Element).tagName === tag) {
            const nextEl = between as HTMLElement
            while (nextEl.firstChild) el.appendChild(nextEl.firstChild)
            parent.removeChild(nextEl)
            continue
          }
          break
        }

        const text = (el.textContent ?? '').replace(/\u00a0/g, ' ')
        if (!text.trim()) {
          el.replaceWith(doc.createTextNode(text))
          continue
        }

        normalizeParent(el)
        index += 1
        continue
      }

      if (tag === 'SPAN') {
        const fw = el.style.fontWeight
        if (fw && /^(bold(er)?|[5-9]\d{2,})$/.test(fw) && el.childNodes.length > 0) {
          const strong = doc.createElement('strong')
          while (el.firstChild) strong.appendChild(el.firstChild)
          el.replaceWith(strong)
          normalizeParent(parent)
          continue
        }
      }

      normalizeParent(el)
      index += 1
    }
  }

  normalizeParent(wrapper)
  return wrapper.innerHTML
}

/** 首尾空白外提：`**text **` 飞书不识别会露出 **，需转成 `**text** ` */
function splitEdgeWhitespace(inner: string): { lead: string; core: string; trail: string } {
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/)
  return { lead: m?.[1] ?? '', core: m?.[2] ?? inner, trail: m?.[3] ?? '' }
}

function formatBoldLarkMd(inner: string): string {
  if (!inner || !inner.trim()) return inner
  const { lead, core, trail } = splitEdgeWhitespace(inner)
  // 内容自带星号时用 __（飞书 markdown 组件两者均支持），避免 ** 被误闭合
  const delim = core.includes('*') ? '__' : '**'
  return `${lead}${delim}${core}${delim}${trail}`
}

function formatItalicLarkMd(inner: string): string {
  if (!inner || !inner.trim()) return inner
  const { lead, core, trail } = splitEdgeWhitespace(inner)
  return `${lead}*${core}*${trail}`
}

function formatStrikeLarkMd(inner: string): string {
  if (!inner || !inner.trim()) return inner
  const { lead, core, trail } = splitEdgeWhitespace(inner)
  return `${lead}~~${core}~~${trail}`
}

function cleanupLarkMd(md: string): string {
  return md
    .replace(/\*\*\s*\*\*/g, '')
    .replace(/__\s*__/g, '')
    .replace(/~~~~\s*~~~~/g, '')
    .replace(/([^\n])\*\*\*\*([^\n])/g, '$1$2')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function cssColorToFeishuName(color: string): string {
  const c = color.trim().toLowerCase().replace(/\s/g, '')
  if (FEISHU_NAMED_COLORS.has(c)) return c === 'gray' ? 'grey' : c
  const rgbMap: Record<string, string> = {
    'rgb(255,0,0)': 'red',
    'rgb(255,165,0)': 'orange',
    'rgb(255,153,0)': 'orange',
    'rgb(0,128,0)': 'green',
    'rgb(21,128,61)': 'green',
    'rgb(0,0,255)': 'blue',
    'rgb(37,99,235)': 'blue',
    'rgb(128,128,128)': 'grey',
    'rgb(156,163,175)': 'grey',
    '#808080': 'grey',
    '#9ca3af': 'grey',
    '#ff0000': 'red',
    '#f00': 'red',
    '#ffa500': 'orange',
    '#008000': 'green',
    '#15803d': 'green',
    '#0000ff': 'blue',
    '#2563eb': 'blue',
  }
  return rgbMap[c] ?? c
}

/** lark_md → 编辑器 HTML（仅用于 contentEditable 展示） */
export function larkMdToHtml(larkMd: string): string {
  if (!larkMd.trim()) return ''

  const hrParts = larkMd.split(FEISHU_HR_MARKER)
  const htmlParts = hrParts.map((part) => larkMdSegmentToHtml(part))
  return htmlParts.join('<hr>')
}

function larkMdSegmentToHtml(segment: string): string {
  const lines = segment.split(/\r?\n/)
  const blocks: string[] = []
  let ulItems: string[] = []
  let olItems: string[] = []
  let quoteLines: string[] = []

  const flushUl = () => {
    if (!ulItems.length) return
    blocks.push(`<ul>${ulItems.map((li) => `<li>${parseInlineLarkMd(li)}</li>`).join('')}</ul>`)
    ulItems = []
  }
  const flushOl = () => {
    if (!olItems.length) return
    blocks.push(`<ol>${olItems.map((li) => `<li>${parseInlineLarkMd(li)}</li>`).join('')}</ol>`)
    olItems = []
  }
  const flushQuote = () => {
    if (!quoteLines.length) return
    blocks.push(`<blockquote><p>${quoteLines.map((l) => parseInlineLarkMd(l)).join('<br>')}</p></blockquote>`)
    quoteLines = []
  }

  for (const line of lines) {
    if (line.includes(FEISHU_AT_ALL_LARK)) {
      flushUl()
      flushOl()
      flushQuote()
      const rest = line.replace(FEISHU_AT_ALL_LARK, '').trim()
      blocks.push(`<p><span class="feishu-at-all">@所有人</span>${rest ? parseInlineLarkMd(rest) : ''}</p>`)
      continue
    }

    const quoteMatch = line.match(/^>\s?(.*)$/)
    if (quoteMatch) {
      flushUl()
      flushOl()
      quoteLines.push(quoteMatch[1] ?? '')
      continue
    }
    flushQuote()

    const ulMatch = line.match(/^-\s+(.*)$/)
    if (ulMatch) {
      flushOl()
      ulItems.push(ulMatch[1] ?? '')
      continue
    }
    flushUl()

    const olMatch = line.match(/^\d+\.\s+(.*)$/)
    if (olMatch) {
      flushUl()
      olItems.push(olMatch[1] ?? '')
      continue
    }
    flushOl()

    if (!line.trim()) {
      blocks.push('<p></p>')
    } else {
      blocks.push(`<p>${parseInlineLarkMd(line)}</p>`)
    }
  }
  flushUl()
  flushOl()
  flushQuote()
  return blocks.join('')
}

function parseInlineLarkMd(input: string): string {
  const parts: string[] = []
  let rest = input

  while (rest.length > 0) {
    if (rest.startsWith(FEISHU_AT_ALL_LARK)) {
      parts.push('<span class="feishu-at-all">@所有人</span>')
      rest = rest.slice(FEISHU_AT_ALL_LARK.length)
      continue
    }

    const uMatch = rest.match(/^<u>([\s\S]*?)<\/u>/i)
    if (uMatch) {
      parts.push(`<u>${parseInlineLarkMd(uMatch[1] ?? '')}</u>`)
      rest = rest.slice(uMatch[0].length)
      continue
    }

    const fontMatch = rest.match(/^<font\s+color=['"]([^'"]+)['"]>([\s\S]*?)<\/font>/i)
    if (fontMatch) {
      const color = cssColorToFeishuName(fontMatch[1] ?? '')
      parts.push(`<span style="color:${color}">${parseInlineLarkMd(fontMatch[2] ?? '')}</span>`)
      rest = rest.slice(fontMatch[0].length)
      continue
    }

    const linkMatch = rest.match(/^\[([^\]]*)\]\(([^)]*)\)/)
    if (linkMatch) {
      const label = parseInlineLarkMd(linkMatch[1] ?? '')
      const href = escapeHtml(linkMatch[2] ?? '')
      parts.push(`<a href="${href}">${label}</a>`)
      rest = rest.slice(linkMatch[0].length)
      continue
    }

    const boldMatch = rest.match(/^\*\*(.+?)\*\*/)
    if (boldMatch) {
      parts.push(`<strong>${parseInlineLarkMd(boldMatch[1] ?? '')}</strong>`)
      rest = rest.slice(boldMatch[0].length)
      continue
    }

    const boldUnderscoreMatch = rest.match(/^__(.+?)__/)
    if (boldUnderscoreMatch) {
      parts.push(`<strong>${parseInlineLarkMd(boldUnderscoreMatch[1] ?? '')}</strong>`)
      rest = rest.slice(boldUnderscoreMatch[0].length)
      continue
    }

    const strikeDoubleMatch = rest.match(/^~~([^~]+)~~/)
    if (strikeDoubleMatch) {
      parts.push(`<s>${parseInlineLarkMd(strikeDoubleMatch[1] ?? '')}</s>`)
      rest = rest.slice(strikeDoubleMatch[0].length)
      continue
    }
    const strikeMatch = rest.match(/^~([^~]+)~/)
    if (strikeMatch) {
      parts.push(`<s>${parseInlineLarkMd(strikeMatch[1] ?? '')}</s>`)
      rest = rest.slice(strikeMatch[0].length)
      continue
    }

    const italicMatch = rest.match(/^_([^_]+)_/)
    if (italicMatch) {
      parts.push(`<em>${parseInlineLarkMd(italicMatch[1] ?? '')}</em>`)
      rest = rest.slice(italicMatch[0].length)
      continue
    }

    const nextSpecial = rest.search(/[\[*_~<]/)
    if (nextSpecial === -1) {
      parts.push(escapeHtml(rest))
      break
    }
    if (nextSpecial === 0) {
      parts.push(escapeHtml(rest[0] ?? ''))
      rest = rest.slice(1)
      continue
    }
    parts.push(escapeHtml(rest.slice(0, nextSpecial)))
    rest = rest.slice(nextSpecial)
  }

  return parts.join('')
}

/** 行内元素若带颜色（SPAN style.color / FONT color 属性），返回飞书颜色名 */
function inlineElementColorName(el: HTMLElement): string {
  if (el.tagName === 'FONT') {
    const c = el.getAttribute('color')
    return c ? cssColorToFeishuName(c) : ''
  }
  if (el.tagName === 'SPAN' && el.style.color) {
    return cssColorToFeishuName(el.style.color)
  }
  return ''
}

function inlineNodesToLarkMd(parent: Node): string {
  let out = ''
  parent.childNodes.forEach((node) => {
    out += nodeToLarkMd(node)
  })
  return out
}

function blockElementToLarkMd(el: HTMLElement): string {
  const tag = el.tagName
  if (tag === 'HR') return FEISHU_HR_MARKER

  if (tag === 'BLOCKQUOTE') {
    const text = inlineNodesToLarkMd(el).replace(/\u00a0/g, ' ').trim()
    if (!text) return '> '
    return text
      .split(/\n/)
      .map((line) => (line.trim() ? `> ${line.trim()}` : '>'))
      .join('\n')
  }

  if (tag === 'UL') {
    return Array.from(el.querySelectorAll(':scope > li'))
      .map((li) => `- ${inlineNodesToLarkMd(li).trim()}`)
      .join('\n')
  }

  if (tag === 'OL') {
    return Array.from(el.querySelectorAll(':scope > li'))
      .map((li, index) => `${index + 1}. ${inlineNodesToLarkMd(li).trim()}`)
      .join('\n')
  }

  if (tag === 'P' || tag === 'DIV') {
    return inlineNodesToLarkMd(el).replace(/\u00a0/g, ' ').trimEnd()
  }

  return inlineNodesToLarkMd(el)
}

function nodeToLarkMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\u00a0/g, ' ')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const el = node as HTMLElement
  const tag = el.tagName
  const inner = inlineNodesToLarkMd(el)

  switch (tag) {
    case 'STRONG':
    case 'B': {
      // 飞书 markdown 要求颜色标签在外层（<font>**x**</font>）；
      // 编辑器可能产出 <strong><span style="color:..."> 的反向嵌套，这里交换
      const only = el.childNodes.length === 1 ? el.firstChild : null
      if (only && only.nodeType === Node.ELEMENT_NODE) {
        const colorName = inlineElementColorName(only as HTMLElement)
        if (colorName) {
          const bolded = formatBoldLarkMd(inlineNodesToLarkMd(only as HTMLElement))
          return `<font color='${colorName}'>${bolded}</font>`
        }
      }
      return formatBoldLarkMd(inner)
    }
    case 'EM':
    case 'I':
      return formatItalicLarkMd(inner)
    case 'U':
      return inner
    case 'S':
    case 'DEL':
    case 'STRIKE':
      return formatStrikeLarkMd(inner)
    case 'A': {
      const href = el.getAttribute('href') ?? ''
      return `[${inner || href}](${href})`
    }
    case 'FONT': {
      const color = cssColorToFeishuName(el.getAttribute('color') ?? 'red')
      return `<font color='${color}'>${inner}</font>`
    }
    case 'SPAN': {
      if (el.classList.contains('feishu-at-all')) return FEISHU_AT_ALL_LARK
      if (el.dataset.feishuAtAll === 'true') return FEISHU_AT_ALL_LARK
      const color = el.style.color
      if (color) {
        const named = cssColorToFeishuName(color)
        return `<font color='${named}'>${inner}</font>`
      }
      return inner
    }
    case 'BR':
      return '\n'
    case 'IMG':
      return ''
    default:
      return inner
  }
}

/** contentEditable / TipTap HTML → lark_md（推送存储格式） */
export function htmlToLarkMd(html: string): string {
  if (!html.trim()) return ''
  const normalized = normalizeEditorHtmlForLarkMd(html)
  const doc = new DOMParser().parseFromString(`<div>${normalized}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return ''

  const blocks: string[] = []
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      blocks.push((node.textContent ?? '').replace(/\u00a0/g, ' ').trim())
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    blocks.push(blockElementToLarkMd(node as HTMLElement))
  })

  // 首尾空段落不产生多余换行；中间的空段落对应编辑器里的一次空行，保留为一次真实换行。
  // 飞书 markdown 组件里单个 \n 就是一次真实换行（不遵循「空一行才分段」的标准 markdown 语义），
  // 因此这里按「一次 Enter = 一个 \n」拼接，而不是固定拼 \n\n，避免每敲一次回车飞书端多出空行。
  while (blocks.length && !blocks[0]) blocks.shift()
  while (blocks.length && !blocks[blocks.length - 1]) blocks.pop()

  return cleanupLarkMd(blocks.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd())
}
