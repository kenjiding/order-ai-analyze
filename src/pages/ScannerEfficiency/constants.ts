export const SORTING_REQUIRED_COLUMNS = ['扫描时间', '运单号', '扫描员'] as const
export const SCAN_TIME_COLUMNS = ['扫描时间', '时间', '到件时间', '扫描日期', '日期']
export const TRACKING_COLUMNS = ['运单号', '运单号码', '快递单号', '单号', '票号', '面单号']
export const SCANNER_COLUMNS = ['扫描员', '操作员', '作业员', '员工', '姓名']

export {
  SCAN_ROUTE_CODE_COLUMNS,
  SCAN_CONSIGNEE_ZIP_COLUMNS,
  SCAN_DELIVERY_STATION_COLUMNS,
  SCAN_STATION_COLUMNS,
  SCAN_CLIENT_CODE_COLUMNS,
  SCAN_CLIENT_NAME_COLUMNS,
  SCAN_CONSIGNEE_CITY_COLUMNS,
} from './scanInboundFieldMap'

export const ATTENDANCE_DATE_COLUMNS = ['日期', '考勤日期', '工作日期', '打卡日期', '统计日期', 'date']
/** 有值时优先用于工时结算（与工资页口径一致） */
export const ATTENDANCE_WORK_HOURS_COLUMNS = [
  '工作时长',
  '工作时长(小时)',
  '工作时长（小时）',
  'Work Hours',
  'workHours',
  '工作小时',
] as const

/** 无「工作时长」或无法解析时回退 */
export const ATTENDANCE_TOTAL_HOURS_COLUMNS = [
  '总时长',
  'Total Hours',
  'totalHours',
  '工时',
  '总工时',
  '时长',
  '考勤时长',
  '出勤时长',
  '时长(小时)',
  '总时长(小时)',
  '工时(h)',
  '工时(H)',
  'hours',
] as const
export const ATTENDANCE_ID_COLUMNS = ['人员编号', '员工编号', '人员ID', '员工ID', '用户ID', '工号', 'id', 'uid']
export const ATTENDANCE_NAME_COLUMNS = ['昵称', '姓名', '员工姓名', '人员姓名', '分拣员', '分拣工', '员工', 'name', '姓氏']
export const ATTENDANCE_POSITION_TITLE_COLUMNS = ['职位名称', 'Job Title', 'jobTitle', 'Position', 'position']
export const ATTENDANCE_POSITION_CODE_COLUMNS = ['职位编号', 'Job Code', 'jobCode', 'Position Code', 'positionCode']
export const ATTENDANCE_CLOCK_IN_COLUMNS = ['实际签到时间', '实际签到', '首次打卡', 'First Clock In', 'firstClockIn']
export const ATTENDANCE_CLOCK_OUT_COLUMNS = ['实际签退时间', '实际签退', '最后打卡', 'Last Clock Out', 'lastClockOut']

/** 与 {@link ../../payroll/attendanceClockTime} 一致：考勤打卡时刻比悉尼业务时间快 30 分钟 */
export { ATTENDANCE_CLOCK_TIME_OFFSET_MINUTES } from '../../payroll/attendanceClockTime'

export const ALLOCATION_TIME_COLUMNS = ['分配时间', '分配日期', '交接时间', '派单时间', '时间', '日期', 'allocationTime']
export const ALLOCATION_BOX_COLUMNS = ['箱号', '包号', '集包号', '批次号', 'containerNo', 'boxNo']
export const ALLOCATION_DRIVER_COLUMNS = [
  '派送员',
  '派件员',
  '配送员',
  '司机',
  '司机名称',
  'driver',
  'courier',
  'assignDaName',
]
export const ALLOCATION_DRIVER_COMPANY_COLUMNS = [
  '司机所属公司',
  '所属公司',
  '司机公司',
  '派送公司',
  '公司',
  'driverCompany',
]
export const ALLOCATION_DRIVER_CODE_COLUMNS = [
  'Route Code',
  'routeCode',
  '路由编码',
  '司机编码',
  '司机编号',
  '派送员编号',
  '司机ID',
  '司机id',
  'driverCode',
  'driverNo',
  'driverId',
  'courierId',
]

/** @deprecated 使用 ALLOCATION_DRIVER_CODE_COLUMNS */
export const ALLOCATION_DRIVER_NO_COLUMNS = ALLOCATION_DRIVER_CODE_COLUMNS

/** 效率明细图表「不开仓」判定：分拣人数或货量不超过下列上限（满足任一即不开仓） */
export const EFFICIENCY_CHART_NON_OPEN_MAX_SORTERS = 2
export const EFFICIENCY_CHART_NON_OPEN_MAX_VOLUME = 500

export const DEFAULT_SETTINGS = {
  openDayThreshold: 2,
  breakCapMinutes: 10,
  splitThresholdMinutes: 30,
  /** 每个分拣会话折算有效工时的下限（分钟），含仅 1 次扫描或与真实作业不符的极小间隔累计（如文件中大量同一时间戳）。 */
  minSingleScanSessionMinutes: 2,
  /** 脏数据阈值：某扫描员在某日的扫描量低于此值时，该日数据整体剔除（不计入效率、汇总与按小时段）。 */
  minDayScanCount: 300,
} as const

export type ScanSettings = {
  openDayThreshold: number
  breakCapMinutes: number
  splitThresholdMinutes: number
  /** 同上；字段名沿用历史快照，语义为「分拣会话最短有效工时」而非仅单笔。 */
  minSingleScanSessionMinutes: number
  /** 脏数据阈值：某扫描员在某日的扫描量低于此值时，该日数据整体剔除。 */
  minDayScanCount: number
}

export const TAB_KEYS = {
  WAREHOUSE: 'warehouse',
  SCANNER: 'scanner',
  FRONT_DESK: 'frontDesk',
  CANCEL_SCAN: 'cancelScan',
  WEEKLY: 'weekly',
  PUSH: 'push',
} as const

export type TabKey = (typeof TAB_KEYS)[keyof typeof TAB_KEYS]
