export type PermissionType = 'menu' | 'button'

export type PermissionDefinition = {
  key: string
  type: PermissionType
  label: string
  description?: string
  menuKey?: string
  sortOrder: number
}

export const PERMISSION_REGISTRY: PermissionDefinition[] = [
  { key: 'menu:efficiency', type: 'menu', label: '效率考勤', description: '到件与考勤效率分析', sortOrder: 10 },
  {
    key: 'menu:efficiency-records',
    type: 'menu',
    label: '效率考勤记录',
    description: '按日保存的效率与考勤计算结果',
    sortOrder: 15,
  },
  { key: 'menu:wage-salary', type: 'menu', label: '工资结算', description: '员工工资计算与管理', sortOrder: 20 },
  { key: 'menu:order-exception', type: 'menu', label: 'AI订单异常分析', description: '轨迹样本与异常分类分析', sortOrder: 30 },
  { key: 'menu:push-notifications', type: 'menu', label: '推送功能', description: '飞书群机器人推送配置', sortOrder: 40 },
  { key: 'menu:warehouse-safety', type: 'menu', label: '仓库安全日常检查', description: '安全自查表填写与导出', sortOrder: 50 },
  { key: 'menu:system-users', type: 'menu', label: '用户管理', description: '系统用户与权限管理', sortOrder: 60 },
  {
    key: 'btn:wage-salary:export',
    type: 'button',
    label: '导出工资',
    menuKey: 'wage-salary',
    sortOrder: 210,
  },
  {
    key: 'btn:wage-salary:edit',
    type: 'button',
    label: '编辑员工数据',
    menuKey: 'wage-salary',
    sortOrder: 220,
  },
  {
    key: 'btn:order-exception:analyze',
    type: 'button',
    label: '执行分析',
    menuKey: 'order-exception',
    sortOrder: 310,
  },
  {
    key: 'btn:order-exception:config-edit',
    type: 'button',
    label: '编辑仓库配置',
    menuKey: 'order-exception',
    sortOrder: 320,
  },
  {
    key: 'btn:push-notifications:send',
    type: 'button',
    label: '发送推送',
    menuKey: 'push-notifications',
    sortOrder: 410,
  },
  {
    key: 'btn:warehouse-safety:export',
    type: 'button',
    label: '导出检查表',
    menuKey: 'warehouse-safety',
    sortOrder: 510,
  },
]

/** 可分配给普通用户的权限；超级管理员通过 role 拥有全部能力，不通过 permission 分配用户管理 */
export const ASSIGNABLE_PERMISSION_REGISTRY = PERMISSION_REGISTRY.filter(
  (item) => item.key !== 'menu:system-users',
)

export type UserRole = 'super_admin' | 'user'

export const SUPER_ADMIN_ROLE: UserRole = 'super_admin'
export const USER_ROLE: UserRole = 'user'
