import { useMemo } from 'react'
import type {
  AttendanceSchedulingPlanPreview,
  PlanPreviewCell,
  PlanPreviewTable,
} from '../attendanceSchedulingPlanPreviewModel'
import {
  ATTENDANCE_EXTRA_COLUMN_WIDTHS,
  BASE_SHEET_COLUMN_WIDTHS,
} from '../exportAttendanceSchedulingPlanExcel'
import '../attendanceSchedulingPlanPreview.css'

const MAIN_TABLE_COL_WIDTHS = [...BASE_SHEET_COLUMN_WIDTHS]
const ATTENDANCE_TABLE_COL_WIDTHS = [...BASE_SHEET_COLUMN_WIDTHS, ...ATTENDANCE_EXTRA_COLUMN_WIDTHS]

function colWidthPercents(widths: readonly number[]): string[] {
  const total = widths.reduce((sum, w) => sum + w, 0)
  return widths.map((w) => `${(w / total) * 100}%`)
}

type Props = {
  preview: AttendanceSchedulingPlanPreview
  cellTexts: Record<string, string>
  onCellChange: (key: string, text: string) => void
}

function cellClassName(c: PlanPreviewCell): string {
  const parts = ['attendance-plan-preview__cell']
  if (c.variant === 'title') parts.push('attendance-plan-preview__cell--title')
  else if (c.variant === 'section') parts.push('attendance-plan-preview__cell--section')
  else if (c.variant === 'header') parts.push('attendance-plan-preview__cell--header')
  else parts.push('attendance-plan-preview__cell--body')

  if (c.emphasis === 'label') parts.push('attendance-plan-preview__cell--label')
  if (c.emphasis === 'metric') parts.push('attendance-plan-preview__cell--metric')
  if (c.emphasis === 'ratio') parts.push('attendance-plan-preview__cell--ratio')

  if (c.align === 'left') parts.push('attendance-plan-preview__cell--left')
  else if (c.align === 'center' || c.variant === 'header' || c.variant === 'section' || c.variant === 'title') {
    parts.push('attendance-plan-preview__cell--center')
  }
  if (c.tone === 'red') parts.push('attendance-plan-preview__cell--red')
  if (c.tone === 'green') parts.push('attendance-plan-preview__cell--green')
  if (c.editable) parts.push('attendance-plan-preview__cell--editable')
  return parts.join(' ')
}

function renderCellContent(c: PlanPreviewCell, text: string) {
  if (
    !c.editable &&
    c.emphasis === 'ratio' &&
    text.trim() &&
    (c.tone === 'red' || c.tone === 'green')
  ) {
    return <span className="attendance-plan-preview__ratio-pill">{text}</span>
  }
  return text
}

function PreviewTable({
  table,
  cellTexts,
  onCellChange,
}: {
  table: PlanPreviewTable
  cellTexts: Record<string, string>
  onCellChange: (key: string, text: string) => void
}) {
  const columnWidths =
    table.columns === 7
      ? colWidthPercents(MAIN_TABLE_COL_WIDTHS)
      : colWidthPercents(ATTENDANCE_TABLE_COL_WIDTHS)

  return (
    <table
      className={`attendance-plan-preview__table attendance-plan-preview__table--${table.columns}`}
    >
      <colgroup>
        {columnWidths.map((width, index) => (
          <col key={index} style={{ width }} />
        ))}
      </colgroup>
      <tbody>
        {table.rows.map((row, rowIndex) => {
          if (row.length === 0) {
            return (
              <tr key={`spacer-${rowIndex}`}>
                <td colSpan={table.columns} className="attendance-plan-preview__spacer" />
              </tr>
            )
          }
          return (
            <tr key={row.map((c) => c.key).join('|') || `row-${rowIndex}`}>
              {row.map((c) => {
                const text = cellTexts[c.key] ?? c.text
                const content = renderCellContent(c, text)
                if (c.editable) {
                  return (
                    <td
                      key={c.key}
                      colSpan={c.colSpan}
                      className={cellClassName(c)}
                      contentEditable
                      suppressContentEditableWarning
                      data-cell-key={c.key}
                      onBlur={(e) => onCellChange(c.key, e.currentTarget.innerText)}
                    >
                      {content}
                    </td>
                  )
                }
                return (
                  <td key={c.key} colSpan={c.colSpan} className={cellClassName(c)}>
                    {content}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function AttendanceSchedulingPlanPreviewView({
  preview,
  cellTexts,
  onCellChange,
}: Props) {
  const tables = useMemo(() => preview.tables, [preview.tables])
  const [mainTable, attendanceTable] = tables

  return (
    <div className="attendance-plan-preview">
      {mainTable && (
        <div className="attendance-plan-preview__block">
          <div className="attendance-plan-preview__block-label">计划概览</div>
          <div className="attendance-plan-preview__block-body">
            <PreviewTable table={mainTable} cellTexts={cellTexts} onCellChange={onCellChange} />
          </div>
        </div>
      )}
      {attendanceTable && (
        <div className="attendance-plan-preview__attendance-table">
          <PreviewTable
            table={attendanceTable}
            cellTexts={cellTexts}
            onCellChange={onCellChange}
          />
        </div>
      )}
    </div>
  )
}
