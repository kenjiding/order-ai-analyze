import dayjs from 'dayjs'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DAILY_CHECKLIST_SERIAL_NOS, getDailyChecklistTemplate } from './dailyChecklistTemplate'
import type { LocalEvidenceImage } from './localEvidenceImage'
import type { DailyChecklistFormState, DailyChecklistRowState, InspectionResult } from './types'

function createDefaultRowState(): DailyChecklistRowState {
  return {
    result: 'no_risk',
    evidenceImages: [],
    evidenceNote: '',
    rectificationMeasure: '',
    rectificationDueDate: '',
  }
}

function buildInitialRows(): Record<number, DailyChecklistRowState> {
  const rows: Record<number, DailyChecklistRowState> = {}
  for (const serialNo of DAILY_CHECKLIST_SERIAL_NOS) {
    rows[serialNo] = createDefaultRowState()
  }
  return rows
}

export function useDailyChecklistForm() {
  const { t } = useTranslation('warehouseSafety')
  const template = useMemo(() => getDailyChecklistTemplate(t), [t])

  const [form, setForm] = useState<DailyChecklistFormState>(() => ({
    meta: {
      warehouseName: '',
      inspectorName: '',
      inspectionDate: dayjs().format('YYYY-MM-DD'),
    },
    rows: buildInitialRows(),
  }))
  const [onlyRiskRows, setOnlyRiskRows] = useState(false)

  const riskCount = useMemo(
    () => template.filter((row) => form.rows[row.serialNo]?.result === 'risk').length,
    [form.rows, template],
  )

  const visibleTemplate = useMemo(() => {
    if (!onlyRiskRows) return template
    return template.filter((row) => form.rows[row.serialNo]?.result === 'risk')
  }, [onlyRiskRows, form.rows, template])

  const setMetaField = useCallback(
    <K extends keyof DailyChecklistFormState['meta']>(key: K, value: DailyChecklistFormState['meta'][K]) => {
      setForm((prev) => ({
        ...prev,
        meta: { ...prev.meta, [key]: value },
      }))
    },
    [],
  )

  const setRowResult = useCallback((serialNo: number, result: InspectionResult) => {
    setForm((prev) => {
      const current = prev.rows[serialNo] ?? createDefaultRowState()
      return { ...prev, rows: { ...prev.rows, [serialNo]: { ...current, result } } }
    })
  }, [])

  const setRowEvidenceFields = useCallback(
    (
      serialNo: number,
      patch: Partial<
        Pick<DailyChecklistRowState, 'evidenceNote' | 'rectificationMeasure' | 'rectificationDueDate'>
      >,
    ) => {
      setForm((prev) => {
        const current = prev.rows[serialNo] ?? createDefaultRowState()
        return {
          ...prev,
          rows: { ...prev.rows, [serialNo]: { ...current, ...patch } },
        }
      })
    },
    [],
  )

  const addRowEvidenceImages = useCallback((serialNo: number, images: LocalEvidenceImage[]) => {
    if (images.length === 0) return
    setForm((prev) => {
      const current = prev.rows[serialNo] ?? createDefaultRowState()
      return {
        ...prev,
        rows: {
          ...prev.rows,
          [serialNo]: {
            ...current,
            evidenceImages: [...current.evidenceImages, ...images],
          },
        },
      }
    })
  }, [])

  const removeRowEvidenceImage = useCallback((serialNo: number, imageId: string) => {
    setForm((prev) => {
      const current = prev.rows[serialNo] ?? createDefaultRowState()
      return {
        ...prev,
        rows: {
          ...prev.rows,
          [serialNo]: {
            ...current,
            evidenceImages: current.evidenceImages.filter((img) => img.id !== imageId),
          },
        },
      }
    })
  }, [])

  const markAllNoRisk = useCallback(() => {
    setForm((prev) => {
      const rows: Record<number, DailyChecklistRowState> = {}
      for (const serialNo of DAILY_CHECKLIST_SERIAL_NOS) {
        rows[serialNo] = createDefaultRowState()
      }
      return { ...prev, rows }
    })
  }, [])

  const resetForm = useCallback(() => {
    setForm({
      meta: {
        warehouseName: '',
        inspectorName: '',
        inspectionDate: dayjs().format('YYYY-MM-DD'),
      },
      rows: buildInitialRows(),
    })
    setOnlyRiskRows(false)
  }, [])

  return {
    form,
    onlyRiskRows,
    setOnlyRiskRows,
    riskCount,
    visibleTemplate,
    setMetaField,
    setRowResult,
    setRowEvidenceFields,
    addRowEvidenceImages,
    removeRowEvidenceImage,
    markAllNoRisk,
    resetForm,
  }
}

export type DailyChecklistFormVm = ReturnType<typeof useDailyChecklistForm>
