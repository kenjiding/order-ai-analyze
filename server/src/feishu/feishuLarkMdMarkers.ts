/** 与前端 `src/pages/PushNotifications/feishuLarkMdMarkers.ts` 保持一致 */
export const FEISHU_HR_MARKER = '[[FEISHU_HR]]'

/** 图片占位标记：序号对应推送 images 数组下标，可选 |宽x高（px）尾缀控制展示尺寸 */
export const FEISHU_IMG_MARKER_RE = /\[\[FEISHU_IMG:(\d+)(?:\|(\d+)x(\d+))?\]\]/g
