import { Calculator, DollarSign, Megaphone, PackageSearch, type LucideIcon } from 'lucide-react'

export type SidebarMenuItem = {
  id: string
  path: string
  label: string
  icon: LucideIcon
  description: string
}

const items: SidebarMenuItem[] = [
  {
    id: 'efficiency',
    path: '/efficiency',
    label: '效率考勤',
    icon: Calculator,
    description: '到件与考勤效率分析',
  },
  {
    id: 'wage-salary',
    path: '/wage-salary',
    label: '工资结算',
    icon: DollarSign,
    description: '员工工资计算与管理',
  },
  {
    id: 'order-exception',
    path: '/order-exception',
    label: 'AI订单异常分析',
    icon: PackageSearch,
    description: '轨迹样本与异常分类分析',
  },
  {
    id: 'push-notifications',
    path: '/push-notifications',
    label: '推送功能',
    icon: Megaphone,
    description: '飞书群机器人推送配置',
  },
]

export function buildSidebarMenuItems(): SidebarMenuItem[] {
  return items
}

/** 与 react-router NavLink「当前路径」对齐：效率考勤页映射根路径 `/` */
export function matchesSidebarActive(path: string, pathname: string): boolean {
  if (path === '/efficiency') {
    return pathname === '/efficiency' || pathname === '/'
  }
  return pathname === path || pathname.startsWith(`${path}/`)
}
