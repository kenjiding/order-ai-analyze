import { splitFeishuWebhookTextChunks } from '../sortEfficiencyFeishuAnalysis'
import { FEISHU_HR_MARKER } from './feishuLarkMdMarkers'

function fleetImageElement(imageKey: string): Record<string, unknown> {
  return {
    tag: 'img',
    img_key: imageKey,
    alt: { tag: 'plain_text', content: '' },
    mode: 'fit_horizontal',
    preview: true,
  }
}

/** 富文本 + 多图 → 单条飞书交互式卡片 */
export function buildFleetRichMessageCard(params: {
  content?: string
  imageKeys: string[]
}): Record<string, unknown> {
  const elements: Record<string, unknown>[] = []
  const raw = params.content?.trim() ?? ''

  if (raw) {
    const segments = raw.split(FEISHU_HR_MARKER)
    segments.forEach((segment, index) => {
      const text = segment.trim()
      if (text) {
        for (const chunk of splitFeishuWebhookTextChunks(text)) {
          elements.push({
            tag: 'div',
            text: { tag: 'lark_md', content: chunk },
          })
        }
      }
      if (index < segments.length - 1) {
        elements.push({ tag: 'hr' })
      }
    })
  }

  for (const key of params.imageKeys) {
    if (key.trim()) elements.push(fleetImageElement(key.trim()))
  }

  return {
    schema: '2.0',
    body: {
      direction: 'vertical',
      elements,
    },
  }
}
