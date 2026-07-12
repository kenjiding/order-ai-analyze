/**
 * 飞书富文本编辑器公共组件。
 *
 * - `FeishuLarkMdEditor`：Tiptap 编辑器（加粗/颜色/列表/图片/@所有人/分隔线），value 为 HTML。
 * - `prepareFleetRichPayload`：编辑器 HTML → { content: lark_md + 图片占位标记, images }，
 *   与后端 `/api/feishu-webhook/push-rich-message` + `buildFleetRichMessageCard` 配套。
 * - 其余为 HTML ↔ lark_md 转换与展示辅助函数。
 */
export { FeishuLarkMdEditor } from './FeishuLarkMdEditor'
export {
  editorContentFromStored,
  hasEditorContent,
  isEditorHtml,
  mergeEditorHtmlParts,
  prepareFleetRichPayload,
  stripEditorContentForPreview,
} from './feishuEditorContent'
export { htmlToLarkMd, larkMdToHtml } from './feishuLarkMdConvert'
export { FEISHU_AT_ALL_LARK, FEISHU_HR_MARKER, feishuImageMarker, feishuLinkMarker } from './feishuLarkMdMarkers'
