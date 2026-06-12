import type { FinanceLedgerRow } from './financeLedgerMapping'

export const RECONCILIATION_TOLERANCE = 0.01

export type ReconciliationStatus = 'matched' | 'fieldMismatch' | 'systemOnly' | 'financeOnly'

export type FieldDiffKind = 'hours' | 'wage' | 'position' | 'workday'

export type FieldDiff = {
  kind: FieldDiffKind
  financeValue: string
  systemValue: string
  delta: number | null
}

export type ReconciliationRow = {
  status: ReconciliationStatus
  date: string
  personLabel: string
  financePersonName: string
  systemPersonName: string
  financePosition: string
  systemPosition: string
  financeWorkday: string
  systemWorkday: string
  /** 财务出勤小时原值 */
  financeHours: string | null
  systemHours: number | null
  hoursDelta: number | null
  financeWage: number | null
  systemWage: number | null
  wageDelta: number | null
  fieldDiffs: FieldDiff[]
  duplicateFinanceKey?: boolean
}

export type ReconciliationSummary = {
  financeTotalHours: number
  systemTotalHours: number
  hoursDelta: number
  financeTotalWage: number
  systemTotalWage: number
  wageDelta: number
  matchedCount: number
  fieldMismatchCount: number
  systemOnlyCount: number
  financeOnlyCount: number
  duplicateFinanceKeyCount: number
}

export type ReconciliationResult = {
  rows: ReconciliationRow[]
  summary: ReconciliationSummary
}

export type SystemWageRecordLike = {
  date: string
  name?: string
  surname?: string
  nickname?: string
  workday?: string
  positionTitle?: string
  totalHoursDecimal: number | string
  totalWage: number | string
}

/** 人员名规范化：trim、小写、合并空白、去常见标点 */
export function normalizePersonLabel(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.,\-_·'"]/g, '')
    .replace(/\s+/g, '')
}

const WEEKDAY_TOKEN_MAP: Record<string, string> = {
  mon: 'mon',
  monday: 'mon',
  周一: 'mon',
  星期一: 'mon',
  tue: 'tue',
  tues: 'tue',
  tuesday: 'tue',
  周二: 'tue',
  星期二: 'tue',
  wed: 'wed',
  wednesday: 'wed',
  周三: 'wed',
  星期三: 'wed',
  thu: 'thu',
  thur: 'thu',
  thurs: 'thu',
  thursday: 'thu',
  周四: 'thu',
  星期四: 'thu',
  fri: 'fri',
  friday: 'fri',
  周五: 'fri',
  星期五: 'fri',
  sat: 'sat',
  saturday: 'sat',
  周六: 'sat',
  星期六: 'sat',
  sun: 'sun',
  sunday: 'sun',
  周日: 'sun',
  周天: 'sun',
  星期日: 'sun',
}

/** 工作日规范化到统一 token（mon/tue/...）或原串小写 */
export function normalizeWorkdayLabel(raw: unknown): string {
  const s = String(raw ?? '')
    .trim()
    .replace(/周天/g, '周日')
  if (!s) return ''
  const lower = s.toLowerCase().replace(/\s+/g, '')
  for (const [key, token] of Object.entries(WEEKDAY_TOKEN_MAP)) {
    if (lower === key.toLowerCase().replace(/\s+/g, '') || s.includes(key)) {
      return token
    }
  }
  return lower
}

