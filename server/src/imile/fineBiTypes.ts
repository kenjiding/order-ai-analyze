/** 页面传入的 FineBI 连接配置（每次请求携带，不写 env） */
export type FineBiConnectionInput = {
  reportId: string
  shareLink: string
  baseUrl?: string
  authToken?: string
  /** 浏览器抓取的原始 widget/data URL（含 templateId 等额外参数），用于原样重建请求 URL */
  widgetDataUrl?: string
}
