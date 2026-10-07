import { type ReactNode } from 'react'
import { Tooltip } from 'antd'
import { useAuthStore } from '../stores/authStore'

export function usePermission(key: string): boolean {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  return hasPermission(key)
}

type PermissionGateProps = {
  permission: string
  children: ReactNode
  fallback?: ReactNode
}

export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const allowed = usePermission(permission)
  if (!allowed) return <>{fallback}</>
  return <>{children}</>
}

type PermissionButtonProps = {
  permission: string
  children: ReactNode
  disabled?: boolean
  title?: string
  className?: string
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
}

export function PermissionButton({
  permission,
  children,
  disabled,
  title,
  className,
  onClick,
  type = 'button',
}: PermissionButtonProps) {
  const allowed = usePermission(permission)
  const isDisabled = disabled || !allowed
  const tooltip = !allowed ? '无操作权限' : title

  return (
    <Tooltip title={tooltip}>
      <span className={!allowed ? 'inline-flex cursor-not-allowed' : 'inline-flex'}>
        <button
          type={type}
          className={className}
          disabled={isDisabled}
          onClick={onClick}
          aria-disabled={isDisabled}
        >
          {children}
        </button>
      </span>
    </Tooltip>
  )
}

export const PERMISSION_KEYS = {
  menuEfficiency: 'menu:efficiency',
  menuWageSalary: 'menu:wage-salary',
  menuOrderException: 'menu:order-exception',
  menuNewMerchantMonitor: 'menu:new-merchant-monitor',
  menuPushNotifications: 'menu:push-notifications',
  menuSupplierContentPush: 'menu:supplier-content-push',
  menuPushEngagementMonitor: 'menu:push-engagement-monitor',
  menuWarehouseSafety: 'menu:warehouse-safety',
  menuContainerLedger: 'menu:container-ledger',
  menuContainerAccounts: 'menu:container-accounts',
  menuContainerTransfers: 'menu:container-transfers',
  menuSystemUsers: 'menu:system-users',
  menuSupplierConfigs: 'menu:supplier-configs',
  menuPriorityClients: 'menu:priority-clients',
  menuRegionPackagePrices: 'menu:region-package-prices',
  menuWarehouseSettings: 'menu:warehouse-settings',
  menuRegionCalendar: 'menu:region-calendar',
  btnContainerAccountsManage: 'btn:container-accounts:manage',
  btnContainerLedgerEdit: 'btn:container-ledger:edit',
  btnContainerLedgerDelete: 'btn:container-ledger:delete',
  btnContainerLedgerManageTypes: 'btn:container-ledger:manage-types',
  btnContainerTransfersVoid: 'btn:container-transfers:void',
  btnWageSalaryExport: 'btn:wage-salary:export',
  btnWageSalaryEdit: 'btn:wage-salary:edit',
  btnOrderExceptionAnalyze: 'btn:order-exception:analyze',
  btnOrderExceptionConfigEdit: 'btn:order-exception:config-edit',
  btnOrderExceptionClosureAdd: 'btn:order-exception:closure-add',
  btnOrderExceptionUsageStats: 'btn:order-exception:usage-stats',
  btnPushNotificationsWarehouseEfficiency: 'btn:push-notifications:warehouse-efficiency',
  btnPushNotificationsAttendanceScheduling: 'btn:push-notifications:attendance-scheduling',
  btnPushNotificationsFleetSupplier: 'btn:push-notifications:fleet-supplier',
  btnPushNotificationsOrderException: 'btn:push-notifications:order-exception',
  btnWarehouseSafetyExport: 'btn:warehouse-safety:export',
  menuVendorAnalysis: 'menu:vendor-analysis',
  menuVendorRegionMap: 'menu:vendor-region-map',
  btnVendorAnalysisPush: 'btn:vendor-analysis:push',
  btnVendorAnalysisShare: 'btn:vendor-analysis:share',
  menuExitAlarm: 'menu:exit-alarm',
  menuDispatchAlarm: 'menu:dispatch-alarm',
  menuDispatchPerformance: 'menu:dispatch-performance',
  btnDispatchPerformancePush: 'btn:dispatch-performance:push',
  menuExitRateQuery: 'menu:exit-rate-query',
  menuChaseDispatch: 'menu:chase-dispatch',
  menuWorkOrderPush: 'menu:work-order-push',
  menuAttendanceWorkTime: 'menu:attendance-work-time',
  menuReturnToMerchantFinish: 'menu:return-to-merchant-finish',
  menuScanStat: 'menu:scan-stat',
  menuPackageLossMonitor: 'menu:package-loss-monitor',
  btnPackageLossMonitorAnalyze: 'btn:package-loss-monitor:analyze',
} as const
