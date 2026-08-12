import { splitFeishuWebhookTextChunks } from '../sortEfficiencyFeishuAnalysis'
import { FEISHU_BLOCK_MARKER, FEISHU_BODY_MARKER_RE, FEISHU_HR_MARKER } from './feishuLarkMdMarkers'
import { buildMentionLarkMd, type SupplierMentionContact } from './feishuMentionHelpers'

/** 编辑器里一个空行在卡片上对应的高度（markdown 组件正文行高，normal 字号约 22px） */
const FEISHU_BLANK_LINE_PX = 22

/** margin 官方允许 [-99,99]px，连续空行最多留 4 行的间距 */
const FEISHU_MAX_BLANK_LINES = 4

/** 一张卡片最多 200 个元素（官方限制），超了飞书直接拒收整条消息 */
const FEISHU_CARD_MAX_ELEMENTS = 200

/** 块内含图片 / 外链按钮 / 分割线占位标记（非全局，可安全 test） */
const FEISHU_ANY_MARKER_RE = /\[\[FEISHU_(?:IMG|LINK|HR)/

/**
 * 行首块级 markdown 语法（列表 / 引用 / 标题 / 表格 / 代码围栏 / 缩进代码）。
 * 这类块必须独占一个 markdown 元素：一旦和别的块拼进同一个元素，块之间的空行就会被
 * CommonMark 当成「结束这个块」的语法分隔符吃掉——编辑器里敲的空行到飞书就消失了。
 */
const BLOCK_MD_LINE_RE =
  /^(?:\s{4,}\S|\s{0,3}(?:[-*+](?=\s)|\d{1,9}[.)](?=\s)|>|#{1,6}(?=\s|$)|\||```|~~~|(?:[-*_][ \t]*){3,}$))/

function isPlainTextBlock(block: string): boolean {
  return block.split('\n').every((line) => !BLOCK_MD_LINE_RE.test(line))
}

/** 飞书卡片 button.type 合法值 */
const FEISHU_BUTTON_TYPES = new Set([
  'default',
  'primary',
  'danger',
  'text',
  'primary_text',
  'danger_text',
  'primary_filled',
  'danger_filled',
  'laser',
])

function normalizeFeishuButtonType(raw?: string): string {
  const t = raw?.trim()
  return t && FEISHU_BUTTON_TYPES.has(t) ? t : 'primary_filled'
}

function fleetImageElement(imageKey: string, size?: string): Record<string, unknown> {
  const element: Record<string, unknown> = {
    tag: 'img',
    img_key: imageKey,
    alt: { tag: 'plain_text', content: '' },
    preview: true,
  }
  if (size) {
    // 官方规定 size 仅在 scale_type 为 crop_center/crop_top 时生效，
    // 配 fit_horizontal 会被校验拒绝（img size is not allowed）。
    // size 按编辑器宽高比生成，crop_center 实际不裁剪。
    element.scale_type = 'crop_center'
    element.size = size
  } else {
    element.scale_type = 'fit_horizontal'
  }
  return element
}

/** 飞书卡片 img size 自定义像素允许 [1,1000]px，越界则放弃定制尺寸 */
function feishuImgSize(width: number, height: number): string | undefined {
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 1000
  return valid(width) && valid(height) ? `${width}px ${height}px` : undefined
}

/** 自定义机器人卡片：markdown [text](url) 不可跳转，需用 open_url 按钮（见项目 飞书群推送.md） */
function fleetOpenUrlButton(url: string, text: string, buttonType?: string): Record<string, unknown> {
  const href = url.trim()
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: text.trim() || href },
    type: normalizeFeishuButtonType(buttonType),
    width: 'default',
    size: 'medium',
    behaviors: [{
      type: 'open_url',
      default_url: href,
      pc_url: href,
      ios_url: href,
      android_url: href,
    }],
  }
}

function parseBodyMarker(raw: string): { kind: 'img'; index: number; w?: number; h?: number } | { kind: 'link'; url: string; text: string; buttonType?: string } | null {
  const img = raw.match(/^IMG:(\d+)(?:\|(\d+)x(\d+))?$/)
  if (img) {
    return {
      kind: 'img',
      index: Number(img[1]),
      w: img[2] ? Number(img[2]) : undefined,
      h: img[3] ? Number(img[3]) : undefined,
    }
  }
  const link = raw.match(/^LINK:([^|]+)\|([^|]+)(?:\|([^|\]]+))?$/)
  if (link) {
    return {
      kind: 'link',
      url: link[1] ?? '',
      text: link[2] ?? '',
      buttonType: link[3],
    }
  }
  return null
}

