export type AttendanceSchedulingPushTemplateStoredV1 = {
  version: 1
  planDate: string
  cells: Record<string, string>
}

export type AttendanceSchedulingPushTemplate = {
  planDate: string
  cells: Record<string, string>
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeCells(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || !key.trim()) continue
    if (typeof value !== 'string') continue
    out[key] = value
  }
  return out
}

export function normalizeAttendanceSchedulingPushTemplate(
  raw: unknown,
): AttendanceSchedulingPushTemplate | null {
  if (!isRecord(raw)) return null

  const planDate = typeof raw.planDate === 'string' && ISO_DATE.test(raw.planDate) ? raw.planDate : null
  if (!planDate) return null

  const cells =
    raw.version === 1 && isRecord(raw.cells)
      ? sanitizeCells(raw.cells)
      : sanitizeCells(raw.cells ?? raw.cellTexts)

  return { planDate, cells }
}

export function toAttendanceSchedulingPushTemplatePayload(
  template: AttendanceSchedulingPushTemplate,
): AttendanceSchedulingPushTemplateStoredV1 {
  return {
    version: 1,
    planDate: template.planDate,
    cells: template.cells,
  }
}

export function stripPlanDatePrefixFromCellTexts(
  cellTexts: Record<string, string>,
  planDate: string,
): Record<string, string> {
  const prefix = `${planDate}:`
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(cellTexts)) {
    if (key.startsWith(prefix)) {
      out[key.slice(prefix.length)] = value
    }
  }
  return out
}

export function applyPlanDatePrefixToCellTexts(
  cells: Record<string, string>,
  planDate: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [suffix, value] of Object.entries(cells)) {
    out[`${planDate}:${suffix}`] = value
  }
  return out
}

export function remapCellTextsToPlanDate(
  cellTexts: Record<string, string>,
  fromPlanDate: string,
  toPlanDate: string,
): Record<string, string> {
  if (fromPlanDate === toPlanDate) return cellTexts
  const cells = stripPlanDatePrefixFromCellTexts(cellTexts, fromPlanDate)
  return applyPlanDatePrefixToCellTexts(cells, toPlanDate)
}

export function mergeCellTextsWithBase(
  base: Record<string, string>,
  overlay: Record<string, string>,
): Record<string, string> {
  return { ...base, ...overlay }
}
