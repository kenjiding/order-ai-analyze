import {
  Activity,
  AlarmClock,
  ArrowLeftRight,
  Boxes,
  Building2,
  BarChart2,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  DollarSign,
  Eye,
  Gauge,
  Globe,
  History,
  MapPinned,
  Megaphone,
  HammerIcon,
  PackageCheck,
  PackageMinus,
  PackageSearch,
  ScanSearch,
  Settings,
  Star,
  Store,
  Ticket,
  Timer,
  TrendingUp,
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
      {
        id: 'attendance-work-time',
        path: '/attendance-work-time',
        permissionKey: 'menu:attendance-work-time',
        label: '出勤工作时间记录',
        icon: Timer,
        description: '按工序/岗位记录员工出勤工作时长，用于计算各工序人效',
      },
      {
        id: 'return-to-merchant-finish',
        path: '/return-to-merchant-finish',
        permissionKey: 'menu:return-to-merchant-finish',
        label: '退返商家完结',
        icon: PackageCheck,
        description: '按集包创建时间查询集包并批量提交退返商家完结',
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
        id: 'vendor-region-map',
        path: '/vendor-region-map',
        permissionKey: 'menu:vendor-region-map',
        label: '供应商区域地图',
        icon: MapPinned,
        description: '按阿德莱德收件邮编查看供应商货量 3D 分布',
      },
      {
        id: 'exit-alarm',
        path: '/exit-alarm',
        permissionKey: 'menu:exit-alarm',
        label: '滞留数据告警',
        icon: AlarmClock,
        description: '监控供应商滞留未出仓数据并定时推送告警',
      },
      {
        id: 'dispatch-alarm',
        path: '/dispatch-alarm',
        permissionKey: 'menu:dispatch-alarm',
        label: '24小时派签告警',
        icon: Gauge,
        description: '监控供应商24小时派签率并定时推送告警',
      },
      {
        id: 'dispatch-performance',
        path: '/dispatch-performance',
        permissionKey: 'menu:dispatch-performance',
        label: '出仓派签达成分析',
        icon: TrendingUp,
        description: '11点前出仓率与24小时派签率的最终值、交叉归因与历史回看',
      },
      {
        id: 'exit-rate-query',
        path: '/exit-rate-query',
        permissionKey: 'menu:exit-rate-query',
        label: '出仓率查询',
        icon: Timer,
        description: '按到件日查询当天出仓率、次日11点出仓率及分时段占比',
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
    id: 'data-monitor',
    label: '数据监控',
    icon: Activity,
    items: [
      {
        id: 'package-loss-monitor',
        path: '/package-loss-monitor',
        permissionKey: 'menu:package-loss-monitor',
        label: '丢包监控',
        icon: PackageMinus,
        description: '库内/库外丢包运单监控与异常分析',
      },
      {
        id: 'push-engagement-monitor',
        path: '/push-engagement-monitor',
        permissionKey: 'menu:push-engagement-monitor',
        label: '推送数据监控',
        icon: Eye,
        description: '监控供应商对出仓/24H派签/催派/工单推送的已读与按钮点击情况',
      },
    ],
  },
  {
    id: 'container',
    label: '容器管理',
    icon: Boxes,
    items: [
      {
        id: 'container-ledger',
        path: '/container/ledger',
        permissionKey: 'menu:container-ledger',
        label: '容器台账',
        icon: PackageSearch,
        description: '站点×品类的容器库存基线与变更记录',
      },
      {
        id: 'container-accounts',
        path: '/container/accounts',
        permissionKey: 'menu:container-accounts',
        label: '站点账户',
        icon: Building2,
        description: '维护容器责任站点目录与用户绑定关系',
      },
      {
        id: 'container-transfers',
        path: '/container/transfers',
        permissionKey: 'menu:container-transfers',
        label: '流转记录',
        icon: ArrowLeftRight,
        description: '容器借出/归还流转、收货确认与差异协商',
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
      {
        id: 'supplier-content-push',
        path: '/supplier-content-push',
        permissionKey: 'menu:supplier-content-push',
        label: '供应商内容推送',
        icon: Truck,
        description: '向车队供应商推送货量报表、推送文案与图片',
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
    {
      id: 'supplier-configs',
      path: '/system/supplier-configs',
      permissionKey: 'menu:supplier-configs',
      label: '供应商配置',
      icon: Truck,
      description: '供应商路由、站点、飞书群与推送文案的统一维护',
    },
    {
      id: 'priority-clients',
      path: '/system/priority-clients',
      permissionKey: 'menu:priority-clients',
      label: '优先客户配置',
      icon: Star,
      description: '维护优先客户名单：负责人、商家编码/名称、开户时间与销售团队',
    },
    {
      id: 'region-package-prices',
      path: '/system/region-package-prices',
      permissionKey: 'menu:region-package-prices',
      label: '区域包裹价格配置',
      icon: DollarSign,
      description: '按州维护 postcode/suburb 的派送单价、所属供应商与上一次价格',
    },
  ],
}

export function buildSidebarMenuGroups(
  hasPermission: (key: string) => boolean,
  isSuperAdmin: boolean,
): SidebarMenuGroup[] {
  const allGroups: SidebarMenuGroup[] = [...groups]
  // 系统管理组内既有超管专属项（用户管理），也有可分配项（供应商配置），故按权限判断是否展示
  const showSystemGroup =
    isSuperAdmin || systemGroup.items.some((item) => hasPermission(item.permissionKey))
  if (showSystemGroup) allGroups.push(systemGroup)

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
