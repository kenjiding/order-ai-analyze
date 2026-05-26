export const SORTING_REQUIRED_COLUMNS = ['扫描时间', '运单号', '扫描员'] as const
export const SCAN_TIME_COLUMNS = ['扫描时间', '时间', '到件时间', '扫描日期', '日期']
export const TRACKING_COLUMNS = ['运单号', '运单号码', '快递单号', '单号', '票号', '面单号']
export const SCANNER_COLUMNS = ['扫描员', '操作员', '作业员', '员工', '姓名']

export const ATTENDANCE_DATE_COLUMNS = ['日期', '考勤日期', '工作日期', '打卡日期', '统计日期', 'date']
export const ATTENDANCE_DURATION_COLUMNS = [
  '总时长',
  '工时',
  '总工时',
  '时长',
  '工作时长',
  '考勤时长',
  '出勤时长',
  '时长(小时)',
  '总时长(小时)',
  '工时(h)',
  '工时(H)',
  '工作小时',
  'hours',
]
export const ATTENDANCE_ID_COLUMNS = ['人员编号', '员工编号', '人员ID', '员工ID', '用户ID', '工号', 'id', 'uid']
export const ATTENDANCE_NAME_COLUMNS = ['昵称', '姓名', '员工姓名', '人员姓名', '分拣员', '分拣工', '员工', 'name', '姓氏']

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
  WEEKLY: 'weekly',
} as const

export type TabKey = (typeof TAB_KEYS)[keyof typeof TAB_KEYS]