export function normalizePositionLabel(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function withinTolerance(a: number, b: number, tolerance = RECONCILIATION_TOLERANCE): boolean {
  return Math.abs(a - b) <= tolerance
}

function buildMatchKey(date: string, personNorm: string): string {
  return `${date}|${personNorm}`
}

function systemPersonCandidates(record: SystemWageRecordLike): string[] {
  const nickname = String(record.nickname ?? '').trim()
  const name = String(record.name ?? '').trim()
  const surname = String(record.surname ?? '').trim()
  const fullName = `${surname}${name}`.trim()

  const labels = [nickname, name, fullName].filter(Boolean)
  const seen = new Set<string>()
  const norms: string[] = []
  for (const label of labels) {
    const norm = normalizePersonLabel(label)
    if (norm && !seen.has(norm)) {
      seen.add(norm)
      norms.push(norm)
    }
  }
  return norms
}

function displaySystemPerson(record: SystemWageRecordLike): string {
  const name = String(record.name ?? '').trim()
  if (name) return name
  const o = record as Record<string, unknown>
  const fromAlias = String(o['姓名'] ?? o['Name'] ?? '').trim()
  return fromAlias || '未知'
}

function displaySystemPosition(record: SystemWageRecordLike): string {
  const title = String(record.positionTitle ?? '').trim()
  if (title) return title
  const o = record as Record<string, unknown>
  return String(o['职位名称'] ?? o['Job Title'] ?? '').trim()
}

function compareFields(
  finance: FinanceLedgerRow,
  system: SystemWageRecordLike,
): FieldDiff[] {
  const diffs: FieldDiff[] = []
  const sysHours = round2(Number(system.totalHoursDecimal) || 0)
  const sysWage = round2(Number(system.totalWage) || 0)
  const finHours = round2(finance.attendanceHours)
  const finWage = round2(finance.excludingTaxAmount)

  if (!withinTolerance(finHours, sysHours)) {
    diffs.push({
      kind: 'hours',
      financeValue: finance.attendanceHoursRaw,
      systemValue: sysHours.toFixed(2),
      delta: round2(finHours - sysHours),
    })
  }

  if (!withinTolerance(finWage, sysWage)) {
    diffs.push({
      kind: 'wage',
      financeValue: finWage.toFixed(2),
      systemValue: sysWage.toFixed(2),
      delta: round2(finWage - sysWage),
    })
  }

  const finPos = normalizePositionLabel(finance.positionName)
  const sysPos = normalizePositionLabel(displaySystemPosition(system))
  if (finPos && sysPos && finPos !== sysPos) {
    diffs.push({
      kind: 'position',
      financeValue: finance.positionName,
      systemValue: displaySystemPosition(system),
      delta: null,
    })
  } else if (finPos && !sysPos && finance.positionName) {
    diffs.push({
      kind: 'position',
      financeValue: finance.positionName,
      systemValue: '-',
      delta: null,
    })
  }

  const finWd = normalizeWorkdayLabel(finance.workday)
  const sysWd = normalizeWorkdayLabel(system.workday)
  if (finWd && sysWd && finWd !== sysWd) {
    diffs.push({
      kind: 'workday',
      financeValue: finance.workday,
      systemValue: String(system.workday ?? ''),
      delta: null,
    })
  }

  return diffs
}

function buildReconciliationRow(
  status: ReconciliationStatus,
  finance: FinanceLedgerRow | null,
  system: SystemWageRecordLike | null,
  fieldDiffs: FieldDiff[] = [],
  duplicateFinanceKey = false,
): ReconciliationRow {
  const finHoursNum = finance ? round2(finance.attendanceHours) : null
  const finWage = finance ? round2(finance.excludingTaxAmount) : null
  const sysHours = system ? round2(Number(system.totalHoursDecimal) || 0) : null
  const sysWage = system ? round2(Number(system.totalWage) || 0) : null

  return {
    status,
    date: finance?.date ?? system?.date ?? '',
    personLabel: finance?.personName ?? (system ? displaySystemPerson(system) : ''),
    financePersonName: finance?.personName ?? '',
    systemPersonName: system ? displaySystemPerson(system) : '',
    financePosition: finance?.positionName ?? '',
    systemPosition: system ? displaySystemPosition(system) : '',
    financeWorkday: finance?.workday ?? '',
    systemWorkday: String(system?.workday ?? ''),
    financeHours: finance?.attendanceHoursRaw ?? null,
    systemHours: sysHours,
    hoursDelta:
      finHoursNum != null && sysHours != null ? round2(finHoursNum - sysHours) : null,
    financeWage: finWage,
    systemWage: sysWage,
    wageDelta: finWage != null && sysWage != null ? round2(finWage - sysWage) : null,
    fieldDiffs,
    duplicateFinanceKey,
  }
}

export function reconcileFinanceWithWageRecords(
  financeRows: FinanceLedgerRow[],
  wageRecords: SystemWageRecordLike[],
): ReconciliationResult {
  /** finance key -> queue of unmatched finance rows */
  const financeIndex = new Map<string, FinanceLedgerRow[]>()
  for (const fin of financeRows) {
    const key = buildMatchKey(fin.date, normalizePersonLabel(fin.personName))
    const list = financeIndex.get(key) ?? []
    list.push(fin)
    financeIndex.set(key, list)
  }

  const duplicateFinanceKeys = new Set<string>()
  for (const [key, list] of financeIndex.entries()) {
    if (list.length > 1) duplicateFinanceKeys.add(key)
  }

  const matchedFinanceRows = new Set<FinanceLedgerRow>()
  const rows: ReconciliationRow[] = []

  function takeFinanceMatch(date: string, candidates: string[]): FinanceLedgerRow | null {
    for (const norm of candidates) {
      const key = buildMatchKey(date, norm)
      const list = financeIndex.get(key)
      if (!list || list.length === 0) continue
      const fin = list.find((r) => !matchedFinanceRows.has(r))
      if (fin) {
        matchedFinanceRows.add(fin)
        return fin
      }
    }
    return null
  }

  for (const system of wageRecords) {
    const date = String(system.date ?? '').slice(0, 10)
    const candidates = systemPersonCandidates(system)
    const matchedFinance = takeFinanceMatch(date, candidates)

    if (!matchedFinance) {
      rows.push(buildReconciliationRow('systemOnly', null, { ...system, date }))
      continue
    }

    const matchKey = buildMatchKey(date, normalizePersonLabel(matchedFinance.personName))
    const duplicateFinanceKey = duplicateFinanceKeys.has(matchKey)
    const fieldDiffs = compareFields(matchedFinance, { ...system, date })
    const status: ReconciliationStatus =
      fieldDiffs.length === 0 ? 'matched' : 'fieldMismatch'

    rows.push(
      buildReconciliationRow(status, matchedFinance, { ...system, date }, fieldDiffs, duplicateFinanceKey),
    )
  }

  for (const fin of financeRows) {
    if (!matchedFinanceRows.has(fin)) {
      const key = buildMatchKey(fin.date, normalizePersonLabel(fin.personName))
      rows.push(
        buildReconciliationRow('financeOnly', fin, null, [], duplicateFinanceKeys.has(key)),
      )
    }
  }

  rows.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date)
    if (dateCmp !== 0) return dateCmp
    return a.personLabel.localeCompare(b.personLabel, 'zh-CN')
  })

  const financeTotalHours = round2(financeRows.reduce((s, r) => s + r.attendanceHours, 0))
  const financeTotalWage = round2(financeRows.reduce((s, r) => s + r.excludingTaxAmount, 0))
  const systemTotalHours = round2(
    wageRecords.reduce((s, r) => s + (Number(r.totalHoursDecimal) || 0), 0),
  )
  const systemTotalWage = round2(wageRecords.reduce((s, r) => s + (Number(r.totalWage) || 0), 0))

  const summary: ReconciliationSummary = {
    financeTotalHours,
    systemTotalHours,
    hoursDelta: round2(financeTotalHours - systemTotalHours),
    financeTotalWage,
    systemTotalWage,
    wageDelta: round2(financeTotalWage - systemTotalWage),
    matchedCount: rows.filter((r) => r.status === 'matched').length,
    fieldMismatchCount: rows.filter((r) => r.status === 'fieldMismatch').length,
    systemOnlyCount: rows.filter((r) => r.status === 'systemOnly').length,
    financeOnlyCount: rows.filter((r) => r.status === 'financeOnly').length,
    duplicateFinanceKeyCount: rows.filter((r) => r.duplicateFinanceKey).length,
  }

  return { rows, summary }
}

const STATUS_LABEL: Record<ReconciliationStatus, string> = {
  matched: '一致',
  fieldMismatch: '字段差异',
  systemOnly: '仅系统',
  financeOnly: '仅财务',
}

export function buildReconciliationExportRows(result: ReconciliationResult): Record<string, string | number>[] {
  return result.rows.map((row) => ({
    状态: STATUS_LABEL[row.status],
    日期: row.date,
    人员: row.personLabel,
    '财务-人员': row.financePersonName,
    '系统-人员': row.systemPersonName,
    '财务-职位': row.financePosition,
    '系统-职位': row.systemPosition,
    '财务-工作日': row.financeWorkday,
    '系统-工作日': row.systemWorkday,
    '财务-工时': row.financeHours ?? '',
    '系统-工时': row.systemHours ?? '',
    工时差额: row.hoursDelta ?? '',
    '财务-工资': row.financeWage ?? '',
    '系统-工资': row.systemWage ?? '',
    工资差额: row.wageDelta ?? '',
    差异字段: row.fieldDiffs.map((d) => d.kind).join(', '),
    财务重复键: row.duplicateFinanceKey ? '是' : '',
  }))
}
