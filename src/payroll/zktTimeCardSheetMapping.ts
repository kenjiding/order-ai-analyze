import { convertDateToStandard } from './attendanceDate'

function readZktField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (value == null) return ''
  return String(value).trim()
}

/** ZKT totalTimeCardReportV2 单条记录 → 与考勤上传表列名一致的行 */
export function mapZktTimeCardToAttendanceSheetRows(records: unknown[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []

  for (const item of records) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>

    rows.push({
      人员编号: readZktField(record, 'emp_code'),
      姓名: readZktField(record, 'first_name'),
      姓氏: readZktField(record, 'last_name'),
      昵称: readZktField(record, 'nick_name'),
      职位编号: readZktField(record, 'position_code'),
      职位名称: readZktField(record, 'position_name'),
      日期: readZktField(record, 'att_date') || readZktField(record, 'att_date_normal'),
      工作日: readZktField(record, 'weekday'),
      实际签到时间: readZktField(record, 'clock_in'),
      实际签退时间: readZktField(record, 'clock_out'),
      总时长: readZktField(record, 'total_hrs'),
      工作时长: readZktField(record, 'worked_hrs'),
      扣减: readZktField(record, 'punishment'),
      奖励: readZktField(record, 'award'),
    })
  }

  return rows
}

/** 与物流运营 ZKT 解析一致：仅保留窗口内日期 */
export function filterZktAttendanceSheetRowsByDateRange(
  rows: Record<string, unknown>[],
  startDate: string,
  endDate: string,
): Record<string, unknown>[] {
  return rows.filter((row) => {
    const raw = String(row['日期'] ?? '').trim()
    if (!raw) return false
    const d = convertDateToStandard(raw) || raw
    return d >= startDate && d <= endDate
  })
}
