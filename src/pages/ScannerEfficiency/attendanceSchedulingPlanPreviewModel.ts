export type AttendanceSchedulingPlanPreview = {
  planDate: string
  title: string
}

export const SCHEDULING_PLAN_PROCESSES = [
  { id: 'forklift' as const, label: '叉车', defaultPosition: '叉车', defaultSource: '保障岗' },
  { id: 'coarse' as const, label: '粗分', defaultPosition: '粗分+入站', defaultSource: '生产岗' },
  { id: 'fine' as const, label: '细分', defaultPosition: '细分', defaultSource: '生产岗' },
  { id: 'frontdesk' as const, label: '前台', defaultPosition: '前台', defaultSource: '辅助岗' },
]

export const SCHEDULING_PLAN_HOURS_STRUCTURE = [
  { type: 'direct', label: '直接作业工时', desc: '生产/处理类岗位', source: '出勤明细' },
  { type: 'indirect', label: '间接作业工时', desc: '保障/流转/前台等', source: '出勤明细' },
  { type: 'mgr', label: '管理人员工时', desc: '管理/现场协调', source: '出勤明细' },
] as const

function buildDefaultPlanTitle(planDate: string, warehouseTitle: string): string {
  return `${warehouseTitle} ${planDate}日期 排班计划`
}

export function buildManualAttendanceSchedulingPlanPreview({
  planDate,
  warehouseTitle = '阿德莱德区域',
}: {
  planDate: string
  warehouseTitle?: string
}): AttendanceSchedulingPlanPreview {
  return {
    planDate,
    title: buildDefaultPlanTitle(planDate, warehouseTitle),
  }
}

export function flattenPreviewCellTexts(preview: AttendanceSchedulingPlanPreview): Record<string, string> {
  const { planDate } = preview
  const p = (suffix: string) => `${planDate}:${suffix}`
  const out: Record<string, string> = {}

  out[p('title')] = preview.title

  // Section 1: overview totals (s1-hours, s1-count, s1-total-eff are computed)
  for (const k of ['s1-inbound', 's1-coarse', 's1-fine', 's1-hours', 's1-count', 's1-total-eff']) {
    out[p(k)] = ''
  }

  // Section 2: previous day efficiency review (per process)
  for (let i = 0; i < SCHEDULING_PLAN_PROCESSES.length; i++) {
    for (const suffix of ['qty', 'workhours', 'actual', 'target', 'rate', 'gap', 'verdict', 'reason', 'suggest', 'adjust']) {
      out[p(`s2-${i}-${suffix}`)] = ''
    }
  }

  // Section 3A: hours structure breakdown
  for (const { type } of SCHEDULING_PLAN_HOURS_STRUCTURE) {
    for (const suffix of ['hours', 'ratio', 'note']) {
      out[p(`s3a-${type}-${suffix}`)] = ''
    }
  }

  // Section 3B: per-process hour summary + total row
  for (let i = 0; i < SCHEDULING_PLAN_PROCESSES.length; i++) {
    for (const suffix of ['hours', 'ratio', 'count']) {
      out[p(`s3b-${i}-${suffix}`)] = ''
    }
  }
  for (const suffix of ['hours', 'ratio', 'count']) {
    out[p(`s3b-total-${suffix}`)] = ''
  }

  // Section 4: next day attendance plan + total row
  for (let i = 0; i < SCHEDULING_PLAN_PROCESSES.length; i++) {
    const proc = SCHEDULING_PLAN_PROCESSES[i]!
    out[p(`s4-${i}-position`)] = proc.defaultPosition
    out[p(`s4-${i}-source`)] = proc.defaultSource
    for (const suffix of ['qty', 'eff', 'count', 'start', 'end', 'hours', 'hratio', 'remark']) {
      out[p(`s4-${i}-${suffix}`)] = ''
    }
  }
  for (const suffix of ['count', 'hours']) {
    out[p(`s4-total-${suffix}`)] = ''
  }

  return out
}

export function resolveAttendanceSchedulingPlanTitle(
  preview: AttendanceSchedulingPlanPreview,
  cellTexts: Record<string, string>,
): string {
  return cellTexts[`${preview.planDate}:title`]?.trim() || preview.title
}

export function syncPlanTitleForDateChange(
  cellTexts: Record<string, string>,
  fromPlanDate: string,
  toPlanDate: string,
  warehouseTitle = '阿德莱德区域',
): Record<string, string> {
  const titleKey = `${toPlanDate}:title`
  const currentTitle = cellTexts[titleKey]
  const defaultOld = buildDefaultPlanTitle(fromPlanDate, warehouseTitle)
  const defaultNew = buildDefaultPlanTitle(toPlanDate, warehouseTitle)

  if (!currentTitle?.trim() || currentTitle === defaultOld) {
    return { ...cellTexts, [titleKey]: defaultNew }
  }
  return cellTexts
}
