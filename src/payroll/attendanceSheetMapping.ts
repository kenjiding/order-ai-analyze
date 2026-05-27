import { format } from 'date-fns'
import { isWeekendWorkday, parseDate } from './attendanceDate'
import { calculateDecimalHours } from './wageRateCalculation'

export type EmployeeLite = { employeeId: string; role: string }

const POSITION_TITLE_KEYS = ['职位名称', 'Job Title', 'jobTitle', 'Position', 'position'] as const
const POSITION_CODE_KEYS = ['职位编号', 'Job Code', 'jobCode', 'Position Code', 'positionCode'] as const
const CLOCK_IN_KEYS = ['实际签到时间', '实际签到', '首次打卡', 'First Clock In', 'firstClockIn'] as const
const CLOCK_OUT_KEYS = ['实际签退时间', '实际签退', '最后打卡', 'Last Clock Out', 'lastClockOut'] as const
const TOTAL_HOURS_KEYS = ['总时长', 'Total Hours', 'totalHours'] as const
const WORK_HOURS_KEYS = ['工作时长', '工作时长(小时)', '工作时长（小时）', 'Work Hours', 'workHours'] as const
const DEDUCTION_KEYS = ['扣减', '扣款', 'Deduction', 'deduction'] as const
const REWARD_KEYS = ['奖励', '奖金', 'Reward', 'reward'] as const

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

function resolveRoleByPositionTitle(positionTitle: string): string | null {
  const posNorm = normalizePositionTitle(positionTitle)
  if (!posNorm) return null

  if (posNorm.includes('level 2-28')) {
    return 'worker'
  }

  if (posNorm.includes('level 2-30') || posNorm.includes('level 3-30')) {
    if (posNorm.includes('前台') || posNorm.includes('reception')) {
      return 'receptionist'
    }
    return 'forklift'
  }

  return null
}

function resolveRoleByPositionCode(positionCodeRaw: string): string | null {
  if (!positionCodeRaw) return null
  const digits = positionCodeRaw.match(/\d+/)?.[0] ?? ''
  if (digits === '28') return 'worker'
  if (digits === '30') return 'forklift'
  return null
}

/**
 * 考勤行 → 用于 `calculateHourlyRate` 的角色键。
 * - 「职位名称」有值时：按职位名称判定（LEVEL 2-28=worker，LEVEL 2-30=forklift/receptionist）
 * - 「职位名称」为空时：按「职位编号」判定（28=worker，30=forklift）
 * - 其余回退到员工表默认角色，无则 worker
 */
export function resolveRoleFromAttendanceRow(
  row: Record<string, unknown>,
  employeeRoleMap: Record<string, string>,
): string {
  const employeeId = String(row['人员编号'] ?? row['Employee ID'] ?? row['employeeId'] ?? '')
  const baseRole = employeeRoleMap[employeeId] || 'worker'

  const positionTitle = cellString(row, POSITION_TITLE_KEYS)
  if (positionTitle) {
    return resolveRoleByPositionTitle(positionTitle) || baseRole
  }

  const positionCode = cellString(row, POSITION_CODE_KEYS)
  const codeRole = resolveRoleByPositionCode(positionCode)
  if (codeRole) return codeRole

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

    const totalHours = cellString(row, TOTAL_HOURS_KEYS)
    const workHours = cellString(row, WORK_HOURS_KEYS)
    const effectiveHours = workHours || totalHours

    return {
      employeeId,
      /** 考勤表「姓名」，仅展示/导出用，不参与校验 */
      name: row['姓名'] ?? row['Name'] ?? row['name'] ?? '',
      surname: row['姓氏'] ?? row['Surname'] ?? row['surname'] ?? '',
      nickname: row['昵称'] ?? row['Nickname'] ?? row['nickname'] ?? '',
      department: row['部门'] ?? row['Department'] ?? row['department'] ?? '',
      date: dateValue,
      workday: workdayValue,
      firstClockIn: cellString(row, CLOCK_IN_KEYS),
      lastClockOut: cellString(row, CLOCK_OUT_KEYS),
      totalHours,
      workHours,
      deduction: cellString(row, DEDUCTION_KEYS),
      reward: cellString(row, REWARD_KEYS),
      /** 工资结算统一口径：直接使用「工作时长」；不存在时回退「总时长」。 */
      effectiveHours,
      role,
      isPublicHolidayRow,
      isSortingRow,
      weekendOption,
    }
  })

  const validHoursData = mappedData.filter((record) => {
    const h = calculateDecimalHours(record.effectiveHours as string | number)
    return Number.isFinite(h) && h > 0
  })

  const dateGroupMap = new Map<string, Set<string>>()

  validHoursData.forEach((record) => {
    const dateObj = parseDate(record.date)
    if (dateObj) {
      const dateKey = format(dateObj, 'yyyy-MM-dd')
      if (!dateGroupMap.has(dateKey)) {
        dateGroupMap.set(dateKey, new Set())
      }
      dateGroupMap.get(dateKey)!.add(String(record.employeeId))
    }
  })

  const processedData = validHoursData.map((record) => {
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
