import { i18n } from '../../i18n/index'

export type FeishuPushKind = 'sort_efficiency' | 'attendance_scheduling' | 'order_exception'

export type FeishuPushEntry = {
  id: string
  webhookUrl: string
  pushName: string
  pushTimeHm: string
  /** 是否禁用该条推送（禁用后不参与自动/手动推送） */
  isDisabled?: boolean
  /** 飞书签名校验密钥，可选 */
  signingSecret?: string
  pushDescription?: string
}

/** 列表展示用：本地存储仍按类型分桶 */
export type FeishuPushEntryWithKind = FeishuPushEntry & { kind: FeishuPushKind }

export function feishuPushKindLabel(kind: FeishuPushKind): string {
  return String(i18n.t(`kind.${kind}`, { ns: 'pushNotifications' }))
}

/** 新增类型时请同步扩展 FeishuPushKind 与本数组顺序 */
export const FEISHU_PUSH_KIND_ORDER = [
  'sort_efficiency',
  'attendance_scheduling',
  'order_exception',
] as const satisfies readonly FeishuPushKind[]

export const FEISHU_PUSH_DEFAULT_KIND: FeishuPushKind =
  FEISHU_PUSH_KIND_ORDER[0]

export const FEISHU_WEBHOOK_PREFIX = 'https://open.feishu.cn/open-apis/bot/v2/hook/'