/**
 * 富文本 + 多图 → 单条飞书交互式卡片（schema 2.0）。
 *
 * 正文使用官方 markdown 组件（tag: 'markdown'）：lark_md 不支持有序/无序列表，
 * markdown 组件原生支持列表、**加粗**、<font> 颜色、<at id=all> 等完整语法。
 * 正文中的 [[FEISHU_IMG:n]] / [[FEISHU_LINK:url|文案|样式]] 占位标记按顺序替换为图片或 open_url 按钮；
 * 未被标记引用的图片追加在末尾（兼容旧内容）。
 *
 * 排版按「编辑器一个块 → 卡片一个元素」组装，块间距用元素 margin 表达，不用字符换行：
 * 飞书 markdown 组件按 CommonMark 解析块级结构，空行在列表 / 引用后面只是语法分隔符会被吃掉，
 * 只有段落内部的单个 \n 才稳定等价于 <br>。每个元素里只放一个块，块边界就不再经过解析器，
 * 编辑器所见即飞书所得。连续的纯文本块允许合并进一个元素（渲染等价，纯为压元素数）。
 */
export function buildFleetRichMessageCard(params: {
  content?: string
  imageKeys: string[]
  /** 命中「@ 相关人员」时传入，供应商配置花名册里选中的全部联系人 */
  mentions?: SupplierMentionContact[] | null
}): Record<string, unknown> {
  const elements: Record<string, unknown>[] = []
  const usedImageIndexes = new Set<number>()
  const raw = params.content?.trim() ?? ''

  // 编辑器里的空段落不发成空元素，而是攒起来写进下一个元素的上外边距
  let pendingBlankLines = 0

  const emit = (element: Record<string, unknown>) => {
    const top = Math.min(pendingBlankLines, FEISHU_MAX_BLANK_LINES) * FEISHU_BLANK_LINE_PX
    pendingBlankLines = 0
    if (top > 0) element.margin = `${top}px 0px 0px 0px`
    elements.push(element)
  }

  const pushMarkdown = (text: string) => {
    const t = text.trim()
    if (!t) return
    for (const chunk of splitFeishuWebhookTextChunks(t)) {
      emit({ tag: 'markdown', content: chunk })
    }
  }

  const pushImageAt = (index: number, size?: string) => {
    const key = params.imageKeys[index]?.trim()
    if (!key) return
    emit(fleetImageElement(key, size))
    usedImageIndexes.add(index)
  }

  // 块内按占位标记拆分，文字 / 图片 / 外链按钮按原始顺序交错成卡片元素
  const consumeMarkers = (segment: string) => {
    let cursor = 0
    for (const match of segment.matchAll(FEISHU_BODY_MARKER_RE)) {
      pushMarkdown(segment.slice(cursor, match.index))
      const parsed = parseBodyMarker(match[1] ?? '')
      if (parsed?.kind === 'img') {
        const size = parsed.w != null && parsed.h != null ? feishuImgSize(parsed.w, parsed.h) : undefined
        pushImageAt(parsed.index, size)
      } else if (parsed?.kind === 'link' && parsed.url.startsWith('http')) {
        emit(fleetOpenUrlButton(parsed.url, parsed.text, parsed.buttonType))
      }
      cursor = match.index! + match[0].length
    }
    pushMarkdown(segment.slice(cursor))
  }

  if (raw) {
    let plainBuffer: string[] = []
    const flushPlain = () => {
      if (!plainBuffer.length) return
      const text = plainBuffer.join('\n')
      plainBuffer = []
      pushMarkdown(text)
    }

    for (const block of raw.split(FEISHU_BLOCK_MARKER)) {
      if (!block.trim()) {
        flushPlain()
        pendingBlankLines += 1
        continue
      }
      // 纯文本块之间用 \n 拼在同一个元素里（段内换行 = <br>），块级语法必须自己一个元素
      if (!FEISHU_ANY_MARKER_RE.test(block) && isPlainTextBlock(block)) {
        plainBuffer.push(block.trim())
        continue
      }
      flushPlain()
      const hrPieces = block.split(FEISHU_HR_MARKER)
      hrPieces.forEach((piece, index) => {
        consumeMarkers(piece)
        if (index < hrPieces.length - 1) emit({ tag: 'hr' })
      })
    }
    flushPlain()
  }

  params.imageKeys.forEach((key, index) => {
    if (!usedImageIndexes.has(index) && key.trim()) {
      elements.push(fleetImageElement(key.trim()))
    }
  })

  const mentionLarkMd = buildMentionLarkMd(params.mentions)
  if (mentionLarkMd) {
    elements.push({ tag: 'markdown', content: mentionLarkMd })
  }

  // 超上限飞书会拒收整条消息（前端会看到 code!=0 的失败），这里先把原因打出来，别让人只看到一句"发送失败"
  if (elements.length > FEISHU_CARD_MAX_ELEMENTS) {
    console.warn(
      `[fleet-rich-card] 卡片元素 ${elements.length} 个，超过飞书上限 ${FEISHU_CARD_MAX_ELEMENTS}，本次推送会被飞书拒收，请拆分推送内容`,
    )
  }

  return {
    schema: '2.0',
    body: {
      direction: 'vertical',
      elements,
    },
  }
}
