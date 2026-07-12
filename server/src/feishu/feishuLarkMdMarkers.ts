/** 与前端 `src/components/FeishuLarkMdEditor/feishuLarkMdMarkers.ts` 保持一致 */
export const FEISHU_HR_MARKER = '[[FEISHU_HR]]'

/** 图片占位标记：序号对应推送 images 数组下标，可选 |宽x高（px）尾缀控制展示尺寸 */
export const FEISHU_IMG_MARKER_RE = /\[\[FEISHU_IMG:(\d+)(?:\|(\d+)x(\d+))?\]\]/g

/** 外链按钮占位：[[FEISHU_LINK:https://…|按钮文案|primary_filled]]，第三段为可选按钮样式 */
export const FEISHU_LINK_MARKER_RE = /\[\[FEISHU_LINK:([^|\]]+)\|([^|\]]+)(?:\|([^\]]+))?\]\]/g

/** 图片 / 外链按钮占位（按正文出现顺序解析） */
export const FEISHU_BODY_MARKER_RE = /\[\[FEISHU_(IMG:\d+(?:\|\d+x\d+)?|LINK:[^|\]]+\|[^|\]]+(?:\|[^\]]+)?)\]\]/g
