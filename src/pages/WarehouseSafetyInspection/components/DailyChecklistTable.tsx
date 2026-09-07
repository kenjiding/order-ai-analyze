import { DatePicker, Image, Input, Radio, Tooltip } from 'antd'
import dayjs from 'dayjs'
import { Camera, Download, Filter, ImagePlus, Loader2, RotateCcw, X } from 'lucide-react'
import { useCallback, useId, useState, type ChangeEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { PERMISSION_KEYS, usePermission } from '../../../hooks/usePermission'
import { showToast } from '../../../utils/toast'
import { confirmDialog } from '../../../utils/confirmDialog'
import {
  exportDailyChecklistExcel,
  validateDailyChecklistForExport,
} from '../exportDailyChecklistExcel'
import { DAILY_CHECKLIST_SERIAL_NOS } from '../dailyChecklistTemplate'
import { readLocalEvidenceImage, type LocalEvidenceImage } from '../localEvidenceImage'
import type { DailyChecklistFormVm } from '../useDailyChecklistForm'
import type { InspectionResult } from '../types'

type Props = {
  vm: DailyChecklistFormVm
}

export function DailyChecklistTable({ vm }: Props) {
  const { t } = useTranslation('warehouseSafety')
  const canExport = usePermission(PERMISSION_KEYS.btnWarehouseSafetyExport)
  const {
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
  } = vm

  const [exporting, setExporting] = useState(false)

  const onExport = useCallback(async () => {
    const issues = validateDailyChecklistForExport(form)
    if (issues.length > 0) {
      showToast(issues[0].message, 'error')
      return
    }
    setExporting(true)
    try {
      await exportDailyChecklistExcel(form)
      showToast(t('toast.exportSuccess'), 'success')
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('toast.exportFailed')
      showToast(msg, 'error')
    } finally {
      setExporting(false)
    }
  }, [form, t])

  return (
    <div className="space-y-4">
      <section className="admin-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid flex-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <label className="block text-xs font-medium text-slate-600">
              {t('meta.warehouseLabel')}
              <Input
                className="mt-1"
                placeholder={t('meta.warehousePlaceholder')}
                value={form.meta.warehouseName}
                onChange={(e) => setMetaField('warehouseName', e.target.value)}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              {t('meta.inspectorLabel')}
              <Input
                className="mt-1"
                placeholder={t('meta.inspectorPlaceholder')}
                value={form.meta.inspectorName}
                onChange={(e) => setMetaField('inspectorName', e.target.value)}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              {t('meta.inspectionDateLabel')}
              <DatePicker
                className="mt-1 w-full"
                value={form.meta.inspectionDate ? dayjs(form.meta.inspectionDate) : null}
                onChange={(d) => setMetaField('inspectionDate', d ? d.format('YYYY-MM-DD') : '')}
                allowClear={false}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="rounded-md bg-slate-100 px-2.5 py-1">
              <Trans
                i18nKey="meta.itemCount"
                t={t}
                values={{ total: DAILY_CHECKLIST_SERIAL_NOS.length, riskCount }}
                components={{ 1: <strong className="text-red-600" /> }}
              />
            </span>
          </div>
        </div>
      </section>

      <section className="admin-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
          <p className="text-xs text-slate-600">{t('table.hint')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={[
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
                onlyRiskRows
                  ? 'border-[#2f8f87] bg-[#2f8f87]/10 text-[#1f6f68]'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
              ].join(' ')}
              onClick={() => setOnlyRiskRows(!onlyRiskRows)}
            >
              <Filter className="h-3.5 w-3.5" aria-hidden />
              {onlyRiskRows ? t('actions.showAll') : t('actions.onlyRisk')}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              onClick={markAllNoRisk}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              {t('actions.markAllNoRisk')}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => {
                void confirmDialog({
                  title: t('confirm.clearTitle'),
                  content: t('confirm.clearContent'),
                  okText: t('confirm.clearOk'),
                  danger: true,
                }).then((confirmed) => {
                  if (confirmed) resetForm()
                })
              }}
            >
              {t('actions.clear')}
            </button>
            <Tooltip title={!canExport ? t('actions.noPermission') : undefined}>
              <button
                type="button"
                disabled={exporting || !canExport}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#1f6f68] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#185a54] disabled:opacity-60"
                onClick={() => void onExport()}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                {exporting ? t('actions.exporting') : t('actions.exportExcel')}
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="bg-[#e8eef2] text-xs font-semibold text-slate-800">
                <th className="w-12 border border-slate-300 px-2 py-2.5 text-center">{t('table.colSerialNo')}</th>
                <th className="w-[7%] border border-slate-300 px-2 py-2.5 text-center">{t('table.colCategory')}</th>
                <th className="w-[14%] border border-slate-300 px-2 py-2.5 text-center">{t('table.colItem')}</th>
                <th className="border border-slate-300 px-2 py-2.5 text-center">{t('table.colKeyPoint')}</th>
                <th className="w-[11%] border border-slate-300 px-2 py-2.5 text-center">
                  {t('table.colResult')}
                  <div className="mt-0.5 font-normal text-slate-500">{t('table.colResultHint')}</div>
                </th>
                <th className="w-[26%] border border-slate-300 px-2 py-2.5 text-center">
                  {t('table.colEvidence')}
                  <div className="mt-0.5 font-normal text-slate-500">{t('table.colEvidenceHint')}</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleTemplate.length === 0 ? (
                <tr>
                  <td colSpan={6} className="border border-slate-200 px-4 py-10 text-center text-slate-500">
                    {t('table.emptyRiskFilter')}
                  </td>
                </tr>
              ) : (
                visibleTemplate.map((tpl, visIdx) => {
                  const row = form.rows[tpl.serialNo]
                  const showCategory =
                    visIdx === 0 || visibleTemplate[visIdx - 1].category !== tpl.category
                  const showItem = visIdx === 0 || visibleTemplate[visIdx - 1].item !== tpl.item
                  const categoryRowSpan = showCategory
                    ? visibleTemplate.slice(visIdx).filter((r) => r.category === tpl.category).length
                    : 0
                  const itemRowSpan = showItem
                    ? visibleTemplate.slice(visIdx).filter((r) => r.item === tpl.item).length
                    : 0

                  return (
                    <tr
                      key={tpl.serialNo}
                      className={row.result === 'risk' ? 'bg-red-50/40' : 'bg-white'}
                    >
                      <td className="border border-slate-200 px-2 py-2 text-center text-slate-700">
                        {tpl.serialNo}
                      </td>
                      {showCategory ? (
                        <td
                          rowSpan={categoryRowSpan}
                          className="border border-slate-200 bg-slate-50/50 px-2 py-2 text-center align-middle text-xs font-medium text-slate-800"
                        >
                          {tpl.category}
                        </td>
                      ) : null}
                      {showItem ? (
                        <td
                          rowSpan={itemRowSpan}
                          className="border border-slate-200 px-2 py-2 align-middle text-xs text-slate-800"
                        >
                          {tpl.item}
                        </td>
                      ) : null}
                      <td className="border border-slate-200 px-2 py-2 text-xs leading-relaxed text-slate-700">
                        <span className="font-medium text-slate-500">{tpl.serialNo}. </span>
                        {tpl.keyPoint}
                      </td>
                      <td className="border border-slate-200 px-2 py-2 text-center">
                        <Radio.Group
                          value={row.result}
                          onChange={(e) => setRowResult(tpl.serialNo, e.target.value as InspectionResult)}
                          className="flex flex-col items-stretch gap-1"
                        >
                          <Radio value="no_risk" className="!m-0">
                            {t('result.noRisk')}
                          </Radio>
                          <Radio value="risk" className="!m-0">
                            {t('result.risk')}
                          </Radio>
                        </Radio.Group>
                      </td>
                      <td className="border border-slate-200 px-2 py-2 align-top">
                        <EvidenceRectificationCell
                          serialNo={tpl.serialNo}
                          result={row.result}
                          evidenceNote={row.evidenceNote}
                          measure={row.rectificationMeasure}
                          dueDate={row.rectificationDueDate}
                          images={row.evidenceImages}
                          onNoteChange={(v) =>
                            setRowEvidenceFields(tpl.serialNo, { evidenceNote: v })
                          }
                          onMeasureChange={(v) =>
                            setRowEvidenceFields(tpl.serialNo, { rectificationMeasure: v })
                          }
                          onDueDateChange={(v) =>
                            setRowEvidenceFields(tpl.serialNo, { rectificationDueDate: v })
                          }
                          onAddImages={addRowEvidenceImages}
                          onRemove={(id) => removeRowEvidenceImage(tpl.serialNo, id)}
                        />
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function EvidenceRectificationCell({
  serialNo,
  result,
  evidenceNote,
  measure,
  dueDate,
  images,
  onNoteChange,
  onMeasureChange,
  onDueDateChange,
  onAddImages,
  onRemove,
}: {
  serialNo: number
  result: InspectionResult
  evidenceNote: string
  measure: string
  dueDate: string
  images: LocalEvidenceImage[]
  onNoteChange: (v: string) => void
  onMeasureChange: (v: string) => void
  onDueDateChange: (v: string) => void
  onAddImages: (serialNo: number, images: LocalEvidenceImage[]) => void
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation('warehouseSafety')
  const isRisk = result === 'risk'

  return (
    <div className="space-y-2">
      {isRisk ? (
        <>
          <Input.TextArea
            rows={2}
            placeholder={t('evidence.measurePlaceholder')}
            value={measure}
            onChange={(e) => onMeasureChange(e.target.value)}
            className="text-xs"
          />
          <label className="block text-[11px] font-medium text-slate-500">
            {t('evidence.dueDateLabel')}
            <DatePicker
              className="mt-1 w-full"
              value={dueDate ? dayjs(dueDate) : null}
              onChange={(d) => onDueDateChange(d ? d.format('YYYY-MM-DD') : '')}
              placeholder={t('evidence.dueDatePlaceholder')}
            />
          </label>
        </>
      ) : (
        <Input.TextArea
          rows={2}
          placeholder={t('evidence.notePlaceholder')}
          value={evidenceNote}
          onChange={(e) => onNoteChange(e.target.value)}
          className="text-xs"
        />
      )}
      <EvidencePhotoPicker
        serialNo={serialNo}
        images={images}
        onAddImages={onAddImages}
        onRemove={onRemove}
      />
    </div>
  )
}

function EvidencePhotoPicker({
  serialNo,
  images,
  onAddImages,
  onRemove,
}: {
  serialNo: number
  images: LocalEvidenceImage[]
  onAddImages: (serialNo: number, images: LocalEvidenceImage[]) => void
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation('warehouseSafety')
  const inputId = useId()
  const [loading, setLoading] = useState(false)

  const onFilesPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files?.length ? Array.from(e.target.files) : []
    e.target.value = ''
    if (!list.length) return

    setLoading(true)
    const added: LocalEvidenceImage[] = []
    const errors: string[] = []
    try {
      for (const file of list) {
        try {
          added.push(await readLocalEvidenceImage(file))
        } catch (err) {
          errors.push(err instanceof Error ? err.message : t('toast.fileReadFailed', { name: file.name }))
        }
      }
      if (added.length > 0) {
        onAddImages(serialNo, added)
        showToast(t('toast.photosAdded', { count: added.length }), 'success')
      }
      if (errors.length === 1) {
        showToast(errors[0]!, 'error')
      } else if (errors.length > 1) {
        showToast(errors.join('；'), 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        className={[
          'inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed px-2 py-2 text-xs font-medium transition',
          loading
            ? 'cursor-wait border-slate-200 bg-slate-100 text-slate-500'
            : 'border-slate-300 bg-slate-50/80 text-slate-600 hover:border-[#2f8f87]/50 hover:bg-[#2f8f87]/5 hover:text-[#1f6f68]',
        ].join(' ')}
      >
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
            {t('evidence.reading')}
          </>
        ) : (
          <>
            <ImagePlus className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('evidence.uploadPhotos')}
          </>
        )}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        disabled={loading}
        onChange={(e) => void onFilesPicked(e)}
      />

      {images.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-[#1f6f68]">
            {t('evidence.selectedCount', { count: images.length })}
          </p>
          <Image.PreviewGroup>
            <ul className="flex flex-wrap gap-2" aria-label={t('evidence.previewAriaLabel')}>
              {images.map((img) => (
                <li key={img.id} className="group relative">
                  <div className="h-16 w-16 overflow-hidden rounded border border-slate-200 bg-slate-100">
                    <Image
                      src={img.dataUrl}
                      alt={img.name}
                      width={64}
                      height={64}
                      className="!h-16 !w-16 object-cover"
                      preview={{ mask: <Camera className="h-4 w-4" /> }}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={t('evidence.removePhoto', { name: img.name })}
                    className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800/90 text-white shadow-sm transition hover:bg-red-600"
                    onClick={() => onRemove(img.id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <p className="mt-0.5 max-w-[64px] truncate text-[10px] text-slate-500" title={img.name}>
                    {img.name}
                  </p>
                </li>
              ))}
            </ul>
          </Image.PreviewGroup>
        </div>
      ) : null}
    </div>
  )
}
