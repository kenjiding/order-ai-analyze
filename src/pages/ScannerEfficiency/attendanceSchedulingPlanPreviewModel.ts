import { i18n } from '../../i18n/index'

export type AttendanceSchedulingPlanPreview = {
  planDate: string
  title: string
}

export type SchedulingPlanProcess = {
  id: 'forklift' | 'coarse' | 'fine' | 'frontdesk'
  label: string
  defaultPosition: string
  defaultSource: string
}

export type SchedulingPlanHoursStructure = {
  type: 'direct' | 'indirect' | 'mgr'
  label: string
  desc: string
  source: string
}

function t(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: 'scannerEfficiency', ...options }))
}

export function getSchedulingPlanProcesses(): SchedulingPlanProcess[] {
  return [
    {
      id: 'forklift',
      label: t('scheduling.process.forklift'),
      defaultPosition: t('scheduling.operator.defaultPositionForklift'),
      defaultSource: t('scheduling.operator.defaultSourceSupport'),
    },
    {
      id: 'coarse',
      label: t('scheduling.process.coarse'),
      defaultPosition: t('scheduling.operator.defaultPositionCoarse'),
      defaultSource: t('scheduling.operator.defaultSourceProduction'),
    },
    {
      id: 'fine',
      label: t('scheduling.process.fine'),
      defaultPosition: t('scheduling.operator.defaultPositionFine'),
      defaultSource: t('scheduling.operator.defaultSourceProduction'),
    },
    {
      id: 'frontdesk',
      label: t('scheduling.process.frontdesk'),
      defaultPosition: t('scheduling.operator.defaultPositionFrontDesk'),
      defaultSource: t('scheduling.operator.defaultSourceAuxiliary'),
    },
  ]
}

export function getSchedulingPlanHoursStructure(): SchedulingPlanHoursStructure[] {
  return [
    {
      type: 'direct',
      label: t('scheduling.hourType.direct'),
      desc: t('scheduling.hourTypeDesc.direct'),
      source: t('scheduling.hourTypeSource'),
    },
    {
      type: 'indirect',
      label: t('scheduling.hourType.indirect'),
      desc: t('scheduling.hourTypeDesc.indirect'),
      source: t('scheduling.hourTypeSource'),
    },
    {
      type: 'mgr',
      label: t('scheduling.hourType.mgr'),
      desc: t('scheduling.hourTypeDesc.mgr'),
      source: t('scheduling.hourTypeSource'),
    },
  ]
}

/** @deprecated use getSchedulingPlanProcesses() */
export const SCHEDULING_PLAN_PROCESSES = getSchedulingPlanProcesses()

/** @deprecated use getSchedulingPlanHoursStructure() */
export const SCHEDULING_PLAN_HOURS_STRUCTURE = getSchedulingPlanHoursStructure()

function buildDefaultPlanTitle(planDate: string, warehouseTitle: string): string {
  return t('scheduling.planTitle', { warehouse: warehouseTitle, date: planDate })
}

export function buildManualAttendanceSchedulingPlanPreview({
  planDate,
  warehouseTitle,
}: {
  planDate: string
  warehouseTitle?: string
}): AttendanceSchedulingPlanPreview {
  const resolvedWarehouse = warehouseTitle ?? t('scheduling.defaultWarehouse')
  return {
    planDate,
    title: buildDefaultPlanTitle(planDate, resolvedWarehouse),
  }
}

export function flattenPreviewCellTexts(preview: AttendanceSchedulingPlanPreview): Record<string, string> {
  const { planDate } = preview
  const p = (suffix: string) => `${planDate}:${suffix}`
  const out: Record<string, string> = {}
  const processes = getSchedulingPlanProcesses()
  const hoursStructure = getSchedulingPlanHoursStructure()

  out[p('title')] = preview.title

  for (const k of ['s1-inbound', 's1-coarse', 's1-fine', 's1-hours', 's1-count', 's1-total-eff']) {
    out[p(k)] = ''
  }

  for (let i = 0; i < processes.length; i++) {
    for (const suffix of ['qty', 'workhours', 'actual', 'target', 'rate', 'gap', 'verdict', 'reason', 'suggest', 'adjust']) {
      out[p(`s2-${i}-${suffix}`)] = ''
    }
  }

  for (const { type } of hoursStructure) {
    for (const suffix of ['hours', 'ratio', 'note']) {
      out[p(`s3a-${type}-${suffix}`)] = ''
    }
  }

  for (let i = 0; i < processes.length; i++) {
    for (const suffix of ['hours', 'ratio', 'count']) {
      out[p(`s3b-${i}-${suffix}`)] = ''
    }
  }
  for (const suffix of ['hours', 'ratio', 'count']) {
    out[p(`s3b-total-${suffix}`)] = ''
  }

  for (let i = 0; i < processes.length; i++) {
    const proc = processes[i]!
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
  warehouseTitle?: string,
): Record<string, string> {
  const resolvedWarehouse = warehouseTitle ?? t('scheduling.defaultWarehouse')
  const titleKey = `${toPlanDate}:title`
  const currentTitle = cellTexts[titleKey]
  const defaultOld = buildDefaultPlanTitle(fromPlanDate, resolvedWarehouse)
  const defaultNew = buildDefaultPlanTitle(toPlanDate, resolvedWarehouse)

  if (!currentTitle?.trim() || currentTitle === defaultOld) {
    return { ...cellTexts, [titleKey]: defaultNew }
  }
  return cellTexts
}
