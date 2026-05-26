import { format } from 'date-fns'
import { isWeekendWorkday, parseDate } from './attendanceDate'

export type EmployeeLite = { employeeId: string; role: string }

const POSITION_TITLE_KEYS = ['职位名称', 'Job Title', 'jobTitle', 'Position', 'position'] as const

function cellString(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const v = row[key]
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim()
    }
  }
  return ''
}

function normalizePositionTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * 考勤行 → 用于 `calculateHourlyRate` 的角色键，**只看「职位名称」列**（及员工表默认）。
 * - LEVEL 2-28 → 普通小工（worker）
 * - LEVEL 3-30 → 叉车（forklift）；若同格文本含「前台」或 reception → 前台（receptionist），时薪档与叉车一致
 * - 其它或空 → 员工表中该人员编号的角色，无则 worker
 */
export function resolveRoleFromAttendanceRow(
  row: Record<string, unknown>,
  employeeRoleMap: Record<string, string>,
): string {
  const employeeId = String(row['人员编号'] ?? row['Employee ID'] ?? row['employeeId'] ?? '')
  const baseRole = employeeRoleMap[employeeId] || 'worker'

  const positionTitle = cellString(row, POSITION_TITLE_KEYS)
  const posNorm = positionTitle ? normalizePositionTitle(positionTitle) : ''

  if (posNorm === 'level 2-28') {
    return 'worker'
  }

  if (posNorm.includes('level 3-30')) {
    if (posNorm.includes('前台') || posNorm.includes('reception')) {
      return 'receptionist'
    }
    return 'forklift'
  }

  return baseRole
}

export function transformSheetRowsToUploadedData(
  jsonData: Record<string, unknown>[],
  employees: EmployeeLite[],
  isSorting: boolean,
  isPublicHoliday: boolean,
): Record<string, unknown>[] {
  const employeeRoleMap: Record<string, string> = {}
  employees.forEach((emp) => {
    employeeRoleMap[emp.employeeId] = emp.role
  })

  const mappedData = jsonData.map((row) => {
    const employeeId = String(row['人员编号'] ?? row['Employee ID'] ?? row['employeeId'] ?? '')
    const role = resolveRoleFromAttendanceRow(row, employeeRoleMap)

    const workdayValue = row['工作日'] ?? row['Workday'] ?? row['workday'] ?? ''
    const dateValue = row['日期'] ?? row['Date'] ?? row['date'] ?? ''

    let weekend = isWeekendWorkday(workdayValue)
    if (!weekend) {
      const dateObj = parseDate(dateValue)
      if (dateObj) {
        const dayOfWeek = dateObj.getDay()
        weekend = dayOfWeek === 0 || dayOfWeek === 6
      }
    }

    let isPublicHolidayRow = false
    let isSortingRow = false
    let weekendOption: string

    if (weekend) {
      if (isPublicHoliday) {
        isPublicHolidayRow = true
        weekendOption = 'publicHoliday'
      } else if (isSorting) {
        isSortingRow = true
        weekendOption = 'sorting'
      } else {
        weekendOption = 'sorting'
        isSortingRow = true
      }
    } else {
      if (isPublicHoliday) {
        isPublicHolidayRow = true
        weekendOption = 'publicHoliday'
      } else if (isSorting) {
        isSortingRow = true
        weekendOption = 'sorting'
      } else {
        weekendOption = 'sorting'
        isSortingRow = true
      }
    }

    return {
      employeeId,
      /** 考勤表「姓名」，仅展示/导出用，不参与校验 */
      name: row['姓名'] ?? row['Name'] ?? row['name'] ?? '',
      surname: row['姓氏'] ?? row['Surname'] ?? row['surname'] ?? '',
      nickname: row['昵称'] ?? row['Nickname'] ?? row['nickname'] ?? '',
      department: row['部门'] ?? row['Department'] ?? row['department'] ?? '',
      date: dateValue,
      workday: workdayValue,
      firstClockIn: row['首次打卡'] ?? row['First Clock In'] ?? row['firstClockIn'] ?? '',
      lastClockOut: row['最后打卡'] ?? row['Last Clock Out'] ?? row['lastClockOut'] ?? '',
      totalHours: row['总时长'] ?? row['Total Hours'] ?? row['totalHours'] ?? '',
      role,
      isPublicHolidayRow,
      isSortingRow,
      weekendOption,
    }
  })

  const dateGroupMap = new Map<string, Set<string>>()

  mappedData.forEach((record) => {
    const dateObj = parseDate(record.date)
    if (dateObj) {
      const dateKey = format(dateObj, 'yyyy-MM-dd')
      if (!dateGroupMap.has(dateKey)) {
        dateGroupMap.set(dateKey, new Set())
      }
      dateGroupMap.get(dateKey)!.add(String(record.employeeId))
    }
  })

  const processedData = mappedData.map((record) => {
    const dateObj = parseDate(record.date)
    if (dateObj && !record.isPublicHolidayRow) {
      const dateKey = format(dateObj, 'yyyy-MM-dd')
      const workerCount = dateGroupMap.get(dateKey)?.size || 0

      if (workerCount < 3) {
        return {
          ...record,
          weekendOption: 'regularWeekend',
          isSortingRow: false,
        }
      }
      return {
        ...record,
        weekendOption: 'sorting',
        isSortingRow: true,
      }
    }
    return record
  })

  return processedData.sort((a, b) => {
    const dateA = parseDate(a.date)
    const dateB = parseDate(b.date)

    if (!dateA) return 1
    if (!dateB) return -1

    return dateA.getTime() - dateB.getTime()
  })
}
