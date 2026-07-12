/** 飞书卡片正文中的结构化标记（HTML→lark_md 时写入，组装卡片时解析） */
export const FEISHU_HR_MARKER = '[[FEISHU_HR]]'

/** 图片占位标记：序号对应推送 images 数组下标，后端按标记位置插入图片保持编辑顺序；
 * 带尺寸时格式为 [[FEISHU_IMG:0|320x240]]，后端翻译成飞书卡片 img 的 size（单位 px） */
export function feishuImageMarker(index: number, size?: { width: number; height: number }): string {
  return size ? `[[FEISHU_IMG:${index}|${size.width}x${size.height}]]` : `[[FEISHU_IMG:${index}]]`
}

/** 飞书卡片按钮样式（Schema 2.0），见 https://open.feishu.cn/document/feishu-cards/card-json-v2-components/interactive-components/button */
export type FeishuLinkButtonType =
  | 'default'
  | 'primary'
  | 'danger'
  | 'text'
  | 'primary_text'
  | 'danger_text'
  | 'primary_filled'
  | 'danger_filled'
  | 'laser'

/** 外链按钮占位：自定义机器人卡片内 markdown [text](url) 不可点击，后端转为 open_url 按钮 */
export function feishuLinkMarker(
  url: string,
  text: string,
  buttonType: FeishuLinkButtonType = 'primary_filled',
): string {
  return `[[FEISHU_LINK:${url.trim()}|${text.trim()}|${buttonType}]]`
}

/** 飞书 lark_md @所有人 */
export const FEISHU_AT_ALL_LARK = '<at id=all></at>'
