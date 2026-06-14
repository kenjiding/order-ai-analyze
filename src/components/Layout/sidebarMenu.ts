import { Calculator, ClipboardCheck, DollarSign, History, Megaphone, PackageSearch, Settings, type LucideIcon } from 'lucide-react'

export type SidebarMenuItem = {
  id: string
  path: string
  permissionKey: string
  label: string
  icon: LucideIcon
  description: string
}

const items: SidebarMenuItem[] = [
  {
    id: 'efficiency',
    path: '/efficiency',
    permissionKey: 'menu:efficiency',
    label: '效率考勤',
    icon: Calculator,
    description: '到件与考勤效率分析',
  },
  {
    id: 'efficiency-records',
    path: '/efficiency-records',
    permissionKey: 'menu:efficiency-records',
    label: '效率考勤记录',
    icon: History,
    description: '按日保存的效率计算结果',
  },
  {
    id: 'wage-salary',
    path: '/wage-salary',
    permissionKey: 'menu:wage-salary',
    label: '工资结算',
    icon: DollarSign,
    description: '员工工资计算与管理',
  },
  {
    id: 'order-exception',
    path: '/order-exception',
    permissionKey: 'menu:order-exception',
    label: 'AI订单异常分析',
    icon: PackageSearch,
    description: '轨迹样本与异常分类分析',
  },
  {
    id: 'push-notifications',
    path: '/push-notifications',
    permissionKey: 'menu:push-notifications',
    label: '推送功能',
    icon: Megaphone,
    description: '飞书群机器人推送配置',
  },
  {
    id: 'warehouse-safety',
    path: '/warehouse-safety',
    permissionKey: 'menu:warehouse-safety',
    label: '仓库安全日常检查',
    icon: ClipboardCheck,
    description: '安全自查表填写与导出',
  },
  {
    id: 'system-users',
    path: '/system/users',
    permissionKey: 'menu:system-users',
    label: '用户管理',
    icon: Settings,
    description: '系统用户与权限配置',
  },
]

export function buildSidebarMenuItems(
  hasPermission: (key: string) => boolean,
  isSuperAdmin: boolean,
): SidebarMenuItem[] {
  return items.filter((item) => {
    if (item.id === 'system-users' && !isSuperAdmin) return false
    if (isSuperAdmin) return true
    return hasPermission(item.permissionKey)
  })
}

export function getMenuPermissionForPath(pathname: string): string | null {
  const hit = items.find((item) => matchesSidebarActive(item.path, pathname))
  return hit?.permissionKey ?? null
}

export function getDefaultRouteForPermissions(
  hasPermission: (key: string) => boolean,
  isSuperAdmin: boolean,
): string {
  const visible = buildSidebarMenuItems(hasPermission, isSuperAdmin)
  return visible[0]?.path ?? '/login'
}

export function getDefaultRouteFromPermissionKeys(permissions: string[], isSuperAdmin: boolean): string {
  const hasPermission = (key: string) => isSuperAdmin || permissions.includes(key) || permissions.includes('*')
  return getDefaultRouteForPermissions(hasPermission, isSuperAdmin)
}

/** 与 react-router NavLink「当前路径」对齐：效率考勤页映射根路径 `/` */
export function matchesSidebarActive(path: string, pathname: string): boolean {
  if (path === '/efficiency') {
    return pathname === '/efficiency' || pathname === '/'
  }
  return pathname === path || pathname.startsWith(`${path}/`)
}
