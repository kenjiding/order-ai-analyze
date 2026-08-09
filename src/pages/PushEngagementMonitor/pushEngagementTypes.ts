/** 4 类定时推送的 pushLabel（与后端 recordFeishuPushMessage 落库的值一一对应） */
export const PUSH_LABELS = ['11点出仓告警', '24H派签告警', '催派推送', '工单推送'] as const
export type PushLabel = (typeof PUSH_LABELS)[number]

/** 卡片按钮点击事件的 actionType → 展示文案 */
export const CLICK_ACTION_LABELS: Record<string, string> = {
  view_details: 'View Details',
  resolve_tickets: 'Resolve Tickets',
}

export function clickActionLabel(actionType: string): string {
  return CLICK_ACTION_LABELS[actionType] ?? actionType
}

export type PushEngagementRow = {
  id: string
  messageId: string
  supplierConfigId: string | null
  vendorName: string
  regionCode: string
  pushLabel: string | null
  createdAt: string
  /** 超过飞书 7 天已读查询窗口 */
  readWindowExpired: boolean
  /** 按 actionType 聚合的点击次数 */
  clicks: Record<string, number>
}

export type PushReadStatusUser = { userId: string; name: string; readAtMs?: number }
export type PushReadStatus = {
  messageId: string
  sentAt: string
  totalMembers: number
  readCount: number
  readUsers: PushReadStatusUser[]
  unreadUsers: PushReadStatusUser[]
}

export type PushClickEvent = {
  openId: string
  name: string
  actionType: string
  clickedAt: string
}
