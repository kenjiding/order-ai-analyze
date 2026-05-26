/** 工资可视化聚合：优先按「昵称」合并为一名员工；无昵称时按人员编号。 */

export type WageRecordLike = {
  employeeId: string | number
  nickname?: string
  name?: string
  surname?: string
  totalWage: number | string
  totalHoursDecimal: number | string
  role: string
  date: string
  isSorting: boolean
  isPublicHoliday: boolean
}

/** 与考勤表列名兼容：记录内一律落在 nickname，但若历史数据或映射遗漏则读常见别名 */
function nicknameFromRecord(r: WageRecordLike): string {
  const o = r as unknown as Record<string, unknown>
  const v = o.nickname ?? o['昵称'] ?? o['Nickname'] ?? o['nickName']
  return String(v ?? '').trim()
}

/** 每人一行：优先「昵称」；昵称为空时用人员编号，避免把不同人捏成一条 */
function employeeGroupKey(r: WageRecordLike): string {
  const nick = nicknameFromRecord(r)
  if (nick) return `nick:${nick}`
  const id = String(r.employeeId ?? '').trim()
  return id ? `emp:${id}` : 'emp:__unknown__'
}

function displayLabelForRecord(r: WageRecordLike): string {
  const nick = nicknameFromRecord(r)
  if (nick) return nick
  const id = String(r.employeeId ?? '').trim()
  if (id) return `（无昵称）${id}`
  const name = String(r.name ?? '').trim()
  const sur = String(r.surname ?? '').trim()
  const cn = `${sur}${name}`.trim()
  if (cn) return cn
  return '未知'
}

export type EmployeeWageRow = {
  label: string
  totalWage: number
  totalHours: number
}

/** 每人总工资、总工时（筛选范围内） */
export function buildEmployeeWageTotals(records: WageRecordLike[], topN = 30): EmployeeWageRow[] {
  const map = new Map<string, { label: string; totalWage: number; totalHours: number }>()
  for (const r of records) {
    const key = employeeGroupKey(r)
    const wage = Number(r.totalWage) || 0
    const h = Number(r.totalHoursDecimal) || 0
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { label: displayLabelForRecord(r), totalWage: wage, totalHours: h })
    } else {
      prev.totalWage += wage
      prev.totalHours += h
    }
  }
  return [...map.values()]
    .sort((a, b) => b.totalWage - a.totalWage)
    .slice(0, topN)
}

/** 按日汇总对账工资与工时 */
export function buildDailyMetrics(records: WageRecordLike[]): {
  date: string
  totalWage: number
  totalHours: number
}[] {
  const map = new Map<string, { totalWage: number; totalHours: number }>()
  for (const r of records) {
    const d = String(r.date ?? '').slice(0, 10)
    if (!d) continue
    const prev = map.get(d) || { totalWage: 0, totalHours: 0 }
    prev.totalWage += Number(r.totalWage) || 0
    prev.totalHours += Number(r.totalHoursDecimal) || 0
    map.set(d, prev)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }))
}
