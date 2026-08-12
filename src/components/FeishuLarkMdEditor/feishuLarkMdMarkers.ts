/** 飞书卡片正文中的结构化标记（HTML→lark_md 时写入，组装卡片时解析） */
export const FEISHU_HR_MARKER = '[[FEISHU_HR]]'

/**
 * 块级边界标记：编辑器里每个块（段落 / 空行 / 列表 / 引用 / 分割线）之间写入一个，
 * 后端按它拆成独立的卡片 markdown 元素。
 *
 * 块边界绝不能用换行表达：飞书 markdown 组件按 CommonMark 解析，空行在列表 / 引用等
 * 块级结构后面只是「结束这个块」的语法分隔符，会被解析器吃掉，用户敲的空行就此消失
 * （编辑器里却仍是一个实实在在的空段落，于是「编辑器换行了、飞书没换行」）。
 * 块内部的软换行仍用单个 \n —— 段落内飞书把它渲染成 <br>，这是唯一稳定的换行语义。
 */
export const FEISHU_BLOCK_MARKER = '[[FEISHU_BLOCK]]'

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
