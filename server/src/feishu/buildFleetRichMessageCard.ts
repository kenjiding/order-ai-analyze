import { splitFeishuWebhookTextChunks } from '../sortEfficiencyFeishuAnalysis'
import { FEISHU_HR_MARKER, FEISHU_IMG_MARKER_RE } from './feishuLarkMdMarkers'

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

/**
 * 富文本 + 多图 → 单条飞书交互式卡片（schema 2.0）。
 *
 * 正文使用官方 markdown 组件（tag: 'markdown'）：lark_md 不支持有序/无序列表，
 * markdown 组件原生支持列表、**加粗**、<font> 颜色、<at id=all> 等完整语法。
 * 正文中的 [[FEISHU_IMG:n]] 占位标记会替换为 images[n] 对应的图片元素，
 * 保持图片与文字的编辑顺序；未被标记引用的图片追加在末尾（兼容旧内容）。
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
      // 按图片占位标记拆分，文字与图片按原始顺序交错成卡片元素
      let cursor = 0
      for (const match of segment.matchAll(FEISHU_IMG_MARKER_RE)) {
        pushMarkdown(segment.slice(cursor, match.index))
        const size = match[2] && match[3] ? feishuImgSize(Number(match[2]), Number(match[3])) : undefined
        pushImageAt(Number(match[1]), size)
        cursor = match.index + match[0].length
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
