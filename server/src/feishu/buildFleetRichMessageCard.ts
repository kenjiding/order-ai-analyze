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
        // 按段落（\n\n）拆分，每段单独一个 div 元素。
        // 若整段放入同一 div 的 lark_md content，飞书卡片会忽略 \n\n 导致不换行。
        const paras = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
        for (const para of paras) {
          for (const chunk of splitFeishuWebhookTextChunks(para)) {
            elements.push({
              tag: 'div',
              text: { tag: 'lark_md', content: chunk },
            })
          }
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
