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
  menuWarehouseSafety: 'menu:warehouse-safety',
  menuSystemUsers: 'menu:system-users',
  btnWageSalaryExport: 'btn:wage-salary:export',
  btnWageSalaryEdit: 'btn:wage-salary:edit',
  btnOrderExceptionAnalyze: 'btn:order-exception:analyze',
  btnOrderExceptionConfigEdit: 'btn:order-exception:config-edit',
  btnOrderExceptionClosureAdd: 'btn:order-exception:closure-add',
  btnPushNotificationsWarehouseEfficiency: 'btn:push-notifications:warehouse-efficiency',
  btnPushNotificationsAttendanceScheduling: 'btn:push-notifications:attendance-scheduling',
  btnPushNotificationsFleetSupplier: 'btn:push-notifications:fleet-supplier',
  btnPushNotificationsOrderException: 'btn:push-notifications:order-exception',
  btnWarehouseSafetyExport: 'btn:warehouse-safety:export',
  menuVendorAnalysis: 'menu:vendor-analysis',
  btnVendorAnalysisPush: 'btn:vendor-analysis:push',
  btnVendorAnalysisShare: 'btn:vendor-analysis:share',
  menuExitAlarm: 'menu:exit-alarm',
  menuDispatchAlarm: 'menu:dispatch-alarm',
  menuChaseDispatch: 'menu:chase-dispatch',
  menuWorkOrderPush: 'menu:work-order-push',
  menuAttendanceWorkTime: 'menu:attendance-work-time',
} as const
