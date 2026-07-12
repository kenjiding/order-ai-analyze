import { splitFeishuWebhookTextChunks } from '../sortEfficiencyFeishuAnalysis'
import { FEISHU_BODY_MARKER_RE, FEISHU_HR_MARKER } from './feishuLarkMdMarkers'

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
 */
export function buildFleetRichMessageCard(params: {
  content?: string
  imageKeys: string[]
}): Record<string, unknown> {
  const elements: Record<string, unknown>[] = []
  const usedImageIndexes = new Set<number>()
  const raw = params.content?.trim() ?? ''

  const pushMarkdown = (text: string) => {
    const t = text.trim()
    if (!t) return
    for (const chunk of splitFeishuWebhookTextChunks(t)) {
      elements.push({ tag: 'markdown', content: chunk })
    }
  }

  const pushImageAt = (index: number, size?: string) => {
    const key = params.imageKeys[index]?.trim()
    if (!key) return
    elements.push(fleetImageElement(key, size))
    usedImageIndexes.add(index)
  }

  if (raw) {
    const segments = raw.split(FEISHU_HR_MARKER)
    segments.forEach((segment, segIndex) => {
      // 按占位标记拆分，文字 / 图片 / 外链按钮按原始顺序交错成卡片元素
      let cursor = 0
      for (const match of segment.matchAll(FEISHU_BODY_MARKER_RE)) {
        pushMarkdown(segment.slice(cursor, match.index))
        const parsed = parseBodyMarker(match[1] ?? '')
        if (parsed?.kind === 'img') {
          const size = parsed.w != null && parsed.h != null ? feishuImgSize(parsed.w, parsed.h) : undefined
          pushImageAt(parsed.index, size)
        } else if (parsed?.kind === 'link' && parsed.url.startsWith('http')) {
          elements.push(fleetOpenUrlButton(parsed.url, parsed.text, parsed.buttonType))
        }
        cursor = match.index! + match[0].length
      }
      pushMarkdown(segment.slice(cursor))
      if (segIndex < segments.length - 1) {
        elements.push({ tag: 'hr' })
      }
    })
  }

  params.imageKeys.forEach((key, index) => {
    if (!usedImageIndexes.has(index) && key.trim()) {
      elements.push(fleetImageElement(key.trim()))
    }
  })

  return {
    schema: '2.0',
    body: {
      direction: 'vertical',
      elements,
    },
  }
}
