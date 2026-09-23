import { PERMISSION_KEYS } from '../hooks/usePermission'
import type { FeishuPushKind } from '../pages/PushNotifications/feishuPushTypes'

/** 与 server/src/permissions/pushNotificationAccess.ts 的 PushApiScope 保持一致 */
export type PushApiScope = 'warehouse-efficiency' | 'attendance-scheduling' | 'fleet-supplier' | 'order-exception' | 'vendor-analysis'

export type PushPageTabKey = 'warehouse_efficiency' | 'attendance_scheduling' | 'order_exception'

export const PUSH_NOTIFICATIONS_BASE_PATH = '/push-notifications'
export const PUSH_PAGE_TAB_QUERY_KEY = 'tab'

export type PushNotificationFeature = {
  tabKey: PushPageTabKey
  label: string
  permissionKey: string
  apiScope: PushApiScope
  feishuKind?: FeishuPushKind
}

/** 推送功能子模块：菜单 menu:push-notifications 下的 Tab 与 API 权限一一对应 */
export const PUSH_NOTIFICATION_FEATURES: readonly PushNotificationFeature[] = [
  {
    tabKey: 'warehouse_efficiency',
    label: '物流运营推送',
    permissionKey: PERMISSION_KEYS.btnPushNotificationsWarehouseEfficiency,
    apiScope: 'warehouse-efficiency',
    feishuKind: 'sort_efficiency',
  },
  {
    tabKey: 'attendance_scheduling',
    label: '仓库出勤/排班推送',
    permissionKey: PERMISSION_KEYS.btnPushNotificationsAttendanceScheduling,
    apiScope: 'attendance-scheduling',
    feishuKind: 'attendance_scheduling',
  },
  {
    tabKey: 'order_exception',
    label: '订单异常分析推送',
    permissionKey: PERMISSION_KEYS.btnPushNotificationsOrderException,
    apiScope: 'order-exception',
    feishuKind: 'order_exception',
  },
] as const

const PUSH_PAGE_TAB_KEYS = new Set<PushPageTabKey>(
  PUSH_NOTIFICATION_FEATURES.map((feature) => feature.tabKey),
)

export function isPushPageTabKey(value: string): value is PushPageTabKey {
  return PUSH_PAGE_TAB_KEYS.has(value as PushPageTabKey)
}

export function buildPushNotificationsPath(tabKey?: PushPageTabKey): string {
  if (!tabKey) return PUSH_NOTIFICATIONS_BASE_PATH
  return `${PUSH_NOTIFICATIONS_BASE_PATH}?${PUSH_PAGE_TAB_QUERY_KEY}=${tabKey}`
}

export function listAccessiblePushFeatures(
  hasPermission: (key: string) => boolean,
): PushNotificationFeature[] {
  return PUSH_NOTIFICATION_FEATURES.filter((feature) => hasPermission(feature.permissionKey))
}

export function getPushFeatureByTabKey(tabKey: PushPageTabKey): PushNotificationFeature | undefined {
  return PUSH_NOTIFICATION_FEATURES.find((feature) => feature.tabKey === tabKey)
}

export function getPushFeatureByFeishuKind(kind: FeishuPushKind): PushNotificationFeature | undefined {
  return PUSH_NOTIFICATION_FEATURES.find((feature) => feature.feishuKind === kind)
}

export function getPushFeatureByApiScope(scope: PushApiScope): PushNotificationFeature | undefined {
  return PUSH_NOTIFICATION_FEATURES.find((feature) => feature.apiScope === scope)
}

export function canAccessPushApiScope(
  hasPermission: (key: string) => boolean,
  scope: PushApiScope,
): boolean {
  const feature = getPushFeatureByApiScope(scope)
  return feature ? hasPermission(feature.permissionKey) : false
}
