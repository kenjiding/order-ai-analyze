import type { LocalEvidenceImage } from './localEvidenceImage'

export type InspectionResult = 'no_risk' | 'risk'

export type DailyChecklistRowState = {
  result: InspectionResult
  evidenceImages: LocalEvidenceImage[]
  /** 无风险时的备注说明 */
  evidenceNote: string
  rectificationMeasure: string
  rectificationDueDate: string
}

export type DailyChecklistFormMeta = {
  warehouseName: string
  inspectorName: string
  inspectionDate: string
}

export type DailyChecklistFormState = {
  meta: DailyChecklistFormMeta
  rows: Record<number, DailyChecklistRowState>
}
