import {
  AlarmClock,
  BarChart2,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  DollarSign,
  Globe,
  History,
  Megaphone,
  HammerIcon,
  PackageSearch,
  ScanSearch,
  Settings,
  Store,
  Ticket,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'

export type SidebarMenuItem = {
  id: string
  path: string
  permissionKey: string
  label: string
  icon: LucideIcon
  description: string
}

export type SidebarMenuGroup = {
  id: string
  label: string
  icon: LucideIcon
  items: SidebarMenuItem[]
}

const groups: SidebarMenuGroup[] = [
  {
    id: 'inbound',
    label: '库内管理',
    icon: Warehouse,
    items: [
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
        id: 'warehouse-safety',
        path: '/warehouse-safety',
        permissionKey: 'menu:warehouse-safety',
        label: '仓库安全日常检查',
        icon: ClipboardCheck,
        description: '安全自查表填写与导出',
      },
    ],
  },
  {
    id: 'outbound',
    label: '库外管理',
    icon: Globe,
    items: [
      {
        id: 'order-exception',
        path: '/order-exception',
        permissionKey: 'menu:order-exception',
        label: 'AI订单异常分析',
        icon: PackageSearch,
        description: '轨迹样本与异常分类分析',
      },
      {
        id: 'new-merchant-monitor',
        path: '/new-merchant-monitor',
        permissionKey: 'menu:new-merchant-monitor',
        label: '新商家数据监控',
        icon: Store,
        description: '新商家货量与签收指标看板',
      },
      {
        id: 'problem-package-audit',
        path: '/problem-package-audit',
        permissionKey: 'menu:problem-package-audit',
        label: 'AI问题件审核',
        icon: ScanSearch,
        description: '问题件图片AI智能审核',
      },
      {
        id: 'vendor-analysis',
        path: '/vendor-analysis',
        permissionKey: 'menu:vendor-analysis',
        label: '供应商数据分析',
        icon: BarChart2,
        description: '供应商客诉率与工单数据推送',
      },
      {
        id: 'exit-alarm',
        path: '/exit-alarm',
        permissionKey: 'menu:exit-alarm',
        label: '出仓 / 派签告警',
        icon: AlarmClock,
        description: '监控供应商11点前出仓率、24小时派签率并定时推送告警',
      },
      {
        id: 'chase-dispatch',
        path: '/chase-dispatch',
        permissionKey: 'menu:chase-dispatch',
        label: '催派推送',
        icon: Truck,
        description: '按滞留时间统计供应商滞留订单并定时推送催派',
      },
      {
        id: 'work-order-push',
        path: '/work-order-push',
        permissionKey: 'menu:work-order-push',
        label: '工单推送',
        icon: Ticket,
        description: '未处理工单定时推送提醒供应商',
      },
    ],
  },
  {
    id: 'quality',
    label: '质检管理',
    icon: ClipboardList,
    items: [],
  },
  {
    id: 'push',
    label: '工具管理',
    icon: HammerIcon,
    items: [
      {
        id: 'push-notifications',
        path: '/push-notifications',
        permissionKey: 'menu:push-notifications',
        label: '推送功能',
        icon: Megaphone,
        description: '飞书群机器人推送配置',
      },
    ],
  },
]

const systemGroup: SidebarMenuGroup = {
  id: 'system',
  label: '系统管理',
  icon: Settings,
  items: [
    {
      id: 'system-users',
      path: '/system/users',
      permissionKey: 'menu:system-users',
      label: '用户管理',
      icon: Users,
      description: '系统用户与权限配置',
    },
  ],
}

export function buildSidebarMenuGroups(
  hasPermission: (key: string) => boolean,
  isSuperAdmin: boolean,
): SidebarMenuGroup[] {
  const allGroups: SidebarMenuGroup[] = [...groups]
  if (isSuperAdmin) allGroups.push(systemGroup)

  return allGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isSuperAdmin || hasPermission(item.permissionKey)),
    }))
    .filter((group, i) => {
      // Always keep intentionally-empty groups (e.g. 质检管理)
      if (allGroups[i].items.length === 0) return true
      // Drop groups where all items were stripped by permission check
      return group.items.length > 0
    })
}

export function getMenuPermissionForPath(pathname: string): string | null {
  const allItems = [...groups.flatMap((g) => g.items), ...systemGroup.items]
  const hit = allItems.find((item) => matchesSidebarActive(item.path, pathname))
  return hit?.permissionKey ?? null
}

export function getDefaultRouteForPermissions(
  hasPermission: (key: string) => boolean,
  isSuperAdmin: boolean,
): string {
  const visibleGroups = buildSidebarMenuGroups(hasPermission, isSuperAdmin)
  for (const group of visibleGroups) {
    if (group.items.length > 0) return group.items[0].path
  }
  return '/login'
}

export function getDefaultRouteFromPermissionKeys(permissions: string[], isSuperAdmin: boolean): string {
  const hasPermission = (key: string) => isSuperAdmin || permissions.includes(key) || permissions.includes('*')
  return getDefaultRouteForPermissions(hasPermission, isSuperAdmin)
}

export type MenuGroupDef = {
  id: string
  label: string
  permissionKeys: string[]
}

/** 返回菜单分组结构（不过滤权限），供权限配置 UI 复用 */
export function getMenuGroupDefs(): MenuGroupDef[] {
  return [...groups, systemGroup].map((group) => ({
    id: group.id,
    label: group.label,
    permissionKeys: group.items.map((item) => item.permissionKey),
  }))
}

export function matchesSidebarActive(path: string, pathname: string): boolean {
  if (path === '/efficiency') {
    return pathname === '/efficiency' || pathname === '/'
  }
  return pathname === path || pathname.startsWith(`${path}/`)
}
