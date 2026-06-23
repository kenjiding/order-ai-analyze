import { PERMISSION_KEYS } from '../hooks/usePermission'
import type { FeishuPushKind } from '../pages/PushNotifications/feishuPushTypes'

/** 与 server/src/permissions/pushNotificationAccess.ts 的 PushApiScope 保持一致 */
export type PushApiScope = 'warehouse-efficiency' | 'attendance-scheduling' | 'fleet-supplier' | 'order-exception' | 'vendor-analysis'

export type PushPageTabKey = 'warehouse_efficiency' | 'attendance_scheduling' | 'fleet_supplier' | 'order_exception'

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
    label: '仓库效率推送',
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
    tabKey: 'fleet_supplier',
    label: '车队供应商推送',
    permissionKey: PERMISSION_KEYS.btnPushNotificationsFleetSupplier,
    apiScope: 'fleet-supplier',
  },
  {
    tabKey: 'order_exception',
    label: '订单异常分析推送',
    permissionKey: PERMISSION_KEYS.btnPushNotificationsOrderException,
    apiScope: 'order-exception',
    feishuKind: 'order_exception',
  },
] as const

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
