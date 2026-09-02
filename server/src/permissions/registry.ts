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
  { key: 'menu:new-merchant-monitor', type: 'menu', label: '新商家数据监控', description: '新商家货量与签收指标看板', sortOrder: 35 },
  { key: 'menu:problem-package-audit', type: 'menu', label: 'AI问题件审核', description: '问题件图片AI智能审核', sortOrder: 37 },
  { key: 'menu:vendor-analysis', type: 'menu', label: '供应商数据分析', description: '供应商客诉率与工单数据推送', sortOrder: 38 },
  {
    key: 'menu:vendor-region-map',
    type: 'menu',
    label: '供应商区域地图',
    description: '按阿德莱德收件邮编查看供应商货量 3D 分布',
    sortOrder: 38,
  },
  {
    key: 'menu:exit-alarm',
    type: 'menu',
    label: '滞留数据告警',
    description: '监控供应商滞留未出仓数据并定时推送告警',
    sortOrder: 39,
  },
  {
    key: 'menu:dispatch-alarm',
    type: 'menu',
    label: '24小时派签告警',
    description: '监控供应商24小时派签率并定时推送告警',
    sortOrder: 39,
  },
  {
    key: 'menu:dispatch-performance',
    type: 'menu',
    label: '出仓派签达成分析',
    description: '11点前出仓率与24小时派签率的最终值、交叉归因与历史回看',
    sortOrder: 39,
  },
  { key: 'menu:chase-dispatch', type: 'menu', label: '催派推送', description: '按滞留时间统计供应商滞留订单并定时推送催派', sortOrder: 39 },
  { key: 'menu:work-order-push', type: 'menu', label: '工单推送', description: '未处理工单定时推送提醒供应商', sortOrder: 39 },
  {
    key: 'menu:package-loss-monitor',
    type: 'menu',
    label: '丢包监控',
    description: '库内/库外丢包运单监控与异常分析',
    sortOrder: 42,
  },
  { key: 'menu:push-notifications', type: 'menu', label: '推送功能', description: '飞书群机器人推送配置', sortOrder: 40 },
  {
    key: 'menu:push-engagement-monitor',
    type: 'menu',
    label: '推送数据监控',
    description: '监控供应商对出仓/24H派签/催派/工单推送的已读与按钮点击情况',
    sortOrder: 43,
  },
  { key: 'menu:warehouse-safety', type: 'menu', label: '仓库安全日常检查', description: '安全自查表填写与导出', sortOrder: 50 },
  {
    key: 'menu:attendance-work-time',
    type: 'menu',
    label: '出勤工作时间记录',
    description: '按工序/岗位记录员工出勤工作时长，用于计算各工序人效',
    sortOrder: 55,
  },
  { key: 'menu:system-users', type: 'menu', label: '用户管理', description: '系统用户与权限管理', sortOrder: 60 },
  {
    key: 'menu:supplier-configs',
    type: 'menu',
    label: '供应商配置',
    description: '供应商路由、站点、飞书群与推送文案的统一维护',
    sortOrder: 61,
  },
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
    key: 'btn:order-exception:closure-add',
    type: 'button',
    label: '新增异常完结',
    menuKey: 'order-exception',
    sortOrder: 330,
  },
  {
    key: 'btn:push-notifications:warehouse-efficiency',
    type: 'button',
    label: '物流运营推送',
    menuKey: 'push-notifications',
    sortOrder: 410,
  },
  {
    key: 'btn:push-notifications:attendance-scheduling',
    type: 'button',
    label: '仓库出勤/排班推送',
    menuKey: 'push-notifications',
    sortOrder: 411,
  },
  {
    key: 'btn:push-notifications:fleet-supplier',
    type: 'button',
    label: '车队供应商推送',
    menuKey: 'push-notifications',
    sortOrder: 412,
  },
  {
    key: 'btn:push-notifications:order-exception',
    type: 'button',
    label: '订单异常分析推送',
    menuKey: 'push-notifications',
    sortOrder: 413,
  },
  {
    key: 'btn:vendor-analysis:push',
    type: 'button',
    label: '供应商数据推送',
    menuKey: 'vendor-analysis',
    sortOrder: 380,
  },
  {
    key: 'btn:vendor-analysis:share',
    type: 'button',
    label: '供应商分享链接管理',
    description: '生成/重置/禁用供应商日报外部分享链接',
    menuKey: 'vendor-analysis',
    sortOrder: 381,
  },
  {
    key: 'btn:warehouse-safety:export',
    type: 'button',
    label: '导出检查表',
    menuKey: 'warehouse-safety',
    sortOrder: 510,
  },
  {
    key: 'menu:container-ledger',
    type: 'menu',
    label: '容器台账',
    description: '站点×品类的容器库存基线与变更记录',
    sortOrder: 62,
  },
  {
    key: 'menu:container-accounts',
    type: 'menu',
    label: '站点账户',
    description: '维护容器责任站点目录与用户绑定关系',
    sortOrder: 63,
  },
  {
    key: 'menu:container-transfers',
    type: 'menu',
    label: '流转记录',
    description: '容器借出/归还流转、收货确认与差异协商',
    sortOrder: 64,
  },
  {
    key: 'btn:container-accounts:manage',
    type: 'button',
    label: '管理站点账户与绑定',
    description: '新增/编辑/删除站点账户，并维护用户绑定',
    menuKey: 'container-accounts',
    sortOrder: 620,
  },
  {
    key: 'btn:container-ledger:delete',
    type: 'button',
    label: '删除台账记录',
    menuKey: 'container-ledger',
    sortOrder: 630,
  },
  {
    key: 'btn:container-transfers:proxy-confirm',
    type: 'button',
    label: '代确认收货',
    description: '接收方无系统账号时，凭线下回单单方面确认并入账',
    menuKey: 'container-transfers',
    sortOrder: 640,
  },
  {
    key: 'btn:package-loss-monitor:analyze',
    type: 'button',
    label: '查询并分析',
    menuKey: 'package-loss-monitor',
    sortOrder: 420,
  },
]

/** 可分配给普通用户的权限；超级管理员通过 role 拥有全部能力，不通过 permission 分配用户管理 */
export const ASSIGNABLE_PERMISSION_REGISTRY = PERMISSION_REGISTRY.filter(
  (item) => item.key !== 'menu:system-users',
)

export type UserRole = 'super_admin' | 'user'

export const SUPER_ADMIN_ROLE: UserRole = 'super_admin'
export const USER_ROLE: UserRole = 'user'
